'use strict';

/**
 * Provider factory for LLM adapters.
 * Auto-detects provider from API URL or uses explicit AI_LLM_PROVIDER override.
 * All providers return normalized responses: { content, usage: { prompt_tokens, completion_tokens } }
 */

/**
 * Detect provider from API URL.
 *
 * @param {string} apiUrl
 * @returns {string} 'anthropic' or 'openai_compat'
 */
function detectProvider (apiUrl) {
  if (!apiUrl) return 'openai_compat';
  var lower = apiUrl.toLowerCase();
  if (lower.indexOf('anthropic') !== -1) return 'anthropic';
  return 'openai_compat';
}

/**
 * Create a provider instance.
 *
 * @param {object} config
 * @param {string} config.apiUrl - Full API endpoint URL
 * @param {string} config.apiKey - API key
 * @param {string} [config.provider] - Explicit provider name ('openai', 'anthropic')
 * @param {number} [config.timeout] - Timeout in ms
 * @returns {object} provider with chatCompletion method
 */
function createProvider (config) {
  var providerName = config.provider || detectProvider(config.apiUrl);

  // Normalize 'openai' to 'openai_compat'
  if (providerName === 'openai') providerName = 'openai_compat';

  if (providerName === 'anthropic') {
    return require('./providers/anthropic')(config);
  }
  return require('./providers/openai_compat')(config);
}

module.exports = {
  createProvider: createProvider
  , detectProvider: detectProvider
};
