'use strict';

var storedData = {
  datastorage: null,
  sorteddaystoshow: null,
  options: null
};

function init(ctx) {
  var $ = ctx.$;
  let currentConfigurationIsValid = false;
  let serverPrompts = null;

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation',

    html: function(client) {
      // console.log('AI Eval HTML function called (Step 4 Rebuild).'); // Console log can be removed for final version
      return `
        <div id="ai-eval-plugin-content">
          <div id="ai-eval-status-area" style="margin-bottom: 15px;"></div>
          <div id="ai-eval-debug-info" style="margin-bottom: 15px;"></div>
          <div id="ai-eval-results"></div>
        </div>
      `;
    },

    css: `
      #ai-eval-plugin-content { padding: 15px; }
      #ai-eval-results table { width: 100%; border-collapse: collapse; margin-bottom: 1em; }
      #ai-eval-results th, #ai-eval-results td { border: 1px solid #ccc; padding: 8px; text-align: left; }
      #ai-eval-results th { background-color: #f0f0f0; }
      #ai-eval-results h1, #ai-eval-results h2, #ai-eval-results h3 { margin-top: 1em; margin-bottom: 0.5em; }
      #ai-eval-results ul, #ai-eval-results ol { margin-left: 20px; margin-bottom: 1em; }
      #ai-eval-results p { margin-bottom: 1em; }
    `,

    report: function(datastorage, sorteddaystoshow, options) {
      console.log('AI Eval (Step 4 Rebuild - Full Report Logic) REPORT function called. currentConfigurationIsValid:', currentConfigurationIsValid);
      storedData.datastorage = datastorage;
      storedData.sorteddaystoshow = sorteddaystoshow;
      storedData.options = options;

      $('#ai-eval-results').html(''); // Clear previous results first
      $('#ai-eval-debug-info').html('');

      if (currentConfigurationIsValid) { // Check the correctly scoped variable
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
            // Append warning to status area, don't overwrite existing status messages
            if ($statusArea && $statusArea.length) { // Check if $statusArea is defined and found
              $statusArea.append(`<p style="color: orange;">${client.translate('Warning: Could not retrieve full profile data for AI evaluation.')}</p>`);
            } else {
              console.warn("AI Eval: $statusArea not found to append profile warning.");
            }
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
          $('#ai-eval-results').html(client.translate('Waiting for all report data to load before AI Evaluation...'));
        }
      } else {
        // If currentConfigurationIsValid is false
        const $resultsDivLocal = $('#ai-eval-results'); // Ensure it's defined for this scope
        if ($('#ai-eval-status-area:contains("LLM API URL is missing")').length > 0) {
          if($resultsDivLocal.length) $resultsDivLocal.html(client.translate('AI Evaluation cannot proceed until configuration issues (shown above) are resolved.'));
        } else {
          if($resultsDivLocal.length) $resultsDivLocal.html(client.translate('AI Evaluation configuration is invalid or not yet checked. Please ensure the AI Evaluation tab has loaded correctly and all required settings are configured.'));
        }
      }
    },

    script: function(client) {
      // console.log('AI Eval (Step 4 Rebuild - Full Logic) SCRIPT function started.'); // Console log can be removed for final version
      const $statusArea = $('#ai-eval-status-area'); // Defined here for processSettingsCheckResult and triggerAIEvaluation
      const $resultsDiv = $('#ai-eval-results');
      const $debugInfoDiv = $('#ai-eval-debug-info');

      try {
        if (!($statusArea.length && $resultsDiv.length && $debugInfoDiv.length)) {
          console.error("AI Eval Script (Full Rebuild): Core UI divs not found. Aborting script.");
          return;
        }

        $statusArea.html('<p style="color: blue;">Initializing AI Evaluation settings check...</p>');
        $resultsDiv.html('');
        $debugInfoDiv.html('');

        function performComprehensiveSettingsCheck(callback) {
          $statusArea.html(client.translate('Checking AI configuration...'));
          $resultsDiv.html('');
          $debugInfoDiv.html('');
          let isApiUrlMissing = false;
          let messages = [];

          if (!client.settings.ai_llm_api_url || client.settings.ai_llm_api_url.trim() === '') {
            isApiUrlMissing = true;
            messages.push({ type: 'error', text: client.translate('LLM API URL is missing.') + ' ' + client.translate('Please set the AI_LLM_API_URL environment variable on your server.') });
          } else {
            messages.push({ type: 'info', text: client.translate('LLM API URL is configured.') });
          }
          if (!client.settings.ai_llm_model || client.settings.ai_llm_model.trim() === '') {
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
          currentConfigurationIsValid = !isApiUrlMissing;
          if (callback && typeof callback === 'function') {
            callback(currentConfigurationIsValid);
          }
        }

        performComprehensiveSettingsCheck(function(isValid) {
          console.log('AI Eval (Full Rebuild) Initial settings check complete. IsValid:', isValid, 'currentConfigurationIsValid:', currentConfigurationIsValid);
          if (isValid) {
            if ($statusArea.find('p[style*="color:orange"]').length > 0) {
              $resultsDiv.html(client.translate('AI settings allow proceeding with warnings. AI evaluation will automatically start once main report data is loaded.'));
            } else {
              $resultsDiv.html(client.translate('AI settings are valid. AI evaluation will automatically start once main report data is loaded.'));
            }
          } else {
            $resultsDiv.html(`<p style="color: red; font-weight: bold;">${client.translate('AI Evaluation cannot proceed until critical configuration issues (shown above) are resolved.')}</p>`);
          }
        });

        client.triggerAIEvaluation = function(cgmDataPayload) {
          if (!currentConfigurationIsValid) {
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
      } catch (e) {
        console.error("AI Eval Script (Full Rebuild): Outer error during script setup:", e);
        if ($('#ai-eval-status-area').length) { // Check if $statusArea is defined and found
          $('#ai-eval-status-area').html(`<p style="color: red;">AI Eval Plugin Critical Error during script setup: ${e.message}</p>`);
        } else if ($('#ai-eval-results').length) { // Check if $resultsDiv is defined and found
          $('#ai-eval-results').html(`<p style="color: red;">AI Eval Plugin Critical Error during script setup: ${e.message}</p>`);
        }
      }
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
