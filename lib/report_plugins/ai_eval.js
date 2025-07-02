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
      $('#ai-eval-show-button').on('click', function() {
        $('#ai-eval-results').html(client.translate('Loading AI evaluation...'));

        if (!storedData.datastorage || !storedData.sorteddaystoshow || !storedData.options) {
          $('#ai-eval-results').html(`<p style="color: red;">${client.translate('Report data not loaded yet. Please click the main "Show" button for the reports first.')}</p>`);
          return;
        }

        var llmApiUrl = client.settings.ai_llm_api_url;
        var llmPrompt = client.settings.ai_llm_prompt;

        if (!llmApiUrl || !llmPrompt) {
          $('#ai-eval-results').html(`<p style="color: red;">${client.translate('LLM API URL or Prompt is not configured in settings.')}</p>`);
          return;
        }

        // Prepare data to send to the LLM
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
            if (response && response.html_content) {
              $('#ai-eval-results').html(response.html_content);
            } else if (typeof response === 'string') {
              $('#ai-eval-results').html(response); // Fallback if response is just a string
            }
             else {
              $('#ai-eval-results').html(`<p>${client.translate('Received an empty or unexpected response from the server.')}</p>`);
            }
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
