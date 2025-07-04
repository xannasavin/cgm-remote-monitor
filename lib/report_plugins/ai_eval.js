'use strict';

// Minimal stub for AI Evaluation plugin for diagnostic purposes - v2 (fixing script exec)
// Purpose: To confirm basic script execution, jQuery availability, and DOM manipulation.

function init(ctx) {
  var $ = ctx.$; // Make jQuery available via $ within this init scope and its closures
  // This is crucial for the script function to use jQuery correctly.

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation (Minimal Test v2)', // Label for the tab

    html: function(client) {
      // This function is called by Nightscout to get the HTML content for the tab.
      console.log('AI Eval (Minimal v2) HTML function called.');
      return `
        <div id="ai-eval-minimal-test-area" style="padding: 20px; border: 2px dashed darkred;">
          <h1>AI Eval HTML Loaded (Minimal v2)</h1>
          <p>This is static content from the HTML function. If you see this, the HTML part is working.</p>
          <!-- The script will attempt to append text below this line -->
        </div>
      `;
    },

    css: `
      /* Minimal CSS for the test area */
      #ai-eval-minimal-test-area h1 {
        color: darkred;
        font-size: 1.5em;
      }
      #ai-eval-minimal-test-area p {
        font-style: italic;
        margin-bottom: 10px;
      }
    `,

    report: function(datastorage, sorteddaystoshow, options) {
      // This function is called by reportclient.js when main report data is loaded
      // for ANY active report tab, or for this plugin if it's active.
      // For this minimal test, it only logs to the console.
      console.log('AI Eval (Minimal v2) REPORT function called. Data received:', !!datastorage, 'Options Report Name:', options ? options.reportName : 'N/A');
    },

    script: function(client) {
      // This script is executed when the AI Evaluation tab is loaded/activated by Nightscout.
      console.log('AI Eval (Minimal v2) SCRIPT function started.'); // VERY FIRST LINE IN SCRIPT

      try {
        // Check if jQuery ($) is available in this scope (it should be due to closure over init's scope)
        if (typeof $ !== 'undefined') {
          console.log('AI Eval (Minimal v2) Script: jQuery ($) is defined.');

          // Attempt to select the target div
          var $testArea = $('#ai-eval-minimal-test-area');

          if ($testArea.length) {
            console.log('AI Eval (Minimal v2) Script: Successfully selected #ai-eval-minimal-test-area div.');
            $testArea.append('<p style="color: green; font-weight: bold;">AI Eval Minimal v2 Script Appended Text Successfully.</p>');
            console.log('AI Eval (Minimal v2) Script: Successfully appended text to div.');
          } else {
            var divNotFoundErrorMsg = 'AI Eval (Minimal v2) Script Error: #ai-eval-minimal-test-area div NOT FOUND in the DOM.';
            console.error(divNotFoundErrorMsg);
            // If the specific div isn't found, this is a critical issue for the plugin.
            // Try to make this visible on the page if possible.
            $('body').prepend(`<p style="color: red; background-color: yellow; padding: 10px; font-weight: bold; z-index: 9999;">${divNotFoundErrorMsg}</p>`);
          }
        } else {
          var jQueryNotDefinedErrorMsg = 'AI Eval (Minimal v2) Script Error: jQuery ($) is UNDEFINED within script function.';
          console.error(jQueryNotDefinedErrorMsg);
          // Cannot use jQuery to alert this to body if $ is not defined.
          // An alert might be too disruptive, console log is the primary feedback here.
          // alert(jQueryNotDefinedErrorMsg);
        }
      } catch (e) {
        var catchErrorMsg = 'AI Eval (Minimal v2) Script CRITICAL error during execution: ' + e.message;
        console.error(catchErrorMsg, e);
        // Attempt to display this critical error on the page if possible
        if (typeof $ !== 'undefined' && $('body').length) {
          $('body').prepend(`<p style="color: red; background-color: #ffdddd; padding: 10px; font-weight: bold; z-index: 9999;">${catchErrorMsg}</p>`);
        } else {
          // alert(catchErrorMsg); // Last resort if jQuery is unavailable for body prepend
        }
      }
      console.log('AI Eval (Minimal v2) SCRIPT function finished.');
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
