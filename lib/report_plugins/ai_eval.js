'use strict';

// Minimal stub for AI Evaluation plugin for diagnostic purposes.

function init(ctx) {
  var $ = ctx.$; // jQuery

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation (Minimal Test)',

    html: function(client) {
      // Returns a very simple static HTML structure.
      console.log('AI Eval (Minimal) HTML function called.');
      return `
        <div id="ai-eval-minimal-test-area" style="padding: 20px; border: 2px dashed blue;">
          <h1>AI Eval HTML Loaded</h1>
          <p>This is static content from the HTML function.</p>
        </div>
      `;
    },

    css: `
      #ai-eval-minimal-test-area h1 { color: blue; }
      #ai-eval-minimal-test-area p { font-style: italic; }
    `, // Minimal CSS

    report: function(datastorage, sorteddaystoshow, options) {
      // This function is called by reportclient.js when main report data is loaded
      // for ANY active report tab, or for this plugin if it's active.
      console.log('AI Eval (Minimal) REPORT function called. Data received:', !!datastorage, 'Options:', options ? options.reportName : 'N/A');
      // Minimal stub: does not interact with the DOM here to avoid interference.
    },

    script: function(client) {
      // This script is executed when the AI Evaluation tab is loaded/activated.
      console.log('AI Eval (Minimal) SCRIPT function executed.');
      try {
        // Check if jQuery and the target div are available.
        if (typeof $ !== 'undefined' && $('#ai-eval-minimal-test-area').length) {
          $('#ai-eval-minimal-test-area').append('<p style="color: green; font-weight: bold;">AI Eval Minimal Script Appended Text Successfully.</p>');
          console.log('AI Eval (Minimal) Script successfully selected div and appended text.');
        } else {
          var errorMsg = 'AI Eval (Minimal) Script: jQuery not available or #ai-eval-minimal-test-area div not found.';
          console.error(errorMsg);
          // As a fallback, if the specific div isn't there, try to alert the body or use global alert.
          if (typeof $ !== 'undefined' && $('body').length) {
            $('body').prepend(`<p style="color: red; background-color: yellow; padding: 10px; font-weight: bold;">${errorMsg}</p>`);
          } else {
            // alert(errorMsg);
          }
        }
      } catch (e) {
        var catchErrorMsg = 'AI Eval (Minimal) Script critical error: ' + e.message;
        console.error(catchErrorMsg, e);
        if (typeof $ !== 'undefined' && $('body').length) {
          $('body').prepend(`<p style="color: red; background-color: yellow; padding: 10px; font-weight: bold;">${catchErrorMsg}</p>`);
        } else {
          // alert(catchErrorMsg);
        }
      }
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
