'use strict';

// Global storedData
var storedData = {
  datastorage: null,
  sorteddaystoshow: null,
  options: null
};

function init(ctx) {
  var $ = ctx.$; // jQuery instance from context

  const augmentClient = (originalClient) => {
    // Ensure client object is not null or undefined before augmenting
    if (!originalClient) {
      console.error("AI Eval: augmentClient received undefined or null originalClient");
      originalClient = {}; // Initialize to prevent further errors, though this is a problem state
    }
    if (!originalClient.$ && $) { // Check if $ from ctx is valid
      originalClient.$ = $;
    }
    if (!originalClient.escape) {
      originalClient.escape = function (unsafe) {
        if (typeof unsafe !== 'string') return String(unsafe); // Ensure it's a string before replace
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      };
    }
    if (typeof originalClient.settings === 'undefined') {
      originalClient.settings = {}; // Ensure settings object exists
      console.warn("AI Eval: originalClient.settings was undefined, initialized to empty object.");
    }
    originalClient.aiEvalConfigIsValid = false;
    originalClient.triggerAIEvaluation = null;
    return originalClient;
  };

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation (MVP2 - API URL Status)',

    html: function(originalClient) {
      // 'client' in this scope is the one passed by Nightscout.
      // It will be augmented and then available to the IIFE via closure.
      const client = augmentClient(originalClient);

      // console.log('AI Eval (MVP2) HTML function called.'); // Keep this for initial load confirmation

      // Construct the script content separately for clarity and to ensure 'client' is from closure.
      // Note: Backticks for the outer template literal for the HTML string.
      // Inside the <script> tag, we avoid template literals for the JS code itself for max compatibility.
      const embeddedScript = `
        (function() { // IIFE relies on 'client' from html() function's outer scope (closure)
          console.log('AI Eval (MVP2) Embedded SCRIPT started.');
          var statusDiv = document.getElementById('ai-eval-mvp2-status'); 

          if (!statusDiv) { 
            console.error('AI Eval (MVP2) - Status DIV #ai-eval-mvp2-status not found!'); 
            return; 
          }

          // Test 1: Is 'client' object itself in scope via closure?
          if (typeof client !== 'undefined' && client !== null) {
            console.log('AI Eval (MVP2) - "client" object IS IN SCOPE via closure.');

            // Test 2: Does client.settings exist?
            // client.settings should have been ensured by augmentClient if it was initially missing
            if (typeof client.settings !== 'undefined') {
              console.log('AI Eval (MVP2) - "client.settings" IS IN SCOPE.');
              
              // Test 3: Does client.$ (jQuery) exist and work?
              var $ = client.$; // Get jQuery from the client object via closure.
              var useJQuery = (typeof $ === 'function' && typeof $.ajax === 'function');

              if (useJQuery) {
                console.log('AI Eval (MVP2) - "client.$" (jQuery) IS IN SCOPE and functional.');
                statusDiv = $(statusDiv); // Convert to jQuery object for future DOM manipulation if $ works
              } else {
                console.warn('AI Eval (MVP2) - "client.$" (jQuery) is NOT functional. Will use vanilla JS for status update.');
              }

              var apiUrl = client.settings.ai_llm_api_url;
              // Use client.translate and client.escape with fallbacks if they don't exist on client
              var translateFunc = client.translate || function(s) { return s; };
              var escapeFunc = client.escape || function(s) { 
                if (typeof s !== 'string') return String(s);
                return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
              };

              var msg = '';
              if (apiUrl && apiUrl.trim() !== '') {
                msg = '<p style="color:green;">' + escapeFunc(translateFunc('AI_LLM_API_URL is set.')) + '</p>';
                console.log('AI Eval (MVP2) - AI_LLM_API_URL is SET.');
              } else {
                msg = '<p style="color:red; font-weight:bold;">' + escapeFunc(translateFunc('ERROR: AI_LLM_API_URL setting is missing.')) + '</p>';
                console.log('AI Eval (MVP2) - AI_LLM_API_URL is MISSING.');
              }

              if (useJQuery) { statusDiv.html(msg); } else { statusDiv.innerHTML = msg; }

            } else { // client.settings is undefined
              console.error('AI Eval (MVP2) - CRITICAL: "client.settings" UNDEFINED within IIFE (augmentClient might have issues or originalClient lacked settings).');
              statusDiv.innerHTML = '<p style="color:red; font-weight:bold;">MVP2 SCRIPT ERROR: \\'client.settings\\' undefined.</p>';
            }
          } else { // client is undefined
            console.error('AI Eval (MVP2) - CRITICAL: "client" object UNDEFINED in IIFE via closure.');
            statusDiv.innerHTML = '<p style="color:red; font-weight:bold;">MVP2 SCRIPT ERROR: \\'client\\' object undefined.</p>';
          }
          console.log('AI Eval (MVP2) Embedded SCRIPT finished.');
        })();
      `;

      return `
        <div id="ai-eval-mvp2-container" style="padding: 15px;">
          <h3>AI Evaluation (MVP2 - API URL Status)</h3>
          <div id="ai-eval-mvp2-status" style="padding:10px; border:1px solid #ccc; font-weight:bold; min-height: 20px;">
            Checking settings...
          </div>
          <!-- No button or results area for this minimal MVP step -->
        </div>
        <script type="text/javascript">
          ${embeddedScript}
        </script>
      `;
    },

    css: `
      #ai-eval-mvp2-container {} /* Basic styling if needed */
    `,

    report: function(originalClient, ds, sds, opts) {
      // const client = augmentClient(originalClient); // Not strictly needed if report doesn't use client props
      console.log('AI Eval (MVP2) REPORT function called.');
      storedData.datastorage = ds;
      storedData.sorteddaystoshow = sds;
      storedData.options = opts;
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
