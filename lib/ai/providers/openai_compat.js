'use strict';

/**
 * OpenAI-compatible provider adapter.
 * Handles: OpenAI, Gemini (via compat endpoint), any OpenAI-compatible API.
 * Uses Node.js built-in https/http (not deprecated request package).
 */

var https = require('https');
var http = require('http');
var url = require('url');

/**
 * Create an OpenAI-compatible provider.
 *
 * @param {object} config
 * @param {string} config.apiUrl - Full API endpoint URL
 * @param {string} config.apiKey - API key
 * @param {number} [config.timeout] - Timeout in ms (default 120000)
 * @returns {object} provider with chatCompletion method
 */
function create (config) {
  var timeoutMs = config.timeout || 120000;

  /**
   * Send a chat completion request.
   *
   * @param {object} payload - { messages, model, temperature, max_tokens, response_format, ... }
   * @returns {Promise<{ content: string, usage: { prompt_tokens: number, completion_tokens: number } }>}
   */
  function chatCompletion (payload) {
    return new Promise(function (resolve, reject) {
      var parsed = url.parse(config.apiUrl);
      var transport = parsed.protocol === 'https:' ? https : http;
      var settled = false; // F2: guard against double-settle race

      function safeResolve (val) { if (!settled) { settled = true; resolve(val); } }
      function safeReject (err) { if (!settled) { settled = true; reject(err); } }

      var body = JSON.stringify(payload);

      var options = {
        hostname: parsed.hostname
        , port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80)
        , path: parsed.path
        , method: 'POST'
        , headers: {
          'Content-Type': 'application/json'
          , 'Content-Length': Buffer.byteLength(body)
          , 'Authorization': 'Bearer ' + config.apiKey
        }
        , timeout: timeoutMs
      };

      var MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10 MB

      var req = transport.request(options, function (res) {
        var chunks = [];
        var totalSize = 0;
        res.on('data', function (chunk) {
          totalSize += chunk.length;
          if (totalSize > MAX_RESPONSE_SIZE) {
            req.destroy();
            return safeReject(new Error('LLM response exceeds max size of ' + MAX_RESPONSE_SIZE + ' bytes'));
          }
          chunks.push(chunk);
        });
        res.on('end', function () {
          if (settled) return;
          var rawBody = Buffer.concat(chunks).toString('utf8');
          try {
            var json = JSON.parse(rawBody);
          } catch (e) {
            return reject(new Error('Failed to parse LLM response: ' + rawBody.substring(0, 200)));
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            var content = 'No content found in LLM response.';
            if (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) {
              content = json.choices[0].message.content;
            } else {
              console.warn('Unexpected OpenAI response structure:', JSON.stringify(json).substring(0, 200));
            }
            var usage = json.usage || {};
            safeResolve({
              content: content
              , usage: {
                prompt_tokens: usage.prompt_tokens || 0
                , completion_tokens: usage.completion_tokens || 0
              }
            });
          } else {
            var err = new Error('LLM API error: ' + res.statusCode);
            err.statusCode = res.statusCode;
            err.body = json;
            safeReject(err);
          }
        });
      });

      req.on('timeout', function () {
        req.destroy();
        var err = new Error('LLM API request timed out after ' + (timeoutMs / 1000) + 's.');
        err.code = 'ETIMEDOUT';
        safeReject(err);
      });

      req.on('error', function (error) {
        safeReject(error);
      });

      req.write(body);
      req.end();
    });
  }

  return {
    name: 'openai_compat'
    , chatCompletion: chatCompletion
  };
}

module.exports = create;
