'use strict';

var storedData = {
  datastorage: null,
  sorteddaystoshow: null,
  options: null
};

function init(ctx) {
  var $ = ctx.$;

  const augmentClient = (originalClient) => {
    if (!originalClient.$) {
      originalClient.$ = $;
    }
    if (!originalClient.escape) {
      originalClient.escape = function (unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      };
    }
    originalClient.aiEvalConfigIsValid = false;
    originalClient.triggerAIEvaluation = null;
    return originalClient;
  };

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation',

    html: function(originalClient) {
      const client = augmentClient(originalClient);

      // Prepare a serializable object of settings for the embedded script
      const clientSettingsForScript = {
        ai_llm_api_url: client.settings.ai_llm_api_url,
        ai_llm_model: client.settings.ai_llm_model,
        baseURL: client.settings.baseURL,
        ai_llm_debug: client.settings.ai_llm_debug
        // Add other simple settings if needed by the script
      };
      const clientSettingsJSON = JSON.stringify(clientSettingsForScript);

      // The IIFE will use window.jQuery and the embedded clientSettingsJSON.
      // It will attempt to use 'client.translate' and 'client.headers' via closure.
      return `
        <div id="ai-eval-plugin-content">
          <div id="ai-eval-status-area" style="margin-bottom: 15px;"></div>
          <div id="ai-eval-debug-info" style="margin-bottom: 15px;"></div>
          <div id="ai-eval-results"></div>
        </div>

        <script type="text/javascript">
          (function() { // IIFE relies on closure for 'client' object's methods
            // console.log('AI Eval Embedded Script (S1 - Explicit Data) started.');
            
            var $ = window.jQuery; // Get jQuery from global scope

            if (typeof $ === 'undefined') {
              console.error('AI Eval Embedded Script: jQuery (window.jQuery) is not defined. Cannot initialize plugin UI.');
              // Minimal error display without jQuery
              var errDiv = document.getElementById('ai-eval-status-area') || document.body;
              var p = document.createElement('p');
              p.style.color = 'red'; p.style.fontWeight = 'bold';
              p.textContent = 'AI EVAL PLUGIN CRITICAL ERROR: jQuery NOT FOUND.';
              if (errDiv) errDiv.appendChild(p); else if(document.body) document.body.insertBefore(p, document.body.firstChild);
              return; 
            }

            // Parse the embedded client settings
            var clientSettings = {};
            try {
              clientSettings = JSON.parse('${clientSettingsJSON}');
            } catch (e) {
              console.error('AI Eval Embedded Script: Failed to parse clientSettingsJSON.', e);
              $statusArea.html('<p style="color:red;">Critical error: Could not parse client settings.</p>');
              return;
            }
            
            // console.log('AI Eval Embedded Script: jQuery and clientSettings obtained.');

            let currentConfigurationIsValid = false; 
            let serverPrompts = null; 

            var $statusArea = $('#ai-eval-status-area');
            var $resultsDiv = $('#ai-eval-results');
            var $debugInfoDiv = $('#ai-eval-debug-info');

            if (!($statusArea.length && $resultsDiv.length && $debugInfoDiv.length)) {
              console.error('AI Eval Embedded Script: One or more critical UI divs not found.');
              return; 
            }
            
            // Use client.translate if available via closure
            var initialMsg = typeof client !== 'undefined' && client.translate ? client.translate('Initializing AI Evaluation...') : 'Initializing AI Evaluation... (translate unavailable)';
            $statusArea.html('<p style="color: blue;">' + initialMsg + '</p>');
            $resultsDiv.html('');
            $debugInfoDiv.html('');

            function performComprehensiveSettingsCheck(callback) {
              var checkingMsg = typeof client !== 'undefined' && client.translate ? client.translate('Checking AI configuration...') : 'Checking AI configuration...';
              $statusArea.html(checkingMsg);
              let isApiUrlMissing = false; 
              let messages = []; 

              if (!clientSettings.ai_llm_api_url || clientSettings.ai_llm_api_url.trim() === '') {
                isApiUrlMissing = true;
                messages.push({ type: 'error', text: (client.translate ? client.translate('LLM API URL is missing.') : 'LLM API URL is missing.') + ' ' + (client.translate ? client.translate('Please set the AI_LLM_API_URL environment variable on your server.') : 'Set AI_LLM_API_URL ENV var.') });
              } else {
                messages.push({ type: 'info', text: (client.translate ? client.translate('LLM API URL is configured.') : 'LLM API URL is configured.') });
              }
              if (!clientSettings.ai_llm_model || clientSettings.ai_llm_model.trim() === '') {
                messages.push({ type: 'warning', text: (client.translate ? client.translate('LLM Model is not set (e.g., via AI_LLM_MODEL environment variable).') : 'LLM Model not set.') + ' ' + (client.translate ? client.translate('A server-default model may be used, but setting this is recommended.') : 'Server default may be used.') });
              } else {
                 messages.push({ type: 'info', text: (client.translate ? client.translate('LLM Model is configured:') : 'LLM Model configured:') + ' ' + (client.escape ? client.escape(clientSettings.ai_llm_model) : clientSettings.ai_llm_model) });
              }
              messages.push({ type: 'info', text: (client.translate ? client.translate('Remember: The AI_LLM_KEY environment variable must be correctly set on your server for evaluations to work. This key is not visible to the browser.') : 'Remember AI_LLM_KEY for server.') });
              
              var ajaxHeaders = typeof client !== 'undefined' && client.headers ? client.headers() : {};
              $.ajax({
                url: clientSettings.baseURL + '/api/v1/ai_settings/prompts',
                type: 'GET',
                headers: ajaxHeaders,
                success: function(data) {
                  serverPrompts = data; 
                  if (data && data.system_prompt && data.system_prompt.trim() !== '') {
                    messages.push({ type: 'info', text: (client.translate ? client.translate('Custom System Prompt is configured in Admin Tools.') : 'Custom System Prompt set.') });
                  } else {
                    messages.push({ type: 'info', text: (client.translate ? client.translate('Custom System Prompt not set in Admin Tools. A default system prompt will be used by the server.') : 'Default System Prompt will be used.') });
                  }
                  if (data && data.user_prompt_template && data.user_prompt_template.trim() !== '') {
                    messages.push({ type: 'info', text: (client.translate ? client.translate('Custom User Prompt Template is configured in Admin Tools.') : 'Custom User Prompt Template set.') });
                  } else {
                    messages.push({ type: 'info', text: (client.translate ? client.translate('Custom User Prompt Template not set in Admin Tools. A default user prompt template will be used by the server.') : 'Default User Prompt Template will be used.') });
                  }
                  processSettingsCheckResult(isApiUrlMissing, messages, callback);
                },
                error: function(jqXHR, textStatus, errorThrown) {
                  console.error("Error fetching AI prompts configuration:", textStatus, errorThrown);
                  messages.push({ type: 'warning', text: (client.translate ? client.translate('Could not verify custom prompt settings due to a server error.') : 'Could not verify prompts.') + ' (' + textStatus + ')' });
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
                finalHtml += '<p style="color: ' + color + '; margin-bottom: 5px;">' + (client.escape ? client.escape(msg.text) : msg.text) + '</p>';
              });
              $statusArea.html(finalHtml);
              currentConfigurationIsValid = !isApiUrlMissing; 
              if (typeof client !== 'undefined') client.aiEvalConfigIsValid = currentConfigurationIsValid; 
              if (callback && typeof callback === 'function') {
                callback(currentConfigurationIsValid); 
              }
            }

            try {
              performComprehensiveSettingsCheck(function(isValid) {
                var resultsMsg = '';
                if (isValid) {
                  if ($statusArea.find('p[style*="color:orange"]').length > 0) { 
                       resultsMsg = client.translate ? client.translate('AI settings allow proceeding with warnings. AI evaluation will automatically start once main report data is loaded.') : 'Proceed with warnings. Auto-evaluation on data load.';
                  } else {
                       resultsMsg = client.translate ? client.translate('AI settings are valid. AI evaluation will automatically start once main report data is loaded.') : 'Settings valid. Auto-evaluation on data load.';
                  }
                } else {
                   resultsMsg = '<p style="color: red; font-weight: bold;">' + (client.translate ? client.translate('AI Evaluation cannot proceed until critical configuration issues (shown above) are resolved.') : 'Cannot proceed, critical config issues.') + '</p>';
                }
                $resultsDiv.html(resultsMsg);
              });
            } catch (e) {
                console.error("AI Eval Plugin: Error during initial settings check:", e);
                var errorInitMsg = client.translate ? client.translate('Critical error during AI Plugin initialization:') : 'Critical init error:';
                var errorPluginFailMsg = client.translate ? client.translate('Plugin failed to initialize. Check console for details.') : 'Plugin init failed.';
                $statusArea.html('<p style="color: red;">' + errorInitMsg + ' ' + (client.escape ? client.escape(e.message) : e.message) + '</p>');
                $resultsDiv.html(errorPluginFailMsg);
                currentConfigurationIsValid = false; 
                if (typeof client !== 'undefined') client.aiEvalConfigIsValid = false; 
            }

            if (typeof client !== 'undefined') {
              client.triggerAIEvaluation = function(cgmDataPayload) {
                if (!currentConfigurationIsValid) { 
                  $resultsDiv.html('<p style="color: red;">' + (client.translate ? client.translate('Cannot trigger AI Evaluation: Configuration is invalid. Please check messages above.') : 'Cannot trigger: Config invalid.')+ '</p>');
                  return;
                }
                $resultsDiv.html(client.translate ? client.translate('Loading AI evaluation...') : 'Loading AI evaluation...');
                $debugInfoDiv.html(''); 
                var ajaxHeaders = client.headers ? client.headers() : {};
                var ajaxBaseURL = clientSettings.baseURL || '';

                $.ajax({
                  url: ajaxBaseURL + '/api/v1/ai_eval',
                  type: 'POST',
                  contentType: 'application/json',
                  data: JSON.stringify(cgmDataPayload),
                  headers: ajaxHeaders,
                  success: function(response) {
                    let finalResultsHtml = '';
                    let finalDebugHtml = '';
                    if (clientSettings.ai_llm_debug && response && response.debug_info) {
                      const debug = response.debug_info;
                      finalDebugHtml += '<h4 style="margin-top:0;">' + (client.translate ? client.translate('AI Debug Info:') : 'AI Debug Info:') + '</h4>';
                      finalDebugHtml += '<p><strong>' + (client.translate ? client.translate('Model:') : 'Model:') + '</strong> ' + (client.escape ? client.escape(debug.model || 'N/A') : (debug.model || 'N/A')) + '</p>';
                      finalDebugHtml += '<p><strong>' + (client.translate ? client.translate('System Prompt:') : 'System Prompt:') + '</strong></p><pre style="white-space: pre-wrap; word-break: break-all; background-color: #f8f8f8; border: 1px solid #ddd; padding: 5px;">' + (client.escape ? client.escape(debug.system_prompt || 'N/A') : (debug.system_prompt || 'N/A')) + '</pre>';
                      finalDebugHtml += '<p><strong>' + (client.translate ? client.translate('Final User Prompt (with data injected):') : 'Final User Prompt:') + '</strong></p><pre style="white-space: pre-wrap; word-break: break-all; background-color: #f8f8f8; border: 1px solid #ddd; padding: 5px;">' + (client.escape ? client.escape(debug.final_user_prompt || 'N/A') : (debug.final_user_prompt || 'N/A')) + '</pre>';
                      $debugInfoDiv.html(finalDebugHtml).show();
                    } else {
                      $debugInfoDiv.hide();
                    }
                    if (response && response.html_content) {
                      finalResultsHtml += response.html_content;
                    } else {
                      finalResultsHtml += '<p>' + (client.translate ? client.translate('Received an empty or unexpected LLM response from the server.') : 'Empty/unexpected LLM response.') + '</p>';
                    }
                    if (response && response.tokens_used) {
                        const costMessage = (client.translate ? client.translate('Tokens used for this evaluation:') : 'Tokens used:') + ' ' + response.tokens_used;
                        if ($statusArea.find('p[style*="color:blue"]').length > 0 || $statusArea.find('p[style*="color:orange"]').length > 0) { 
                            $statusArea.append('<p style="margin-top: 5px;"><small>' + costMessage + '</small></p>');
                        } else { 
                            finalResultsHtml += '<hr><p><small>' + costMessage + '</small></p>';
                        }
                    }
                    $resultsDiv.html(finalResultsHtml);
                  },
                  error: function(jqXHR, textStatus, errorThrown) {
                    console.error('AI Eval Error:', textStatus, errorThrown, jqXHR.responseText);
                    var errorMsg = (client.translate ? client.translate('Error fetching AI evaluation: ') : 'Error fetching AI evaluation: ') + textStatus;
                    if (jqXHR.responseJSON && jqXHR.responseJSON.error) {
                      errorMsg += ' - ' + (client.translate ? client.translate(jqXHR.responseJSON.error) : jqXHR.responseJSON.error);
                    } else if (jqXHR.responseText) {
                      try {
                        var parsedError = JSON.parse(jqXHR.responseText);
                        if (parsedError && parsedError.error) { errorMsg += ' - ' + (client.translate ? client.translate(parsedError.error) : parsedError.error); }
                        else { errorMsg += ' - ' + (client.translate ? client.translate('Check server logs for details.') : 'Check server logs.'); }
                      } catch (e) { errorMsg += ' - ' + (client.translate ? client.translate('Unparseable error from server. Check server logs.') : 'Unparseable error.'); }
                    }
                    $resultsDiv.html('<p style="color: red;">' + (client.escape ? client.escape(errorMsg) : errorMsg) + '</p>');
                    $debugInfoDiv.hide();
                  }
                });
              };
            }
            // console.log('AI Eval Embedded script finished initialization.');
          })(); // IIFE does not take client as arg here, relies on closure
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
      const client = augmentClient(originalClient);
      var $resultsDivFromReport = $('#ai-eval-results');
      var $debugInfoDivFromReport = $('#ai-eval-debug-info');

      if($resultsDivFromReport.length) $resultsDivFromReport.html('');
      if($debugInfoDivFromReport.length) $debugInfoDivFromReport.html('');

      storedData.datastorage = datastorage;
      storedData.sorteddaystoshow = sorteddaystoshow;
      storedData.options = options;

      if (client.aiEvalConfigIsValid) {
        if (storedData.datastorage && storedData.sorteddaystoshow && storedData.options) {
          if($resultsDivFromReport.length) $resultsDivFromReport.html(client.translate ? client.translate('Preparing data for AI evaluation...') : 'Preparing data...');

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
          } catch (e) {
            console.error("AI Eval (Report): Error accessing client profile data:", e);
            if ($('#ai-eval-status-area').length) {
              $('#ai-eval-status-area').append('<p style="color: orange;">' + (client.escape ? client.escape(client.translate ? client.translate('Warning: Could not retrieve full profile data for AI evaluation.') : 'Warning: Profile data error.') : (client.translate ? client.translate('Warning: Could not retrieve full profile data for AI evaluation.') : 'Warning: Profile data error.')) + '</p>');
            }
          }

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
            if($resultsDivFromReport.length) $resultsDivFromReport.html('<p style="color: red;">' + (client.escape ? client.escape(client.translate ? client.translate('Error: AI Evaluation trigger function is missing on client.') : 'Error: Trigger missing.') : (client.translate ? client.translate('Error: AI Evaluation trigger function is missing on client.') : 'Error: Trigger missing.'))+ '</p>');
          }
        } else {
          if($resultsDivFromReport.length) $resultsDivFromReport.html(client.translate ? client.translate('Waiting for all report data to load before AI Evaluation...') : 'Waiting for data...');
        }
      } else {
        if($resultsDivFromReport.length) {
          if ($('#ai-eval-status-area').find('p:contains("LLM API URL is missing")').length > 0 && $('#ai-eval-status-area').find('p[style*="color: red"]').length > 0) {
            $resultsDivFromReport.html(client.translate ? client.translate('AI Evaluation cannot proceed until configuration issues (shown above) are resolved.') : 'Cannot proceed: Config issues.');
          } else {
            $resultsDivFromReport.html(client.translate ? client.translate('AI Evaluation configuration is invalid or not yet checked. Ensure the AI tab has loaded and required settings are configured.') : 'Config invalid/not checked.');
          }
        }
      }
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
