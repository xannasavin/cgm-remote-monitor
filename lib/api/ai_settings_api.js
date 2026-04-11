'use strict';

const COLLECTION_NAME = 'ai_prompt_settings';
const CONFIG_ID = 'main_config';

// Default prompts used when no custom prompts are configured.
// Token names must match the replacements object in data_processor.js:buildSinglePayload.
// NOTE: The response schema is enforced by OpenAI/Anthropic structured outputs via
// `response_format` on the API payload, not via text in the prompts. The {{RETURNFORMAT}}
// and {{TREATMENT_SUMMARY}} placeholders are still replaced in data_processor.js for
// backwards compatibility with user-customised prompts, but the defaults no longer
// use them because (a) the schema is already delivered through response_format, and
// (b) the treatment totals are already inside STATS_JSON.period.treatment_summary.
// Keeping them out of the defaults is what shrinks a 6-day report from ~120KB to ~55KB.
var DEFAULT_SYSTEM_PROMPT = 'You are a diabetes data analyst specializing in CGM (Continuous Glucose Monitor) interpretation for insulin-dependent diabetes management.\n\n'
  + 'ANALYSIS APPROACH:\n'
  + '- You receive pre-computed statistics (TIR, SD, CV, MAGE, episodes). Do NOT recompute them. Use them as evidence.\n'
  + '- Focus on: pattern recognition across days, clinical interpretation of trends, therapy adjustment rationale, treatment-glucose correlations.\n'
  + '- Reference specific dates, time windows, and values as evidence.\n\n'
  + 'DATA SECTIONS AND FORMATS:\n'
  + '- CGMDATA_JSON: Per-day arrays. SGV readings as [timestamp_ms, mg_dL]. Treatments as [timestamp_ms, carbs_g, insulin_u, notes_string]. The treatments array is pre-filtered to exclude zero-value pump-tick rows — every entry you see carries real information (carbs, insulin, or a note).\n'
  + '- STATS_JSON: Pre-computed period and per-day statistics (TIR/TBR/TAR, SD, CV, MAGE, episodes, period-level diurnal patterns by hour, period-level treatment_summary).\n'
  + '- PROFILE_JSON: Basal rates, carb ratios (I:C), insulin sensitivity factors (ISF), and target ranges — each as {time, value} arrays by time of day.\n\n'
  + 'SEVERITY CLASSIFICATION FOR TRENDS:\n'
  + '- info: Observations worth noting, no immediate action needed\n'
  + '- warning: Patterns requiring attention (e.g., recurring mild hypos, TIR <60%, CV >36%)\n'
  + '- critical: Safety concerns (e.g., severe/nocturnal hypoglycemia, TBR >4%, persistent hyperglycemia >50% time)\n\n'
  + 'TREATMENT INSIGHTS (required section):\n'
  + '- Always include treatment_insights with carb_patterns, insulin_patterns, basal_observations, and dosing_observations.\n'
  + '- Compare basal profile against overnight and fasting glucose patterns (dawn phenomenon, overnight stability).\n'
  + '- Evaluate I:C and ISF adequacy from post-meal glucose excursions.\n\n'
  + 'OUTPUT:\n'
  + '- Format all dates as {{DATEFORMAT}}. Respond in {{LANGUAGE}}.\n'
  + '- Return valid JSON only. The response schema is enforced by the API\u2019s structured-output feature; do not echo the schema, just return the analysis object.';

var DEFAULT_USER_PROMPT = 'Analyze the following CGM data for {{DAYS}} days ({{TIMEFROM}} to {{TIMETILL}}).\n\n'
  + 'CGM readings and treatments per day:\n{{CGMDATA_JSON}}\n\n'
  + 'Pre-computed statistics (use as evidence, do not recompute):\n{{STATS_JSON}}\n\n'
  + 'Patient insulin profile (basal rates, I:C ratios, ISF, targets by time of day):\n{{PROFILE_JSON}}\n\n'
  + 'Provide the analysis as JSON. The response schema is enforced by the API structured-output feature — return only the analysis object.';

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
          system_prompt: config.system_prompt || ''
          , user_prompt_template: config.user_prompt_template || ''
        });
      } else {
        // Return built-in defaults when nothing is configured yet
        res.json({
          system_prompt: DEFAULT_SYSTEM_PROMPT
          , user_prompt_template: DEFAULT_USER_PROMPT
        });
      }
    } catch (error) {
      console.error('Error fetching AI prompts:', error);
      res.sendJSONStatus(res, 500, 'Error fetching AI prompts', 'Internal server error');
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
                  system_prompt: system_prompt
                  , user_prompt_template: user_prompt_template
                  , updated_at: new Date()
                }
              },
              { upsert: true, writeConcern: { w: 1 } }
          );

          // Corrected success condition based on observed log structure:
          // Checks nested result.ok and various count properties.
          // Also handles the case where data is identical and modifiedCount is 0 for an update.
          // F19: Check driver v4+ fields first, fall back to legacy v3
          var isOk = (result && result.acknowledged !== false) &&
              (result.modifiedCount === 1 ||
                  (result.upsertedCount === 1) ||
                  (result.matchedCount === 1 && result.modifiedCount === 0) // data identical
              );
          if (isOk) {
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
          res.sendJSONStatus(res, 500, 'Error saving AI prompts', 'Internal server error');
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
        res.sendJSONStatus(res, 500, 'Error saving AI prompts', 'Internal server error');
      } else {
        // If response already sent (e.g. by the loop's error handling), just log
        console.error('Error saving AI prompts (outer catch, response previously sent):', error.message);
      }
    }
  });

  return api;
}

module.exports = configure;
