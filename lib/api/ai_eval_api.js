'use strict';

var request = require('request');

// Simple in-memory rate limiter (Finding #7)
// Nightscout is single-user. Max 10 requests/minute, resets on restart.
var rateLimitState = {
  count: 0
  , windowStart: Date.now()
  , maxPerMinute: 10
};

function checkRateLimit () {
  var now = Date.now();
  if (now - rateLimitState.windowStart > 60000) {
    rateLimitState.count = 0;
    rateLimitState.windowStart = now;
  }
  rateLimitState.count++;
  return rateLimitState.count <= rateLimitState.maxPerMinute;
}

// Field whitelist: only forward known-safe scalar fields to the LLM API (Finding #2)
// response_format is NOT in this list — it's set server-side to prevent injection (R3-3)
var ALLOWED_FIELDS = ['messages', 'model', 'temperature', 'top_p', 'max_tokens'];

function configure (app, wares, ctx, env) {
  var express = require('express');
  var api = express.Router();

  api.post('/', wares.bodyParser(), ctx.authorization.isPermitted('api:treatments:read'), function (req, res) {
    // Rate limiting (Finding #7)
    if (!checkRateLimit()) {
      return res.status(429).json({ error: 'Rate limit exceeded. Max ' + rateLimitState.maxPerMinute + ' requests per minute.' });
    }

    var ai_llm_key = env.ai_llm_key;
    var ai_llm_api_url = env.ai_llm_api_url;
    var ai_llm_model = env.ai_llm_model;
    var ai_llm_debug = env.ai_llm_debug;
    var clientPayload = req.body;

    if (ai_llm_debug) {
      console.log('AI Eval Endpoint: Received payload:', JSON.stringify(clientPayload, null, 2));
    }

    var missingSettings = [];
    if (!ai_llm_key) missingSettings.push('AI_LLM_KEY');
    if (!ai_llm_api_url) missingSettings.push('AI_LLM_API_URL');
    if (!clientPayload.model && !ai_llm_model) missingSettings.push('AI_LLM_MODEL');

    if (missingSettings.length > 0) {
      var errorMsg = 'Missing required LLM configuration: ' + missingSettings.join(', ');
      console.error(errorMsg);
      return res.status(500).json({ error: errorMsg });
    }

    // Apply field whitelist (Finding #2)
    var llmPayload = {};
    for (var i = 0; i < ALLOWED_FIELDS.length; i++) {
      var field = ALLOWED_FIELDS[i];
      if (clientPayload[field] !== undefined) {
        llmPayload[field] = clientPayload[field];
      }
    }
    llmPayload.model = llmPayload.model || ai_llm_model;

    // Set response_format server-side only (R3-3: never forward client-provided schemas)
    if (req.body.response_format && req.body.response_format.type === 'json_schema') {
      var schemas = require('../report_plugins/ai_eval/schemas');
      llmPayload.response_format = schemas.unified_response_format;
    }

    // Configurable timeout, default 120s (Finding #16)
    var timeoutMs = (env.ai_llm_timeout || 120) * 1000;

    var requestOptions = {
      uri: ai_llm_api_url
      , method: 'POST'
      , headers: {
        'Content-Type': 'application/json'
        , 'Authorization': 'Bearer ' + ai_llm_key
      }
      , body: JSON.stringify(llmPayload)
      , timeout: timeoutMs
    };

    request(requestOptions, function (error, response, body) {
      if (error) {
        console.error('Error calling LLM API:', error);
        var isTimeout = error.code === 'ESOCKETTIMEDOUT' || error.code === 'ETIMEDOUT';
        var isConnRefused = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND';
        var errMsg = isTimeout
          ? 'LLM API request timed out after ' + (timeoutMs / 1000) + 's.'
          : 'Failed to connect to LLM API.';
        var statusCode = isTimeout ? 504 : (isConnRefused ? 502 : 500);
        return res.status(statusCode).json({ error: errMsg, details: error.message });
      }

      if (ai_llm_debug) {
        console.log('LLM API Response Status:', response.statusCode);
        console.log('LLM API Response Body:', body);
      }

      try {
        var llmResponse = JSON.parse(body);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          var contentToReturn = 'No content found in LLM response.';
          if (llmResponse.choices && llmResponse.choices[0] && llmResponse.choices[0].message && llmResponse.choices[0].message.content) {
            contentToReturn = llmResponse.choices[0].message.content;
          }

          var clientResponse = {
            html_content: contentToReturn
            , usage: llmResponse.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
          };

          res.json(clientResponse);
        } else {
          console.error('LLM API Error:', response.statusCode, body);
          res.status(response.statusCode).json({ error: 'LLM API returned an error.', details: llmResponse });
        }
      } catch (parseError) {
        console.error('Error parsing LLM API response:', parseError, body);
        res.status(500).json({ error: 'Failed to parse LLM API response.', details: body });
      }
    });
  });

  return api;
}

module.exports = configure;
