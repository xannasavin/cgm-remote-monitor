'use strict';

const request = require('request');
const USAGE_COLLECTION_NAME = 'ai_usage_stats';
const EXCHANGE_RATES_COLLECTION_NAME = 'exchange_rates';
const SUMMARY_COLLECTION_NAME = 'ai_usage_summary';

function getExchangeRate(ctx, env) {
  return new Promise(async (resolve, reject) => {
    const targetCurrency = ctx.settings.ai_llm_exchangerate_api_currency;
    if (!targetCurrency) {
      return resolve(null);
    }

    const exchangeRatesCollection = ctx.store.collection(EXCHANGE_RATES_COLLECTION_NAME);
    const apiKey = env.ai_llm_exchangerate_api_key;
    if (!apiKey) {
      console.error('AI_LLM_EXCHANGERATE_API_KEY is not set. Cannot fetch exchange rate.');
      return resolve(null);
    }
    const pollingIntervalDays = ctx.settings.ai_llm_exchangerate_api_poling_intervall || 7;
    const monthlyLimit = ctx.settings.ai_llm_exchangerate_api_limit || 100;

    const lastRate = await exchangeRatesCollection.findOne({}, { sort: { last_fetched: -1 } });

    const now = new Date();
    const oneDay = 24 * 60 * 60 * 1000;
    let needsFetch = true;
    let usageCount = 0;
    let lastFetchMonth = -1;

    if (lastRate) {
      const lastFetchDate = new Date(lastRate.last_fetched);
      lastFetchMonth = lastFetchDate.getUTCMonth();
      const diffDays = Math.round(Math.abs((now - lastFetchDate) / oneDay));
      if (diffDays < pollingIntervalDays) {
        needsFetch = false;
      }
      usageCount = lastRate.monthly_usage_count || 0;
    }

    const currentMonth = now.getUTCMonth();
    if (lastFetchMonth !== currentMonth) {
      usageCount = 0; // Reset monthly usage count
    }

    if (needsFetch && usageCount < monthlyLimit) {
      const requestOptions = {
        uri: 'https://api.exchangerate.host/convert',
        method: 'GET',
        qs: {
          from: 'USD',
          to: targetCurrency,
          amount: 1,
          access_key: apiKey
        },
        json: true
      };

      request(requestOptions, async (error, response, body) => {
        if (error) {
          console.error('Error fetching exchange rate:', error.message);
          if (lastRate) return resolve({ rate: lastRate.rate, currency: lastRate.target_currency });
          return resolve(null);
        }

        if (body && body.success) {
          const rate = body.result;
          if (rate) {
            const newRateRecord = {
              base_currency: 'USD',
              target_currency: targetCurrency,
              rate: rate,
              last_fetched: now,
              monthly_usage_count: usageCount + 1
            };
            await exchangeRatesCollection.insertOne(newRateRecord);
            return resolve({ rate, currency: targetCurrency });
          }
        }

        if (lastRate) return resolve({ rate: lastRate.rate, currency: lastRate.target_currency });
        resolve(null);
      });
    } else {
      if (lastRate) return resolve({ rate: lastRate.rate, currency: lastRate.target_currency });
      resolve(null);
    }
  });
}

