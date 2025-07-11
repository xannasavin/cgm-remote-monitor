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
        console.log('AI Eval: initializeAiEvalTab completed initial UI setup.');
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

                    if (reportData && reportData.datastorage) {
                        const systemPromptContent = prompts.system_prompt || "You are a helpful assistant.";
                        let userPromptContent = prompts.user_prompt_template || "Analyze the following CGM data: {{CGMDATA}} using this profile: {{PROFILE}}";

                        // --- Prepare CGM Data String for {{CGMDATA}} ---
                        let cgmDataString = "CGM data (entries, treatments, devicestatus) not available.";
                        const relevantCGMData = {};
                        if (reportData.datastorage) {
                            // Check within datastorage.data first, then root of datastorage
                            const ds_data = reportData.datastorage.data || {};
                            const ds_root = reportData.datastorage;

                            if (Array.isArray(ds_data.entries) && ds_data.entries.length > 0) {
                                relevantCGMData.entries = ds_data.entries;
                            } else if (Array.isArray(ds_root.entries) && ds_root.entries.length > 0) {
                                relevantCGMData.entries = ds_root.entries;
                            }

                            if (Array.isArray(ds_data.treatments) && ds_data.treatments.length > 0) {
                                relevantCGMData.treatments = ds_data.treatments;
                            } else if (Array.isArray(ds_root.treatments) && ds_root.treatments.length > 0) {
                                relevantCGMData.treatments = ds_root.treatments;
                            }

                            if (Array.isArray(ds_data.devicestatus) && ds_data.devicestatus.length > 0) {
                                relevantCGMData.devicestatus = ds_data.devicestatus;
                            } else if (Array.isArray(ds_root.devicestatus) && ds_root.devicestatus.length > 0) {
                                relevantCGMData.devicestatus = ds_root.devicestatus;
                            }

                            if (Object.keys(relevantCGMData).length > 0) {
                                cgmDataString = JSON.stringify(relevantCGMData, null, 2);
                                console.log('AI Eval: Extracted for {{CGMDATA}}:', Object.keys(relevantCGMData));
                            } else {
                                console.warn('AI Eval: No core CGM data (entries, treatments, devicestatus) found in datastorage or datastorage.data.');
                            }
                        } else {
                            console.warn('AI Eval: reportData.datastorage itself is null/undefined for {{CGMDATA}}.');
                        }
                        userPromptContent = userPromptContent.replace('{{CGMDATA}}', cgmDataString);

                        // --- Prepare Profile data string for {{PROFILE}} ---
                        let profileString = "Profile data not available.";
                        let activeProfile = null;
                        let profileSource = "None";

                        if (reportData.datastorage) {
                            if (reportData.datastorage.data && reportData.datastorage.data.profile) {
                                activeProfile = Array.isArray(reportData.datastorage.data.profile) ? reportData.datastorage.data.profile[0] : reportData.datastorage.data.profile;
                                if (activeProfile) profileSource = "datastorage.data.profile";
                            }
                            if (!activeProfile && reportData.datastorage.profile) {
                                activeProfile = Array.isArray(reportData.datastorage.profile) ? reportData.datastorage.profile[0] : reportData.datastorage.profile;
                                if (activeProfile) profileSource = "datastorage.profile";
                            }
                        }

                        if (!activeProfile && passedInClient && typeof passedInClient.profile === 'function') {
                            console.log('AI Eval: Attempting to get profile from passedInClient.profile()');
                            const clientProfile = passedInClient.profile();
                            // Inspect clientProfile structure - common is .store or direct properties
                            if (clientProfile && clientProfile.store) { // common pattern for profile store
                                activeProfile = clientProfile.store;
                                if (activeProfile) profileSource = "passedInClient.profile().store";
                            } else if (clientProfile && Object.keys(clientProfile).length > 0 && !clientProfile.load) {
                                // If clientProfile is an object with keys and not the profile loader itself
                                activeProfile = clientProfile;
                                if (activeProfile) profileSource = "passedInClient.profile() direct object";
                            }
                            console.log('AI Eval: passedInClient.profile() result:', clientProfile);
                        }

                        if (activeProfile) {
                            // Ensure we're not stringifying functions if activeProfile is complex
                            const profileToLog = {};
                            for (const key in activeProfile) {
                                if (typeof activeProfile[key] !== 'function') {
                                    profileToLog[key] = activeProfile[key];
                                }
                            }
                            profileString = JSON.stringify(profileToLog, null, 2);
                            console.log('AI Eval: Extracted profile for {{PROFILE}} from:', profileSource, JSON.stringify(profileToLog, null, 2).substring(0,100) + "...");
                        } else {
                            console.warn('AI Eval: Could not extract a specific active profile for {{PROFILE}} token from any source.');
                        }
                        userPromptContent = userPromptContent.replace('{{PROFILE}}', profileString);

                        console.log('AI Eval DEBUG User Prompt after replacements:\n', userPromptContent);

                        const payload = {
                            model: settings.ai_llm_model || 'gpt-4o',
                            messages: [
                                { role: "system", content: systemPromptContent },
                                { role: "user", content: userPromptContent }
                            ],
                            temperature: typeof settings.ai_llm_temperature === 'number' ? settings.ai_llm_temperature : 0.7,
                            max_tokens: typeof settings.ai_llm_max_tokens === 'number' ? settings.ai_llm_max_tokens : 200
                        };
                        console.log('AI Eval: Constructed payload:', payload);

                        if (settings.ai_llm_debug === true) {
                            const debugArea = document.getElementById('aiEvalDebugArea');
                            if (debugArea) {
                                debugArea.textContent = 'AI PROMPT PAYLOAD (DEBUG):\n\n' + JSON.stringify(payload, null, 2);
                                console.log('AI Eval: Payload displayed in debug area.');
                            }
                        }
                    } else {
                        console.warn('AI Eval: Report data (datastorage) became unavailable before payload construction in success callback.');
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
                    // Clean up all temporary global data
                    if (typeof window !== 'undefined') {
                        if (window.tempAiEvalReportData) {
                            delete window.tempAiEvalReportData;
                            console.log('AI Eval: Cleaned up window.tempAiEvalReportData.');
                        }
                        if (window.tempAiEvalPassedInClient) {
                            delete window.tempAiEvalPassedInClient;
                            console.log('AI Eval: Cleaned up window.tempAiEvalPassedInClient.');
                        }
                    }
                }
            });
        } else {
            console.error('AI Eval: window.jQuery is not available in processAiEvaluationData.');
            const sysPromptEl = document.getElementById('ai-system-prompt-status');
            if(sysPromptEl) {
                sysPromptEl.textContent = 'jQuery N/A';
                sysPromptEl.className = 'ai-setting-value-not-set';
            }
            const usrPromptEl = document.getElementById('ai-user-prompt-status');
            if(usrPromptEl) {
                usrPromptEl.textContent = 'jQuery N/A';
                usrPromptEl.className = 'ai-setting-value-not-set';
            }

            if (typeof window !== 'undefined') {
                if (window.tempAiEvalReportData) {
                    delete window.tempAiEvalReportData;
                    console.log('AI Eval: Cleaned up window.tempAiEvalReportData (jQuery N/A).');
                }
                if (window.tempAiEvalPassedInClient) {
                    delete window.tempAiEvalPassedInClient;
                    console.log('AI Eval: Cleaned up window.tempAiEvalPassedInClient (jQuery N/A).');
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

                // Call processAiEvaluationData now that data is presumed to be set
                if (typeof window.processAiEvaluationData === 'function') {
                    console.log('AI Eval: Calling window.processAiEvaluationData from report function.');
                    // A small timeout might help ensure the DOM is ready if processAiEvaluationData manipulates it immediately,
                    // though ideally it shouldn't be strictly necessary if initializeAiEvalTab has already run.
                    // However, given the complexities, this is a safeguard.
                    setTimeout(function() {
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