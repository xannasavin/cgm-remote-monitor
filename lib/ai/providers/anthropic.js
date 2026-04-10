'use strict';

/**
 * Anthropic (Claude) provider adapter.
 * Auth: x-api-key header, anthropic-version header.
 * System prompt: top-level `system` param, NOT in messages.
 * Response: content[0].text, usage: { input_tokens, output_tokens }.
 * Normalizes to { prompt_tokens, completion_tokens } for consistency.
 * Uses Node.js built-in https (not deprecated request package).
 */

var https = require('https');
var http = require('http');
var url = require('url');

/**
 * Create an Anthropic provider.
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
   * Transforms OpenAI-style payload to Anthropic format.
   *
   * @param {object} payload - { messages, model, temperature, max_tokens, ... }
   * @returns {Promise<{ content: string, usage: { prompt_tokens: number, completion_tokens: number } }>}
   */
  function chatCompletion (payload) {
    return new Promise(function (resolve, reject) {
      var parsed = url.parse(config.apiUrl);
      var transport = parsed.protocol === 'https:' ? https : http;

      // Extract system message from messages array (Anthropic uses top-level system param)
      var systemContent = '';
      var messages = [];
      if (payload.messages) {
        for (var i = 0; i < payload.messages.length; i++) {
          if (payload.messages[i].role === 'system') {
            systemContent += (systemContent ? '\n\n' : '') + payload.messages[i].content;
          } else {
            messages.push(payload.messages[i]);
          }
        }
      }

      // Build Anthropic-style payload
      var anthropicPayload = {
        model: payload.model
        , messages: messages
        , max_tokens: payload.max_tokens || 4096
      };

      if (systemContent) {
        anthropicPayload.system = systemContent;
      }
      if (payload.temperature !== undefined) {
        anthropicPayload.temperature = payload.temperature;
      }

      // For structured output, embed schema instructions in system prompt
      // (Anthropic doesn't support response_format like OpenAI)
      if (payload.response_format && payload.response_format.type === 'json_schema'
        && payload.response_format.json_schema && payload.response_format.json_schema.schema) {
        var schemaNote = '\n\nIMPORTANT: You MUST respond with valid JSON matching this schema:\n'
          + JSON.stringify(payload.response_format.json_schema.schema, null, 0);
        anthropicPayload.system = (anthropicPayload.system || '') + schemaNote;
      }

      var body = JSON.stringify(anthropicPayload);

      var options = {
        hostname: parsed.hostname
        , port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80)
        , path: parsed.path
        , method: 'POST'
        , headers: {
          'Content-Type': 'application/json'
          , 'Content-Length': Buffer.byteLength(body)
          , 'x-api-key': config.apiKey
          , 'anthropic-version': '2023-06-01'
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
            return reject(new Error('Anthropic response exceeds max size of ' + MAX_RESPONSE_SIZE + ' bytes'));
          }
          chunks.push(chunk);
        });
        res.on('end', function () {
          var rawBody = Buffer.concat(chunks).toString('utf8');
          try {
            var json = JSON.parse(rawBody);
          } catch (e) {
            return reject(new Error('Failed to parse Anthropic response: ' + rawBody.substring(0, 200)));
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            var content = 'No content found in Anthropic response.';
            if (json.content && json.content[0] && json.content[0].text) {
              content = json.content[0].text;
            } else {
              console.warn('Unexpected Anthropic response structure:', JSON.stringify(json).substring(0, 200));
            }
            // Normalize Anthropic usage fields to OpenAI-style names
            var usage = json.usage || {};
            resolve({
              content: content
              , usage: {
                prompt_tokens: usage.input_tokens || 0
                , completion_tokens: usage.output_tokens || 0
              }
            });
          } else {
            var err = new Error('Anthropic API error: ' + res.statusCode);
            err.statusCode = res.statusCode;
            err.body = json;
            reject(err);
          }
        });
      });

      req.on('timeout', function () {
        req.destroy();
        var err = new Error('Anthropic API request timed out after ' + (timeoutMs / 1000) + 's.');
        err.code = 'ETIMEDOUT';
        reject(err);
      });

      req.on('error', function (error) {
        reject(error);
      });

      req.write(body);
      req.end();
    });
  }

  return {
    name: 'anthropic'
    , chatCompletion: chatCompletion
  };
}

module.exports = create;
