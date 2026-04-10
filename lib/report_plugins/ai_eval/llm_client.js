'use strict';

/**
 * LLM client utilities: JSON fence stripping, parsing, and API call with retry.
 * Consolidates duplicated fence-stripping logic (Finding #12).
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
 * Runs in browser context — uses fetch and window globals.
 *
 * @param {object} payload - The request payload
 * @param {object} client - The Nightscout client object (passedInClient)
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<object>} The API response data
 */
async function callAiWithRetry (payload, client, retries) {
  if (retries === undefined) retries = 2;

  var apiEndpoint = (client.settings.baseURL || '') + '/api/v1/ai_eval';
  var requestHeaders = client.headers ? client.headers() : {};
  requestHeaders['Content-Type'] = 'application/json';

  if (client.settings.ai_llm_debug === true) {
    console.log('AI Eval: Sending payload (retries left: ' + retries + '):', JSON.stringify(payload, null, 2));
  }

  var response = await fetch(apiEndpoint, {
    method: 'POST'
    , headers: requestHeaders
    , body: JSON.stringify(payload)
  });

  if (!response.ok) {
    var errorText = await response.text();
    throw new Error('Network response was not ok. Status: ' + response.status + '. Body: ' + errorText);
  }

  var data = await response.json();
  var usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  window.aiEvalState.accumulatedInterimTokens.prompt_tokens += usage.prompt_tokens;
  window.aiEvalState.accumulatedInterimTokens.completion_tokens += usage.completion_tokens;
  window.aiEvalState.accumulatedInterimTokens.total_tokens += usage.total_tokens;

  var parsed = tryParseJson(data.html_content || '');
  if (parsed !== null) {
    return data;
  }

  if (retries > 0) {
    if (client.settings.ai_llm_debug === true) {
      console.warn('AI Eval: JSON parsing failed. Retrying... (' + retries + ' retries left)');
      console.warn('AI Eval: Invalid JSON content:', data.html_content);
    }
    window.aiEvalState.repairCalls = (window.aiEvalState.repairCalls || 0) + 1;

    var repairPayload = Object.assign({}, payload, {
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
    return callAiWithRetry(repairPayload, client, retries - 1);
  }

  console.error('AI Eval: JSON parsing failed after multiple retries.');
  throw new Error('Failed to parse JSON response from AI after retries.');
}

module.exports = {
  stripJsonFences: stripJsonFences
  , tryParseJson: tryParseJson
  , callAiWithRetry: callAiWithRetry
};
