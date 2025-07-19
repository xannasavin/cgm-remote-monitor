'use strict';

function create (env, ctx) {
  var _each = require('lodash/each')
      , express = require('express')
      , request = require('request') // Added for making HTTP requests
      ,  app = express( )
  ;

  const wares = ctx.wares;

  // set up express app with our options
  app.set('name', env.name);
  app.set('version', env.version);

  app.set('units', env.DISPLAY_UNITS);
  // Only allow access to the API if API KEY is set on the server.
  app.disable('api');
  if (env.enclave.isApiKeySet()) {
    console.log('API KEY present, enabling API');
    app.enable('api');
  } else {
    console.log('API KEY has not been set, API disabled');
  }

  if (env.settings.enable) {
    app.extendedClientSettings = ctx.plugins && ctx.plugins.extendedClientSettings ? ctx.plugins.extendedClientSettings(env.extendedSettings) : {};
    _each(env.settings.enable, function (enable) {
      console.info('enabling feature:', enable);
      app.enable(enable);
    });
  }

  app.set('title', [app.get('name'),  'API', app.get('version')].join(' '));

  // Start setting up routes
  if (app.enabled('api')) {
    // experiments
    app.use('/experiments', require('./experiments/')(app, wares, ctx));
  }


  app.use(wares.extensions([
    'json', 'svg', 'csv', 'txt', 'png', 'html', 'tsv'
  ]));
  var entriesRouter = require('./entries/')(app, wares, ctx, env);
  // Entries and settings
  app.all('/entries*', entriesRouter);
  app.all('/echo/*', entriesRouter);
  app.all('/times/*', entriesRouter);
  app.all('/slice/*', entriesRouter);
  app.all('/count/*', entriesRouter);

  app.all('/treatments*', require('./treatments/')(app, wares, ctx, env));
  app.all('/profile*', require('./profile/')(app, wares, ctx));
  app.all('/devicestatus*', require('./devicestatus/')(app, wares, ctx, env));
  app.all('/notifications*', require('./notifications-api')(app, wares, ctx));

  app.all('/activity*', require('./activity/')(app, wares, ctx));

  // AI Settings API (for prompts)
  app.use('/ai_settings', require('./ai_settings_api')(app, wares, ctx));

  // AI Usage Stats API
  app.use('/ai_usage', require('./ai_usage_api')(app, wares, ctx));

  // AI Evaluation Endpoint
  // Corrected authorization middleware usage: ctx.authorization.isPermitted
  // Using 'api:treatments:read' as an example of a known read permission.
  // Ideally, this might be 'api:ai_eval:read' or a more generic 'api:read' permission.
  // Removed wares.checkAPIEnabled as it's not a defined middleware in ctx.wares.
  // API enabled status is implicitly handled by authorization checks.
  app.post('/ai_eval', wares.bodyParser(), ctx.authorization.isPermitted('api:treatments:read'), async function (req, res) {
    const { ai_llm_key, ai_llm_api_url, ai_llm_model, ai_llm_debug } = req.settings;
    const clientPayload = req.body;

    if (ai_llm_debug) {
        console.log('AI Eval Endpoint: Received payload:', JSON.stringify(clientPayload, null, 2));
    }

    const missingSettings = [];
    if (!ai_llm_key) missingSettings.push('AI_LLM_KEY');
    if (!ai_llm_api_url) missingSettings.push('AI_LLM_API_URL');

    // Model is now part of the payload, but we can use the setting as a fallback check
    if (!clientPayload.model && !ai_llm_model) missingSettings.push('AI_LLM_MODEL');

    if (missingSettings.length > 0) {
        const errorMsg = `Missing required LLM configuration on the server: ${missingSettings.join(', ')}. Please set these environment variables.`;
        console.error(errorMsg);
        return res.status(500).json({ error: errorMsg });
    }

    // The client now sends the complete payload, including model, messages, temp, etc.
    // We just need to forward it.
    const llmPayload = {
        ...clientPayload,
        model: clientPayload.model || ai_llm_model, // Prioritize client model, fallback to server setting
    };

    const requestOptions = {
        uri: ai_llm_api_url,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ai_llm_key}`
        },
        body: JSON.stringify(llmPayload)
    };

    request(requestOptions, function (error, response, body) {
        if (error) {
            console.error('Error calling LLM API:', error);
            return res.status(500).json({ error: 'Failed to connect to LLM API.', details: error.message });
        }

        if (ai_llm_debug) {
            console.log('LLM API Response Status:', response.statusCode);
            console.log('LLM API Response Body:', body);
        }

        try {
            const llmResponse = JSON.parse(body);
            if (response.statusCode >= 200 && response.statusCode < 300) {
                let contentToReturn = 'No content found in LLM response.';
                if (llmResponse.choices && llmResponse.choices[0] && llmResponse.choices[0].message && llmResponse.choices[0].message.content) {
                    contentToReturn = llmResponse.choices[0].message.content;
                }

                const clientResponse = {
                    html_content: contentToReturn,
                    tokens_used: llmResponse.usage ? llmResponse.usage.total_tokens : 0
                };

                if (llmResponse.usage && typeof llmResponse.usage.total_tokens === 'number') {
                    const tokensConsumed = llmResponse.usage.total_tokens;
                    const internalRecordPayload = { tokens_used: tokensConsumed };
                    request({
                        uri: `${req.protocol}://${req.get('host')}/api/v1/ai_usage/record`,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(ctx.headers ? ctx.headers() : (req.headers.authorization ? { 'Authorization': req.headers.authorization } : (req.headers['api-secret'] ? { 'api-secret': req.headers['api-secret'] } : {})))
                        },
                        body: JSON.stringify(internalRecordPayload)
                    }, (err, recordRes, recordBody) => {
                        if (err) console.error('[AI_EVAL] Error calling /ai_usage/record:', err.message);
                        else if (recordRes.statusCode < 200 || recordRes.statusCode >= 300) console.error(`[AI_EVAL] Error recording usage: status ${recordRes.statusCode}`, recordBody);
                    });
                } else {
                    console.warn('[AI_EVAL] LLM response did not include usage.total_tokens. Usage not recorded.');
                }

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

  app.use('/', wares.sendJSONStatus, require('./verifyauth')(ctx));

  app.use('/', wares.sendJSONStatus, require('./adminnotifiesapi')(ctx));

  app.all('/food*', require('./food/')(app, wares, ctx));

  // Status first
  app.all('/status*', require('./status')(app, wares, env, ctx));

  if (ctx.alexa) {
    app.all('/alexa*', require('./alexa/')(app, wares, ctx, env));
  }

  if (ctx.googleHome) {
    app.all('/googlehome*', require('./googlehome/')(app, wares, ctx, env));
  }

  return app;
}

module.exports = create;
