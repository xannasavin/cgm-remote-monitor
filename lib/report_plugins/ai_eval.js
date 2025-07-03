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
      // Store the data for later use by the button
      storedData.datastorage = datastorage;
      storedData.sorteddaystoshow = sorteddaystoshow;
      storedData.options = options;
      // console.log('AI Eval plugin: Data stored by report function.', storedData);

      // Clear previous results if any when new main report is generated
      $('#ai-eval-results').html('');
    },

    html: function(client) {
      var placeholderText = client.translate('AI evaluations will appear here. Click "Show AI Evaluation" after the main report data has loaded.');
      var showButtonText = client.translate('Show AI Evaluation');
      var html = `
        <div id="ai-eval-content">
          <p>${placeholderText}</p>
          <button id="ai-eval-show-button" class="btn">${showButtonText}</button>
          <div id="ai-eval-results" style="margin-top: 20px;">
            <!-- LLM results will be displayed here -->
          </div>
        </div>
      `;
      return html;
    },

    css: `
      #ai-eval-content {
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
      const $showButton = $('#ai-eval-show-button');
      const $resultsDiv = $('#ai-eval-results');
      let serverPrompts = null; // To store fetched prompts

      function checkConfigurationAndToggleButton() {
        let missingSettings = [];
        let guidanceMessages = [];

        // Check client-available settings (which reflect server ENV vars)
        if (!client.settings.ai_llm_api_url) {
          missingSettings.push(client.translate('LLM API URL (AI_LLM_API_URL environment variable)'));
        }
        if (!client.settings.ai_llm_model) {
          missingSettings.push(client.translate('LLM Model (AI_LLM_MODEL environment variable)'));
        }
        // AI_LLM_KEY is a server-side check, but we can remind the user about it.
        // We can't confirm its presence from the client, but if others are missing, it's good to list.
        if (!client.settings.ai_llm_api_url || !client.settings.ai_llm_model) { // If core URL/model missing, key is also critical
             // No direct check for ai_llm_key on client for security, server handles this.
             // But we can add a general reminder if other critical settings are missing.
        }


        // Check server-configured prompts
        if (serverPrompts) {
          if (!serverPrompts.system_prompt) {
            missingSettings.push(client.translate('System Prompt (configure in Admin Tools > AI Evaluation Prompt Settings)'));
          }
          if (!serverPrompts.user_prompt_template) {
            missingSettings.push(client.translate('User Prompt Template (configure in Admin Tools > AI Evaluation Prompt Settings, or set AI_LLM_PROMPT environment variable as fallback)'));
          }
        } else {
          // If serverPrompts is null, it means the fetch hasn't completed or failed.
          // We can add a generic message or wait for the fetch to complete.
          // For now, if other things are missing, this will be covered.
          // If fetch failed, an error message is already shown by fetchPromptsConfig.
        }

        if (missingSettings.length > 0) {
          $showButton.prop('disabled', true);
          let errorMessage = `<p style="color: red; font-weight: bold;">${client.translate('AI Evaluation Configuration Incomplete:')}</p>
                            <p>${client.translate('The following configurations are missing or not set. Please configure them to enable AI Evaluation:')}</p>
                            <ul style="color: red; margin-left: 20px;">`;
          missingSettings.forEach(function(setting) {
            errorMessage += `<li>${setting}</li>`;
          });
          errorMessage += `</ul>`;
          if (!client.settings.ai_llm_key) { // Add a reminder for the key if other settings are missing
            errorMessage += `<p style="color: orange;">${client.translate('Also ensure the AI_LLM_KEY environment variable is set on your server.')}</p>`;
          }
          $resultsDiv.html(errorMessage);
          return false;
        } else {
          $showButton.prop('disabled', false);
          // Clear previous error messages if any, but preserve loading/results message
          if ($resultsDiv.find('p[style*="color: red"]').length > 0 || $resultsDiv.find('p[style*="color: orange"]').length > 0) {
            //$resultsDiv.html(client.translate('Configuration complete. Ready to generate AI evaluation.'));
          }
          return true;
        }
      }

      function fetchPromptsConfig() {
        $showButton.prop('disabled', true); // Disable button while checking
        $resultsDiv.html(client.translate('Checking AI configuration...'));

        $.ajax({
          url: client.settings.baseURL + '/api/v1/ai_settings/prompts',
          type: 'GET',
          headers: client.headers(),
          success: function(data) {
            serverPrompts = data;
            if (data && (data.system_prompt || data.user_prompt_template)) {
              // console.log('AI Eval: Prompts fetched successfully.', data);
            } else if (data && !data.system_prompt && !data.user_prompt_template && client.settings.ai_llm_prompt) {
              // Prompts are empty in DB, but the fallback AI_LLM_PROMPT might be set on server.
              // Server will handle this, so we can consider client-side check for prompts as "conditionally passed" if AI_LLM_PROMPT could be a factor.
              // However, it's better to be explicit. The server API for /ai_eval already has robust fallback.
              // For this check, we rely on what /api/v1/ai_settings/prompts returns.
              // If both are empty, they are truly missing from primary config.
            }
            checkConfigurationAndToggleButton();
          },
          error: function(jqXHR, textStatus, errorThrown) {
            console.error("Error fetching AI prompts configuration:", textStatus, errorThrown);
            serverPrompts = { system_prompt: '', user_prompt_template: '' }; // Assume empty on error to show them as missing
            $resultsDiv.html(`<p style="color: red;">${client.translate('Error checking AI prompt configuration: ')} ${textStatus}. ${client.translate('AI Evaluation may not function correctly.')}</p>`);
            checkConfigurationAndToggleButton(); // Still run check to show other missing settings
          }
        });
      }

      // Initial check when the script loads / tab is shown
      fetchPromptsConfig();


      $showButton.on('click', function() {
        if (!checkConfigurationAndToggleButton()) {
          // Re-check just in case, and prevent submission if still not configured.
          return;
        }

        $resultsDiv.html(client.translate('Loading AI evaluation...'));

        if (!storedData.datastorage || !storedData.sorteddaystoshow || !storedData.options) {
          $resultsDiv.html(`<p style="color: red;">${client.translate('Report data not loaded yet. Please click the main "Show" button for the reports first.')}</p>`);
          return;
        }

        // Server-side settings (like AI_LLM_KEY) are validated by the /api/v1/ai_eval endpoint.
        // Client-side checks for URL and Model are already done by checkConfigurationAndToggleButton.

        var daysData = [];
        storedData.sorteddaystoshow.forEach(function(dayString) {
          var dayData = storedData.datastorage[dayString];
          if (dayData && !dayData.treatmentsonly) { // treatmentsonly days are for previous day's treatments, not full days
            daysData.push({
              date: dayString,
              sgv: dayData.sgv ? dayData.sgv.map(function(s) { return { sgv: s.sgv, mills: s.mills, type: s.type }; }) : [],
              treatments: dayData.treatments ? dayData.treatments.map(function(t) { return { eventType: t.eventType, carbs: t.carbs, insulin: t.insulin, mills: t.mills }; }) : [],
              dailyCarbs: dayData.dailyCarbs
            });
          }
        });

        var payload = {
          reportOptions: {
            targetLow: storedData.options.targetLow,
            targetHigh: storedData.options.targetHigh,
            units: storedData.options.units,
            dateFrom: storedData.sorteddaystoshow.length > 0 ? storedData.sorteddaystoshow[0] : null,
            dateTo: storedData.sorteddaystoshow.length > 0 ? storedData.sorteddaystoshow[storedData.sorteddaystoshow.length - 1] : null,
          },
          daysData: daysData,
          prompt: llmPrompt
        };

        // console.log('AI Eval: Sending payload to /api/v1/ai_eval', payload);

        $.ajax({
          url: client.settings.baseURL + '/api/v1/ai_eval', // Ensure baseURL is prepended
          type: 'POST',
          contentType: 'application/json',
          data: JSON.stringify(payload),
          headers: client.headers(), // For authentication if needed
          success: function(response) {
            // Assuming the response is HTML or Markdown that can be directly injected.
            // For Markdown, a client-side parser might be needed if not pre-rendered.
            // For now, let's assume it's HTML.
            let finalHtml = '';
            if (client.settings.ai_llm_debug && response && response.debug_prompts) {
              const debug = response.debug_prompts;
              finalHtml += `
                <div style="background-color: #f0f0f0; border: 1px solid #ccc; padding: 10px; margin-bottom: 15px;">
                  <h4 style="margin-top:0;">${client.translate('AI Debug Info:')}</h4>
                  <p><strong>${client.translate('Model:')}</strong> <pre style="white-space: pre-wrap; word-break: break-all;">${client.escape(debug.model || 'N/A')}</pre></p>
                  <p><strong>${client.translate('System Prompt:')}</strong> <pre style="white-space: pre-wrap; word-break: break-all;">${client.escape(debug.system || 'N/A')}</pre></p>
                  <p><strong>${client.translate('User Prompt Template:')}</strong> <pre style="white-space: pre-wrap; word-break: break-all;">${client.escape(debug.user_template || 'N/A')}</pre></p>
                  <p><strong>${client.translate('Final User Prompt (with data):')}</strong> <pre style="white-space: pre-wrap; word-break: break-all;">${client.escape(debug.user_final || 'N/A')}</pre></p>
                </div>
              `;
            }

            if (response && response.html_content) {
              finalHtml += response.html_content;
            } else if (typeof response === 'string' && (!response.debug_prompts)) { // if it's just a string and not our debug object
              finalHtml += response; // Fallback if response is just a string
            } else if (!response || !response.html_content) {
               finalHtml += `<p>${client.translate('Received an empty or unexpected LLM response from the server.')}</p>`;
            }
            $('#ai-eval-results').html(finalHtml);
          },
          error: function(jqXHR, textStatus, errorThrown) {
            console.error('AI Eval Error:', textStatus, errorThrown, jqXHR.responseText);
            var errorMsg = client.translate('Error fetching AI evaluation: ') + textStatus;
            if (jqXHR.responseJSON && jqXHR.responseJSON.error) {
              errorMsg += ' - ' + client.translate(jqXHR.responseJSON.error);
            } else if (jqXHR.responseText) {
              try {
                var parsedError = JSON.parse(jqXHR.responseText);
                if(parsedError && parsedError.error) {
                  errorMsg += ' - ' + client.translate(parsedError.error);
                } else {
                   errorMsg += ' - ' + client.translate('Check server logs for details.');
                }
              } catch(e) {
                 errorMsg += ' - ' + client.translate('Unparseable error from server. Check server logs.');
              }
            }
            $('#ai-eval-results').html(`<p style="color: red;">${errorMsg}</p>`);
          }
        });
      });
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
