'use strict';

// Minimal stub for AI Evaluation plugin - v5 (testing embedded script in HTML)

function init(ctx) {
  // var $ = ctx.$; // jQuery might be used by client if available globally,
  // but embedded script will use vanilla JS first for diagnostics.

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation (Minimal Test v5)', // Updated label

    html: function(client) {
      // client object is passed here, might contain client.settings or client.translate
      // For this test, we are primarily focused on script execution.
      // We can access client.translate if needed for messages inside the script block.
      // jQuery ($) from ctx might need to be passed into this scope if used by embedded script.
      // For now, embedded script uses vanilla JS.

      console.log('AI Eval (Minimal v5) HTML function called.');

      // Note: Using backticks for the template literal.
      // Ensure no actual newlines within the <script> tag's content if it causes issues,
      // though modern JS engines in browsers handle multiline strings in script tags well.
      // For safety, complex scripts are often IIFEs or call functions defined elsewhere.
      // Here, it's simple direct code.
      return `
        <div id="ai-eval-v5-container" style="padding: 20px; border: 2px dashed darkorange;">
          <h1>AI Eval HTML Loaded (Minimal v5)</h1>
          <p>This is static content from the HTML function.</p>
          <p id="ai-eval-v5-text" style="font-weight: bold;">Initial text.</p>
          <p>If the embedded script runs, an alert should appear, and the text above should change and turn green.</p>
        </div>

        <script type="text/javascript">
          (function() { // IIFE to scope variables
            try {
              // Very first thing: alert and log to confirm execution
              alert('AI Eval (Minimal v5) EMBEDDED script executed!');
              console.log('AI Eval (Minimal v5) EMBEDDED script executed.');

              var el = document.getElementById('ai-eval-v5-text');
              if (el) {
                el.textContent = 'Embedded script CHANGED this text!';
                el.style.color = 'green';
                console.log('AI Eval (Minimal v5) Embedded script successfully changed text.');
              } else {
                console.error('AI Eval (Minimal v5) Embedded script: #ai-eval-v5-text element not found.');
                // If this happens, it's a strong sign the script might be running before the DOM from this HTML is fully parsed/ready,
                // or there's a typo in the ID.
                 var body = document.getElementsByTagName('body')[0];
                 if (body) {
                    var p = document.createElement('p');
                    p.textContent = 'AI Eval (Minimal v5) Embedded script: #ai-eval-v5-text element not found.';
                    p.style.color = 'red'; p.style.backgroundColor = 'yellow'; p.style.padding = '10px';
                    body.insertBefore(p, body.firstChild);
                 }
              }
            } catch (e) {
              console.error('AI Eval (Minimal v5) Embedded script CRITICAL error:', e);
              alert('AI Eval (Minimal v5) EMBEDDED script CRITICAL error: ' + e.message);
               var body = document.getElementsByTagName('body')[0];
               if (body) {
                  var p = document.createElement('p');
                  p.textContent = 'AI Eval (Minimal v5) Embedded script CRITICAL error: ' + e.message;
                  p.style.color = 'red'; p.style.backgroundColor = 'yellow'; p.style.padding = '10px';
                  body.insertBefore(p, body.firstChild);
               }
            }
          })();
        </script>
      `;
    },

    css: `
      #ai-eval-v5-container h1 { color: darkorange; }
    `, // Minimal CSS

    report: function(datastorage, sorteddaystoshow, options) {
      // This function remains minimal.
      console.log('AI Eval (Minimal v5) REPORT function called. Data received:', !!datastorage, 'Options Report Name:', options ? options.reportName : 'N/A');
    }

    // No separate 'script' or 'onLoad' methods in the plugin object for this test.
  };

  return aiEvalPlugin;
}

module.exports = init;