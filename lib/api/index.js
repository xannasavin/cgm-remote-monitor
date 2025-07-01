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

  // AI Evaluation Endpoint
  app.post('/ai_eval', wares.bodyParser(), wares.checkAPIEnabled, wares.verifyAuthorization(['readable']), function (req, res) {
    const { ai_llm_key, ai_llm_api_url, ai_llm_prompt: defaultPrompt } = req.settings;
    const { reportOptions, daysData, prompt: customPrompt } = req.body;

    if (!ai_llm_key || !ai_llm_api_url) {
      return res.status(500).json({ error: 'LLM API key or URL is not configured on the server.' });
    }

    const finalPrompt = customPrompt || defaultPrompt; // Use custom prompt from payload if available

    // Construct the payload for the LLM. This is a generic example.
    // You'll need to adapt this to the specific API requirements of your chosen LLM (e.g., OpenAI).
    // For example, OpenAI expects a 'messages' array.
    const llmPayload = {
      // model: "gpt-4o-mini", // Or whatever model is appropriate
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant analyzing diabetes data. Provide insights and recommendations based on the data. Format your response using Markdown, including tables where appropriate for clarity."
        },
        {
          role: "user",
          content: `${finalPrompt}\n\nHere is the data:\n\nReport Options:\n${JSON.stringify(reportOptions, null, 2)}\n\nDaily Data:\n${JSON.stringify(daysData, null, 2)}`
        }
      ],
      // max_tokens: 1500, // Example parameter
      // temperature: 0.7 // Example parameter
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
          res.json({ html_content: contentToReturn });
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
