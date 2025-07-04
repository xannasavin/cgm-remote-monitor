'use strict';

// AI Evaluation plugin - Establishing reliable client access

function init(ctx) {
  // This function will be called by the embedded script
  function initializeAiEvalTab(passedInClient) {
    console.log('AI Eval: initializeAiEvalTab called. Received client:', passedInClient);

    const settings = passedInClient && passedInClient.settings ? passedInClient.settings : {};
    const apiUrl = settings.ai_llm_api_url;
    const model = settings.ai_llm_model;
    // Assuming server sends 'ai_llm_key_set' as a boolean if the key is configured.
    const apiKeyIsSet = settings.ai_llm_key_set;

    console.log('AI Eval: API URL:', apiUrl);
    console.log('AI Eval: Model:', model);
    console.log('AI Eval: API Key is set:', apiKeyIsSet);

    var statusText = 'AI Settings Status:<br>';
    statusText += 'API URL: ' + (apiUrl || 'Not set') + '<br>';
    statusText += 'Model: ' + (model || 'Not set') + '<br>';
    statusText += 'API Key Set: ' + (apiKeyIsSet === undefined ? 'Unknown' : apiKeyIsSet) + '<br>';

    var el = document.getElementById('ai-eval-status-text'); // Updated ID
    if (el) {
      el.innerHTML = statusText; // Use innerHTML to render line breaks
      el.style.color = 'darkblue';
      console.log('AI Eval: Successfully updated status text.');
    } else {
      console.error('AI Eval: #ai-eval-status-text element not found.');
    }
  }

  // Attach the initializer function to the window object to make it globally accessible
  // This is safe because this script is module-scoped by Node.js,
  // but client-side scripts in Nightscout tabs often rely on window for such initializers.
  if (typeof window !== 'undefined') {
    window.initializeAiEvalTab = initializeAiEvalTab;
  }


  var aiEvalPlugin = {
    name: 'ai_eval',
    label: 'AI Evaluation', // Updated label

    html: function(originalClient) {
      console.log('AI Eval: HTML function called. Original client:', originalClient);

      // Extract settings for clarity, though initializeAiEvalTab will access them via passedInClient.settings
      // These are primarily for logging within this specific function's scope if needed.
      const apiUrl = originalClient.settings && originalClient.settings.ai_llm_api_url;
      const model = originalClient.settings && originalClient.settings.ai_llm_model;
      const apiKeyIsSet = originalClient.settings && originalClient.settings.ai_llm_key_set;

      console.log('AI Eval HTML func: API URL from originalClient.settings:', apiUrl);
      console.log('AI Eval HTML func: Model from originalClient.settings:', model);
      console.log('AI Eval HTML func: API Key Set from originalClient.settings:', apiKeyIsSet);

      // Make the originalClient available globally for the embedded script to pick up.
      // This is a temporary measure; the script will delete it.
      if (typeof window !== 'undefined') {
        window.tempAiClient = originalClient;
      }

      // HTML structure for the tab
      // Using a more specific ID for the status text paragraph.
      return `
        <div id="ai-eval-container" style="padding: 20px;">
          <h1>AI Evaluation Report</h1>
          <p id="ai-eval-status-text" style="font-weight: bold;">Loading AI settings status...</p>
          <p><em>(This tab is for AI-powered analysis of your Nightscout data.)</em></p>
        </div>

        <script type="text/javascript">
          (function() { // IIFE to keep scope clean
            try {
              console.log('AI Eval: Embedded script executing.');
              if (typeof window.initializeAiEvalTab === 'function' && window.tempAiClient) {
                console.log('AI Eval: Calling window.initializeAiEvalTab.');
                window.initializeAiEvalTab(window.tempAiClient);
                // Clean up the global temporary client object
                delete window.tempAiClient; 
                console.log('AI Eval: tempAiClient deleted from window.');
              } else {
                console.error('AI Eval: Embedded script - initializeAiEvalTab function or tempAiClient not found on window.');
                var statusEl = document.getElementById('ai-eval-status-text');
                if (statusEl) {
                  statusEl.textContent = 'Error: Could not initialize AI Evaluation tab script. Init function or client data missing.';
                  statusEl.style.color = 'red';
                }
              }
            } catch (e) {
              console.error('AI Eval: Embedded script CRITICAL error:', e);
              var statusEl = document.getElementById('ai-eval-status-text');
              if (statusEl) {
                statusEl.textContent = 'CRITICAL SCRIPT ERROR: ' + e.message;
                statusEl.style.color = 'red';
              }
              // Optionally, re-throw or alert for very critical issues
              // alert('AI Eval embedded script critical error: ' + e.message);
            }
          })();
        </script>
      `;
    },

    css: `
      #ai-eval-container h1 { color: #007bff; } /* Example styling */
      #ai-eval-status-text { 
        padding: 10px; 
        border: 1px solid #ccc; 
        background-color: #f8f9fa; 
        margin-bottom: 15px;
      }
    `,

    report: function(datastorage, sorteddaystoshow, options) {
      // This function remains minimal for now to ensure no interference with other reports.
      // It will store data for later use by the AI evaluation logic.
      console.log('AI Eval: REPORT function called. Data received:', !!datastorage, 'Options Report Name:', options ? options.reportName : 'N/A');
      // Store data if needed for client-side processing, though MVP might fetch directly
      // this.storedData = datastorage; // Example: if data needs to be accessed later by client script via some mechanism
    }
  };

  return aiEvalPlugin;
}

module.exports = init;