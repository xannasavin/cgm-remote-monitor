'use strict';

var aiProviders = require('../ai/');

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
  if (rateLimitState.count >= rateLimitState.maxPerMinute) return false;
  rateLimitState.count++;
  return true;
}

// Base field whitelist: only forward known-safe scalar fields to the LLM API (Finding #2)
// response_format is NOT in this list -- handled separately per provider (R3-3)
var BASE_ALLOWED_FIELDS = ['messages', 'model', 'temperature', 'top_p', 'max_tokens'];

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
    var ai_llm_provider = env.ai_llm_provider;
    var clientPayload = req.body;

    if (ai_llm_debug) {
      console.log('AI Eval Endpoint: Received payload with', (clientPayload.messages || []).length, 'messages');
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

    // Validate messages field (R2-3 + F22)
    if (!Array.isArray(clientPayload.messages) || clientPayload.messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array.' });
    }
    var validRoles = ['system', 'user', 'assistant'];
    for (var m = 0; m < clientPayload.messages.length; m++) {
      var msg = clientPayload.messages[m];
      if (!msg || typeof msg.content !== 'string' || validRoles.indexOf(msg.role) === -1) {
        return res.status(400).json({ error: 'Each message must have a valid role and string content.' });
      }
    }

    // Create provider adapter
    var provider = aiProviders.createProvider({
      apiUrl: ai_llm_api_url
      , apiKey: ai_llm_key
      , provider: ai_llm_provider
      , timeout: (env.ai_llm_timeout || 120) * 1000
    });

    // Apply field whitelist (Finding #2)
    var llmPayload = {};
    for (var i = 0; i < BASE_ALLOWED_FIELDS.length; i++) {
      var field = BASE_ALLOWED_FIELDS[i];
      if (clientPayload[field] !== undefined) {
        llmPayload[field] = clientPayload[field];
      }
    }
    llmPayload.model = llmPayload.model || ai_llm_model;

    // Set response_format server-side only (R3-3: never forward client-provided schemas)
    // Only add for OpenAI-compat providers (Anthropic handles via system prompt in adapter)
    if (req.body.response_format && req.body.response_format.type === 'json_schema') {
      var schemas = require('../report_plugins/ai_eval/schemas');
      llmPayload.response_format = schemas.unified_response_format;
    }

    if (ai_llm_debug) {
      console.log('AI Eval: Using provider:', provider.name, '| Model:', llmPayload.model, '| Messages:', llmPayload.messages.length);
    }

    provider.chatCompletion(llmPayload).then(function (result) {
      if (ai_llm_debug) {
        console.log('AI Eval: LLM response received, content length:', result.content.length);
      }

      var clientResponse = {
        html_content: result.content
        , usage: {
          prompt_tokens: result.usage.prompt_tokens
          , completion_tokens: result.usage.completion_tokens
          , total_tokens: (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0)
        }
      };

      res.json(clientResponse);
    }).catch(function (error) {
      console.error('Error calling LLM API:', error);
      var isTimeout = error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT';
      var isConnRefused = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND';
      var errMsg = isTimeout
        ? 'LLM API request timed out after ' + ((env.ai_llm_timeout || 120)) + 's.'
        : isConnRefused ? 'Failed to connect to LLM API.'
        : 'LLM API returned an error (status ' + (error.statusCode || 'unknown') + ').';
      var statusCode = isTimeout ? 504 : (isConnRefused ? 502 : (error.statusCode || 500));
      res.status(statusCode).json({ error: errMsg });
    });
  });

  return api;
}

module.exports = configure;
