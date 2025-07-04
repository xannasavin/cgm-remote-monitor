'use strict';

// Global storedData, as report function is outside the script method's direct execution flow,
// but the button click handler inside script might later want to access it.
var storedData = {
  datastorage: null,
  sorteddaystoshow: null,
  options: null
};

// augmentClient can be defined in the init scope if needed by multiple plugin methods
// For this MVP, script will try to use client object as passed by Nightscout.
// We assume client passed to html and script by Nightscout has .$ and .settings
function init(ctx) {
  // var $ = ctx.$; // $ from context, if needed by functions outside of client methods that don't receive client.$

  // Helper to ensure the client object passed to plugin methods has necessary utilities
  // This might be redundant if Nightscout's client object is already well-formed.
  // For this MVP, we'll mostly rely on the client object passed directly to script/html methods.
  const augmentClient = (originalClient) => {
    if (originalClient && !originalClient.$ && ctx.$) { // Check originalClient exists
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
    label: 'AI Evaluation (MVP1)',

    html: function(originalClient) {
      // const client = augmentClient(originalClient); // Not strictly needed if client is used directly
      // For MVP, keep HTML simple.
      console.log('AI Eval (MVP1) HTML function called.');
      return `
        <div id="ai-eval-mvp1-container" style="padding: 15px;">
          <h3>AI Evaluation (MVP1)</h3>
          <div id="ai-eval-mvp1-status" style="min-height: 30px; border: 1px solid #ddd; padding: 8px; margin-bottom:10px; background-color: #f9f9f9;">
            Status will appear here.
          </div>
          <button id="ai-eval-mvp1-button" type="button" class="btn btn-primary">Evaluate Report Period (MVP1)</button>
          <div id="ai-eval-mvp1-results" style="margin-top: 15px; border: 1px solid #eee; padding: 8px; min-height: 50px;">
            Results will appear here.
          </div>
        </div>
      `;
    },

    css: `
      #ai-eval-mvp1-container {} /* Basic styling if needed */
    `,

    report: function(originalClient, ds, sds, opts) {
      // const client = augmentClient(originalClient); // Not using client here for now
      console.log('AI Eval (MVP1) REPORT function called. Storing data.');
      storedData.datastorage = ds;
      storedData.sorteddaystoshow = sds;
      storedData.options = opts;
      // CRITICAL: This function must remain lightweight to avoid the main rendering bug.
      // No DOM manipulation or complex async operations here for now.
    },

    script: function(originalClient) {
      // Assuming 'originalClient' passed by Nightscout to 'script' has .$, .settings, .translate
      // If not, augmentClient would be needed here or a different way to access ctx.$.
      const client = augmentClient(originalClient); // Ensure $ and escape are on client

      console.log('AI Eval (MVP1) SCRIPT method started.');

      // Check if client and essential properties are available
      if (typeof client === 'undefined' || client === null) {
        console.error('AI Eval (MVP1) SCRIPT: client object is undefined or null!');
        return; // Cannot proceed
      }
      var $ = client.$;
      if (typeof $ === 'undefined' || $ === null) {
        console.error('AI Eval (MVP1) SCRIPT: client.$ (jQuery) is undefined or null!');
        // Try to write error to a known div using vanilla JS if $ is gone
        var statusDivVanilla = document.getElementById('ai-eval-mvp1-status');
        if (statusDivVanilla) {
          statusDivVanilla.innerHTML = '<p style="color:red;font-weight:bold;">MVP1 SCRIPT Error: jQuery (client.$) not found!</p>';
        }
        return; // Cannot proceed
      }

      var $statusDiv = $('#ai-eval-mvp1-status');
      var $resultsDiv = $('#ai-eval-mvp1-results');
      var $button = $('#ai-eval-mvp1-button');

      if (!$statusDiv.length || !$resultsDiv.length || !$button.length) {
        console.error('AI Eval (MVP1) SCRIPT: One or more MVP UI elements not found.');
        return;
      }

      $statusDiv.html(client.translate ? client.translate('MVP1 Script Loaded. Waiting for button click.') : 'MVP1 Script Loaded. Waiting for button click.');

      // Basic check for AI_LLM_API_URL
      var isApiUrlSet = false;
      if (client.settings && client.settings.ai_llm_api_url && client.settings.ai_llm_api_url.trim() !== '') {
        isApiUrlSet = true;
        $statusDiv.append('<br><span style="color:green;">' + (client.translate ? client.translate('API URL is set.') : 'API URL is set.') + '</span>');
      } else {
        $statusDiv.append('<br><span style="color:red;font-weight:bold;">' + (client.translate ? client.translate('ERROR: AI_LLM_API_URL setting is missing.') : 'ERROR: AI_LLM_API_URL setting is missing.') + '</span>');
      }

      $button.on('click', function() {
        console.log('AI Eval (MVP1) Button Clicked.');
        $resultsDiv.html(''); // Clear previous results

        if (isApiUrlSet) {
          console.log('AI Eval (MVP1): API URL is set. Would attempt AI call...');
          // For MVP, we'll just confirm we have access to storedData.
          // Actual data prep and call will be in next steps.
          let message = client.translate ? client.translate('Attempting AI Call (API URL Set)...') : 'Attempting AI Call (API URL Set)...';
          if (storedData && storedData.options && storedData.options.reportName) {
            message += '<br>' + (client.translate ? client.translate('Data available from report:') : 'Data available from report:') + ' ' + client.escape(storedData.options.reportName);
            message += ' (' + storedData.sorteddaystoshow.length + ' ' + (client.translate ? client.translate('days') : 'days') + ')';
          } else {
            message += '<br>' + (client.translate ? client.translate('No specific report data found in storedData, or report details missing.') : 'No specific report data found.');
          }
          $resultsDiv.html(message);
          // TODO in next step:
          // 1. Implement full settings check here (or call a shared function)
          // 2. Prepare cgmDataPayload from storedData
          // 3. Make AJAX call to /api/v1/ai_eval
        } else {
          console.log('AI Eval (MVP1): API URL is MISSING. Cannot call AI.');
          $resultsDiv.html('<p style="color:red;font-weight:bold;">' + (client.translate ? client.translate('ERROR: AI_LLM_API_URL is not set. Cannot proceed with evaluation.') : 'ERROR: AI_LLM_API_URL is not set.') + '</p>');
        }
      });
      console.log('AI Eval (MVP1) SCRIPT method finished setup.');
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
