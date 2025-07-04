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
  // var Nightscout = ctx.Nightscout; // Not explicitly used in the provided snippet, but good to have if needed

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation', // This will be translated

    report: function(datastorage, sorteddaystoshow, options) {
      console.log('AI Eval plugin: report function called with new data.');
      storedData.datastorage = datastorage;
      storedData.sorteddaystoshow = sorteddaystoshow;
      storedData.options = options;

      // Clear previous results and debug info when new main report data is loaded
      $('#ai-eval-results').html('');
      $('#ai-eval-debug-info').html('');
      // The status area message (config valid/invalid) should persist from tab load / settings check.

      // Decision to trigger AI evaluation relies on currentConfigurationIsValid flag
      // which is set when the tab's script is loaded/activated.
      // 'currentConfigurationIsValid' is a global variable within the script scope.
      if (typeof currentConfigurationIsValid !== 'undefined' && currentConfigurationIsValid) {
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
          } else if (datastorage.devicestatus) { // Check top-level datastorage as well
            cgmDataPayload.deviceStatus = datastorage.devicestatus;
          }


          if (typeof client.triggerAIEvaluation === 'function') {
            client.triggerAIEvaluation(cgmDataPayload);
          } else {
            console.error("AI Eval: triggerAIEvaluation function not found on client object.");
            $('#ai-eval-results').html(`<p style="color: red;">${client.translate('Error: AI Evaluation trigger function is missing.')}</p>`);
          }
        } else {
          $('#ai-eval-results').html(client.translate('Waiting for all report data to load...'));
        }
      } else {
        if ($('#ai-eval-status-area:contains("LLM API URL is missing")').length > 0) {
          $('#ai-eval-results').html(client.translate('AI Evaluation cannot proceed until configuration issues (shown above) are resolved.'));
        } else {
          // This case implies config check hasn't run fully or some other issue.
          $('#ai-eval-results').html(client.translate('AI Evaluation configuration is invalid or not yet checked. Please ensure the AI Evaluation tab has loaded correctly and all required settings are configured.'));
        }
      }
    },

    html: function(client) {
      var html = `
        <div id="ai-eval-plugin-content">
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
      #ai-eval-plugin-content {
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
      console.log("AI Eval Script: Fully Restored");

      // Declare currentConfigurationIsValid in the broader script scope
      // It's important this is accessible by the report function.
      // To ensure it's truly in the plugin's script scope and not local to a try block:
      var currentConfigurationIsValid = false; // Use var for broader scope if needed, or ensure it's hoisted/accessible.
      // Let's assume it's accessible from report() if defined here.

      try {
        const $statusArea = $('#ai-eval-status-area');
        const $resultsDiv = $('#ai-eval-results');
        const $debugInfoDiv = $('#ai-eval-debug-info');

        if (!($statusArea.length && $resultsDiv.length && $debugInfoDiv.length)) {
          console.error("AI Eval Script: Core UI divs not found. Aborting script.");
          $('body').prepend('<p style="color: red; font-weight: bold;">AI EVAL PLUGIN CRITICAL ERROR: UI DIVS NOT FOUND.</p>');
          return;
        }

        $statusArea.html('<p style="color: blue;">Initializing AI Evaluation settings check...</p>');
        $resultsDiv.html('');
        $debugInfoDiv.html('');

        let serverPrompts = null;

        // Redefine performComprehensiveSettingsCheck and processSettingsCheckResult here
        // as they were in Step 4.
        function performComprehensiveSettingsCheck(callback) {
          $statusArea.html(client.translate('Checking AI configuration...'));
          $resultsDiv.html(''); // Clear results during check
          $debugInfoDiv.html('');

          let isApiUrlMissing = false;
          let isModelMissing = false;
          let messages = [];

          if (!client.settings.ai_llm_api_url || client.settings.ai_llm_api_url.trim() === '') {
            isApiUrlMissing = true;
            messages.push({ type: 'error', text: client.translate('LLM API URL is missing.') + ' ' + client.translate('Please set the AI_LLM_API_URL environment variable on your server.') });
          } else {
            messages.push({ type: 'info', text: client.translate('LLM API URL is configured.') });
          }

          if (!client.settings.ai_llm_model || client.settings.ai_llm_model.trim() === '') {
            isModelMissing = true;
            messages.push({ type: 'warning', text: client.translate('LLM Model is not set (e.g., via AI_LLM_MODEL environment variable).') + ' ' + client.translate('A server-default model may be used, but setting this is recommended.') });
          } else {
            messages.push({ type: 'info', text: client.translate('LLM Model is configured:') + ' ' + client.escape(client.settings.ai_llm_model) });
          }

          messages.push({ type: 'info', text: client.translate('Remember: The AI_LLM_KEY environment variable must be correctly set on your server for evaluations to work. This key is not visible to the browser.') });

          $.ajax({
            url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
            type: 'GET',
            headers: client.headers(),
            success: function(data) {
              serverPrompts = data;
              if (data && data.system_prompt && data.system_prompt.trim() !== '') {
                messages.push({ type: 'info', text: client.translate('Custom System Prompt is configured in Admin Tools.') });
              } else {
                messages.push({ type: 'info', text: client.translate('Custom System Prompt not set in Admin Tools. A default system prompt will be used by the server.') });
              }
              if (data && data.user_prompt_template && data.user_prompt_template.trim() !== '') {
                messages.push({ type: 'info', text: client.translate('Custom User Prompt Template is configured in Admin Tools.') });
              } else {
                messages.push({ type: 'info', text: client.translate('Custom User Prompt Template not set in Admin Tools. A default user prompt template will be used by the server.') });
              }
              processSettingsCheckResult(isApiUrlMissing, messages, callback);
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.error("Error fetching AI prompts configuration:", textStatus, errorThrown);
              messages.push({ type: 'warning', text: client.translate('Could not verify custom prompt settings due to a server error.') + ` (${textStatus})` });
              processSettingsCheckResult(isApiUrlMissing, messages, callback);
            }
          });
        }

        function processSettingsCheckResult(isApiUrlMissing, messages, callback) {
          let finalHtml = '';
          messages.forEach(function(msg) {
            let color = 'black';
            if (msg.type === 'error') color = 'red';
            else if (msg.type === 'warning') color = 'orange';
            else if (msg.type === 'info') color = 'blue';
            finalHtml += `<p style="color: ${color}; margin-bottom: 5px;">${client.escape(msg.text)}</p>`;
          });
          $statusArea.html(finalHtml);
          currentConfigurationIsValid = !isApiUrlMissing; // This sets the script-scoped variable
          if (callback && typeof callback === 'function') {
            callback(currentConfigurationIsValid);
          }
        }

        // Initial check when the script loads / tab is shown
        performComprehensiveSettingsCheck(function(isValidLocal) { // isValidLocal to avoid conflict with outer scope if any
          // This callback updates $resultsDiv based on the final validity from the check
          if (isValidLocal) {
            if ($statusArea.find('p[style*="color:orange"]').length > 0) {
              $resultsDiv.html(client.translate('AI settings allow proceeding with warnings. AI evaluation will automatically start once main report data is loaded.'));
            } else {
              $resultsDiv.html(client.translate('AI settings are valid. AI evaluation will automatically start once main report data is loaded.'));
            }
          } else {
            $resultsDiv.html(`<p style="color: red; font-weight: bold;">${client.translate('AI Evaluation cannot proceed until critical configuration issues (shown above) are resolved.')}</p>`);
          }
        });

        // Restore client.triggerAIEvaluation with full AJAX logic
        client.triggerAIEvaluation = function(cgmDataPayload) {
          if (!currentConfigurationIsValid) { // Check the script-scoped variable
            $resultsDiv.html(`<p style="color: red;">${client.translate('Cannot trigger AI Evaluation: Configuration is invalid. Please check messages above.')}</p>`);
            return;
          }

          $resultsDiv.html(client.translate('Loading AI evaluation...'));
          $debugInfoDiv.html('');

          $.ajax({
            url: client.settings.baseURL + '/api/v1/ai_eval',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(cgmDataPayload),
            headers: client.headers(),
            success: function(response) {
              let finalResultsHtml = '';
              let finalDebugHtml = '';

              if (client.settings.ai_llm_debug && response && response.debug_info) {
                const debug = response.debug_info;
                finalDebugHtml += `<h4 style="margin-top:0;">${client.translate('AI Debug Info:')}</h4>`;
                finalDebugHtml += `<p><strong>${client.translate('Model:')}</strong> ${client.escape(debug.model || 'N/A')}</p>`;
                finalDebugHtml += `<p><strong>${client.translate('System Prompt:')}</strong></p><pre style="white-space: pre-wrap; word-break: break-all; background-color: #f8f8f8; border: 1px solid #ddd; padding: 5px;">${client.escape(debug.system_prompt || 'N/A')}</pre>`;
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
                if ($statusArea.find('p[style*="color:blue"]').length > 0 || $statusArea.find('p[style*="color:orange"]').length > 0) {
                  $statusArea.append(`<p style="margin-top: 5px;"><small>${costMessage}</small></p>`);
                } else { // Fallback if status area is empty or only has red errors
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

      } catch (e) {
        console.error("AI Eval Script: Outer error during script setup:", e);
        // Try to write to status area, then results, then alert as last resort
        if ($('#ai-eval-status-area').length) {
          $('#ai-eval-status-area').html(`<p style="color: red;">AI Eval Plugin Critical Error during script setup: ${e.message}</p>`);
        } else if ($('#ai-eval-results').length) {
          $('#ai-eval-results').html(`<p style="color: red;">AI Eval Plugin Critical Error during script setup: ${e.message}</p>`);
        } else {
          // alert("AI Eval Plugin Critical Error during script setup: " + e.message);
        }
      }
    }
  };

  // The init function for a report plugin usually just returns the plugin object.
  // Make sure this module.exports = init; is at the end of your actual file.
  return aiEvalPlugin;
}

module.exports = init;
