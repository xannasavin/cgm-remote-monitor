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

    // Add stream: true to the payload to enable streaming from the LLM API
    llmPayload.stream = true;

    const requestOptions = {
      uri: ai_llm_api_url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ai_llm_key}`
      },
      body: JSON.stringify(llmPayload)
    };

    // Use request to pipe the streaming response from the LLM API directly to the client.
    // This avoids timeouts by not waiting for the entire response to be generated.
    const llmRequest = request(requestOptions);

    llmRequest.on('response', function (llmResponse) {
      // Check for non-successful status codes from the LLM API
      if (llmResponse.statusCode >= 400) {
        // If we get an error status, we try to read the body to provide a meaningful error to the client.
        let errorBody = '';
        llmResponse.on('data', (chunk) => {
          errorBody += chunk;
        });
        llmResponse.on('end', () => {
          console.error(`LLM API Error: Status ${llmResponse.statusCode}, Body: ${errorBody}`);
          if (!res.headersSent) {
            res.status(llmResponse.statusCode).send(errorBody);
          }
        });
      } else {
        // If the status is okay, we set the client's response headers
        // and pipe the body directly.
        res.writeHead(llmResponse.statusCode, {
          'Content-Type': llmResponse.headers['content-type']
        });
        llmResponse.pipe(res);
      }
    });

    llmRequest.on('error', function (error) {
      console.error('Error calling LLM API:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to connect to LLM API.', details: error.message });
      }
    });

    // Handle client disconnects to abort the LLM request
    req.on('close', () => {
      console.log('Client disconnected, aborting LLM request.');
      llmRequest.abort();
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
