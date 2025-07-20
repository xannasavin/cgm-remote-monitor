'use strict';

// AI Evaluation plugin - Establishing reliable client access

function init(ctx) {
    // This function will be called by the embedded script when the tab is loaded.
    // Its primary role is to set up the initial UI elements and store the client object.
    function initializeAiEvalTab(passedInClient) {

        if(passedInClient.settings.ai_llm_debug === true) {
            console.log('AI Eval: initializeAiEvalTab called. Received client:', passedInClient);
        }

        if (typeof window !== 'undefined') {
            // Store passedInClient for processAiEvaluationData to use
            window.tempAiEvalPassedInClient = passedInClient;
            if(passedInClient.settings.ai_llm_debug === true) {
                console.log('AI Eval: Stored passedInClient on window.tempAiEvalPassedInClient');
            }
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
        statusHTML += '<div><span class="ai-setting-label">System Interim Prompt: </span><span id="ai-system-interim-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';
        statusHTML += '<div><span class="ai-setting-label">User Interim Prompt: </span><span id="ai-user-interim-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';
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

        const interimDebugArea = document.getElementById('aiEvalInterimDebugArea');
        if (interimDebugArea) {
            interimDebugArea.textContent = 'Awaiting report data processing...';
        }

        const interimResponseDebugArea = document.getElementById('aiEvalInterimResponseDebugArea');
        if (interimResponseDebugArea) {
            interimResponseDebugArea.textContent = 'Awaiting interim AI call...';
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
            sendButton.addEventListener('click', async function () {

                if (settings.ai_llm_debug === true) {
                    console.log('AI Eval: Send to AI button clicked.');
                }
                const button = this;

                if (typeof window === 'undefined' || !window.interimPayloads || window.interimPayloads.length === 0) {
                    console.error('AI Eval: No interim payloads available to send.');
                    alert('AI Evaluation interim payloads are not ready. Please load data first.');
                    return;
                }

                button.disabled = true;
                window.interimResponses = []; // Reset responses

                const interimResponseDebugArea = document.getElementById('aiEvalInterimResponseDebugArea');
                const responseOutputArea = document.getElementById('aiResponseOutputArea');
                interimResponseDebugArea.textContent = ''; // Clear previous debug content
                responseOutputArea.innerHTML = 'Starting interim analysis...'; // Initial status message

                const totalPayloads = window.interimPayloads.length;

                for (let i = 0; i < totalPayloads; i++) {
                    const payload = window.interimPayloads[i];
                    const statusMsg = `Processing day ${i + 1} of ${totalPayloads}...`;
                    console.log(`AI Eval: ${statusMsg}`);
                    button.textContent = `Sending (${i + 1}/${totalPayloads})...`;
                    responseOutputArea.innerHTML = `<p>${statusMsg}</p>`;

                    try {
                        const apiEndpoint = (passedInClient.settings.baseURL || '') + '/api/v1/ai_eval';
                        const requestHeaders = passedInClient.headers ? passedInClient.headers() : {};
                        requestHeaders['Content-Type'] = 'application/json';

                        if (passedInClient.settings.ai_llm_debug === true) {
                            console.log(`AI Eval: Sending interim payload #${i + 1}:`, JSON.stringify(payload, null, 2));
                        }

                        const response = await fetch(apiEndpoint, {
                            method: 'POST',
                            headers: requestHeaders,
                            body: JSON.stringify(payload)
                        });

                        if (!response.ok) {
                            const errorText = await response.text();
                            throw new Error(`Network response was not ok for payload ${i + 1}. Status: ${response.status}. Body: ${errorText}`);
                        }

                        const data = await response.json();
                        window.interimResponses.push(data);

                        if (passedInClient.settings.ai_llm_debug === true) {
                            const currentDebugText = interimResponseDebugArea.textContent;
                            interimResponseDebugArea.textContent = currentDebugText + `\n\n--- Response for Day ${i + 1} ---\n` + JSON.stringify(data, null, 2);
                        }

                    } catch (error) {
                        console.error(`AI Eval: AI API call failed for interim payload #${i + 1}:`, error);
                        responseOutputArea.innerHTML = `<p style="color: red;">Error during analysis of day ${i + 1}. Please check the console and debug areas for details.</p>`;
                        interimResponseDebugArea.textContent += `\n\n--- ERROR for Day ${i + 1} ---\n${error.message}`;
                        button.textContent = 'Send to AI';
                        button.disabled = false;
                        return; // Stop processing on error
                    }
                }

                console.log('AI Eval: All interim payloads processed.');
                responseOutputArea.innerHTML = '<p>All daily analyses complete. Ready to build final report.</p>';
                button.textContent = 'Send to AI'; // Or change to "Build Final Report"
                button.disabled = false; // Re-enable for next step

                // Here, you would trigger the final payload construction and call
                // For now, we just log the collected responses.
                if (passedInClient.settings.ai_llm_debug === true) {
                    console.log('AI Eval: Collected interim responses:', window.interimResponses);
                }

                // Construct and display the final payload
                const $ = window.jQuery;
                const baseUrl = passedInClient.settings.baseURL || '';
                const headers = passedInClient.headers ? passedInClient.headers() : {};

                $.ajax({
                    url: baseUrl + '/api/v1/ai_settings/prompts',
                    type: 'GET',
                    headers: headers,
                    success: function (prompts) {
                        const finalSystemPrompt = prompts.system_prompt || "You are a helpful assistant.";
                        let finalUserPrompt = prompts.user_prompt_template || "Analyze the following interim AI data: {{INTERIMAIDATA}}";

                        const interimJsonContents = window.interimResponses.map(response => {
                            try {
                                if (
                                    response &&
                                    response.html_content &&
                                    typeof response.html_content === 'string'
                                ) {
                                    const raw = response.html_content.trim();

                                    // Entferne ```json und abschließendes ```
                                    const cleaned = raw
                                        .replace(/^```json\s*/, '')
                                        .replace(/```$/, '')
                                        .trim();

                                    const parsed = JSON.parse(cleaned);

                                    return {
                                        html_content: parsed,
                                        tokens_used: response.tokens_used
                                    };
                                }
                            } catch (e) {
                                console.error('AI Eval: Error parsing html_content to JSON:', e);
                                return {
                                    error: 'Failed to parse html_content',
                                    original_content: response.html_content,
                                    tokens_used: response.tokens_used
                                };
                            }
                            return null;
                        }).filter(Boolean); // Filtere null-Werte (falls Parsing oder Bedingungen fehlschlagen)

                        const parsedResponses = [];

                        let totalTokensUsed = 0;
                        let interimCallTokens = 0;
                        let interimCallsAmount = 0;

                        for (const response of window.interimResponses) {
                            try {
                                if (
                                    response &&
                                    response.html_content &&
                                    typeof response.html_content === 'string'
                                ) {
                                    const raw = response.html_content.trim();

                                    // Entferne ```json und abschließendes ```
                                    const cleaned = raw
                                        .replace(/^```json\s*/, '')
                                        .replace(/```$/, '')
                                        .trim();

                                    const parsedContent = JSON.parse(cleaned);

                                    if (!parsedContent.date) continue;

                                    parsedResponses.push({
                                        date: parsedContent.date,
                                        content: parsedContent
                                    });

                                    totalTokensUsed += response.tokens_used || 0;
                                    interimCallTokens += response.tokens_used || 0;
                                    interimCallsAmount++;
                                }
                            } catch (e) {
                                console.error('Fehler beim Parsen oder Verarbeiten:', e);
                            }
                        }

                        // Sortiere nach Datum aufsteigend
                        parsedResponses.sort((a, b) => new Date(a.date) - new Date(b.date));

                        // Erzeuge zusammengeführtes Objekt nach Datum
                        const mergedByDate = {};
                        for (const entry of parsedResponses) {
                            mergedByDate[entry.date] = entry.content;
                        }

                        //const interim_calls_amount = parsedResponses.length;

                        // Ermittle frühestes und spätestes Datum
                        const date_from = parsedResponses[0]?.date || null;
                        const date_till = parsedResponses[parsedResponses.length - 1]?.date || null;

                        // Endgültiges Ergebnisobjekt
                        const aiResponsesDataObject = {
                            merged_by_date: mergedByDate,
                            interim_call_tokens: interimCallTokens,
                            interim_calls_amount: interimCallsAmount,
                            total_tokens_used: totalTokensUsed,
                            date_from: date_from,
                            date_till: date_till
                        };

                        if (passedInClient.settings.ai_llm_debug === true) {
                            console.log('AI Eval Debug: new json from interim api responses:', aiResponsesDataObject);
                        }

                        const interimDataString = JSON.stringify(aiResponsesDataObject.merged_by_date, null, 2);
                        finalUserPrompt = finalUserPrompt.replace('{{INTERIMAIDATA}}', interimDataString);
                        finalUserPrompt = finalUserPrompt.replace('{{TIMEFROM}}', aiResponsesDataObject.date_from);
                        finalUserPrompt = finalUserPrompt.replace('{{TIMETILL}}', aiResponsesDataObject.date_till);
                        finalUserPrompt = finalUserPrompt.replace('{{DAYS}}', String(aiResponsesDataObject.interim_calls_amount));
                        if (typeof window !== 'undefined') {
                            let profile = window.cgmData.profile;
                            finalUserPrompt = finalUserPrompt.replace('{{PROFILE}}', profile);
                            let response_format = window.response_format;
                        } else {
                            finalUserPrompt = finalUserPrompt.replace('{{PROFILE}}', '_not available_');
                            console.error('No Profile data & response format for final prompt available');
                        }

                        if(!response_format) {
                            console.error('No Response format for final prompt available');
                            return; //can't send without response format
                        }


                        const finalPayload = {
                            model: passedInClient.settings.ai_llm_model || 'gpt-4o',
                            temperature: typeof passedInClient.settings.ai_llm_temperature === 'number' ? passedInClient.settings.ai_llm_temperature : 0.7,
                            max_tokens: typeof passedInClient.settings.ai_llm_max_tokens === 'number' ? passedInClient.settings.ai_llm_max_tokens : 2000,
                            messages: [
                                {role: "system", content: finalSystemPrompt},
                                {role: "user", content: finalUserPrompt}
                            ],
                            response_format: response_format
                        };

                        if (passedInClient.settings.ai_llm_debug === true) {
                            const debugArea = document.getElementById('aiEvalDebugArea');
                            if (debugArea) {
                                debugArea.textContent = 'Final AI Payload (DEBUG):\n\n' + JSON.stringify(finalPayload, null, 2);
                            }
                        }

                        // Store final payload globally for the button click
                        if (typeof window !== 'undefined') {
                            window.currentAiEvalfinalPayload = finalPayload;
                            window.aiResponsesDataObject = aiResponsesDataObject;
                        }

                        $('#ai-system-prompt-status').text('Set').removeClass('ai-setting-value-loading').addClass('ai-setting-value-set');
                        $('#ai-user-prompt-status').text('Set').removeClass('ai-setting-value-loading').addClass('ai-setting-value-set');


                        // Automatically send the final payload to the AI
                        const sendFinalPayload = async () => {
                            const responseOutputArea = document.getElementById('aiResponseOutputArea');
                            const responseDebugArea = document.getElementById('aiEvalResponseDebugArea');
                            const statisticsArea = document.getElementById('aiStatistics');

                            responseOutputArea.innerHTML = '<p>Sending final analysis request to AI...</p>';
                            if (passedInClient.settings.ai_llm_debug === true) {
                                responseDebugArea.textContent = 'Calling final API...';
                            }

                            try {
                                const apiEndpoint = (passedInClient.settings.baseURL || '') + '/api/v1/ai_eval';
                                const requestHeaders = passedInClient.headers ? passedInClient.headers() : {};
                                requestHeaders['Content-Type'] = 'application/json';

                                const finalResponse = await fetch(apiEndpoint, {
                                    method: 'POST',
                                    headers: requestHeaders,
                                    body: JSON.stringify(window.currentAiEvalfinalPayload)
                                });

                                if (!finalResponse.ok) {
                                    const errorText = await finalResponse.text();
                                    throw new Error(`Network response was not ok for final payload. Status: ${finalResponse.status}. Body: ${errorText}`);
                                }

                                const finalData = await finalResponse.json();

                                if (passedInClient.settings.ai_llm_debug === true) {
                                    responseDebugArea.textContent = 'Final AI Response (RAW DEBUG):\n\n' + JSON.stringify(finalData, null, 2);
                                }

                                // Update aiResponsesDataObject
                                if (window.aiResponsesDataObject) {
                                    window.aiResponsesDataObject.total_tokens_used += finalData.tokens_used || 0;
                                    window.aiResponsesDataObject.final_response = finalData.html_content;
                                    window.aiResponsesDataObject.total_calls = (window.aiResponsesDataObject.interim_calls_amount || 0) + 1;
                                    window.aiResponsesDataObject.final_call = 1;

                                    // Display results
                                    responseOutputArea.innerHTML = finalData.html_content;
                                    statisticsArea.innerHTML = `
                                        <h3>Statistics</h3>
                                        <p>Total Tokens Used: ${window.aiResponsesDataObject.total_tokens_used}</p>
                                        <p>Total API Calls: ${window.aiResponsesDataObject.total_calls}</p>
                                        <p>Interim Calls: ${window.aiResponsesDataObject.interim_calls_amount}</p>
                                        <p>Final Call: ${window.aiResponsesDataObject.final_call}</p>
                                    `;
                                }

                            } catch (error) {
                                console.error('AI Eval: Final AI API call failed:', error);
                                responseOutputArea.innerHTML = `<p style="color: red;">Error during final analysis. Please check the console and debug areas for details.</p>`;
                                if (responseDebugArea) {
                                    responseDebugArea.textContent = `--- FINAL CALL ERROR ---\n${error.message}`;
                                }
                            }
                        };

                        sendFinalPayload();


                    },
                    error: function (jqXHR, textStatus, errorThrown) {
                        console.error('AI Eval: Error fetching final prompts:', textStatus, errorThrown);
                        responseOutputArea.innerHTML = `<p style="color: red;">Error fetching final prompts. Cannot construct final payload.</p>`;
                    }
                });
            });
        }
        if (passedInClient.settings.ai_llm_debug === true) {
            console.log('AI Eval: initializeAiEvalTab completed initial UI setup and event listeners.');
        }
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
            $('#ai-system-interim-prompt-status').text('Loading...').removeClass('ai-setting-value-set ai-setting-value-not-set ai-setting-value-waiting').addClass('ai-setting-value-loading');
            $('#ai-user-interim-prompt-status').text('Loading...').removeClass('ai-setting-value-set ai-setting-value-not-set ai-setting-value-waiting').addClass('ai-setting-value-loading');
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

                    const systemInterimPromptIsSet = prompts && prompts.system_interim_prompt && prompts.system_interim_prompt.trim() !== '';
                    const userInterimPromptIsSet = prompts && prompts.user_interim_prompt_template && prompts.user_interim_prompt_template.trim() !== '';
                    const systemPromptIsSet = prompts && prompts.system_prompt && prompts.system_prompt.trim() !== '';
                    const userPromptIsSet = prompts && prompts.user_prompt_template && prompts.user_prompt_template.trim() !== '';

                    $('#ai-system-interim-prompt-status')
                        .text(systemInterimPromptIsSet ? 'Set' : 'Not Set')
                        .removeClass('ai-setting-value-loading')
                        .addClass(systemInterimPromptIsSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set');
                    $('#ai-user-interim-prompt-status')
                        .text(userInterimPromptIsSet ? 'Set' : 'Not Set')
                        .removeClass('ai-setting-value-loading')
                        .addClass(userInterimPromptIsSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set');
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
                        let cgmData = {};
                        let cgmProfile;
                        let debugInterimPayload;

                        if (settings.ai_llm_debug === true) {
                            console.log('AI Eval DEBUG: =================================');
                            console.log('AI Eval DEBUG: datastorage: ', reportData.datastorage);
                            console.log('AI Eval DEBUG: =================================');
                        }

                        const response_format = {
                            type: 'json_schema',
                            json_schema: {
                                name: "DailyAnalysisSchema",
                                schema: {
                                    type: "object",
                                    properties: {
                                        date: {
                                            type: "string",
                                            format: "date",
                                            pattern: "^\\d{4}-\\d{2}-\\d{2}$"
                                        },
                                        summary: { type: "array", items: { type: "string" } },
                                        statistics: { type: "object" },
                                        anomalies: { type: "array", items: { type: "string" } },
                                        dailyPatterns: { type: "object" },
                                        recommendations: { type: "array", items: { type: "string" } },
                                        notes: { type: "array", items: { type: "string" } },
                                        rawAnalysis: { type: "array", items: { type: "string" } }
                                    },
                                    required: ["date"]
                                }
                            }
                        };

                        if (typeof window !== 'undefined') {
                            window.interimPayloads = [];
                            window.response_format = response_format;
                        }


                        const payload = {
                            model: settings.ai_llm_model || 'gpt-4o',
                            temperature: typeof settings.ai_llm_temperature === 'number' ? settings.ai_llm_temperature : 0.7,
                            max_tokens: typeof settings.ai_llm_max_tokens === 'number' ? settings.ai_llm_max_tokens : 2000,
                            response_format: response_format
                        };

                        if (reportData.datastorage) {

                            //Move datastorage content to another var, so we can work with it
                            let datastorageAltered = reportData.datastorage;

                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval DEBUG: datastorageAltered: ', datastorageAltered);
                            }

                            //Move all relevant data to a new object
                            cgmData.numberOfDays = datastorageAltered.alldays;
                            //cgmData.treatments = datastorageAltered.treatments;

                            // Prepare Profile Data
                            function formatProfileMarkdown(profile) {
                                const startDate = new Date(profile.startDate);
                                const dateFormatted = `${String(startDate.getDate()).padStart(2, '0')}.${String(startDate.getMonth() + 1).padStart(2, '0')}.${startDate.getFullYear()}`;
                                const store = profile.store[profile.defaultProfile];

                                const table = (header, rows) => {
                                    return `${header}\n${rows.map(r => `| ${r.join(' | ')} |`).join('\n')}`;
                                };

                                const section = (title, data) => {
                                    const rows = data.map(entry => [entry.time, entry.value]);
                                    return `## ${title}\n${table('| Uhrzeit | Wert |', rows)}\n`;
                                };

                                const rangeSection = (title, lows, highs) => {
                                    const rows = lows.map((low, i) => [low.time, low.value, highs[i]?.value ?? '']);
                                    return `## ${title}\n${table('| Uhrzeit | Ziel niedrig | Ziel hoch |', rows)}\n`;
                                };

                                return [
                                    `# Profil aktiv ab: ${dateFormatted}\n`,
                                    `**Einheit für Blutzuckerwerte:** ${profile.units}\n`,
                                    section('Basalrate (IE/h)', store.basal),
                                    section('Carbratio (g/IE)', store.carbratio),
                                    section('Insulinempfindlichkeit (mg/dl pro IE)', store.sens),
                                    rangeSection('Zielbereich', store.target_low, store.target_high)
                                ].join('\n');
                            }

                            cgmData.profile = formatProfileMarkdown(datastorageAltered.profiles[0]);
                            cgmProfile = cgmData.profile;

                            //Delete all unnecessary Keys from the datastorage altered, so only the days with entries are left
                            const keysToDelete = [
                                'devicestatus'
                                , 'combobolusTreatments'
                                , 'tempbasalTreatments'
                                , 'profileSwitchTreatments'
                                , 'profiles'
                                , 'allstatsrecords'
                                , 'alldays'
                                , 'treatments'
                                , 'allstatsrecords'
                            ];

                            for (const key of keysToDelete) {
                                delete datastorageAltered[key];
                            }

                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval DEBUG: =================================');
                                console.log('AI Eval DEBUG: datastorageAltered after deleting keys: ', datastorageAltered);
                                console.log('AI Eval DEBUG: cgmData: ', cgmData);
                                console.log('AI Eval DEBUG: =================================');
                            }

                            //Now we move through the remaining entries in datastorageAltered which cover every day
                            cgmData.days = [];
                            let dates = [];

                            // => cgmData.days
                            for (const [key, value] of Object.entries(datastorageAltered)) {

                                if (settings.ai_llm_debug === true) {
                                    console.log('AI Eval DEBUG KEY: ', key);
                                    console.log('AI Eval DEBUG Value: ', value);
                                    console.log('AI Eval DEBUG -------');
                                }

                                let day = {};

                                day.date = key;
                                dates.push(new Date(key).getTime());

                                day.totalCarbs = value.dailyCarbs;
                                day.totalBolus = 0;
                                day.treatments = [];

                                if (Array.isArray(value.treatments) && value.treatments.length > 0) {

                                    for (let i = 0; i < value.treatments.length; i++) {
                                        //console.log(value.treatments[i]);
                                        let treatment = {};

                                        const keys = ['mills', 'carbs', 'insulin', 'notes'];
                                        const source = value.treatments[i];

                                        for (const k of keys) {
                                            if (source[k] != null) {
                                                treatment[k] = source[k];
                                                if (k === 'insulin') {
                                                    day.totalBolus = day.totalBolus + source[k];
                                                }
                                            }
                                        }

                                        if (settings.ai_llm_debug === true) {
                                            //console.log('AI Eval DEBUG: treatment #',i, ' ' , treatment);
                                        }

                                        day.treatments.push(treatment);

                                    }

                                }

                                day.entries = [];

                                if (Array.isArray(value.sgv) && value.sgv.length > 0) {

                                    //@TODO IF NECESSARY: REDUCE AMOUNT OF DATA BY SUBMITTING THE AVERAGE OF 3 ENTRIES

                                    for (let i = 0; i < value.sgv.length; i++) {
                                        let entry = {};
                                        //console.log(value.treatments[i]);

                                        const keys = ['mills', 'sgv'];
                                        const source = value.sgv[i];

                                        for (const k of keys) {
                                            if (source[k] != null) {
                                                entry[k] = source[k];
                                            }
                                        }

                                        if (settings.ai_llm_debug === true) {
                                            //console.log('AI Eval DEBUG: entry #',i, ' ' , entry);
                                        }

                                        if (entry.mills) {
                                            day.entries.push(entry);
                                        }

                                    }


                                }


                                cgmData.days.push(day);

                            }

                            function dateToDDMMYYYY(date) {
                                const dd = String(date.getDate()).padStart(2, '0');
                                const mm = String(date.getMonth() + 1).padStart(2, '0'); // Monate: 0-basiert
                                const yyyy = date.getFullYear();

                                return `${dd}.${mm}.${yyyy}`;
                            }

                            cgmData.dateFrom = new Date(Math.min(...dates));
                            cgmData.dateTill = new Date(Math.max(...dates));
                            cgmData.dateFrom = dateToDDMMYYYY(cgmData.dateFrom);
                            cgmData.dateTill = dateToDDMMYYYY(cgmData.dateTill);

                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval DEBUG: =================================');
                                console.log('AI Eval DEBUG: dates: ', dates);
                                console.log('AI Eval DEBUG: cgmData with entries & treatments: ', cgmData);
                                console.log('AI Eval DEBUG: =================================');
                            }

                            // Refactor the days to be sent as single requests
                            function generateMarkdownFromDays(days) {
                                return days.map(day => {
                                    return generateMarkdownFromDay(day);
                                }).join('\n\n---\n\n'); // Trennlinie zwischen Tagen
                            }

                            function generateMarkdownFromDay(day) {
                                const pad = (v) => (v == null ? '' : v);

                                let md = `# ${day.date}\n\n`;

                                // Statistik
                                md += `## Statistik\n`;
                                md += `- Total Carbs: ${day.totalCarbs}\n`;
                                md += `- Total Bolus: ${day.totalBolus}\n\n`;

                                // Treatments
                                md += `## Treatments\n`;
                                if (Array.isArray(day.treatments) && day.treatments.length > 0) {
                                    md += `| Zeit (mills) | Carbs | Insulin | Notes |\n`;
                                    md += `|--------------|-------|---------|-------|\n`;
                                    for (const t of day.treatments) {
                                        md += `| ${pad(t.mills)} | ${pad(t.carbs)} | ${pad(t.insulin)} | ${pad(t.notes)} |\n`;
                                    }
                                } else {
                                    md += `_keine Treatments_\n`;
                                }
                                md += `\n`;

                                // Entries
                                md += `## Blutzuckerwerte (entries)\n`;
                                if (Array.isArray(day.entries) && day.entries.length > 0) {
                                    md += `| Zeit (mills) | SGV |\n`;
                                    md += `|--------------|-----|\n`;
                                    for (const e of day.entries) {
                                        md += `| ${e.mills} | ${e.sgv} |\n`;
                                    }
                                } else {
                                    md += `_keine Einträge_\n`;
                                }

                                return md;
                            }

                            let userInterimPromptContent = prompts.user_interim_prompt_template || "Analyze the following CGM data: {{CGMDATA}} using this profile: {{PROFILE}}";
                            let systemInterimPromptContent = prompts.system_interim_prompt || "You are a helpful assistant.";

                            userInterimPromptContent = userInterimPromptContent.replace('{{PROFILE}}', cgmProfile);

                            let interimPayloads = [];

                            // Create Interim Payloads
                            for (let i = 0; i < cgmData.days.length; i++) {
                                let interimPayload = {};
                                interimPayload = { ...payload };
                                interimPayload.messages = [];

                                let tempUserPromptContent = '';
                                tempUserPromptContent = userInterimPromptContent.replace('{{CGMDATA}}', generateMarkdownFromDay(cgmData.days[i]));
                                tempUserPromptContent = tempUserPromptContent.replace('{{DATE}}', cgmData.days[i].date);

                                if (settings.ai_llm_debug === true) {
                                    console.log('AI Eval DEBUG: ---------------------------------');
                                    console.log('AI Eval DEBUG: Date: ', cgmData.days[i].date);
                                    console.log('AI Eval DEBUG: Interim Payloads Markdown for current Day: ', generateMarkdownFromDay(cgmData.days[i]).slice(0, 50) + "...");
                                    console.log('AI Eval DEBUG: tempUserPromptContent: ', tempUserPromptContent.slice(0, 150) + "...");
                                    console.log('AI Eval DEBUG: interimPayload before adding messages: ', interimPayload);
                                }

                                interimPayload.messages = [
                                    {role: "system", content: systemInterimPromptContent},
                                    {role: "user", content: tempUserPromptContent}
                                ];

                                interimPayloads.push(interimPayload)

                                if (settings.ai_llm_debug === true) {
                                    console.log('AI Eval DEBUG: interimPayload AFTER adding messages: ', interimPayload);
                                    console.log('AI Eval DEBUG: ---------------------------------');
                                }

                            }

                            if (typeof window !== 'undefined') {
                                window.interimPayloads = interimPayloads;
                                window.cgmData = cgmData;
                            }

                            if (settings.ai_llm_debug === true) {
                                console.log('AI Eval DEBUG: =================================');
                                console.log('AI Eval DEBUG: Interim Payloads per Day: ', window.interimPayloads);
                                console.log('AI Eval DEBUG: =================================');
                            }

                            debugInterimPayload = JSON.stringify(window.interimPayloads, null, 2);

                            // Final payload is NOT created here anymore.
                            // Update status texts to reflect this.
                            $('#ai-system-prompt-status').text('Waiting for interim calls...').addClass('ai-setting-value-loading');
                            $('#ai-user-prompt-status').text('Waiting for interim calls...').addClass('ai-setting-value-loading');
                        }

                        // Clear any previous final payload
                        if (typeof window !== 'undefined') {
                            delete window.currentAiEvalfinalPayload;
                        }

                        if (settings.ai_llm_debug === true) {
                            const debugAreaInterim = document.getElementById('aiEvalInterimDebugArea');
                            if (debugAreaInterim) {
                                debugAreaInterim.textContent = 'AI INTERIM PROMPT PAYLOADS (DEBUG):\n\n' + debugInterimPayload;
                                console.log('AI Eval: Interim Payloads displayed in debug area.');
                            }

                            const debugArea = document.getElementById('aiEvalDebugArea');
                            if (debugArea) {
                                debugArea.textContent = 'Final payload will be constructed after interim calls are complete.';
                            }
                        }
                    } else {
                        console.warn('AI Eval: Report data (datastorage) became unavailable before finalPayload construction in success callback.');
                        if (typeof window !== 'undefined') {
                            delete window.currentAiEvalfinalPayload; // Clear potentially stale payload
                        }
                        if (settings.ai_llm_debug === true) {
                            const debugArea = document.getElementById('aiEvalDebugArea');
                            if (debugArea) {
                                debugArea.textContent = 'AI PROMPT FINAL PAYLOAD (DEBUG):\n\nReport data (datastorage) was not available when prompts were fetched or became null. Cannot construct full final payload.';
                            }
                        }
                    }
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    console.error('AI Eval: Error fetching AI prompts:', textStatus, errorThrown);
                    if (typeof window !== 'undefined') {
                        delete window.currentAiEvalfinalPayload; // Clear final payload on error
                    }
                    $('#ai-system-prompt-status').text('Error').removeClass('ai-setting-value-loading').addClass('ai-setting-value-not-set');
                    $('#ai-user-prompt-status').text('Error').removeClass('ai-setting-value-loading').addClass('ai-setting-value-not-set');
                    $('#ai-system-interim-prompt-status').text('Error').removeClass('ai-setting-value-loading').addClass('ai-setting-value-not-set');
                    $('#ai-user-interim-prompt-status').text('Error').removeClass('ai-setting-value-loading').addClass('ai-setting-value-not-set');
                    if (settings.ai_llm_debug === true) {
                        const debugInterimArea = document.getElementById('aiEvalInterimDebugArea');
                        if (debugInterimArea) {
                            debugInterimArea.textContent = 'AI PROMPT Interim PAYLOAD (DEBUG):\n\nFailed to fetch system/user prompts. Cannot construct Interim payload.';
                        }

                        const debugArea = document.getElementById('aiEvalDebugArea');
                        if (debugArea) {
                            debugArea.textContent = 'AI PROMPT FINAL PAYLOAD (DEBUG):\n\nFailed to fetch system/user prompts. Cannot construct final payload.';
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
                delete window.currentAiEvalfinalPayload; // Clear payload if jQuery is missing
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


            if(originalClient && originalClient.settings.ai_llm_debug === true){
                console.log('AI Eval: HTML function called. Original client:', originalClient);
                //console.log('AI Eval DEBUG Settings original client:', originalClient.settings)
            }

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
        
          <div id="aiEvalInterimDebugArea" style="margin-top: 20px;">
            <!-- Debug content will be injected here -->
          </div>
          
          <div id="aiEvalInterimResponseDebugArea" style="margin-top: 20px;">
            <!-- Response Debug content will be injected here -->
          </div>
        
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
    #aiEvalInterimDebugArea {
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
      #aiEvalInterimResponseDebugArea {
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
            console.log('AI Eval: REPORT function called. Data received:', !!datastorage, 'Options Report Name:', options ? options.reportName : 'N/A');

            if (typeof window !== 'undefined') {
                // 1. Reset all AI-related data and UI elements
                console.log('AI Eval: Resetting AI data and UI from report function.');

                // Reset global variables
                window.interimPayloads = [];
                window.interimResponses = [];
                window.aiResponsesDataObject = {}; // Clear the main data object
                if (window.currentAiEvalfinalPayload) {
                    delete window.currentAiEvalfinalPayload;
                }

                // Reset UI Elements
                const responseOutputArea = document.getElementById('aiResponseOutputArea');
                if (responseOutputArea) responseOutputArea.innerHTML = 'Awaiting new data...';

                const statisticsArea = document.getElementById('aiStatistics');
                if (statisticsArea) statisticsArea.innerHTML = '';

                const interimDebugArea = document.getElementById('aiEvalInterimDebugArea');
                if (interimDebugArea) interimDebugArea.textContent = 'Awaiting report data processing...';

                const interimResponseDebugArea = document.getElementById('aiEvalInterimResponseDebugArea');
                if (interimResponseDebugArea) interimResponseDebugArea.textContent = 'Awaiting interim AI call...';

                const debugArea = document.getElementById('aiEvalDebugArea');
                if (debugArea) debugArea.textContent = 'Awaiting report data processing...';

                const responseDebugArea = document.getElementById('aiEvalResponseDebugArea');
                if(responseDebugArea) responseDebugArea.textContent = 'AI Response Debug Area: Waiting for AI call...';


                // 2. Store new data for processing
                window.tempAiEvalReportData = {
                    datastorage: datastorage,
                    options: options,
                    sorteddaystoshow: sorteddaystoshow
                };
                console.log('AI Eval: Stored new datastorage, options, and sorteddaystoshow on window.tempAiEvalReportData.');

                // 3. Call the processor for the new data
                if (typeof window.processAiEvaluationData === 'function') {
                    console.log('AI Eval: Calling window.processAiEvaluationData from report function.');
                    setTimeout(function () {
                        window.processAiEvaluationData();
                    }, 0); // Timeout to ensure DOM updates apply before processing starts
                } else {
                    console.error('AI Eval: window.processAiEvaluationData is not defined. Cannot process new data.');
                }

            } else {
                console.error('AI Eval: window object not available in REPORT function. Cannot store report data or call processor.');
            }
        }
    };

    return aiEvalPlugin;
}

module.exports = init;