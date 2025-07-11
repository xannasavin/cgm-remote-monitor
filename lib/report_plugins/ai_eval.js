'use strict';

// AI Evaluation plugin - Establishing reliable client access

function init(ctx) {
    // This function will be called by the embedded script
    function initializeAiEvalTab(passedInClient) {
        console.log('AI Eval: initializeAiEvalTab called. Received client:', passedInClient);

        console.log('AI Eval: initializeAiEvalTab called. Received client:', passedInClient);

        const settings = passedInClient && passedInClient.settings ? passedInClient.settings : {};
        const modelFromSettings = settings.ai_llm_model;

        console.log('AI Eval: Model from settings:', modelFromSettings);

        // --- Retrieve Report Data ---
        let reportData = null;
        if (typeof window !== 'undefined' && window.tempAiEvalReportData) {
            reportData = window.tempAiEvalReportData;
            console.log('AI Eval: Retrieved data from window.tempAiEvalReportData:', reportData);
            // Clean up immediately after retrieval, or after use if preferred.
            // For now, let's clean up at the end of this function.
        } else {
            console.warn('AI Eval: window.tempAiEvalReportData not found. Payload construction will be limited.');
            // Display a message in the debug area if it exists
            const debugArea = document.getElementById('aiEvalDebugArea');
            if (debugArea) {
                debugArea.textContent = 'Report data not loaded. Click "Show" on the AI Evaluation report to load data for prompt construction.';
            }
        }

        // --- Display Static Settings Status ---
        const modelIsSet = modelFromSettings && modelFromSettings.trim() !== '';
        var statusHTML = '<strong>AI Settings Status:</strong><br>';

        if (settings.ai_llm_debug === true) {
            statusHTML += '<div><span class="ai-setting-label ai-setting-value-not-set">Debug Mode is active</span></div>';
        }

        let modelValueClass, modelText;
        if (modelIsSet) {
            modelValueClass = 'ai-setting-value-set';
            modelText = modelFromSettings;
        } else {
            modelValueClass = 'ai-setting-value-not-set';
            modelText = 'Not Set';
        }
        statusHTML += '<div><span class="ai-setting-label">Model: </span><span class="' + modelValueClass + '">' + modelText + '</span></div>';
        statusHTML += '<div><span class="ai-setting-label">Please make sure that <em>AI_LLM_KEY</em><br>Environment variable is set.</span></div>';

        // Placeholders for dynamic prompt statuses (will be updated by AJAX)
        statusHTML += '<div><span class="ai-setting-label">System Prompt: </span><span id="ai-system-prompt-status" class="ai-setting-value-loading">Loading...</span></div>';
        statusHTML += '<div><span class="ai-setting-label">User Prompt: </span><span id="ai-user-prompt-status" class="ai-setting-value-loading">Loading...</span></div>';

        var el = document.getElementById('ai-eval-status-text');
        if (el) {
            el.innerHTML = statusHTML;
        } else {
            console.error('AI Eval: #ai-eval-status-text element not found.');
        }

        // --- Fetch Prompts & Construct Payload ---
        if (typeof window.jQuery === 'function') {
            const $ = window.jQuery;
            const baseUrl = settings.baseURL || '';
            const headers = passedInClient.headers ? passedInClient.headers() : {};

            $.ajax({
                url: baseUrl + '/api/v1/ai_settings/prompts',
                type: 'GET',
                headers: headers,
                success: function (prompts) {
                    console.log('AI Eval: Fetched prompts:', prompts);
                    const systemPromptIsSet = prompts && prompts.system_prompt && prompts.system_prompt.trim() !== '';
                    const userPromptIsSet = prompts && prompts.user_prompt_template && prompts.user_prompt_template.trim() !== '';

                    $('#ai-system-prompt-status')
                        .text(systemPromptIsSet ? 'Set' : 'Not Set')
                        .removeClass('ai-setting-value-loading')
                        .addClass(systemPromptIsSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set');
                    $('#ai-user-prompt-status')
                        .text(userPromptIsSet ? 'Set' : 'Not Set')
                        .removeClass('ai-setting-value-loading')
                        .addClass(userPromptIsSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set');

                    // Proceed to construct payload if reportData is available
                    if (reportData && reportData.datastorage) {
                        const systemPromptContent = prompts.system_prompt || "You are a helpful assistant."; // Default if not set
                        let userPromptContent = prompts.user_prompt_template || "Analyze the following CGM data: {{CGMDATA}}"; // Default if not set

                        // Prepare CGM data string
                        // For now, stringify the whole datastorage.data.
                        // This might need refinement to select specific parts like entries, treatments, profile.
                        let cgmDataString = "No CGM data loaded.";
                        if (reportData.datastorage.data) {
                            // A more targeted approach:
                            const relevantData = {
                                entries: reportData.datastorage.data.entries,
                                treatments: reportData.datastorage.data.treatments,
                                profile: reportData.datastorage.data.profile || reportData.datastorage.profile, // Check both common locations
                                deviceStatus: reportData.datastorage.data.devicestatus
                            };
                            cgmDataString = JSON.stringify(relevantData, null, 2); // Pretty print for debug
                        } else {
                            cgmDataString = JSON.stringify(reportData.datastorage, null, 2); // Fallback if .data is not there
                        }

                        userPromptContent = userPromptContent.replace('{{CGMDATA}}', cgmDataString);
                        // Placeholder for {{PROFILE}} if we decide to add it separately
                        // userPromptContent = userPromptContent.replace('{{PROFILE}}', JSON.stringify(reportData.datastorage.profile_data_here, null, 2));


                        const payload = {
                            model: settings.ai_llm_model || 'gpt-4o', // Fallback model
                            messages: [
                                { role: "system", content: systemPromptContent },
                                { role: "user", content: userPromptContent }
                            ],
                            temperature: 0.7, // Hardcoded default
                            max_tokens: 2000  // Hardcoded default
                            // TODO: Consider making temperature and max_tokens configurable via Nightscout settings if desired later
                        };

                        console.log('AI Eval: Constructed payload:', payload);

                        if (settings.ai_llm_debug === true) {
                            const debugArea = document.getElementById('aiEvalDebugArea');
                            if (debugArea) {
                                debugArea.textContent = 'AI PROMPT PAYLOAD (DEBUG):\n\n' + JSON.stringify(payload, null, 2);
                                console.log('AI Eval: Payload displayed in debug area.');
                            } else {
                                console.warn('AI Eval: #aiEvalDebugArea not found for displaying payload.');
                            }
                        }
                    } else {
                        console.warn('AI Eval: Report data not available, skipping payload construction.');
                        if (settings.ai_llm_debug === true) {
                            const debugArea = document.getElementById('aiEvalDebugArea');
                            if (debugArea && !debugArea.textContent) { // Don't overwrite previous message
                                debugArea.textContent = 'AI PROMPT PAYLOAD (DEBUG):\n\nReport data (datastorage) was not available when prompts were fetched. Cannot construct full payload.';
                            }
                        }
                    }
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    console.error('AI Eval: Error fetching AI prompts:', textStatus, errorThrown);
                    $('#ai-system-prompt-status').text('Error').removeClass('ai-setting-value-loading').addClass('ai-setting-value-not-set');
                    $('#ai-user-prompt-status').text('Error').removeClass('ai-setting-value-loading').addClass('ai-setting-value-not-set');
                    if (settings.ai_llm_debug === true) {
                        const debugArea = document.getElementById('aiEvalDebugArea');
                        if (debugArea) {
                            debugArea.textContent = 'AI PROMPT PAYLOAD (DEBUG):\n\nFailed to fetch system/user prompts. Cannot construct payload.';
                        }
                    }
                },
                complete: function () {
                    // Clean up temporary global data regardless of success/failure of AJAX
                    if (typeof window !== 'undefined' && window.tempAiEvalReportData) {
                        delete window.tempAiEvalReportData;
                        console.log('AI Eval: Cleaned up window.tempAiEvalReportData.');
                    }
                }
            });
        } else {
            console.error('AI Eval: window.jQuery is not available. Cannot fetch prompts or construct payload.');
            $('#ai-system-prompt-status').text('jQuery N/A').removeClass('ai-setting-value-loading').addClass('ai-setting-value-not-set');
            $('#ai-user-prompt-status').text('jQuery N/A').removeClass('ai-setting-value-loading').addClass('ai-setting-value-not-set');
            if (typeof window !== 'undefined' && window.tempAiEvalReportData) {
                delete window.tempAiEvalReportData; // Still try to clean up
                console.log('AI Eval: Cleaned up window.tempAiEvalReportData (jQuery was not available).');
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

            console.log('AI Eval DEBUG Settings original client:', originalClient.settings)

            // Extract settings for clarity, though initializeAiEvalTab will access them via passedInClient.settings
            // These are primarily for logging within this specific function's scope if needed.
            const apiUrl = originalClient.settings && originalClient.settings.ai_llm_api_url;
            const model = originalClient.settings && originalClient.settings.ai_llm_model;

            //console.log('AI Eval HTML func: API URL from originalClient.settings:', apiUrl);
            //console.log('AI Eval HTML func: Model from originalClient.settings:', model);

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
          <p><em>This tab provides AI-powered analysis of your Nightscout data.<br>
          <strong>Disclaimer:</strong>The information generated is not medical advice and must not be used as a substitute for professional diagnosis or treatment.<br>
          The AI analysis may be inaccurate, incomplete, or incorrect. Use it only as a general indicator or for informational purposes. 
          Always consult a qualified healthcare provider for medical decisions.</em></p>
        
          <div id="aiEvalDebugArea" style="margin-top: 20px;">
            <!-- Debug content will be injected here -->
          </div>
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
      #aiEvalDebugArea {
        background-color: #f0f0f0;
        border: 1px solid #ddd;
        padding: 10px;
        margin-top: 15px;
        white-space: pre-wrap; /* Allows text to wrap but preserves whitespace and newlines */
        word-wrap: break-word; /* Breaks long words to prevent overflow */
        font-family: monospace;
        font-size: 0.85em;
        max-height: 400px; /* Optional: if the content can be very long */
        overflow-y: auto;   /* Optional: adds scrollbar if content exceeds max-height */
      }
    `,

        report: function (datastorage, sorteddaystoshow, options) {
            // This function is called when the "Show" button for this report is clicked.
            // It stores data for later use by the AI evaluation logic in initializeAiEvalTab.
            console.log('AI Eval: REPORT function called. Data received:', !!datastorage, 'Options Report Name:', options ? options.reportName : 'N/A');

            if (typeof window !== 'undefined') {
                // Temporarily store the data on the window object for initializeAiEvalTab to pick up.
                // This will be cleaned up by initializeAiEvalTab.
                window.tempAiEvalReportData = {
                    datastorage: datastorage,
                    options: options,
                    sorteddaystoshow: sorteddaystoshow // Also including sorteddaystoshow as it might be useful
                };
                console.log('AI Eval: Stored datastorage, options, and sorteddaystoshow on window.tempAiEvalReportData.');

                // Log structure of datastorage if debug is enabled (assuming settings are accessible here, which they aren't directly)
                // This indirect check for debug mode is not ideal.
                // A better way would be to check this inside initializeAiEvalTab once client.settings are available.
                // For now, let's log a snippet if datastorage exists.
                if (datastorage) {
                    // Avoid logging the whole object if it's huge. Log keys or specific parts.
                    console.log('AI Eval DEBUG: datastorage keys:', Object.keys(datastorage));
                    if (datastorage.data) {
                        console.log('AI Eval DEBUG: datastorage.data keys:', Object.keys(datastorage.data));
                        if (datastorage.data.profile) {
                            console.log('AI Eval DEBUG: datastorage.data.profile (first one if array):', Array.isArray(datastorage.data.profile) ? datastorage.data.profile[0] : datastorage.data.profile);
                        } else if (datastorage.profile) {
                            console.log('AI Eval DEBUG: datastorage.profile (first one if array):', Array.isArray(datastorage.profile) ? datastorage.profile[0] : datastorage.profile);
                        }
                    } else {
                        console.log('AI Eval DEBUG: datastorage.data is not present.');
                    }
                }
            } else {
                console.error('AI Eval: window object not available in REPORT function. Cannot store report data.');
            }
        }
    };

    return aiEvalPlugin;
}

module.exports = init;