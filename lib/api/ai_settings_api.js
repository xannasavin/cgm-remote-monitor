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

      let result;
      let success = false;
      let attempts = 0;
      let lastError = null;
      const MAX_ATTEMPTS = 3;

      while (attempts < MAX_ATTEMPTS && !success) {
        attempts++;
        try {
          result = await settingsCollection.updateOne(
            { _id: CONFIG_ID },
            { $set: {
                system_prompt: system_prompt,
                user_prompt_template: user_prompt_template,
                updated_at: new Date()
              }
            },
            { upsert: true, writeConcern: { w: 1 } }
          );

          if (result.acknowledged && (result.modifiedCount === 1 || result.upsertedCount === 1)) {
            success = true;
            if (result.upsertedCount === 1) {
              console.log(`[AISettingsAPI POST /prompts] Attempt ${attempts}: Prompts document created (upserted). ID:`, result.upsertedId);
            } else {
              console.log(`[AISettingsAPI POST /prompts] Attempt ${attempts}: Prompts document updated. Matched:`, result.matchedCount, 'Modified:', result.modifiedCount);
            }
            res.json({ message: 'Prompts saved successfully.' });
          } else {
            const resultDetails = JSON.stringify(result, null, 2);
            console.warn(`[AISettingsAPI POST /prompts] Attempt ${attempts}: Database update result did not indicate success. Details: ${resultDetails}`);
            if (!result.acknowledged) {
              lastError = new Error(`Database update not acknowledged by the server (attempt ${attempts}).`);
              console.error(`[AISettingsAPI POST /prompts] Attempt ${attempts}: MongoDB write operation was not acknowledged. Full result object:`, resultDetails);
            } else if (result.matchedCount === 0 && result.upsertedCount === 0) {
              lastError = new Error(`Database update failed: Document not found and not upserted (attempt ${attempts}).`);
            } else {
              lastError = new Error(`Database update acknowledged but did not modify or upsert as expected (attempt ${attempts}).`);
            }
            if (attempts < MAX_ATTEMPTS) {
              await new Promise(resolve => setTimeout(resolve, 750 * attempts)); // Exponential backoff factor
            }
          }
        } catch (err) {
          lastError = err; // Preserve the actual MongoDB driver error if one occurs
          console.error(`[AISettingsAPI POST /prompts] Attempt ${attempts}: Error during updateOne operation:`, err);
          if (attempts < MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, 750 * attempts));
          }
        }
      }

      if (!success) {
        // If all attempts failed, throw the last error encountered or a generic one
        const finalError = lastError || new Error('Failed to save AI prompts after multiple attempts due to persistent database issues.');
        console.error('[AISettingsAPI POST /prompts] All attempts to save prompts failed.', finalError.message);
        // Ensure we send a response if not already sent (e.g. if success path wasn't taken)
        if (!res.headersSent) {
           const errorMessage = finalError instanceof Error ? finalError.message : String(finalError);
           res.sendJSONStatus(res, 500, 'Error saving AI prompts', { details: errorMessage });
        }
        // No need to throw here if we've already sent a response,
        // but if we want it to go to the generic catch block, we would.
        // For now, sending response directly is fine.
        return; // Exit if response sent
      }

    } catch (error) { // This outer catch is for unexpected errors or if we re-throw from the loop
      // If an error is thrown from the loop AND a response hasn't been sent.
      if (!res.headersSent) {
        console.error('Error saving AI prompts (outer catch):', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.sendJSONStatus(res, 500, 'Error saving AI prompts', { details: errorMessage });
      } else {
        // If response already sent (e.g. by the loop's error handling), just log
        console.error('Error saving AI prompts (outer catch, response previously sent):', error.message);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.sendJSONStatus(res, 500, 'Error saving AI prompts', { details: errorMessage });
    }
  });

  return api;
}

module.exports = configure;
