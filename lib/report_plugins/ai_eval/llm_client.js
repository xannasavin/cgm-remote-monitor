'use strict';

/**
 * LLM client utilities: JSON fence stripping, parsing, and API call with retry.
 * Single-call architecture: one call with JSON repair retry.
 */

function stripJsonFences (str) {
  return str.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
}

function tryParseJson (str) {
  try {
    return JSON.parse(stripJsonFences(str));
  } catch (e) {
    return null;
  }
}

/**
 * Call the AI evaluation endpoint with retry and JSON repair.
 * Runs in browser context -- uses fetch.
 *
 * Returns { data, usage, repairCalls } where:
 * - data: the API response object (includes html_content)
 * - usage: { prompt_tokens, completion_tokens, total_tokens } accumulated
 * - repairCalls: number of repair attempts made
 *
 * @param {object} payload - The request payload
 * @param {object} client - The Nightscout client object
 * @param {number} retries - Number of retries remaining (default 2)
 * @returns {Promise<object>} { data, usage, repairCalls }
 */
async function callAiWithRetry (payload, client, retries) {
  if (retries === undefined) retries = 2;

  var accumulated = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  var repairCalls = 0;

  async function attempt (currentPayload, retriesLeft) {
    var apiEndpoint = (client.settings.baseURL || '') + '/api/v1/ai_eval';
    var requestHeaders = client.headers ? client.headers() : {};
    requestHeaders['Content-Type'] = 'application/json';

    if (client.settings.ai_llm_debug === true) {
      console.log('AI Eval: Sending payload (retries left: ' + retriesLeft + ')');
    }

    var response = await fetch(apiEndpoint, {
      method: 'POST'
      , headers: requestHeaders
      , body: JSON.stringify(currentPayload)
    });

    if (!response.ok) {
      var errorText = await response.text();
      throw new Error('Status: ' + response.status + '. Body: ' + errorText);
    }

    var data = await response.json();
    var usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    accumulated.prompt_tokens += usage.prompt_tokens || 0;
    accumulated.completion_tokens += usage.completion_tokens || 0;
    accumulated.total_tokens += usage.total_tokens || 0;

    var parsed = tryParseJson(data.html_content || '');
    if (parsed !== null) {
      return data;
    }

    if (retriesLeft > 0) {
      if (client.settings.ai_llm_debug === true) {
        console.warn('AI Eval: JSON parsing failed. Retrying... (' + retriesLeft + ' retries left)');
      }
      repairCalls++;

      var repairPayload = Object.assign({}, currentPayload, {
        messages: [
          {
            role: 'system'
            , content: 'Return the same content as valid JSON only; fix any trailing commas/quotes/NaNs; do not add text.'
          }
          , {
            role: 'user'
            , content: data.html_content
          }
        ]
      });
      return attempt(repairPayload, retriesLeft - 1);
    }

    throw new Error('Failed to parse JSON response from AI after retries.');
  }

  var finalData = await attempt(payload, retries);
  return { data: finalData, usage: accumulated, repairCalls: repairCalls };
}

module.exports = {
  stripJsonFences: stripJsonFences
  , tryParseJson: tryParseJson
  , callAiWithRetry: callAiWithRetry
};
