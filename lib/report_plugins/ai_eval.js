'use strict';

// AI Evaluation plugin - Establishing reliable client access

function init(ctx) {
    // This function will be called by the embedded script
    function initializeAiEvalTab(passedInClient) {
        console.log('AI Eval: initializeAiEvalTab called. Received client:', passedInClient);

        const settings = passedInClient && passedInClient.settings ? passedInClient.settings : {};
        const apiUrlFromSettings = settings.ai_llm_api_url;
        const modelFromSettings = settings.ai_llm_model;
        // Use the new flag from server settings
        const apiKeyIsSetByServerFlag = settings.ai_llm_key_is_set;

        // Initial console logs for received settings
        console.log('AI Eval: API URL from settings:', apiUrlFromSettings);
        console.log('AI Eval: Model from settings:', modelFromSettings);
        console.log('AI Eval: API Key is set:', apiKeyIsSetByServerFlag);

        // Temporary DEBUG logs
        //console.log('AI Eval DEBUG: API URL from settings:', apiUrlFromSettings);
        //console.log('AI Eval DEBUG: Value of settings.ai_llm_key_is_set:', apiKeyIsSetByServerFlag);


        // --- Logic for "Set" / "Not Set" ---
        const apiUrlIsSet = apiUrlFromSettings && apiUrlFromSettings.trim() !== '';
        const modelIsSet = modelFromSettings && modelFromSettings.trim() !== '';

        var statusHTML = '<strong>AI Settings Status:</strong><br>'; // Keep title bold

        // API URL
        let apiUrlValueClass = apiUrlIsSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set';
        let apiUrlText = apiUrlIsSet ? 'Set' : 'Not Set';
        statusHTML += '<div><span class="ai-setting-label">API URL: </span><span class="' + apiUrlValueClass + '">' + apiUrlText + '</span></div>';

        // Model
        let modelValueClass, modelText;
        if (modelIsSet) {
            modelValueClass = 'ai-setting-value-set';
            modelText = modelFromSettings; // Display the actual model name
        } else {
            modelValueClass = 'ai-setting-value-not-set';
            modelText = 'Not Set';
        }
        statusHTML += '<div><span class="ai-setting-label">Model: </span><span class="' + modelValueClass + '">' + modelText + '</span></div>';

        // API Key - status now depends on the server-provided 'ai_llm_key_is_set' flag
        let apiKeySetText, apiKeyValueClass;
        if (apiKeyIsSetByServerFlag === true) {
            apiKeySetText = 'Set';
            apiKeyValueClass = 'ai-setting-value-set';
        } else { // This covers false or undefined (though server should send false if not set)
            apiKeySetText = 'Not Set';
            apiKeyValueClass = 'ai-setting-value-not-set';
        }
        statusHTML += '<div><span class="ai-setting-label">API Key Configured: </span><span class="' + apiKeyValueClass + '">' + apiKeySetText + '</span></div>';
        // The informational message about server-side update is removed as the flag is now definitive.

        // Add placeholders for prompt settings
        statusHTML += '<div><span class="ai-setting-label">System Prompt: </span><span id="ai-system-prompt-status" class="ai-setting-value-loading">Loading...</span></div>';
        statusHTML += '<div><span class="ai-setting-label">User Prompt: </span><span id="ai-user-prompt-status" class="ai-setting-value-loading">Loading...</span></div>';

        var el = document.getElementById('ai-eval-status-text');
        if (el) {
            el.innerHTML = statusHTML;
            console.log('AI Eval: Successfully updated status text with initial settings and prompt placeholders.');
        } else {
            console.error('AI Eval: #ai-eval-status-text element not found for initial update.');
            // If the main container isn't found, we can't update prompt statuses either.
            return;
        }

        // Fetch prompt settings using window.jQuery
        if (typeof window.jQuery === 'function') {
            const $ = window.jQuery; // Use window.jQuery
            const baseUrl = passedInClient.settings && passedInClient.settings.baseURL ? passedInClient.settings.baseURL : '';
            const headers = passedInClient.headers ? passedInClient.headers() : {};

            $.ajax({
                url: baseUrl + '/api/v1/ai_settings/prompts',
                type: 'GET',
                headers: headers,
                success: function (prompts) {
                    console.log('AI Eval: Successfully fetched prompts via window.jQuery:', prompts); // Original log

                    // Temporary DEBUG logs for fetched prompts
                    console.log('AI Eval: Fetched System Prompt:\n', (prompts && prompts.system_prompt ? prompts.system_prompt : 'Not found/empty'));
                    console.log('AI Eval: Fetched User Prompt Template:\n', (prompts && prompts.user_prompt_template ? prompts.user_prompt_template : 'Not found/empty'));

                    const systemPromptIsSet = prompts && prompts.system_prompt && prompts.system_prompt.trim() !== '';
                    const userPromptIsSet = prompts && prompts.user_prompt_template && prompts.user_prompt_template.trim() !== '';

                    // Use $ (window.jQuery) for DOM manipulation here
                    $('#ai-system-prompt-status')
                        .text(systemPromptIsSet ? 'Set' : 'Not Set')
                        .removeClass('ai-setting-value-loading ai-setting-value-not-set ai-setting-value-set') // Clear all potential previous classes
                        .addClass(systemPromptIsSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set');

                    $('#ai-user-prompt-status')
                        .text(userPromptIsSet ? 'Set' : 'Not Set')
                        .removeClass('ai-setting-value-loading ai-setting-value-not-set ai-setting-value-set') // Clear all potential previous classes
                        .addClass(userPromptIsSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set');

                    console.log('AI Eval: Prompt statuses updated via window.jQuery.');
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    console.error('AI Eval: Error fetching AI prompts via window.jQuery:', textStatus, errorThrown, jqXHR.responseText);
                    // Use $ (window.jQuery) for DOM manipulation here
                    $('#ai-system-prompt-status')
                        .text('Error fetching')
                        .removeClass('ai-setting-value-loading ai-setting-value-not-set ai-setting-value-set')
                        .addClass('ai-setting-value-not-set');
                    $('#ai-user-prompt-status')
                        .text('Error fetching')
                        .removeClass('ai-setting-value-loading ai-setting-value-not-set ai-setting-value-set')
                        .addClass('ai-setting-value-not-set');
                }
            });
        } else {
            console.error('AI Eval: window.jQuery is not available. Cannot fetch prompt settings.');
            // Update placeholders using vanilla JS as jQuery is not available
            const systemPromptStatusEl = document.getElementById('ai-system-prompt-status');
            if (systemPromptStatusEl) {
                systemPromptStatusEl.textContent = 'jQuery not available';
                systemPromptStatusEl.className = 'ai-setting-value-not-set'; // Overwrites other classes
            }
            const userPromptStatusEl = document.getElementById('ai-user-prompt-status');
            if (userPromptStatusEl) {
                userPromptStatusEl.textContent = 'jQuery not available';
                userPromptStatusEl.className = 'ai-setting-value-not-set'; // Overwrites other classes
            }
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

        html: function (originalClient) {
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
          <p id="ai-eval-status-text" style="font-weight: bold;">Loading AI settings status...</p>
          <p><em>(This tab provides AI-powered analysis of your Nightscout data.<br>
          <strong>Disclaimer</strong><br> 
          The information generated is not medical advice and must not be used as a substitute for professional diagnosis or treatment.<br>
          The AI analysis may be inaccurate, incomplete, or incorrect. Use it only as a general indicator or for informational purposes. 
          Always consult a qualified healthcare provider for medical decisions.)</em></p>
        
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
        max-width: 400px;
      }
      #ai-eval-status-text strong { /* For the "AI Settings Status:" title */
        font-weight: bold;
      }
      .ai-setting-label {
        font-weight: normal;
      }
      .ai-setting-value-set {
        font-weight: normal;
        color: green;
      }
      .ai-setting-value-not-set {
        font-weight: normal;
        color: red;
      }
      .ai-setting-value-loading {
        font-weight: normal;
        color: orange;
      }
    `,

        report: function (datastorage, sorteddaystoshow, options) {
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