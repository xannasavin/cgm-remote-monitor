'use strict';

// AI Evaluation plugin - Establishing reliable client access

function init(ctx) {
    // This function will be called by the embedded script when the tab is loaded.
    // Its primary role is to set up the initial UI elements and store the client object.
    function initializeAiEvalTab(passedInClient) {
        console.log('AI Eval: initializeAiEvalTab called. Received client:', passedInClient);

        if (typeof window !== 'undefined') {
            // Store passedInClient for processAiEvaluationData to use
            window.tempAiEvalPassedInClient = passedInClient;
            console.log('AI Eval: Stored passedInClient on window.tempAiEvalPassedInClient');
        } else {
            console.error('AI Eval: window object not available in initializeAiEvalTab. Cannot store passedInClient.');
            return; // Critical error, cannot proceed
        }

        const settings = passedInClient.settings || {};
        const modelFromSettings = settings.ai_llm_model;

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

        // Placeholders for dynamic prompt statuses (will be updated by processAiEvaluationData)
        statusHTML += '<div><span class="ai-setting-label">System Prompt: </span><span id="ai-system-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';
        statusHTML += '<div><span class="ai-setting-label">User Prompt: </span><span id="ai-user-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';

        var el = document.getElementById('ai-eval-status-text');
        if (el) {
            el.innerHTML = statusHTML;
        } else {
            console.error('AI Eval: #ai-eval-status-text element not found for initial setup.');
        }

        const debugArea = document.getElementById('aiEvalDebugArea');
        if (debugArea) {
            debugArea.textContent = 'Awaiting report data processing... Click "Show" for the AI Evaluation report if not already done.';
        }
        const responseDebugArea = document.getElementById('aiEvalResponseDebugArea');
        if (responseDebugArea && settings.ai_llm_debug === true) {
            responseDebugArea.style.display = 'block';
            responseDebugArea.textContent = 'AI Response Debug Area: Waiting for AI call...';
        } else if (responseDebugArea) {
            responseDebugArea.style.display = 'none';
        }

        const sendButton = document.getElementById('sendToAiButton');
        if (sendButton) {
            sendButton.addEventListener('click', function () {
                console.log('AI Eval: Send to AI button clicked.');
                const button = this; // Keep a reference to the button

                if (typeof window === 'undefined' || !window.currentAiEvalPayload) {
                    console.error('AI Eval: No payload available to send. Was data processed?');
                    alert('AI Evaluation payload is not ready. Please ensure report data is loaded and processed.');
                    return;
                }

                const payloadToSend = window.currentAiEvalPayload;
                const apiEndpoint = (passedInClient.settings.baseURL || '') + '/api/v1/ai_eval';
                const requestHeaders = passedInClient.headers ? passedInClient.headers() : {};
                requestHeaders['Content-Type'] = 'application/json';

                console.log('AI Eval: Calling AI API at URL:', apiEndpoint);
                if (passedInClient.settings.ai_llm_debug === true) {
                    console.log('AI Eval: Payload being sent:', JSON.stringify(payloadToSend, null, 2));
                }

                button.textContent = 'Sending...';
                button.disabled = true;

                const responseDebugArea = document.getElementById('aiEvalResponseDebugArea');
                if (responseDebugArea && passedInClient.settings.ai_llm_debug === true) {
                    responseDebugArea.textContent = 'Calling API...';
                }


                fetch(apiEndpoint, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify(payloadToSend)
                })
                    .then(response => {
                        console.log('AI Eval: Received response from server for /api/v1/ai_eval');
                        if (!response.ok) {
                            // Try to get error message from response body
                            return response.text().then(text => {
                                throw new Error('Network response was not ok. Status: ' + response.status + '. Body: ' + text);
                            });
                        }
                        return response.json();
                    })
                    .then(data => {
                        console.log('AI Eval: AI API call successful. Response data:', data);
                        button.textContent = 'Send to AI'; // Reset button
                        button.disabled = false;

                        // TODO: Display data.html_content in #aiResponseOutputArea (Step 1.c of main ToDo)
                        // TODO: Display data.tokens_used (Step 1.c of main ToDo)

                        if (passedInClient.settings.ai_llm_debug === true && responseDebugArea) {
                            responseDebugArea.textContent = 'Raw AI Response (from /api/v1/ai_eval):\n\n' + JSON.stringify(data, null, 2);
                        }
                    })
                    .catch(error => {
                        console.error('AI Eval: AI API call failed:', error);
                        button.textContent = 'Send to AI'; // Reset button
                        button.disabled = false;
                        if (responseDebugArea) { // Display error in response debug area regardless of debug mode for visibility
                            responseDebugArea.style.display = 'block'; // Ensure it's visible
                            responseDebugArea.textContent = 'AI API Call Error:\n\n' + error.message;
                        } else {
                            alert('AI API Call Error: ' + error.message);
                        }
                    });
            });
        }

        console.log('AI Eval: initializeAiEvalTab completed initial UI setup and event listeners.');
    }

    // This function will be called by the report() function AFTER data is available.
    function processAiEvaluationData() {
        console.log('AI Eval: processAiEvaluationData called.');

        let passedInClient;
        if (typeof window !== 'undefined' && window.tempAiEvalPassedInClient) {
            passedInClient = window.tempAiEvalPassedInClient;
            console.log('AI Eval: Retrieved passedInClient from window.tempAiEvalPassedInClient.');
        } else {
            console.error('AI Eval: window.tempAiEvalPassedInClient not found. Cannot proceed with processing.');
            const debugArea = document.getElementById('aiEvalDebugArea');
            if (debugArea) {
                debugArea.textContent = 'CRITICAL DEBUG: `processAiEvaluationData` ran, but `window.tempAiEvalPassedInClient` was not found.';
            }
            // Clean up report data if client is missing, as we might not get another chance
            if (typeof window !== 'undefined' && window.tempAiEvalReportData) {
                delete window.tempAiEvalReportData;
            }
            return;
        }

        const settings = passedInClient.settings || {};

        let reportData = null;
        if (typeof window !== 'undefined' && window.tempAiEvalReportData) {
            reportData = window.tempAiEvalReportData;
            console.log('AI Eval: Retrieved reportData from window.tempAiEvalReportData:', reportData && !!reportData.datastorage);
        } else {
            console.warn('AI Eval: window.tempAiEvalReportData not found in processAiEvaluationData. Cannot construct payload.');
            const debugArea = document.getElementById('aiEvalDebugArea');
            if (debugArea) {
                debugArea.textContent = 'DEBUG: `processAiEvaluationData` ran, but `window.tempAiEvalReportData` was not found. This should have been set by the report function.';
            }
            // Clean up passedInClient if reportData is missing, as we can't proceed.
            if (typeof window !== 'undefined' && window.tempAiEvalPassedInClient) {
                delete window.tempAiEvalPassedInClient;
            }
            return;
        }

        // --- Fetch Prompts & Construct Payload ---
        if (typeof window.jQuery === 'function') {
            const $ = window.jQuery;
            const baseUrl = settings.baseURL || '';
            const headers = passedInClient.headers ? passedInClient.headers() : {};

            // Update prompt status to "Loading..." as we are about to fetch them
            $('#ai-system-prompt-status').text('Loading...').removeClass('ai-setting-value-set ai-setting-value-not-set ai-setting-value-waiting').addClass('ai-setting-value-loading');
            $('#ai-user-prompt-status').text('Loading...').removeClass('ai-setting-value-set ai-setting-value-not-set ai-setting-value-waiting').addClass('ai-setting-value-loading');

            $.ajax({
                url: baseUrl + '/api/v1/ai_settings/prompts',
                type: 'GET',
                headers: headers,
                success: function (prompts) {

                    if (settings.ai_llm_debug === true) {
                        console.log('AI Eval: Fetched prompts:', prompts);
                    }

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

                    if (reportData && reportData.datastorage) {
                        const systemPromptContent = prompts.system_prompt || "You are a helpful assistant.";
                        let userPromptContent = prompts.user_prompt_template || "Analyze the following CGM data: {{CGMDATA}} using this profile: {{PROFILE}}";

                        // --- Prepare CGM Data String for {{CGMDATA}} ---
                        //https://github.com/xannasavin/cgm-remote-monitor/commit/d1a8cca9eb80d86afec2f51c56166fae06817258
                        let cgmDataString = "CGM data not available or reportData.datastorage is missing.";

                        if (settings.ai_llm_debug === true) {
                            console.log('AI Eval DEBUG: =================================');
                            console.log('AI Eval DEBUG: datastorage: ', reportData.datastorage);
                            console.log('AI Eval DEBUG: =================================');
                        }

                        if (reportData.datastorage) {

                            //Move datastorage content to another var, so we can work with it
                            let datastorageAltered = reportData.datastorage;

                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval DEBUG: datastorageAltered: ', datastorageAltered);
                            }


                            let cgmData;
                            cgmData.profiles = datastorageAltered.profiles;
                            cgmData.allstatsrecords = datastorageAltered.allstatsrecords;
                            cgmData.alldays = datastorageAltered.alldays;
                            cgmData.treatments = datastorageAltered.treatments;

                            //Delete all unecessary Keys from the datastorage altered, so only the days with entries are left
                            delete datastorageAltered.devicestatus;
                            delete datastorageAltered.combobolusTreatments;
                            delete datastorageAltered.tempbasalTreatments;
                            delete datastorageAltered.profileSwitchTreatments;
                            delete datastorageAltered.profiles;
                            delete datastorageAltered.allstatsrecords;
                            delete datastorageAltered.alldays;
                            delete datastorageAltered.treatments;

                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval DEBUG: =================================');
                                console.log('AI Eval DEBUG: datastorageAltered after deleting keys: ', datastorageAltered);
                                console.log('AI Eval DEBUG: cgmData: ', cgmData);
                                console.log('AI Eval DEBUG: =================================');
                            }
                            
                            cgmData.days = datastorageAltered;




                            ///@TODO CHANGE THE CGM DATA HERE
                            ///@TODO CHANGE THE CGM DATA HERE
                            ///@TODO CHANGE THE CGM DATA HERE

                            cgmDataString = JSON.stringify(reportData.datastorage, null, 2); // Fallback


                        }
                        userPromptContent = userPromptContent.replace('{{CGMDATA}}', cgmDataString);

                        // --- Prepare Profile data string for {{PROFILE}} ---
                        let profileString = "Profile data not available.";
                        let activeProfile = null;
                        let profileSource = "None";

                        if (reportData.datastorage) {
                            // Priority 1: Use datastorage.profiles[0]
                            if (reportData.datastorage.profiles && Array.isArray(reportData.datastorage.profiles) && reportData.datastorage.profiles.length > 0) {
                                activeProfile = reportData.datastorage.profiles[0];
                                profileSource = "datastorage.profiles[0]";

                                if (settings.ai_llm_debug === true) {
                                    console.log('AI Eval: Attempting to use profile from datastorage.profiles[0]');
                                    console.log('AI Eval: activeProfile: ', activeProfile);
                                }

                            }
                        }

                        if (activeProfile) {

                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval: Profile found via ' + profileSource + '.');
                            }

                            const profileToLog = {}; // Create a new object for non-function properties
                            for (const key in activeProfile) {
                                if (typeof activeProfile[key] !== 'function') {
                                    profileToLog[key] = activeProfile[key];
                                }
                            }

                            //@TODO CHANGE PROFILE HERE
                            //@TODO CHANGE PROFILE HERE
                            //@TODO CHANGE PROFILE HERE

                            profileString = JSON.stringify(profileToLog, null, 2);

                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval: Extracted profile for {{PROFILE}} from:', profileSource, profileToLog);
                            }

                        } else {
                            console.warn('AI Eval: Could not extract a specific active profile for {{PROFILE}} token from any source.');
                        }
                        userPromptContent = userPromptContent.replace('{{PROFILE}}', profileString);

                        if (settings.ai_llm_debug === true) {
                            console.log('AI Eval DEBUG User Prompt after replacements:\n', userPromptContent);
                        }

                        const payload = {
                            model: settings.ai_llm_model || 'gpt-4o',
                            messages: [
                                {role: "system", content: systemPromptContent},
                                {role: "user", content: userPromptContent}
                            ],
                            temperature: typeof settings.ai_llm_temperature === 'number' ? settings.ai_llm_temperature : 0.7,
                            max_tokens: typeof settings.ai_llm_max_tokens === 'number' ? settings.ai_llm_max_tokens : 200
                        };

                        // Make the payload available for the send button
                        if (typeof window !== 'undefined') {
                            window.currentAiEvalPayload = payload;
                        }

                        if (settings.ai_llm_debug === true) {
                            console.log('AI Eval: Constructed payload:', payload);

                            const debugArea = document.getElementById('aiEvalDebugArea');
                            if (debugArea) {
                                debugArea.textContent = 'AI PROMPT PAYLOAD (DEBUG):\n\n' + JSON.stringify(payload, null, 2);
                                console.log('AI Eval: Payload displayed in debug area.');
                            }
                        }
                    } else {
                        console.warn('AI Eval: Report data (datastorage) became unavailable before payload construction in success callback.');
                        if (typeof window !== 'undefined') {
                            delete window.currentAiEvalPayload; // Clear potentially stale payload
                        }
                        if (settings.ai_llm_debug === true) {
                            const debugArea = document.getElementById('aiEvalDebugArea');
                            if (debugArea) {
                                debugArea.textContent = 'AI PROMPT PAYLOAD (DEBUG):\n\nReport data (datastorage) was not available when prompts were fetched or became null. Cannot construct full payload.';
                            }
                        }
                    }
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    console.error('AI Eval: Error fetching AI prompts:', textStatus, errorThrown);
                    if (typeof window !== 'undefined') {
                        delete window.currentAiEvalPayload; // Clear payload on error
                    }
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
                    // Clean up temporary global data EXCEPT currentAiEvalPayload which is needed by button
                    if (typeof window !== 'undefined') {
                        if (window.tempAiEvalReportData) {
                            delete window.tempAiEvalReportData;
                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval: Cleaned up window.tempAiEvalReportData.');
                            }
                        }
                        // tempAiEvalPassedInClient is still needed by the button click handler via initializeAiEvalTab's closure
                        // However, the original way it was stored on window was for processAiEvaluationData.
                        // initializeAiEvalTab already has `passedInClient` in its scope.
                        // We can remove window.tempAiEvalPassedInClient here as processAiEvaluationData has used it.
                        if (window.tempAiEvalPassedInClient) {
                            delete window.tempAiEvalPassedInClient;
                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval: Cleaned up window.tempAiEvalPassedInClient.');
                            }
                        }
                    }
                }
            });
        } else {
            console.error('AI Eval: window.jQuery is not available in processAiEvaluationData.');
            if (typeof window !== 'undefined') {
                delete window.currentAiEvalPayload; // Clear payload if jQuery is missing
            }
            const sysPromptEl = document.getElementById('ai-system-prompt-status');
            if (sysPromptEl) {
                sysPromptEl.textContent = 'jQuery N/A';
                sysPromptEl.className = 'ai-setting-value-not-set';
            }
            const usrPromptEl = document.getElementById('ai-user-prompt-status');
            if (usrPromptEl) {
                usrPromptEl.textContent = 'jQuery N/A';
                usrPromptEl.className = 'ai-setting-value-not-set';
            }

            if (typeof window !== 'undefined') {
                if (window.tempAiEvalReportData) {
                    delete window.tempAiEvalReportData;

                    if (settings.ai_llm_debug === true) {
                        console.log('AI Eval: Cleaned up window.tempAiEvalReportData (jQuery N/A).');
                    }

                }
                if (window.tempAiEvalPassedInClient) {
                    delete window.tempAiEvalPassedInClient;

                    if (settings.ai_llm_debug === true) {
                        console.log('AI Eval: Cleaned up window.tempAiEvalPassedInClient (jQuery N/A).');
                    }

                }
            }
        }
    }

    // Attach functions to the window object to make them globally accessible
    if (typeof window !== 'undefined') {
        window.initializeAiEvalTab = initializeAiEvalTab;
        window.processAiEvaluationData = processAiEvaluationData; // Expose the new function
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
        
            <button id="sendToAiButton" style="margin-top: 10px; padding: 8px 15px;">Send to AI</button>
            
          <div id="aiResponseOutputArea" style="margin-top: 20px;">
            <!-- The AI Response will be injected here -->
          </div>
        <div id="aiStatistics" style="margin-top: 20px;">
            <!-- AI Statistics (like token usage) be injected here -->
          </div>
        
          <p id="ai-eval-status-text" style="font-weight: bold;">Loading AI settings status...</p>
          <p><em>This tab provides AI-powered analysis of your Nightscout data.<br>
          <strong>Disclaimer:</strong>The information generated is not medical advice and must not be used as a substitute for professional diagnosis or treatment.<br>
          The AI analysis may be inaccurate, incomplete, or incorrect. Use it only as a general indicator or for informational purposes. 
          Always consult a qualified healthcare provider for medical decisions.</em></p>
        
          <div id="aiEvalDebugArea" style="margin-top: 20px;">
            <!-- Debug content will be injected here -->
          </div>

        <div id="aiEvalResponseDebugArea" style="margin-top: 20px;">
            <!-- Response Debug content will be injected here -->
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
      #aiEvalResponseDebugArea {
        background-color: #e0e0e0; /* Slightly different background for distinction */
        border: 1px solid #ccc;
        padding: 10px;
        margin-top: 10px;
        white-space: pre-wrap;
        word-wrap: break-word;
        font-family: monospace;
        font-size: 0.85em;
        max-height: 300px;
        overflow-y: auto;
      }
      #aiStatistics
      {
        background-color: #e0e0e0; /* Slightly different background for distinction */
        border: 1px solid #ccc;
        padding: 10px;
        margin-top: 10px;
        white-space: pre-wrap;
        word-wrap: break-word;
        font-family: monospace;
        font-size: 0.85em;
        max-height: 300px;
        overflow-y: auto;
        max-width: 400px;
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

                // Call processAiEvaluationData now that data is presumed to be set
                if (typeof window.processAiEvaluationData === 'function') {
                    console.log('AI Eval: Calling window.processAiEvaluationData from report function.');
                    // A small timeout might help ensure the DOM is ready if processAiEvaluationData manipulates it immediately,
                    // though ideally it shouldn't be strictly necessary if initializeAiEvalTab has already run.
                    // However, given the complexities, this is a safeguard.
                    setTimeout(function () {
                        window.processAiEvaluationData();
                    }, 0);
                } else {
                    console.error('AI Eval: window.processAiEvaluationData is not defined. Cannot process data.');
                }

            } else {
                console.error('AI Eval: window object not available in REPORT function. Cannot store report data or call processor.');
            }
        }
    };

    return aiEvalPlugin;
}

module.exports = init;