'use strict';

// Store data received by the .report() function
var storedData = {
  datastorage: null,
  sorteddaystoshow: null,
  options: null
};

function init(ctx) {
  // ctx contains client, Nightscout, _, $, moment, and other utilities
  var $ = ctx.$; // jQuery
  var Nightscout = ctx.Nightscout;

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation', // This will be translated

    // This function is called by reportclient.js when main report data is loaded
    report: function(datastorage, sorteddaystoshow, options) {
      console.log('AI Eval plugin: report function called with new data.');
      storedData.datastorage = datastorage;
      storedData.sorteddaystoshow = sorteddaystoshow;
      storedData.options = options;

      // Clear previous results and debug info when new main report data is loaded
      $('#ai-eval-results').html('');
      $('#ai-eval-debug-info').html('');
      // Status area will be updated by performComprehensiveSettingsCheck

      // Perform settings check, and if valid, trigger evaluation
      // The performComprehensiveSettingsCheck function is defined in the script scope below
      // It will set currentConfigurationIsValid and update the status area.
      // We pass a callback to it that will proceed with the AI eval if settings are okay.
      if (typeof performComprehensiveSettingsCheck === 'function') {
        performComprehensiveSettingsCheck(function(isValid) {
          if (isValid && storedData.datastorage && storedData.sorteddaystoshow && storedData.options) {
            $('#ai-eval-results').html(client.translate('Preparing data for AI evaluation...'));

            // Prepare data for {{CGMDATA}} token
            let cgmDataPayload = {
              reportSettings: { // Renamed from reportOptions for clarity within CGMDATA
                targetLow: storedData.options.targetLow,
                targetHigh: storedData.options.targetHigh,
                units: storedData.options.units,
                dateFrom: storedData.sorteddaystoshow.length > 0 ? storedData.sorteddaystoshow[0] : null,
                dateTo: storedData.sorteddaystoshow.length > 0 ? storedData.sorteddaystoshow[storedData.sorteddaystoshow.length - 1] : null,
                reportName: storedData.options.reportName // e.g. "Day to day"
              },
              entries: [], // For SGV, MBG, etc.
              treatments: [], // For insulin, carbs, notes
              deviceStatus: [] // For sensor/pump status, if available
              // profile: {} // Placeholder for profile data
            };

            // Attempt to get profile data
            // client.profile() should be available if this plugin is loaded like others
            // However, its structure needs to be known to pick relevant parts.
            // For now, let's assume we can get the active profile's core settings.
            let currentProfile = {};
            if (client && typeof client.profile === 'function') {
              const fullProfile = client.profile(); // This might be the profile_data object
              if (fullProfile && fullProfile.store && fullProfile.store[fullProfile.defaultProfile]) {
                const activeProfileStore = fullProfile.store[fullProfile.defaultProfile];
                currentProfile = {
                  timezone: activeProfileStore.timezone,
                  basal: activeProfileStore.basal, // Array of {time: "HH:MM", value: X.X}
                  carbratio: activeProfileStore.carbratio, // Array of {time: "HH:MM", value: X}
                  sens: activeProfileStore.sens // Array of {time: "HH:MM", value: X}
                  // Add other relevant profile parts if needed
                };
              } else if (fullProfile && fullProfile.defaultProfile && fullProfile[fullProfile.defaultProfile]) { // Older structure?
                const activeProfileData = fullProfile[fullProfile.defaultProfile];
                currentProfile = {
                  timezone: activeProfileData.timezone,
                  basal: activeProfileData.basal,
                  carbratio: activeProfileData.carbratio,
                  sens: activeProfileData.sens
                };
              }
            }
            cgmDataPayload.profile = currentProfile;


            storedData.sorteddaystoshow.forEach(function(dayString) {
              var dayData = storedData.datastorage[dayString];
              if (dayData && !dayData.treatmentsonly) {
                if (dayData.sgv) {
                  dayData.sgv.forEach(s => cgmDataPayload.entries.push({ type: 'sgv', date: s.mills, sgv: s.sgv, direction: s.direction }));
                }
                if (dayData.mbg) {
                  dayData.mbg.forEach(m => cgmDataPayload.entries.push({ type: 'mbg', date: m.mills, mbg: m.mbg }));
                }
                // Add other entry types if necessary (cal, etc.)

                if (dayData.treatments) {
                  dayData.treatments.forEach(t => {
                    // Add relevant treatment details
                    let treatmentEntry = {
                      eventType: t.eventType,
                      timestamp: t.timestamp, // Use precise timestamp
                      mills: t.mills,
                      created_at: t.created_at,
                    };
                    if (t.carbs) treatmentEntry.carbs = t.carbs;
                    if (t.insulin) treatmentEntry.insulin = t.insulin;
                    if (t.notes) treatmentEntry.notes = t.notes; // Include notes
                    // Add other fields like glucose, preBolt, duration, percent, etc. if they exist and are relevant
                    cgmDataPayload.treatments.push(treatmentEntry);
                  });
                }
              }
            });

            // Include devicestatus data if available in storedData (might not be in all reports)
            // Assuming devicestatus is an array at the root of storedData or options
            // This needs to be verified based on how Nightscout populates it for reports
            if (storedData.options && storedData.options.devicestatus) { // Example path
              cgmDataPayload.deviceStatus = storedData.options.devicestatus;
            } else if (datastorage.devicestatus) { // More likely path from main datastorage
              cgmDataPayload.deviceStatus = datastorage.devicestatus;
            }


            // The `prompt` field is no longer sent from client; server uses configured prompts.
            // The payload for /api/v1/ai_eval should be the cgmDataPayload itself,
            // which will be used for the {{CGMDATA}} token.
            if (typeof client.triggerAIEvaluation === 'function') {
              client.triggerAIEvaluation(cgmDataPayload);
            } else {
              console.error("AI Eval: triggerAIEvaluation function not found on client object.");
              $('#ai-eval-results').html(`<p style="color: red;">${client.translate('Error: AI Evaluation trigger function is missing.')}</p>`);
            }
          } else if (isValid) {
            // Settings are valid, but data is not (e.g. main report not loaded yet)
            // This case should ideally be handled by performComprehensiveSettingsCheck's initial message
            // or the user not being able to switch to this tab meaningfully without data.
            $('#ai-eval-results').html(client.translate('Waiting for main report data to load...'));
          } else {
            // Settings are invalid, message already shown by performComprehensiveSettingsCheck
            // Ensure results area is clear or shows a message reinforcing the config issue
            $('#ai-eval-results').html(client.translate('AI Evaluation cannot proceed until configuration issues are resolved. See messages above.'));
          }
        });
      } else {
        console.error("AI Eval: performComprehensiveSettingsCheck function not found.");
        $('#ai-eval-status-area').html(`<p style="color: red;">${client.translate('Error: AI Evaluation settings check function is missing.')}</p>`);
      }
    },

    html: function(client) {
      // var placeholderText = client.translate('AI evaluations will appear here. Click "Show AI Evaluation" after the main report data has loaded.');
      // var showButtonText = client.translate('Show AI Evaluation');
      var html = `
        <div id="ai-eval-plugin-content"> <!-- Renamed parent for clarity -->
          <div id="ai-eval-status-area" style="margin-bottom: 15px;">
            <!-- Status messages like "All settings configured" or errors will go here -->
          </div>
          <div id="ai-eval-debug-info" style="margin-bottom: 15px;">
            <!-- Debug info will be displayed here -->
          </div>
          <div id="ai-eval-results">
            <!-- LLM results or loading messages will be displayed here -->
          </div>
        </div>
      `;
      return html;
    },

    css: `
      #ai-eval-plugin-content { /* Adjusted selector */
        padding: 15px;
      }
      #ai-eval-results table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 1em;
      }
      #ai-eval-results th, #ai-eval-results td {
        border: 1px solid #ccc;
        padding: 8px;
        text-align: left;
      }
      #ai-eval-results th {
        background-color: #f0f0f0;
      }
      #ai-eval-results h1, #ai-eval-results h2, #ai-eval-results h3 {
        margin-top: 1em;
        margin-bottom: 0.5em;
      }
      #ai-eval-results ul, #ai-eval-results ol {
        margin-left: 20px;
        margin-bottom: 1em;
      }
      #ai-eval-results p {
        margin-bottom: 1em;
      }
    `,

    script: function(client) {
      // const $showButton = $('#ai-eval-show-button'); // Button removed
      const $statusArea = $('#ai-eval-status-area');
      const $resultsDiv = $('#ai-eval-results');
      const $debugInfoDiv = $('#ai-eval-debug-info');
      let serverPrompts = null; // To store fetched prompts
      let currentConfigurationIsValid = false;

      // This function will be called by the .report() function later
      // For now, it's declared here.
      // window.triggerAIEvaluation = function() { /* ... */ };


      function performComprehensiveSettingsCheck(callback) {
        $statusArea.html(client.translate('Checking AI configuration...'));
        $resultsDiv.html(''); // Clear previous results or "waiting for data" messages
        $debugInfoDiv.html(''); // Clear debug info

        let missingSettings = [];

        // 1. Check client-available settings (which reflect server ENV vars)
        if (!client.settings.ai_llm_api_url) {
          missingSettings.push({
            item: client.translate('LLM API URL'),
            hint: client.translate('Set AI_LLM_API_URL environment variable on your server.')
          });
        }
        if (!client.settings.ai_llm_model) {
          missingSettings.push({
            item: client.translate('LLM Model'),
            hint: client.translate('Set AI_LLM_MODEL environment variable on your server.')
          });
        }
        // Note: AI_LLM_KEY is server-side only, but we add a general reminder if other things are missing.

        // 2. Fetch server-configured prompts
        $.ajax({
          url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
          type: 'GET',
          headers: client.headers(),
          success: function(data) {
            serverPrompts = data;
            if (!data || !data.system_prompt) {
              missingSettings.push({
                item: client.translate('System Prompt'),
                hint: client.translate('Configure in Admin Tools > AI Evaluation Prompt Settings.')
              });
            }
            if (!data || !data.user_prompt_template) {
              // Check for fallback AI_LLM_PROMPT (though server /api/ai_eval handles this, good for UI feedback)
              // The server API /api/v1/ai_settings/prompts returns empty strings if not set in DB.
              // If client.settings.ai_llm_prompt (env var) is also not set, then it's truly missing.
              // However, the primary source should be the DB for this check.
              // The /api/v1/ai_eval will use env AI_LLM_PROMPT if DB user_prompt_template is empty.
              // For frontend check, we primarily care if the specific DB fields are empty.
              missingSettings.push({
                item: client.translate('User Prompt Template'),
                hint: client.translate('Configure in Admin Tools > AI Evaluation Prompt Settings (recommended), or set AI_LLM_PROMPT environment variable as a fallback.')
              });
            }

            processSettingsCheckResult(missingSettings, callback);
          },
          error: function(jqXHR, textStatus, errorThrown) {
            console.error("Error fetching AI prompts configuration:", textStatus, errorThrown);
            // Assume prompts are missing if fetch fails, to guide user
            missingSettings.push({
              item: client.translate('System Prompt'),
              hint: client.translate('Error fetching from server. Check Admin Tools > AI Evaluation Prompt Settings.')
            });
            missingSettings.push({
              item: client.translate('User Prompt Template'),
              hint: client.translate('Error fetching from server. Check Admin Tools > AI Evaluation Prompt Settings.')
            });
            $statusArea.html(`<p style="color: orange;">${client.translate('Could not verify prompt settings due to a server error. Please check server logs and Admin settings.')} (${textStatus})</p>`);
            processSettingsCheckResult(missingSettings, callback, true); // Pass error flag
          }
        });
      }

      function processSettingsCheckResult(missingSettings, callback, fetchError = false) {
        if (missingSettings.length > 0) {
          currentConfigurationIsValid = false;
          let errorMessage = `<p style="color: red; font-weight: bold;">${client.translate('AI Evaluation Configuration Incomplete')}</p>
                            <p>${client.translate('The following configurations are missing or not set. Please configure them to enable AI Evaluation:')}</p>
                            <ul style="color: red; margin-left: 20px;">`;
          missingSettings.forEach(function(setting) {
            errorMessage += `<li>${client.escape(setting.item)}: <span style="font-style: italic;">${client.escape(setting.hint)}</span></li>`;
          });
          errorMessage += `</ul>`;

          // Add reminder for AI_LLM_KEY if other critical settings are missing or if there was a fetch error for prompts
          if (!client.settings.ai_llm_key_present_for_frontend_hint && (missingSettings.some(s => s.item.includes("URL") || s.item.includes("Model")) || fetchError) ) {
            // The 'ai_llm_key_present_for_frontend_hint' is a hypothetical setting to indicate if the key is set for hint purposes.
            // Since we can't directly check the key, we rely on its absence being a common issue.
            // A more robust way would be for the server to pass a boolean `isApiKeySet` via client.settings if desired,
            // but that also has security implications if not handled carefully.
            // For now, a general hint is provided if core settings are missing.
            errorMessage += `<p style="color: orange; margin-top:10px;">${client.translate('Reminder: Also ensure the AI_LLM_KEY environment variable is correctly set on your server. This cannot be checked by the browser.')}</p>`;
          }

          $statusArea.html(errorMessage); // Display detailed errors in status area
          $resultsDiv.html(''); // Clear results area
          $debugInfoDiv.html(''); // Clear debug area
          // Hide other UI elements if necessary (though button is already gone)
        } else {
          currentConfigurationIsValid = true;
          $statusArea.html(`<p style="color: green;">${client.translate('All LLM Settings are configured correctly.')}</p>`);
          // $resultsDiv.html(client.translate('Waiting for main report data to trigger AI evaluation...')); // This will be set by report()
        }

        if (callback && typeof callback === 'function') {
          callback(currentConfigurationIsValid);
        }
      }


      // Initial check when the script loads / tab is shown
      // This function will be called by the report() function when data is available.
      // For now, we'll call it once on load to display status.
      // The actual evaluation trigger will be handled by report().
      performComprehensiveSettingsCheck(function(isValid) {
        if (isValid) {
          // If config is valid on initial load, prompt user or indicate readiness.
          // This message will be overwritten by "Loading AI evaluation..." or results later.
          $resultsDiv.html(client.translate('AI settings are valid. AI evaluation will automatically start once main report data is loaded.'));
        } else {
          // Error message is already displayed by performComprehensiveSettingsCheck
          $resultsDiv.html(''); // Keep results empty if config invalid
        }
      });


      // The old button click handler is removed.
      // The logic for making the AJAX call will be moved to a new function
      // called by report() if settings are valid and data is present.

      // Placeholder for the function that will be called by report()
      // This will be fleshed out in the next step of the plan.
      // For now, this script block focuses on settings checks and UI updates on load.
      client.triggerAIEvaluation = function(cgmDataPayload) {
        if (!currentConfigurationIsValid) {
          $resultsDiv.html(`<p style="color: red;">${client.translate('Cannot trigger AI Evaluation: Configuration is invalid. Please check messages above.')}</p>`);
          return;
        }

        $resultsDiv.html(client.translate('Loading AI evaluation...'));
        $debugInfoDiv.html(''); // Clear previous debug info
        // Status area might show "all configured", which is fine. Or we can add "Loading..." there too.

        // The payload to /api/v1/ai_eval is just the cgmDataPayload.
        // The server will combine this with configured prompts.
        $.ajax({
          url: client.settings.baseURL + '/api/v1/ai_eval',
          type: 'POST',
          contentType: 'application/json',
          data: JSON.stringify(cgmDataPayload), // This is the data for {{CGMDATA}}
          headers: client.headers(),
          success: function(response) {
            let finalResultsHtml = '';
            let finalDebugHtml = '';

            if (client.settings.ai_llm_debug && response && response.debug_info) {
              const debug = response.debug_info;
              // Using a more structured display for debug info, perhaps with <pre> for prompts
              finalDebugHtml += `<h4 style="margin-top:0;">${client.translate('AI Debug Info:')}</h4>`;
              finalDebugHtml += `<p><strong>${client.translate('Model:')}</strong> ${client.escape(debug.model || 'N/A')}</p>`;

              finalDebugHtml += `<p><strong>${client.translate('System Prompt:')}</strong></p><pre style="white-space: pre-wrap; word-break: break-all; background-color: #f8f8f8; border: 1px solid #ddd; padding: 5px;">${client.escape(debug.system_prompt || 'N/A')}</pre>`;

              // User Prompt Template is what's stored (with {{CGMDATA}})
              // finalDebugHtml += `<p><strong>${client.translate('User Prompt Template:')}</strong></p><pre style="white-space: pre-wrap; word-break: break-all; background-color: #f8f8f8; border: 1px solid #ddd; padding: 5px;">${client.escape(debug.user_prompt_template || 'N/A')}</pre>`;

              finalDebugHtml += `<p><strong>${client.translate('Final User Prompt (with data injected):')}</strong></p><pre style="white-space: pre-wrap; word-break: break-all; background-color: #f8f8f8; border: 1px solid #ddd; padding: 5px;">${client.escape(debug.final_user_prompt || 'N/A')}</pre>`;

              $debugInfoDiv.html(finalDebugHtml).show();
            } else {
              $debugInfoDiv.hide();
            }

            if (response && response.html_content) {
              finalResultsHtml += response.html_content;
            } else {
              finalResultsHtml += `<p>${client.translate('Received an empty or unexpected LLM response from the server.')}</p>`;
            }

            if (response && response.tokens_used) {
              const costMessage = client.translate('Tokens used for this evaluation:') + ' ' + response.tokens_used;
              // Display cost message. Could be in $statusArea or appended to $resultsDiv
              if ($statusArea.find('p[style*="color: green"]').length > 0) { // If "all configured" message is there
                $statusArea.append(`<p><small>${costMessage}</small></p>`);
              } else {
                finalResultsHtml += `<hr><p><small>${costMessage}</small></p>`;
              }
            }

            $resultsDiv.html(finalResultsHtml);
          },
          error: function(jqXHR, textStatus, errorThrown) {
            console.error('AI Eval Error:', textStatus, errorThrown, jqXHR.responseText);
            var errorMsg = client.translate('Error fetching AI evaluation: ') + textStatus;
            if (jqXHR.responseJSON && jqXHR.responseJSON.error) {
              errorMsg += ' - ' + client.translate(jqXHR.responseJSON.error);
            } else if (jqXHR.responseText) {
              try {
                var parsedError = JSON.parse(jqXHR.responseText);
                if (parsedError && parsedError.error) {
                  errorMsg += ' - ' + client.translate(parsedError.error);
                } else {
                  errorMsg += ' - ' + client.translate('Check server logs for details.');
                }
              } catch (e) {
                errorMsg += ' - ' + client.translate('Unparseable error from server. Check server logs.');
              }
            }
            $resultsDiv.html(`<p style="color: red;">${errorMsg}</p>`);
            $debugInfoDiv.hide();
          }
        });
      };
    }
  };

  // The init function for a report plugin usually just returns the plugin object.
  // The actual `ctx` object with Nightscout, client etc. is passed to report_plugins/index.js
  // which then passes it to each plugin module's init function.
  // Here, `aiEvalPlugin` itself doesn't need `ctx` directly after this setup,
  // but its methods like `html` and `script` receive `client` which is derived from `ctx`.
  return aiEvalPlugin;
}

module.exports = init;
