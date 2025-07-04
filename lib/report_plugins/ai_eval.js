'use strict';

// Global storedData for report data
var storedData = {
  datastorage: null,
  sorteddaystoshow: null,
  options: null
};

// This function will contain the core client-side logic for the AI Eval tab.
// It will be attached to the window object to be callable from a simple embedded script.
function initializeAiEvalTabLogic_MVP21(clientArg) {
  console.log('AI Eval (MVP2.1) initializeAiEvalTabLogic_MVP21 started. Received clientArg:', !!clientArg);
  var statusDiv = document.getElementById('ai-eval-mvp21-status'); // Vanilla JS for initial targeting

  if (!statusDiv) {
    console.error('AI Eval (MVP2.1) initializeAiEvalTabLogic_MVP21: Critical - Status DIV #ai-eval-mvp21-status not found!');
    return;
  }

  if (!clientArg || typeof clientArg.settings === 'undefined' || typeof clientArg.$ !== 'function' || typeof clientArg.translate !== 'function' || typeof clientArg.escape !== 'function') {
    console.error('AI Eval (MVP2.1) initializeAiEvalTabLogic_MVP21: Critical - clientArg is invalid or missing essential properties (settings, $, translate, escape).', clientArg);
    statusDiv.innerHTML = '<p style="color:red; font-weight:bold;">MVP2.1 FATAL: clientArg invalid.</p>';
    return;
  }

  var $ = clientArg.$; // Use jQuery from the passed clientArg
  var $statusDiv = $(statusDiv); // Now use jQuery for convenience

  console.log('AI Eval (MVP2.1) initializeAiEvalTabLogic_MVP21: jQuery obtained from clientArg.$ and statusDiv selected.');

  // Basic settings check for AI_LLM_API_URL
  var apiUrl = clientArg.settings.ai_llm_api_url;
  var msg = '';

  if (apiUrl && apiUrl.trim() !== '') {
    msg = '<p style="color:green;">' + clientArg.escape(clientArg.translate('AI_LLM_API_URL is set.')) + '</p>';
    console.log('AI Eval (MVP2.1) initializeAiEvalTabLogic_MVP21 - AI_LLM_API_URL is SET.');
    clientArg.aiEvalConfigIsValid = true; // Set validity on the passed client object
  } else {
    msg = '<p style="color:red; font-weight:bold;">' + clientArg.escape(clientArg.translate('ERROR: AI_LLM_API_URL setting is missing.')) + '</p>';
    console.log('AI Eval (MVP2.1) initializeAiEvalTabLogic_MVP21 - AI_LLM_API_URL is MISSING.');
    clientArg.aiEvalConfigIsValid = false; // Set validity on the passed client object
  }
  $statusDiv.html(msg);

  // Placeholder for more complex settings checks and triggerAIEvaluation definition (to be added in later steps)
  // e.g., clientArg.triggerAIEvaluation = function(payload) { ... };

  console.log('AI Eval (MVP2.1) initializeAiEvalTabLogic_MVP21 finished basic setup. Config valid:', clientArg.aiEvalConfigIsValid);
}


function init(ctx) {
  var $ = ctx.$; // jQuery instance from context for augmentClient

  const augmentClient = (originalClient) => {
    if (!originalClient) {
      console.error("AI Eval: augmentClient received undefined originalClient, creating new obj.");
      originalClient = {};
    }
    if (!originalClient.$ && $) {
      originalClient.$ = $;
    }
    if (!originalClient.escape) {
      originalClient.escape = function (unsafe) {
        if (typeof unsafe !== 'string') return String(unsafe);
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      };
    }
    if (typeof originalClient.settings === 'undefined') {
      originalClient.settings = {};
      console.warn("AI Eval: originalClient.settings was undefined, initialized by augmentClient.");
    }
    // Ensure translate exists, even if it's a passthrough
    if (typeof originalClient.translate !== 'function') {
      console.warn("AI Eval: originalClient.translate was not a function, creating passthrough.");
      originalClient.translate = function(s) { return s; };
    }
    originalClient.aiEvalConfigIsValid = false;
    originalClient.triggerAIEvaluation = null;
    return originalClient;
  };

  // Make the main logic function globally accessible for the embedded script to call
  if (typeof window !== 'undefined') {
    window.initializeAiEvalTabLogic_MVP21 = initializeAiEvalTabLogic_MVP21;
  } else {
    // This context (Node.js during plugin load) won't have 'window'.
    // The assignment is for the browser environment when the script runs.
    console.warn('AI Eval init: "window" object not found. initializeAiEvalTabLogic_MVP21 not attached to window here, but expected in browser.');
  }

  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation (MVP2.1 - Global Bridge)',

    html: function(originalClient) {
      const client = augmentClient(originalClient);

      // Assign the prepared client object to a temporary global property
      // This happens when Nightscout calls this html() function to get the tab's content.
      if (typeof window !== 'undefined') {
        window.tempAIClientObjectForMVP21 = client;
      } else {
        // This case should ideally not happen in the browser context where HTML is rendered.
        console.error("AI Eval MVP2.1 html(): 'window' is undefined. Cannot set temp client for embedded script.");
        // Return a fallback HTML indicating an error.
        return '<div id="ai-eval-mvp21-status" style="color:red; padding:10px;">Critical error: Cannot prepare client object for script.</div>';
      }

      return `
        <div id="ai-eval-mvp21-container" style="padding: 15px;">
          <h3>AI Evaluation (MVP2.1 - Global Bridge)</h3>
          <div id="ai-eval-mvp21-status" style="padding:10px; border:1px solid #ccc; font-weight:bold; min-height:20px;">
            Initializing MVP2.1...
          </div>
          <!-- Button and results area will be added in subsequent steps -->
        </div>
        <script type="text/javascript">
          // This simple bridge script calls the globally exposed function
          console.log('AI Eval (MVP2.1) Embedded bridge script executing.');
          if (typeof window.initializeAiEvalTabLogic_MVP21 === 'function' && typeof window.tempAIClientObjectForMVP21 !== 'undefined') {
            console.log('AI Eval (MVP2.1) Calling global initializeAiEvalTabLogic_MVP21.');
            window.initializeAiEvalTabLogic_MVP21(window.tempAIClientObjectForMVP21);
          } else {
            var errMsg = 'AI Eval (MVP2.1) Error: Global init function or temp client object not found on window.';
            console.error(errMsg);
            var sDiv = document.getElementById('ai-eval-mvp21-status');
            if(sDiv) sDiv.innerHTML = '<p style="color:red;">' + errMsg.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</p>'; // Basic escape
          }
          // Clean up the temporary global client object
          try {
            if (typeof window !== 'undefined') {
              delete window.tempAIClientObjectForMVP21;
              console.log('AI Eval (MVP2.1) Cleaned up tempAIClientObjectForMVP21 from window.');
            }
          } catch(e) {
            console.warn('AI Eval (MVP2.1) Could not delete tempAIClientObjectForMVP21 from window.');
          }
        </script>
      `;
    },

    css: `
      #ai-eval-mvp21-container {} 
    `,

    report: function(originalClient, ds, sds, opts) {
      // const client = augmentClient(originalClient); // Augment client if its properties are used here.
      console.log('AI Eval (MVP2.1) REPORT function called.');
      storedData.datastorage = ds;
      storedData.sorteddaystoshow = sds;
      storedData.options = opts;
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
