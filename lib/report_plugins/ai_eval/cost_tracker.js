'use strict';

/**
 * Cost calculation and usage tracking.
 * Fix #15: separate prompt vs completion token costs (was using same rate for both).
 * Structured for per-provider cost rates (Phase 3).
 */

/**
 * Calculate cost for a set of token usage.
 *
 * @param {object} usage - { prompt_tokens, completion_tokens }
 * @param {object} rates - { input_rate, output_rate } per 1000 tokens in USD
 * @returns {number} cost in USD
 */
function calculateCost (usage, rates) {
  var promptTokens = (usage && usage.prompt_tokens) || 0;
  var completionTokens = (usage && usage.completion_tokens) || 0;
  var inputRate = (rates && rates.input_rate) || 0;
  var outputRate = (rates && rates.output_rate) || 0;

  return (promptTokens / 1000) * inputRate + (completionTokens / 1000) * outputRate;
}

/**
 * Format a USD cost with optional exchange rate conversion.
 *
 * @param {number} tokens - token count
 * @param {number} costPer1k - cost per 1000 tokens in USD
 * @param {object} rateInfo - { rate, currency } or null
 * @returns {string} formatted cost string
 */
function formatCost (tokens, costPer1k, rateInfo) {
  if (!costPer1k) return '';
  var usdCost = (tokens / 1000) * costPer1k;
  var costString = '($' + usdCost.toFixed(4);
  if (rateInfo && rateInfo.rate) {
    var convertedCost = usdCost * rateInfo.rate;
    costString += ' / ' + convertedCost.toFixed(4) + ' ' + rateInfo.currency;
  }
  costString += ')';
  return costString;
}

module.exports = {
  calculateCost: calculateCost
  , formatCost: formatCost
};
