'use strict';

// Global storedData
var storedData = {
  datastorage: null,
  sorteddaystoshow: null,
  options: null
};

// augmentClient helper
function init(ctx) {
  // var $ = ctx.$; // Not directly used in init for this version

  const augmentClient = (originalClient) => {
    if (originalClient && !originalClient.$ && ctx.$) {
      originalClient.$ = ctx.$;
    }
    if (originalClient && !originalClient.escape) {
      originalClient.escape = function (unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      };
    }
    return originalClient;
  };

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation (MVP1.1)', // Updated label for v1.1 (testing onLoad)

    html: function(originalClient) {
      // const client = augmentClient(originalClient); // Augmentation will happen in onLoad
      console.log('AI Eval (MVP1.1) HTML function called.');
      return `
        <div id="ai-eval-mvp1-container" style="padding: 15px;">
          <h3>AI Evaluation (MVP1.1 - Testing onLoad)</h3>
          <div id="ai-eval-mvp1-status" style="min-height: 30px; border: 1px solid #ddd; padding: 8px; margin-bottom:10px; background-color: #f9f9f9;">
            Status will appear here if onLoad executes.
          </div>
          <button id="ai-eval-mvp1-button" type="button" class="btn btn-primary">Evaluate Report Period (MVP1.1)</button>
          <div id="ai-eval-mvp1-results" style="margin-top: 15px; border: 1px solid #eee; padding: 8px; min-height: 50px;">
            Results will appear here.
          </div>
        </div>
      `;
    },

    css: `
      #ai-eval-mvp1-container {} 
    `,

    report: function(originalClient, ds, sds, opts) {
      // const client = augmentClient(originalClient); // Not using client here
      console.log('AI Eval (MVP1.1) REPORT function called. Storing data.');
      storedData.datastorage = ds;
      storedData.sorteddaystoshow = sds;
      storedData.options = opts;
    },

    // Renamed 'script' to 'onLoad'
    onLoad: function(originalClient) {
      const client = augmentClient(originalClient); // Augment client at the start of onLoad

      console.log('AI Eval (MVP1.1) onLoad method started.'); // Updated log message

      if (typeof client === 'undefined' || client === null) {
        console.error('AI Eval (MVP1.1) onLoad: client object is undefined or null!');
        return;
      }
      var $ = client.$;
      if (typeof $ === 'undefined' || $ === null) {
        console.error('AI Eval (MVP1.1) onLoad: client.$ (jQuery) is undefined or null!');
        var statusDivVanilla = document.getElementById('ai-eval-mvp1-status');
        if (statusDivVanilla) {
          statusDivVanilla.innerHTML = '<p style="color:red;font-weight:bold;">MVP1.1 onLoad Error: jQuery (client.$) not found!</p>';
        }
        return;
      }

      var $statusDiv = $('#ai-eval-mvp1-status');
      var $resultsDiv = $('#ai-eval-mvp1-results');
      var $button = $('#ai-eval-mvp1-button');

      if (!$statusDiv.length || !$resultsDiv.length || !$button.length) {
        console.error('AI Eval (MVP1.1) onLoad: One or more MVP UI elements not found.');
        return;
      }

      $statusDiv.html((client.translate ? client.translate('MVP1.1 onLoad Executed. Waiting for button click.') : 'MVP1.1 onLoad Executed. Waiting for button click.'));

      var isApiUrlSet = false;
      if (client.settings && client.settings.ai_llm_api_url && client.settings.ai_llm_api_url.trim() !== '') {
        isApiUrlSet = true;
        $statusDiv.append('<br><span style="color:green;">' + (client.translate ? client.translate('API URL is set.') : 'API URL is set.') + '</span>');
      } else {
        $statusDiv.append('<br><span style="color:red;font-weight:bold;">' + (client.translate ? client.translate('ERROR: AI_LLM_API_URL setting is missing.') : 'ERROR: AI_LLM_API_URL setting is missing.') + '</span>');
      }

      $button.on('click', function() {
        console.log('AI Eval (MVP1.1) Button Clicked.');
        $resultsDiv.html('');

        if (isApiUrlSet) {
          console.log('AI Eval (MVP1.1): API URL is set. Would attempt AI call...');
          let message = client.translate ? client.translate('Attempting AI Call (API URL Set)...') : 'Attempting AI Call (API URL Set)...';
          if (storedData && storedData.options && storedData.options.reportName) {
            message += '<br>' + (client.translate ? client.translate('Data available from report:') : 'Data available from report:') + ' ' + client.escape(storedData.options.reportName);
            message += ' (' + storedData.sorteddaystoshow.length + ' ' + (client.translate ? client.translate('days') : 'days') + ')';
          } else {
            message += '<br>' + (client.translate ? client.translate('No specific report data found in storedData, or report details missing.') : 'No specific report data found.');
          }
          $resultsDiv.html(message);
        } else {
          console.log('AI Eval (MVP1.1): API URL is MISSING. Cannot call AI.');
          $resultsDiv.html('<p style="color:red;font-weight:bold;">' + (client.translate ? client.translate('ERROR: AI_LLM_API_URL is not set. Cannot proceed with evaluation.') : 'ERROR: AI_LLM_API_URL is not set.') + '</p>');
        }
      });
      console.log('AI Eval (MVP1.1) onLoad method finished setup.');
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