// This function will be called from lib/api/index.js to set up the routes
function configure(app, wares, ctx, env) {
  const express = require('express');
  const api = express.Router();

  api.use(wares.bodyParser.json());
  api.use(wares.sendJSONStatus);

  api.post('/record', ctx.authorization.isPermitted('api:treatments:read'), async (req, res) => {
    const { date_from, date_till, days_requested, prompt_tokens_used, completion_tokens_used, total_tokens_used, total_api_calls, repair_calls } = req.body;

    if (
        !date_from ||
        !date_till ||
        typeof days_requested !== 'number' ||
        typeof prompt_tokens_used !== 'number' ||
        typeof completion_tokens_used !== 'number' ||
        typeof total_tokens_used !== 'number' ||
        typeof total_api_calls !== 'number'
    ) {
      return res.sendJSONStatus(res, 400, 'Missing or invalid fields in request body.');
    }

    try {
      const usageCollection = ctx.store.collection(USAGE_COLLECTION_NAME);
      const newRecord = {
        createdAt: new Date(),
        date_from,
        date_till,
        days_requested,
        prompt_tokens_used,
        completion_tokens_used,
        total_tokens_used,
        total_api_calls,
        repair_calls: repair_calls || 0,
      };

      const insertResult = await usageCollection.insertOne(newRecord);

      if (insertResult.insertedId) {
        // Now, update the summary collection
        const summaryCollection = ctx.store.collection(SUMMARY_COLLECTION_NAME);
        const cost_input = ctx.settings.ai_llm_1k_token_costs_input;
        const cost_output = ctx.settings.ai_llm_1k_token_costs_output;
        const recordCost = (prompt_tokens_used / 1000 * cost_input) + (completion_tokens_used / 1000 * cost_output);

        const currentMonthStr = newRecord.createdAt.toISOString().substring(0, 7); // "YYYY-MM"

        const updateOperations = [
          {
            filter: { _id: currentMonthStr },
            update: {
              $inc: {
                requests: 1,
                total_days_requested: days_requested,
                total_prompt_tokens: prompt_tokens_used,
                total_completion_tokens: completion_tokens_used,
                total_tokens: total_tokens_used,
                total_costs: recordCost,
                total_repair_calls: repair_calls || 0,
              }
            }
          },
          {
            filter: { _id: 'all_time' },
            update: {
              $inc: {
                requests: 1,
                total_days_requested: days_requested,
                total_prompt_tokens: prompt_tokens_used,
                total_completion_tokens: completion_tokens_used,
                total_tokens: total_tokens_used,
                total_costs: recordCost,
                total_repair_calls: repair_calls || 0,
              }
            }
          }
        ];

        for (const op of updateOperations) {
            await summaryCollection.findOneAndUpdate(op.filter, op.update, { upsert: true });
        }

        res.json({ message: 'Usage recorded successfully.' });
      } else {
        res.sendJSONStatus(res, 500, 'Failed to record usage: DB insert not acknowledged');
      }
    } catch (error) {
      console.error('Error recording AI usage:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.sendJSONStatus(res, 500, 'Error recording AI usage', { details: errorMessage });
    }
  });

  api.get('/check_limit', ctx.authorization.isPermitted('api:treatments:read'), async (req, res) => {
    try {
      const summaryCollection = ctx.store.collection(SUMMARY_COLLECTION_NAME);
      const monthlyLimit = parseFloat(env.ai_llm_monthly_usd_limit);

      if (isNaN(monthlyLimit) || monthlyLimit <= 0) {
        // If the limit is not set or invalid, there's nothing to check.
        return res.json({
          limitExceeded: false,
          currentCost: 0,
          limit: null
        });
      }

      const now = new Date();
      const currentMonthStr = now.toISOString().substring(0, 7); // "YYYY-MM"

      const monthSummary = await summaryCollection.findOne({ _id: currentMonthStr });

      const currentCost = monthSummary ? monthSummary.total_costs : 0;
      const limitExceeded = currentCost >= monthlyLimit;

      res.json({
        limitExceeded,
        currentCost,
        limit: monthlyLimit
      });

    } catch (error) {
      console.error('Error checking AI usage limit:', error);
      res.sendJSONStatus(res, 500, 'Error checking AI usage limit', { details: error.message });
    }
  });

async function rebuildSummary(ctx) {
    const usageCollection = ctx.store.collection(USAGE_COLLECTION_NAME);
    const summaryCollection = ctx.store.collection(SUMMARY_COLLECTION_NAME);

    // Clear existing summary
    await summaryCollection.deleteMany({});

    const cost_input = ctx.settings.ai_llm_1k_token_costs_input;
    const cost_output = ctx.settings.ai_llm_1k_token_costs_output;

    const monthlyPipeline = [
        {
            $project: {
                month: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
                days_requested: 1,
                prompt_tokens_used: { $ifNull: ["$prompt_tokens_used", 0] },
                completion_tokens_used: { $ifNull: ["$completion_tokens_used", 0] },
                total_tokens_used: 1,
                repair_calls: { $ifNull: ["$repair_calls", 0] },
            }
        },
        {
            $group: {
                _id: "$month",
                requests: { $sum: 1 },
                total_days_requested: { $sum: "$days_requested" },
                total_prompt_tokens: { $sum: "$prompt_tokens_used" },
                total_completion_tokens: { $sum: "$completion_tokens_used" },
                total_tokens: { $sum: "$total_tokens_used" },
                total_repair_calls: { $sum: "$repair_calls" },
            }
        },
        {
            $addFields: {
                total_costs: {
                    $add: [
                        { $multiply: [{ $divide: ["$total_prompt_tokens", 1000] }, cost_input] },
                        { $multiply: [{ $divide: ["$total_completion_tokens", 1000] }, cost_output] }
                    ]
                }
            }
        }
    ];

    const totalPipeline = [
        {
            $group: {
                _id: "all_time",
                requests: { $sum: 1 },
                total_days_requested: { $sum: "$days_requested" },
                total_prompt_tokens: { $sum: { $ifNull: ["$prompt_tokens_used", 0] } },
                total_completion_tokens: { $sum: { $ifNull: ["$completion_tokens_used", 0] } },
                total_tokens: { $sum: "$total_tokens_used" },
                total_repair_calls: { $sum: { $ifNull: ["$repair_calls", 0] } },
            }
        },
        {
            $addFields: {
                total_costs: {
                    $add: [
                        { $multiply: [{ $divide: ["$total_prompt_tokens", 1000] }, cost_input] },
                        { $multiply: [{ $divide: ["$total_completion_tokens", 1000] }, cost_output] }
                    ]
                }
            }
        }
    ];

    const monthlyData = await usageCollection.aggregate(monthlyPipeline).toArray();
    const totalData = await usageCollection.aggregate(totalPipeline).toArray();

    if (monthlyData.length > 0) {
        await summaryCollection.insertMany(monthlyData);
    }
    if (totalData.length > 0) {
        await summaryCollection.insertOne(totalData[0]);
    }
}

  api.post('/rebuild_summary', ctx.authorization.isPermitted('api:treatments:read'), async (req, res) => {
    try {
        await rebuildSummary(ctx);
        res.json({ message: 'Summary recalculated successfully.' });
    } catch (error) {
        console.error('Error rebuilding AI usage summary:', error);
        res.sendJSONStatus(res, 500, 'Error rebuilding AI usage summary', { details: error.message });
    }
  });

  api.post('/delete_old', ctx.authorization.isPermitted('api:treatments:read'), async (req, res) => {
    try {
        const months = req.body.months;
        if (!months || typeof months !== 'number' || months < 1) {
            return res.sendJSONStatus(res, 400, 'Invalid "months" parameter.');
        }

        const usageCollection = ctx.store.collection(USAGE_COLLECTION_NAME);
        const summaryCollection = ctx.store.collection(SUMMARY_COLLECTION_NAME);

        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - months);

        const resultStats = await usageCollection.deleteMany({ createdAt: { $lt: cutoffDate } });

        const cutoffYear = cutoffDate.getFullYear();
        const cutoffMonth = cutoffDate.getMonth() + 1;
        const cutoffMonthStr = `${cutoffYear}-${String(cutoffMonth).padStart(2, '0')}`;

        const resultSummary = await summaryCollection.deleteMany({ _id: { $lt: cutoffMonthStr, $ne: 'all_time' } });

        // Recalculate summary to update the 'all_time' record
        await rebuildSummary(ctx);

        res.json({
            message: `Successfully deleted ${resultStats.deletedCount} raw entries and ${resultSummary.deletedCount} monthly summaries.`
        });

    } catch (error) {
        console.error('Error deleting old AI usage data:', error);
        res.sendJSONStatus(res, 500, 'Error deleting old AI usage data', { details: error.message });
    }
  });

  api.get('/monthly_summary', ctx.authorization.isPermitted('api:treatments:read'), async (req, res) => {
    try {
      const summaryCollection = ctx.store.collection(SUMMARY_COLLECTION_NAME);
      const exchangeRateInfo = await getExchangeRate(ctx, env);

      let allData = await summaryCollection.find({}).toArray();

      let totalData = allData.find(d => d._id === 'all_time') || {};
      let monthlyData = allData.filter(d => d._id !== 'all_time');

      // Sort monthly data descending
      monthlyData.sort((a, b) => b._id.localeCompare(a._id));

      const processRecord = (record) => {
        record.month = record._id;
        record.avg_days_per_request = record.requests ? record.total_days_requested / record.requests : 0;
        record.avg_prompt_tokens_per_request = record.requests ? record.total_prompt_tokens / record.requests : 0;
        record.avg_completion_tokens_per_request = record.requests ? record.total_completion_tokens / record.requests : 0;
        record.avg_tokens_per_request = record.requests ? record.total_tokens / record.requests : 0;
        record.avg_prompt_tokens_per_day = record.total_days_requested ? record.total_prompt_tokens / record.total_days_requested : 0;
        record.avg_completion_tokens_per_day = record.total_days_requested ? record.total_completion_tokens / record.total_days_requested : 0;
        record.avg_tokens_per_day = record.total_days_requested ? record.total_tokens / record.total_days_requested : 0;
        record.avg_costs_per_request = record.requests ? record.total_costs / record.requests : 0;
        record.avg_costs_per_day_requested = record.total_days_requested ? record.total_costs / record.total_days_requested : 0;
        record.avg_repair_calls_per_request = record.requests ? (record.total_repair_calls || 0) / record.requests : 0;

        if (exchangeRateInfo) {
          const currency = exchangeRateInfo.currency.toLowerCase();
          record[`total_costs_${currency}`] = record.total_costs * exchangeRateInfo.rate;
          record[`avg_costs_per_request_${currency}`] = record.avg_costs_per_request * exchangeRateInfo.rate;
          record[`avg_costs_per_day_requested_${currency}`] = record.avg_costs_per_day_requested * exchangeRateInfo.rate;
        }
        return record;
      };

      monthlyData = monthlyData.map(processRecord);
      totalData = processRecord(totalData);

      res.json({
        monthly: monthlyData,
        total: totalData,
        exchangeRateInfo: exchangeRateInfo
      });

    } catch (error) {
      console.error('Error fetching AI usage summary:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.sendJSONStatus(res, 500, 'Error fetching AI usage summary', { details: errorMessage });
    }
  });

  return api;
}

module.exports = configure;
