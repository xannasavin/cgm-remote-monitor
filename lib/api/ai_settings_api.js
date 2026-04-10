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
          user_prompt_template: config.user_prompt_template || '',
          system_interim_prompt: config.system_interim_prompt || '',
          user_interim_prompt_template: config.user_interim_prompt_template || ''
        });
      } else {
        // Return defaults or empty if nothing is configured yet
        res.json({
          system_prompt: '',
          user_prompt_template: '',
          system_interim_prompt: '',
          user_interim_prompt_template: ''
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
    const { system_prompt, user_prompt_template, system_interim_prompt, user_interim_prompt_template } = req.body;

    if (typeof system_prompt === 'undefined' || typeof user_prompt_template === 'undefined' || typeof system_interim_prompt === 'undefined' || typeof user_interim_prompt_template === 'undefined') {
      return res.sendJSONStatus(res, 400, 'Missing system_prompt, user_prompt_template, system_interim_prompt, or user_interim_prompt_template in request body');
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
                  system_interim_prompt: system_interim_prompt,
                  user_interim_prompt_template: user_interim_prompt_template,
                  updated_at: new Date()
                }
              },
              { upsert: true, writeConcern: { w: 1 } }
          );

          // Corrected success condition based on observed log structure:
          // Checks nested result.ok and various count properties.
          // Also handles the case where data is identical and modifiedCount is 0 for an update.
          if (result && result.result && result.result.ok === 1 &&
              (result.modifiedCount === 1 ||
                  (result.upsertedId && result.upsertedCount === 1) || // Standard upsert-as-insert
                  (result.matchedCount === 1 && result.modifiedCount === 0 && !result.upsertedId) // Matched existing, data identical
              )
          ) {
            success = true;
            if (result.upsertedId && result.upsertedCount === 1) {
              console.log(`[AISettingsAPI POST /prompts] Attempt ${attempts}: Prompts document created (upserted). ID:`, result.upsertedId._id ? result.upsertedId._id : result.upsertedId);
            } else {
              console.log(`[AISettingsAPI POST /prompts] Attempt ${attempts}: Prompts document updated. Matched:`, result.matchedCount, 'Modified:', result.modifiedCount);
            }
            res.json({ message: 'Prompts saved successfully.' });
            return; // Explicitly return after sending success response
          } else {
            const resultDetails = JSON.stringify(result, null, 2);
            console.warn(`[AISettingsAPI POST /prompts] Attempt ${attempts}: Database update result did not indicate success according to new checks. Details: ${resultDetails}`);

            if (result && typeof result.acknowledged === 'boolean' && !result.acknowledged) {
              lastError = new Error(`Database update explicitly not acknowledged by server (ack flag false) (attempt ${attempts}).`);
              console.error(`[AISettingsAPI POST /prompts] Attempt ${attempts}: MongoDB write operation not acknowledged (acknowledged flag: false). Full result:`, resultDetails);
            } else if (result && result.result && result.result.ok !== 1) {
              const dbErrMsg = result.result.errmsg || 'No specific error message from DB.';
              lastError = new Error(`Database command failed (ok !== 1). DB says: "${dbErrMsg}" (attempt ${attempts}).`);
              console.error(`[AISettingsAPI POST /prompts] Attempt ${attempts}: MongoDB command not ok (result.ok !== 1). DB error: "${dbErrMsg}". Full result:`, resultDetails);
            } else if (result && result.matchedCount === 0 && (!result.upsertedId || result.upsertedCount === 0)) {
              // This condition implies ok === 1 but no document was matched for update, and no new document was upserted.
              // This should ideally not happen with an upsert operation on a fixed _id unless something is very wrong.
              lastError = new Error(`Database update failed: Document not found for update and not upserted, despite command being ok (attempt ${attempts}).`);
              console.error(`[AISettingsAPI POST /prompts] Attempt ${attempts}: Document not found for update and not upserted, despite ok=1. Full result:`, resultDetails);
            } else {
              // This is for cases where result.ok === 1, but modifiedCount/upsertedCount conditions of the primary success IF failed.
              // E.g. modifiedCount was 0 when an update was expected to change something (and it wasn't the identical data case).
              lastError = new Error(`Database update command was ok, but document counts (modified/upserted) were not as expected (attempt ${attempts}).`);
              console.error(`[AISettingsAPI POST /prompts] Attempt ${attempts}: DB command ok, but counts not as expected. Full result:`, resultDetails);
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
