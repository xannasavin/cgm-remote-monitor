'use strict';

// Minimal stub for AI Evaluation plugin - v3 (testing script method with alert)

function init(ctx) {
  var $ = ctx.$;

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation (Minimal Test v3)', // Updated label

    html: function(client) {
      console.log('AI Eval (Minimal v3) HTML function called.');
      return `
        <div id="ai-eval-minimal-test-area-v3" style="padding: 20px; border: 2px dashed purple;">
          <h1>AI Eval HTML Loaded (Minimal v3)</h1>
          <p>This is static content. If the 'script' method is called, an alert should appear.</p>
        </div>
      `;
    },

    css: `
      #ai-eval-minimal-test-area-v3 h1 { color: purple; }
    `,

    report: function(datastorage, sorteddaystoshow, options) {
      console.log('AI Eval (Minimal v3) REPORT function called. Data received:', !!datastorage, 'Options Report Name:', options ? options.reportName : 'N/A');
    },

    script: function(client) {
      // Test if this function is called at all using a very direct method.
      alert('AI Eval (Minimal v3) SCRIPT method CALLED!');
      console.log('AI Eval (Minimal v3) SCRIPT method CALLED and alert should have fired.');

      // For this test, no other script logic is included to keep it minimal.
      // The goal is solely to see if this 'script' method is invoked by Nightscout.
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
