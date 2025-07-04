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
      // Only do this if the AI eval tab is the currently active one,
      // or defer this to when the tab becomes active.
      // For now, let's assume this is fine, as results are specific to data.
      $('#ai-eval-results').html('');
      $('#ai-eval-debug-info').html('');
      // The status area message (config valid/invalid) should persist.

      // Decision to trigger AI evaluation now relies on currentConfigurationIsValid flag
      // which is set when the tab's script is loaded/activated.
      if (currentConfigurationIsValid) {
        if (storedData.datastorage && storedData.sorteddaystoshow && storedData.options) {
          $('#ai-eval-results').html(client.translate('Preparing data for AI evaluation...'));

          let cgmDataPayload = {
            reportSettings: {
              targetLow: storedData.options.targetLow,
              targetHigh: storedData.options.targetHigh,
              units: storedData.options.units,
              dateFrom: storedData.sorteddaystoshow.length > 0 ? storedData.sorteddaystoshow[0] : null,
              dateTo: storedData.sorteddaystoshow.length > 0 ? storedData.sorteddaystoshow[storedData.sorteddaystoshow.length - 1] : null,
              reportName: storedData.options.reportName
            },
            entries: [],
            treatments: [],
            deviceStatus: [],
            profile: {}
          };

          try {
            // Attempt to get profile data
            if (client && typeof client.profile === 'function') {
              const fullProfile = client.profile();
              if (fullProfile && fullProfile.store && fullProfile.store[fullProfile.defaultProfile]) {
                const activeProfileStore = fullProfile.store[fullProfile.defaultProfile];
                cgmDataPayload.profile = {
                  timezone: activeProfileStore.timezone,
                  basal: activeProfileStore.basal,
                  carbratio: activeProfileStore.carbratio,
                  sens: activeProfileStore.sens
                };
              } else if (fullProfile && fullProfile.defaultProfile && fullProfile[fullProfile.defaultProfile]) {
                const activeProfileData = fullProfile[fullProfile.defaultProfile];
                cgmDataPayload.profile = {
                  timezone: activeProfileData.timezone,
                  basal: activeProfileData.basal,
                  carbratio: activeProfileData.carbratio,
                  sens: activeProfileData.sens
                };
              }
            }
          } catch (e) {
            console.error("AI Eval: Error accessing client profile data:", e);
            // Optionally inform the user or send a more basic payload
            $('#ai-eval-status-area').append(`<p style="color: orange;">${client.translate('Warning: Could not retrieve full profile data for AI evaluation.')}</p>`);
          }

          storedData.sorteddaystoshow.forEach(function(dayString) {
            var dayData = storedData.datastorage[dayString];
            if (dayData && !dayData.treatmentsonly) {
              if (dayData.sgv) {
                dayData.sgv.forEach(s => cgmDataPayload.entries.push({ type: 'sgv', date: s.mills, sgv: s.sgv, direction: s.direction }));
              }
              if (dayData.mbg) {
                dayData.mbg.forEach(m => cgmDataPayload.entries.push({ type: 'mbg', date: m.mills, mbg: m.mbg }));
              }
              if (dayData.treatments) {
                dayData.treatments.forEach(t => {
                  let treatmentEntry = {
                    eventType: t.eventType, timestamp: t.timestamp, mills: t.mills, created_at: t.created_at,
                  };
                  if (t.carbs) treatmentEntry.carbs = t.carbs;
                  if (t.insulin) treatmentEntry.insulin = t.insulin;
                  if (t.notes) treatmentEntry.notes = t.notes;
                  cgmDataPayload.treatments.push(treatmentEntry);
                });
              }
            }
          });

          if (storedData.options && storedData.options.devicestatus) {
            cgmDataPayload.deviceStatus = storedData.options.devicestatus;
          } else if (datastorage.devicestatus) {
            cgmDataPayload.deviceStatus = datastorage.devicestatus;
          }

          if (typeof client.triggerAIEvaluation === 'function') {
            client.triggerAIEvaluation(cgmDataPayload);
          } else {
            console.error("AI Eval: triggerAIEvaluation function not found on client object.");
            $('#ai-eval-results').html(`<p style="color: red;">${client.translate('Error: AI Evaluation trigger function is missing.')}</p>`);
          }
        } else {
          // Config is valid, but data not fully loaded for this specific call.
          // This message might briefly appear if report() is called multiple times by main client.
          $('#ai-eval-results').html(client.translate('Waiting for all report data to load...'));
        }
      } else {
        // currentConfigurationIsValid is false
        // The message about invalid config should already be in $statusArea.
        // $resultsDiv can reiterate or stay empty.
        if ($('#ai-eval-status-area:contains("Configuration Incomplete")').length > 0) {
             $('#ai-eval-results').html(client.translate('AI Evaluation cannot proceed until configuration issues (shown above) are resolved.'));
        } else {
            // This case implies config check hasn't run or failed silently.
            // The try-catch in initial script load should provide clues.
            $('#ai-eval-results').html(client.translate('AI Evaluation configuration not yet checked or is invalid. Activate the AI Evaluation tab to check settings.'));
        }
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
        $resultsDiv.html('');
        $debugInfoDiv.html('');

        let isApiUrlMissing = false;
        let isModelMissing = false;
        let isSystemPromptCustomized = false;
        let isUserPromptCustomized = false;

        let messages = []; // To collect all status/error/warning/info messages

        // 1. Check critical client-available settings
        if (!client.settings.ai_llm_api_url || client.settings.ai_llm_api_url.trim() === '') {
          isApiUrlMissing = true;
          messages.push({
            type: 'error',
            text: client.translate('LLM API URL is missing.') + ' ' + client.translate('Please set the AI_LLM_API_URL environment variable on your server.')
          });
        } else {
          messages.push({
            type: 'info', // Or success, but it's just one part of config
            text: client.translate('LLM API URL is configured.')
          });
        }

        if (!client.settings.ai_llm_model || client.settings.ai_llm_model.trim() === '') {
          isModelMissing = true;
          messages.push({
            type: 'warning',
            text: client.translate('LLM Model is not set (e.g., via AI_LLM_MODEL environment variable).') + ' ' + client.translate('A server-default model may be used, but setting this is recommended.')
          });
        } else {
           messages.push({
            type: 'info',
            text: client.translate('LLM Model is configured:') + ' ' + client.escape(client.settings.ai_llm_model)
          });
        }
        
        // Add reminder for AI_LLM_KEY - this is always important
        messages.push({
            type: 'info',
            text: client.translate('Remember: The AI_LLM_KEY environment variable must be correctly set on your server for evaluations to work. This key is not visible to the browser.')
        });


        // 2. Fetch server-configured prompts to see if they are customized
        $.ajax({
          url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
          type: 'GET',
          headers: client.headers(),
          success: function(data) {
            serverPrompts = data; // Store for potential future use if needed elsewhere
            if (data && data.system_prompt && data.system_prompt.trim() !== '') {
              isSystemPromptCustomized = true;
              messages.push({ type: 'info', text: client.translate('Custom System Prompt is configured in Admin Tools.') });
            } else {
              messages.push({ type: 'info', text: client.translate('Custom System Prompt not set in Admin Tools. A default system prompt will be used by the server.') });
            }

            if (data && data.user_prompt_template && data.user_prompt_template.trim() !== '') {
              isUserPromptCustomized = true;
              messages.push({ type: 'info', text: client.translate('Custom User Prompt Template is configured in Admin Tools.') });
            } else {
              messages.push({ type: 'info', text: client.translate('Custom User Prompt Template not set in Admin Tools. A default user prompt template will be used by the server.') });
            }
            processSettingsCheckResult(isApiUrlMissing, messages, callback);
          },
          error: function(jqXHR, textStatus, errorThrown) {
            console.error("Error fetching AI prompts configuration:", textStatus, errorThrown);
            messages.push({ type: 'warning', text: client.translate('Could not verify custom prompt settings due to a server error.') + ` (${textStatus})` });
            // Assume prompts are not customized for the purpose of this check if fetch fails
            processSettingsCheckResult(isApiUrlMissing, messages, callback);
          }
        });
      }

      function processSettingsCheckResult(isApiUrlMissing, messages, callback) {
        let finalHtml = '';
        let hasErrors = false;
        let hasWarnings = false;

        messages.forEach(function(msg) {
          let color = 'black';
          if (msg.type === 'error') {
            color = 'red';
            hasErrors = true;
          } else if (msg.type === 'warning') {
            color = 'orange';
            hasWarnings = true;
          } else if (msg.type === 'info') {
            color = 'blue'; // Or keep default
          }
          finalHtml += `<p style="color: ${color}; margin-bottom: 5px;">${client.escape(msg.text)}</p>`;
        });
        
        $statusArea.html(finalHtml);

        if (isApiUrlMissing) { // API URL is the only hard blocker for currentConfigurationIsValid
          currentConfigurationIsValid = false;
          $resultsDiv.html(`<p style="color: red; font-weight: bold;">${client.translate('AI Evaluation cannot proceed. Please resolve critical configuration issues listed above.')}</p>`);
        } else {
          currentConfigurationIsValid = true;
          if (hasWarnings) {
            $resultsDiv.html(client.translate('AI Evaluation can proceed with warnings. Check messages above. Waiting for main report data...'));
          } else {
            // This message is updated by the initial calling function after performComprehensiveSettingsCheck
            // $resultsDiv.html(client.translate('All essential AI settings seem configured. Waiting for main report data...'));
          }
        }
        
        // Call the main callback from the initial script load
        if (callback && typeof callback === 'function') {
          // The callback now expects 'isValid' which is currentConfigurationIsValid
          callback(currentConfigurationIsValid); 
        }
      }

      // Initial check when the script loads / tab is shown
      // This function will be called by the report() function when data is available.
      // For now, we'll call it once on load to display status.
      // The actual evaluation trigger will be handled by report().
      try {
        performComprehensiveSettingsCheck(function(isValid) {
          if (isValid) {
            // If config is valid on initial load, prompt user or indicate readiness.
            $resultsDiv.html(client.translate('AI settings are valid. AI evaluation will automatically start once main report data is loaded.'));
          } else {
            // Error message is already displayed by performComprehensiveSettingsCheck in $statusArea.
            // Set a clear message in $resultsDiv too if config is invalid from the start.
            if ($('#ai-eval-status-area:contains("Configuration Incomplete")').length > 0) {
                 $('#ai-eval-results').html(client.translate('AI Evaluation cannot proceed until configuration issues (shown above) are resolved.'));
            } else {
                 // Fallback if status area somehow didn't get the error message
                 $('#ai-eval-results').html(client.translate('AI Evaluation configuration is incomplete. Please check settings.'));
            }
          }
        });
      } catch (e) {
          console.error("AI Eval Plugin: Error during initial settings check:", e);
          $statusArea.html(`<p style="color: red;">${client.translate('Critical error during AI Plugin initialization:')} ${client.escape(e.message)}</p>`);
          $resultsDiv.html(client.translate('Plugin failed to initialize. Check console for details.'));
          currentConfigurationIsValid = false; // Ensure this is false
      }


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
