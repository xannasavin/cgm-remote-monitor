'use strict';

// Globally stored data from the main report load
var storedData = {
  datastorage: null,
  sorteddaystoshow: null,
  options: null
};

function init(ctx) {
  var $ = ctx.$; // jQuery instance from context

  // Helper to ensure the client object passed to plugin methods has necessary utilities
  // and state properties for this plugin.
  const augmentClient = (originalClient) => {
    if (!originalClient.$) {
      originalClient.$ = $; // Provide jQuery via client.$
    }
    if (!originalClient.escape) { // Provide a basic HTML escape utility
      originalClient.escape = function (unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      };
    }
    // Initialize properties that the embedded script will set and report function will read
    originalClient.aiEvalConfigIsValid = false;
    originalClient.triggerAIEvaluation = null; // Will be set by the embedded script
    return originalClient;
  };

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation',

    html: function(originalClient) {
      const client = augmentClient(originalClient); // Use augmented client
      // console.log('AI Eval HTML function called.'); // Removed diagnostic log

      // The entire client-side logic specific to this tab is embedded here.
      // The IIFE receives the 'client' object to access settings, translation, jQuery, etc.
      return `
        <div id="ai-eval-plugin-content">
          <div id="ai-eval-status-area" style="margin-bottom: 15px;"></div>
          <div id="ai-eval-debug-info" style="margin-bottom: 15px;"></div>
          <div id="ai-eval-results"></div>
        </div>

        <script type="text/javascript">
          (function(client) { // IIFE receives the augmented client object
            // console.log('AI Eval Embedded script started.'); // Removed diagnostic log
            
            var $ = client.$; // Use jQuery from the passed client object.

            if (typeof $ === 'undefined') {
              console.error('AI Eval Embedded script: jQuery is not defined via client.$. Cannot initialize plugin UI.');
              var errDiv = document.createElement('div');
              errDiv.style.color = 'red'; errDiv.style.backgroundColor = 'yellow'; errDiv.style.padding = '10px';
              errDiv.textContent = 'AI EVAL PLUGIN CRITICAL ERROR: jQuery NOT FOUND via client.$.';
              if (document.body) document.body.insertBefore(errDiv, document.body.firstChild);
              return; 
            }

            // IIFE-scoped variables for settings check
            let currentConfigurationIsValid = false; // Internal flag for this script's logic
            let serverPrompts = null; 

            // jQuery selectors for UI elements
            var $statusArea = $('#ai-eval-status-area');
            var $resultsDiv = $('#ai-eval-results');
            var $debugInfoDiv = $('#ai-eval-debug-info');

            if (!($statusArea.length && $resultsDiv.length && $debugInfoDiv.length)) {
              console.error('AI Eval Embedded script: One or more critical UI divs (#ai-eval-status-area, #ai-eval-results, #ai-eval-debug-info) not found. Plugin cannot initialize.');
              return; 
            }
            
            $statusArea.html(\`<p style="color: blue;">\${client.translate('Initializing AI Evaluation...')}</p>\`);
            $resultsDiv.html('');
            $debugInfoDiv.html('');

            // Performs all settings checks (client-side and server-side for prompts)
            function performComprehensiveSettingsCheck(callback) {
              $statusArea.html(client.translate('Checking AI configuration...'));
              // $resultsDiv.html(''); // Keep resultsDiv showing "Initializing" or previous state from callback
              // $debugInfoDiv.html(''); // Keep debug cleared
              
              let isApiUrlMissing = false; // Critical blocking setting
              let messages = []; 

              // Check AI_LLM_API_URL
              if (!client.settings.ai_llm_api_url || client.settings.ai_llm_api_url.trim() === '') {
                isApiUrlMissing = true;
                messages.push({ type: 'error', text: client.translate('LLM API URL is missing.') + ' ' + client.translate('Please set the AI_LLM_API_URL environment variable on your server.') });
              } else {
                messages.push({ type: 'info', text: client.translate('LLM API URL is configured.') });
              }
              // Check AI_LLM_MODEL
              if (!client.settings.ai_llm_model || client.settings.ai_llm_model.trim() === '') {
                messages.push({ type: 'warning', text: client.translate('LLM Model is not set (e.g., via AI_LLM_MODEL environment variable).') + ' ' + client.translate('A server-default model may be used, but setting this is recommended.') });
              } else {
                 messages.push({ type: 'info', text: client.translate('LLM Model is configured:') + ' ' + client.escape(client.settings.ai_llm_model) });
              }
              // Reminder for AI_LLM_KEY
              messages.push({ type: 'info', text: client.translate('Remember: The AI_LLM_KEY environment variable must be correctly set on your server for evaluations to work. This key is not visible to the browser.') });
              
              // Fetch custom prompts status
              $.ajax({
                url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
                type: 'GET',
                headers: client.headers(),
                success: function(data) {
                  serverPrompts = data; // Store fetched prompts (might be empty)
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
                  messages.push({ type: 'warning', text: client.translate('Could not verify custom prompt settings due to a server error.') + \` (\${textStatus})\` });
                  processSettingsCheckResult(isApiUrlMissing, messages, callback); 
                }
              });
            }

            // Processes results of settings checks and updates UI and validity state
            function processSettingsCheckResult(isApiUrlMissing, messages, callback) {
              let finalHtml = '';
              messages.forEach(function(msg) {
                let color = 'black'; // Default color
                if (msg.type === 'error') color = 'red';
                else if (msg.type === 'warning') color = 'orange';
                else if (msg.type === 'info') color = 'blue';
                finalHtml += \`<p style="color: \${color}; margin-bottom: 5px;">\${client.escape(msg.text)}</p>\`;
              });
              $statusArea.html(finalHtml);
              
              currentConfigurationIsValid = !isApiUrlMissing; // Set IIFE-scoped variable
              client.aiEvalConfigIsValid = currentConfigurationIsValid; // Update client object for report function

              if (callback && typeof callback === 'function') {
                callback(currentConfigurationIsValid); 
              }
            }

            // Initial settings check when the embedded script loads
            try {
              performComprehensiveSettingsCheck(function(isValid) {
                // console.log('AI Eval Initial settings check complete. IsValid:', isValid); // Removed diagnostic log
                if (isValid) {
                  if ($statusArea.find('p[style*="color:orange"]').length > 0) { // Check for warnings
                       $resultsDiv.html(client.translate('AI settings allow proceeding with warnings. AI evaluation will automatically start once main report data is loaded.'));
                  } else {
                       $resultsDiv.html(client.translate('AI settings are valid. AI evaluation will automatically start once main report data is loaded.'));
                  }
                } else {
                   $resultsDiv.html(\`<p style="color: red; font-weight: bold;">\${client.translate('AI Evaluation cannot proceed until critical configuration issues (shown above) are resolved.')}</p>\`);
                }
              });
            } catch (e) {
                console.error("AI Eval Plugin: Error during initial settings check:", e);
                $statusArea.html(\`<p style="color: red;">\${client.translate('Critical error during AI Plugin initialization:')} \${client.escape(e.message)}</p>\`);
                $resultsDiv.html(client.translate('Plugin failed to initialize. Check console for details.'));
                currentConfigurationIsValid = false; 
                client.aiEvalConfigIsValid = false; // Ensure state is false
            }

            // Defines the function to trigger AI evaluation; attached to client object for report function to call
            client.triggerAIEvaluation = function(cgmDataPayload) {
              if (!currentConfigurationIsValid) { 
                $resultsDiv.html(\`<p style="color: red;">\${client.translate('Cannot trigger AI Evaluation: Configuration is invalid. Please check messages above.')}</p>\`);
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
                    finalDebugHtml += \`<h4 style="margin-top:0;">\${client.translate('AI Debug Info:')}</h4>\`;
                    finalDebugHtml += \`<p><strong>\${client.translate('Model:')}</strong> \${client.escape(debug.model || 'N/A')}</p>\`;
                    finalDebugHtml += \`<p><strong>\${client.translate('System Prompt:')}</strong></p><pre style="white-space: pre-wrap; word-break: break-all; background-color: #f8f8f8; border: 1px solid #ddd; padding: 5px;">\${client.escape(debug.system_prompt || 'N/A')}</pre>\`;
                    finalDebugHtml += \`<p><strong>\${client.translate('Final User Prompt (with data injected):')}</strong></p><pre style="white-space: pre-wrap; word-break: break-all; background-color: #f8f8f8; border: 1px solid #ddd; padding: 5px;">\${client.escape(debug.final_user_prompt || 'N/A')}</pre>\`;
                    $debugInfoDiv.html(finalDebugHtml).show();
                  } else {
                    $debugInfoDiv.hide();
                  }
                  if (response && response.html_content) {
                    finalResultsHtml += response.html_content;
                  } else {
                    finalResultsHtml += \`<p>\${client.translate('Received an empty or unexpected LLM response from the server.')}</p>\`;
                  }
                  if (response && response.tokens_used) {
                      const costMessage = client.translate('Tokens used for this evaluation:') + ' ' + response.tokens_used;
                      // Append token usage to status area if it has info/warnings, else to results.
                      if ($statusArea.find('p[style*="color:blue"]').length > 0 || $statusArea.find('p[style*="color:orange"]').length > 0) { 
                          $statusArea.append(\`<p style="margin-top: 5px;"><small>\${costMessage}</small></p>\`);
                      } else { 
                          finalResultsHtml += \`<hr><p><small>\${costMessage}</small></p>\`;
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
                      if (parsedError && parsedError.error) { errorMsg += ' - ' + client.translate(parsedError.error); }
                      else { errorMsg += ' - ' + client.translate('Check server logs for details.'); }
                    } catch (e) { errorMsg += ' - ' + client.translate('Unparseable error from server. Check server logs.'); }
                  }
                  $resultsDiv.html(\`<p style="color: red;">\${client.escape(errorMsg)}</p>\`); // Ensure errorMsg is escaped
                  $debugInfoDiv.hide();
                }
              });
            }; // End of client.triggerAIEvaluation definition

            // console.log('AI Eval Embedded script finished initialization.'); // Removed diagnostic log
          })(client); // Immediately invoke the IIFE, passing the client object from html function's argument
        </script>
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

    report: function(originalClient, datastorage, sorteddaystoshow, options) {
      const client = augmentClient(originalClient); // Use augmented client
      // console.log('AI Eval REPORT function called. Config valid on client obj:', client.aiEvalConfigIsValid); // Removed diagnostic log

      var $resultsDivFromReport = $('#ai-eval-results'); // Re-select for safety, or pass via client
      var $debugInfoDivFromReport = $('#ai-eval-debug-info');

      if($resultsDivFromReport.length) $resultsDivFromReport.html('');
      if($debugInfoDivFromReport.length) $debugInfoDivFromReport.html('');

      storedData.datastorage = datastorage;
      storedData.sorteddaystoshow = sorteddaystoshow;
      storedData.options = options;

      if (client.aiEvalConfigIsValid) {
        if (storedData.datastorage && storedData.sorteddaystoshow && storedData.options) {
          if($resultsDivFromReport.length) $resultsDivFromReport.html(client.translate('Preparing data for AI evaluation...'));

          let cgmDataPayload = {
            reportSettings: {
              targetLow: storedData.options.targetLow, targetHigh: storedData.options.targetHigh,
              units: storedData.options.units,
              dateFrom: storedData.sorteddaystoshow.length > 0 ? storedData.sorteddaystoshow[0] : null,
              dateTo: storedData.sorteddaystoshow.length > 0 ? storedData.sorteddaystoshow[storedData.sorteddaystoshow.length - 1] : null,
              reportName: storedData.options.reportName
            }, entries: [], treatments: [], deviceStatus: [], profile: {}
          };
          try {
            if (client.profile && typeof client.profile === 'function') {
              const fullProfile = client.profile();
              if (fullProfile && fullProfile.store && fullProfile.store[fullProfile.defaultProfile]) {
                const activeProfileStore = fullProfile.store[fullProfile.defaultProfile];
                cgmDataPayload.profile = { timezone: activeProfileStore.timezone, basal: activeProfileStore.basal, carbratio: activeProfileStore.carbratio, sens: activeProfileStore.sens };
              } else if (fullProfile && fullProfile.defaultProfile && fullProfile[fullProfile.defaultProfile]) {
                const activeProfileData = fullProfile[fullProfile.defaultProfile];
                cgmDataPayload.profile = { timezone: activeProfileData.timezone, basal: activeProfileData.basal, carbratio: activeProfileData.carbratio, sens: activeProfileData.sens };
              }
            }
          } catch (e) { console.error("AI Eval (Report): Error accessing client profile data:", e); if ($('#ai-eval-status-area').length) $('#ai-eval-status-area').append(\`<p style="color: orange;">\${client.escape(client.translate('Warning: Could not retrieve full profile data for AI evaluation.'))}</p>\`);}
          
          storedData.sorteddaystoshow.forEach(function(dayString) { 
            var dayData = storedData.datastorage[dayString];
            if (dayData && !dayData.treatmentsonly) {
              if (dayData.sgv) dayData.sgv.forEach(s => cgmDataPayload.entries.push({ type: 'sgv', date: s.mills, sgv: s.sgv, direction: s.direction }));
              if (dayData.mbg) dayData.mbg.forEach(m => cgmDataPayload.entries.push({ type: 'mbg', date: m.mills, mbg: m.mbg }));
              if (dayData.treatments) dayData.treatments.forEach(t => { let te = {eventType: t.eventType, timestamp: t.timestamp, mills: t.mills, created_at: t.created_at}; if (t.carbs) te.carbs = t.carbs; if (t.insulin) te.insulin = t.insulin; if (t.notes) te.notes = t.notes; cgmDataPayload.treatments.push(te); });
            }
          });
          
          if (storedData.options && storedData.options.devicestatus) cgmDataPayload.deviceStatus = storedData.options.devicestatus;
          else if (datastorage.devicestatus) cgmDataPayload.deviceStatus = datastorage.devicestatus;

          if (typeof client.triggerAIEvaluation === 'function') {
            client.triggerAIEvaluation(cgmDataPayload);
          } else {
            console.error("AI Eval (Report): triggerAIEvaluation function not found on client object.");
            if($resultsDivFromReport.length) $resultsDivFromReport.html(\`<p style="color: red;">\${client.escape(client.translate('Error: AI Evaluation trigger function is missing on client.'))}</p>\`);
          }
        } else {
          if($resultsDivFromReport.length) $resultsDivFromReport.html(client.translate('Waiting for all report data to load before AI Evaluation...'));
        }
      } else {
        if($resultsDivFromReport.length) {
            // Check if the specific error message about API URL is in status area
            if ($('#ai-eval-status-area').find('p:contains("LLM API URL is missing")').length > 0 && $('#ai-eval-status-area').find('p[style*="color: red"]').length > 0) {
                 $resultsDivFromReport.html(client.translate('AI Evaluation cannot proceed until configuration issues (shown above) are resolved.'));
            } else {
                 $resultsDivFromReport.html(client.translate('AI Evaluation configuration is invalid or not yet checked. Ensure the AI tab has loaded and required settings are configured.'));
            }
        }
      }
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
