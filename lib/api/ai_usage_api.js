'use strict';

const USAGE_COLLECTION_NAME = 'ai_usage_stats';

// This function will be called from lib/api/index.js to set up the routes
function configure(app, wares, ctx) {
  const express = require('express');
  const api = express.Router();

  api.use(wares.bodyParser.json());
  api.use(wares.sendJSONStatus);

  // POST /api/v1/ai_usage/record
  // Records token usage from an AI evaluation call.
  // This endpoint should ideally be protected and only callable internally or by an admin/system role.
  // For now, using 'api:treatments:create' as a placeholder for a permission that implies internal system actions.
  // A more specific permission like 'api:ai_usage:record' could be created.
  api.post('/record', ctx.authorization.isPermitted('api:treatments:create'), async (req, res) => {
    const { tokens_used } = req.body; // Expecting { tokens_used: 123 }

    if (typeof tokens_used === 'undefined' || typeof tokens_used !== 'number' || tokens_used < 0) {
      return res.sendJSONStatus(res, 400, 'Missing or invalid tokens_used in request body. Must be a non-negative number.');
    }

    try {
      if (!ctx.store || typeof ctx.store.collection !== 'function') {
        console.error('[AIUsageAPI POST /record] ctx.store.collection is not available.');
        return res.sendJSONStatus(res, 500, 'Database accessor not available');
      }
      const usageCollection = ctx.store.collection(USAGE_COLLECTION_NAME);
      const now = new Date();
      const monthYearId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // e.g., "2023-10"
      const todayDateString = `${monthYearId}-${String(now.getDate()).padStart(2, '0')}`; // e.g., "2023-10-27"

      // Upsert the monthly document, incrementing totals and updating daily usage
      const updateResult = await usageCollection.updateOne(
        { _id: monthYearId },
        {
          $inc: {
            total_tokens_month: tokens_used,
            api_calls_month: 1,
            [`daily_usage.${todayDateString}.total_tokens_day`]: tokens_used, // Placeholder, will refine
            [`daily_usage.${todayDateString}.api_calls_day`]: 1, // Placeholder, will refine
          },
          $set: {
            last_updated: now,
            // Initialize daily_usage field if it doesn't exist for the specific date
            // This is tricky with $inc directly on nested dynamic fields.
            // A more robust approach involves finding and then updating or using arrayFilters if schema is an array.
          },
          $setOnInsert: { // Initialize fields if this is a new month document
             // daily_usage: {} // Initialize as an object initially
          }
        },
        { upsert: true }
      );

      // More robust daily update:
      // First, ensure the monthly document exists and basic monthly stats are updated.
      await usageCollection.updateOne(
        { _id: monthYearId },
        {
          $inc: {
            total_tokens_month: tokens_used,
            api_calls_month: 1
          },
          $set: { last_updated: now },
          $setOnInsert: { daily_usage_array: [] } // Initialize as an array if new
        },
        { upsert: true }
      );

      // Then, update or push the daily entry in the array
      const dailyEntryExists = await usageCollection.findOne({ _id: monthYearId, "daily_usage_array.date": todayDateString });

      if (dailyEntryExists) {
        await usageCollection.updateOne(
          { _id: monthYearId, "daily_usage_array.date": todayDateString },
          {
            $inc: {
              "daily_usage_array.$.total_tokens_day": tokens_used,
              "daily_usage_array.$.api_calls_day": 1
            }
          }
        );
      } else {
        await usageCollection.updateOne(
          { _id: monthYearId },
          {
            $push: {
              daily_usage_array: {
                date: todayDateString,
                total_tokens_day: tokens_used,
                api_calls_day: 1
              }
            }
          }
        );
      }


      if (updateResult.acknowledged) {
        // console.log(`[AIUsageAPI POST /record] Usage recorded for ${monthYearId}. Tokens: ${tokens_used}`);
        res.json({ message: 'Usage recorded successfully.' });
      } else {
        console.warn('[AIUsageAPI POST /record] Database update for usage recording not acknowledged.');
        res.sendJSONStatus(res, 500, 'Failed to record usage: DB update not acknowledged');
      }

    } catch (error) {
      console.error('Error recording AI usage:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.sendJSONStatus(res, 500, 'Error recording AI usage', { details: errorMessage });
    }
  });

  // GET /api/v1/ai_usage/monthly_summary
  // Fetches usage statistics.
  // Protected by a read permission, e.g., 'api:treatments:read' or a new 'api:ai_usage:read'.
  api.get('/monthly_summary', ctx.authorization.isPermitted('api:treatments:read'), async (req, res) => {
    try {
      if (!ctx.store || typeof ctx.store.collection !== 'function') {
        console.error('[AIUsageAPI GET /monthly_summary] ctx.store.collection is not available.');
        return res.sendJSONStatus(res, 500, 'Database accessor not available');
      }
      const usageCollection = ctx.store.collection(USAGE_COLLECTION_NAME);

      // Fetch all monthly summaries, sorted by month descending
      const summaries = await usageCollection.find({})
                                          .sort({ _id: -1 }) // Sort by month_year (_id) descending
                                          .toArray();

      res.json(summaries);

    } catch (error) {
      console.error('Error fetching AI usage summary:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.sendJSONStatus(res, 500, 'Error fetching AI usage summary', { details: errorMessage });
    }
  });

  return api;
}

module.exports = configure;
