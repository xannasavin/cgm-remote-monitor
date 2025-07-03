'use strict';

const COLLECTION_NAME = 'ai_prompt_settings';
const CONFIG_ID = 'main_config';

// This function will be called from lib/api/index.js to set up the routes
function configure(app, wares, ctx) {
  const express = require('express');
  const api = express.Router();

  // Middleware for this router
  api.use(wares.bodyParser.json()); // Use the specific JSON parser middleware from ctx.wares if available, or global bodyParser
  api.use(wares.sendJSONStatus);   // Assuming this is standard for sending responses

  // GET /api/v1/ai_settings/prompts
  // Fetches the current system and user prompts
  api.get('/prompts', ctx.authorization.isPermitted('api:treatments:read'), async (req, res) => { // Using 'api:treatments:read' for now for GET, admin for POST
    try {
      if (!ctx.store || typeof ctx.store.collection !== 'function') {
        console.error('[AISettingsAPI GET /prompts] ctx.store.collection is not available or not a function.');
        return res.sendJSONStatus(res, 500, 'Database accessor not available');
      }
      const settingsCollection = ctx.store.collection(COLLECTION_NAME);
      const config = await settingsCollection.findOne({ _id: CONFIG_ID });

      if (config) {
        res.json({
          system_prompt: config.system_prompt || '',
          user_prompt_template: config.user_prompt_template || ''
        });
      } else {
        // Return defaults or empty if nothing is configured yet
        res.json({
          system_prompt: '',
          user_prompt_template: ''
        });
      }
    } catch (error) {
      console.error('Error fetching AI prompts:', error);
      // Ensure error object is passed correctly, or just its message for safety
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.sendJSONStatus(res, 500, 'Error fetching AI prompts', { details: errorMessage });
    }
  });

  // POST /api/v1/ai_settings/prompts
  // Saves/updates the system and user prompts
  // Protected by a new specific admin permission
  api.post('/prompts', ctx.authorization.isPermitted('admin:api:ai_settings:edit'), async (req, res) => {
    const { system_prompt, user_prompt_template } = req.body;

    if (typeof system_prompt === 'undefined' || typeof user_prompt_template === 'undefined') {
      return res.sendJSONStatus(res, 400, 'Missing system_prompt or user_prompt_template in request body');
    }

    try {
      if (!ctx.store || typeof ctx.store.collection !== 'function') {
        console.error('[AISettingsAPI POST /prompts] ctx.store.collection is not available or not a function.');
        return res.sendJSONStatus(res, 500, 'Database accessor not available');
      }
      const settingsCollection = ctx.store.collection(COLLECTION_NAME);
      const result = await settingsCollection.updateOne(
        { _id: CONFIG_ID },
        { $set: {
            system_prompt: system_prompt,
            user_prompt_template: user_prompt_template,
            updated_at: new Date()
          }
        },
        { upsert: true }
      );

      if (result.acknowledged) {
        // Invalidate cache or notify other parts of the system if necessary (not implemented here)
        // e.g., ctx.bus.emit('ai-settings-updated');
        res.json({ message: 'Prompts saved successfully.' });
      } else {
        throw new Error('Database update not acknowledged.');
      }
    } catch (error) {
      console.error('Error saving AI prompts:', error);
      res.sendJSONStatus(res, 500, 'Error saving AI prompts', error);
    }
  });

  return api;
}

module.exports = configure;
