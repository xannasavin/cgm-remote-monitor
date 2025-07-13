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
    const { ai_llm_key, ai_llm_api_url, ai_llm_debug } = req.settings;
    const llmPayload = req.body; // The client now sends the complete, final payload.

    if (ai_llm_debug) {
      console.log('AI Eval Endpoint: Received payload:', JSON.stringify(llmPayload, null, 2));
    }

    const missingSettings = [];
    if (!ai_llm_key) missingSettings.push('AI_LLM_KEY');
    if (!ai_llm_api_url) missingSettings.push('AI_LLM_API_URL');
    if (!llmPayload.model) missingSettings.push('Model in payload');

    if (missingSettings.length > 0) {
      const errorMsg = `Missing required configuration: ${missingSettings.join(', ')}.`;
      console.error(errorMsg);
      return res.status(500).json({ error: errorMsg });
    }

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

      try {
        const llmResponse = JSON.parse(body);
        // Adjust based on actual LLM API response structure
        if (response.statusCode >= 200 && response.statusCode < 300) {
          let contentToReturn = 'No content found in LLM response.';
          if (llmResponse.choices && llmResponse.choices[0] && llmResponse.choices[0].message && llmResponse.choices[0].message.content) {
            contentToReturn = llmResponse.choices[0].message.content;
          } else if (llmResponse.html_content) { // If LLM itself returns pre-formatted HTML
            contentToReturn = llmResponse.html_content;
          } else if (typeof llmResponse === 'string') {
            contentToReturn = llmResponse;
          }
          // We send back the raw content (Markdown or plain text)
          // The client side currently injects it as HTML.
          // For proper Markdown rendering, a client-side library or server-side pre-rendering would be needed.
          const clientResponse = { html_content: contentToReturn };

          // Record token usage (fire and forget)
          if (llmResponse.usage && typeof llmResponse.usage.total_tokens === 'number') {
            const tokensConsumed = llmResponse.usage.total_tokens;
            // Make an internal request to our own /api/v1/ai_usage/record endpoint
            // We need to ensure this request is authenticated if the endpoint requires it.
            // Since it's an internal call, we might use a system token or ensure it's accessible.
            // For now, assuming client.headers() might work if the original request was authenticated,
            // or that the permission allows it.
            // A more robust way for internal service-to-service calls might be needed in a larger system.
            const internalRecordPayload = { tokens_used: tokensConsumed };
            request({
              uri: `${req.protocol}://${req.get('host')}/api/v1/ai_usage/record`, // Construct full internal URL
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                // Pass through necessary auth headers if required by ai_usage_api's permission check
                // This might involve using the original request's headers or a specific system token.
                // For simplicity here, if the original req had an API_SECRET in query/header, it might work.
                // Or if the permission for '/record' is lenient enough for calls from localhost.
                // A common pattern is to have a specific system API key for such internal calls.
                // Let's try passing through existing auth from client.headers() if available from context.
                // This assumes 'api:treatments:create' (used in ai_usage_api) is available to the user making the /ai_eval call.
                ...(ctx.headers ? ctx.headers() : (req.headers.authorization ? { 'Authorization': req.headers.authorization } : (req.headers['api-secret'] ? { 'api-secret': req.headers['api-secret'] } : {})))
              },
              body: JSON.stringify(internalRecordPayload)
            }, (err, recordRes, recordBody) => {
              if (err) {
                console.error('[AI_EVAL] Error calling /ai_usage/record:', err.message);
              } else if (recordRes.statusCode < 200 || recordRes.statusCode >= 300) {
                console.error(`[AI_EVAL] Error recording usage: /ai_usage/record returned status ${recordRes.statusCode}`, recordBody);
              } else {
                // console.log('[AI_EVAL] Successfully recorded token usage.');
              }
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
        // Send back the raw body if parsing fails, as it might contain useful error info as plain text
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
