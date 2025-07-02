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

  // AI Evaluation Endpoint
  // Corrected authorization middleware usage: ctx.authorization.isPermitted
  // Using 'api:treatments:read' as an example of a known read permission.
  // Ideally, this might be 'api:ai_eval:read' or a more generic 'api:read' permission.
  // Removed wares.checkAPIEnabled as it's not a defined middleware in ctx.wares.
  // API enabled status is implicitly handled by authorization checks.
  app.post('/ai_eval', wares.bodyParser(), ctx.authorization.isPermitted('api:treatments:read'), async function (req, res) {
    const { ai_llm_key, ai_llm_api_url, ai_llm_model, ai_llm_prompt: defaultUserPromptFromEnv, ai_llm_debug } = req.settings;
    const { reportOptions, daysData } = req.body; // Custom prompt from payload is removed, will come from DB or env

    if (!ai_llm_key || !ai_llm_api_url) {
      return res.status(500).json({ error: 'LLM API key or URL is not configured on the server.' });
    }
    if (!ai_llm_model) {
      return res.status(500).json({ error: 'LLM Model (AI_LLM_MODEL) is not configured on the server.' });
    }

    let systemPrompt = "You are a helpful assistant analyzing diabetes data. Provide insights and recommendations based on the data. Format your response using Markdown, including tables where appropriate for clarity."; // Default system prompt
    let userPromptTemplate = defaultUserPromptFromEnv; // Fallback to environment variable

    const AI_PROMPT_SETTINGS_COLLECTION = 'ai_prompt_settings';
    const AI_PROMPT_CONFIG_ID = 'main_config';

    try {
      const settingsCollection = ctx.store(AI_PROMPT_SETTINGS_COLLECTION);
      const promptConfig = await settingsCollection.findOne({ _id: AI_PROMPT_CONFIG_ID });

      if (promptConfig) {
        systemPrompt = promptConfig.system_prompt || systemPrompt;
        userPromptTemplate = promptConfig.user_prompt_template || userPromptTemplate;
      }
    } catch (dbError) {
      console.error("Error fetching prompts from DB, using defaults/env fallback:", dbError);
      // Proceed with defaults/env variable
    }

    if (!userPromptTemplate) {
        return res.status(500).json({ error: 'User prompt template is not configured (neither in Admin UI nor via AI_LLM_PROMPT environment variable).' });
    }

    // Replace {{CGMDATA}} token
    const cgmDataString = JSON.stringify({ reportOptions, daysData }, null, 2);
    const finalUserPrompt = userPromptTemplate.replace(/\{\{CGMDATA\}\}/g, cgmDataString);

    const llmPayload = {
      model: ai_llm_model,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: finalUserPrompt
        }
      ],
      // temperature: 0.7 // Example, consider making this configurable later
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
          const clientResponse = { html_content: contentToReturn };
          if (ai_llm_debug) {
            clientResponse.debug_prompts = {
              system: systemPrompt,
              user_template: userPromptTemplate,
              user_final: finalUserPrompt,
              model: ai_llm_model,
              // For very verbose debugging, you could include the cgmDataString, but it can be large.
              // cgm_data_sent: JSON.parse(cgmDataString)
            };
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
