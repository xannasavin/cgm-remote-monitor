'use strict';

// AI Evaluation plugin - Establishing reliable client access

function init(ctx) {
    // This function will be called by the embedded script when the tab is loaded.
    // Its primary role is to set up the initial UI elements and store the client object.
    function initializeAiEvalTab(passedInClient) {

        if (passedInClient.settings.ai_llm_debug === true) {
            console.log('AI Eval: initializeAiEvalTab called. Received client:', passedInClient);
        }

        if (typeof window !== 'undefined') {
            // Store passedInClient for processAiEvaluationData to use
            window.aiEvalClient = passedInClient;
            if (passedInClient.settings.ai_llm_debug === true) {
                console.log('AI Eval: Stored passedInClient on window.aiEvalClient');
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

        const defaultDisplayMode = settings.ai_llm_default_display || 'Show all results';
        const displayModeDropdown = document.getElementById('aiResponseDisplayMode');
        if (displayModeDropdown) {
            displayModeDropdown.value = defaultDisplayMode;
        }

        function toggleDebugArea(id, message, debugEnabled) {
            const el = document.getElementById(id);
            if (!el) return;

            if (debugEnabled) {
                el.style.display = 'block';
                el.textContent = message;
            } else {
                el.style.display = 'none';
            }
        }

        const debugEnabled = settings.ai_llm_debug === true;

        toggleDebugArea(
            'aiEvalDebugArea',
            'Awaiting report data processing... Click "Show" for the AI Evaluation report if not already done.',
            debugEnabled
        );

        toggleDebugArea(
            'aiEvalInterimDebugArea',
            'Awaiting report data processing...',
            debugEnabled
        );

        toggleDebugArea(
            'aiEvalInterimResponseDebugArea',
            'Awaiting interim AI call...',
            debugEnabled
        );

        toggleDebugArea(
            'aiEvalResponseDebugArea',
            'AI Response Debug Area: Waiting for AI call...',
            debugEnabled
        );

        /**
         * Unified CGM Report Renderer
         * - Auto-detects Daily vs Multi-Day schema
         * - Plain JS, framework-agnostic
         * - Renders accessible HTML with headings, lists, and tables
         */

        function renderCgmReport(data, mount) {
            const el = typeof mount === 'string' ? document.querySelector(mount) : mount;
            if (!el) throw new Error('Mount element not found');

            const isMultiDay = !!data.period; // final schema has "period"
            el.innerHTML = isMultiDay ? renderMultiDay(data) : renderDaily(data);
        }

        const unifiedCss = `
              <style>
                    .cgm-wrap {
                      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
                      max-width: 1024px;
                      min-width: 60%;
                      margin: auto;
                      line-height: 1.45;
                    }
                    .cgm-wrap h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
                    .cgm-wrap h2 { font-size: 1.2rem; margin: 1.2rem 0 .6rem; }
                    .cgm-wrap h3 { font-size: 1rem; margin: 1rem 0 .5rem; color: #333; }
                    
                    .cgm-table {
                      width: 100%;
                      border-collapse: collapse;
                      font-size: .95rem;
                    }
                    .cgm-table th,
                    .cgm-table td {
                      border: 1px solid #e5e7eb;
                      padding: .5rem .6rem;
                      text-align: left;
                      vertical-align: top;
                    }
                    .cgm-table thead th {
                      background: #f8fafc;
                      font-weight: 600;
                    }
                    
                    ul { padding-left: 1.2rem; margin: .2rem 0; }
                    .cgm-meta { color: #555; font-size: .9rem; }
                    
                    .cgm-grid-2col, .cgm-grid-3col {
                      display: grid;
                      grid-template-columns: 1fr;
                      gap: 1rem;
                    }
                    .cgm-wrap section.final-response-overall-statistic table,
                    .cgm-wrap section.final-response-diurnal-patterns table,
                    .cgm-wrap section.final-response-episodes table {
                      width: auto;
                    }
                    @media (min-width: 900px) {
                      .cgm-grid-2col { grid-template-columns: repeat(2, 1fr); }
                      .cgm-grid-3col { grid-template-columns: repeat(3, 1fr); }
                    }
                    
                    .ai-accordion .accordion-button {
                      background-color: #eee;
                      color: #444;
                      cursor: pointer;
                      padding: 18px;
                      width: 100%;
                      border: none;
                      text-align: left;
                      outline: none;
                      font-size: 1.6rem;
                      transition: 0.4s;
                      margin-top: 10px;
                    }
                    .ai-accordion .active,
                    .ai-accordion .accordion-button:hover {
                      background-color: #ccc;
                    }
                    .ai-accordion .accordion-button h1 {
                      margin: 0;
                      font-size: 1.6rem;
                    }
                    .ai-accordion .accordion-panel {
                      padding: 0 18px;
                      background-color: white;
                      display: none;
                      overflow: hidden;
                    }
                    .ai-accordion .accordion-panel.show {
                      display: block;
                    }
                    
                </style>    
            `;

        /* ---------- Utilities ---------- */

        const fmt = (val, unit = '', decimals = 1) =>
            val === null || val === undefined || Number.isNaN(val)
                ? '-'
                : `${Number(val).toFixed(decimals)}${unit}`;

        const list = (items = []) =>
            `<ul>${(items || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;

        function escapeHtml(s) {
            return String(s)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        function table({head, rows}) {
            return `
              <table class="cgm-table" role="table">
                <thead><tr>${head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>
                <tbody>
                  ${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}
                </tbody>
              </table>`;
        }

        /* ---------- Daily (Interim) ---------- */

        function renderDaily(d) {
            const stats = d.statistics || {};
            const blocks = d.dailyPatterns || {};

            const statsTable = table({
                head: ['Metric', 'Value'],
                rows: [
                    ['Average Glucose', fmt(stats.average_glucose_mgdl, ' mg/dL')],
                    ['Median Glucose', fmt(stats.median_glucose_mgdl, ' mg/dL')],
                    ['Standard Deviation', fmt(stats.standard_deviation_mgdl, ' mg/dL')],
                    ['CV', fmt(stats.cv_percent, ' %')],
                    ['MAGE', fmt(stats.mage_mgdl, ' mg/dL')],
                    ['Time in Range', fmt(stats.time_in_range_percent, ' %')],
                    ['Time Below Range', fmt(stats.time_below_range_percent, ' %')],
                    ['Time Above Range', fmt(stats.time_above_range_percent, ' %')],
                    ['Hypo Episodes', escapeHtml(stats.number_of_hypo_episodes ?? '-')],
                    ['Hyper Episodes', escapeHtml(stats.number_of_hyper_episodes ?? '-')],
                    ['Longest Hypo', stats.longest_hypo_min != null ? `${stats.longest_hypo_min} min` : '-'],
                    ['Longest Hyper', stats.longest_hyper_min != null ? `${stats.longest_hyper_min} min` : '-']
                ]
            });

            const patternRows = ['00-06', '06-12', '12-18', '18-24'].map((b) => {
                const v = blocks[b] || {};
                return [
                    b,
                    fmt(v.avg, ' mg/dL'),
                    fmt(v.sd, ' mg/dL'),
                    fmt(v.below_pct, ' %'),
                    fmt(v.in_range_pct, ' %'),
                    fmt(v.above_pct, ' %')
                ];
            });

            const patternsTable = table({
                head: ['Time Block', 'Avg', 'SD', 'Below %', 'In Range %', 'Above %'],
                rows: patternRows
            });

            const anomaliesList = list(
                (d.anomalies || []).map((a) => {
                    const base = `${a.type} ${a.start_local}–${a.end_local} (${a.duration_min ?? '-'} min)`;
                    if (a.type === 'hypoglycemia' && a.nadir_mgdl != null) return `${base}; nadir ${a.nadir_mgdl} mg/dL`;
                    if (a.type === 'hyperglycemia' && a.peak_mgdl != null) return `${base}; peak ${a.peak_mgdl} mg/dL`;
                    return base;
                })
            );

            return `
              <div class="cgm-wrap">
                <h1>Daily CGM Report — ${escapeHtml(d.date || '')}</h1>
                <div class="cgm-grid-2col">
                  <section>
                    <h2>Summary</h2>
                    ${list(d.summary || [])}
                    <h2>Statistics</h2>
                    ${statsTable}
                  </section>
                  <section>
                    <h2>Daily Patterns</h2>
                    ${patternsTable}
                    <h2>Anomalies</h2>
                    ${anomaliesList}
                  </section>
                </div>

                <section>
                  <h2>Recommendations</h2>
                  ${list(d.recommendations || [])}
                </section>

                <section>
                  <h2>Data Quality Notes</h2>
                  ${list(d.data_quality_notes || d.notes || [])}
                  ${d.meta ? `<p class="cgm-meta">Units: ${escapeHtml(d.meta.units || 'mg/dL')} · Target ${escapeHtml(String(d.meta.target_low_mgdl ?? ''))}–${escapeHtml(String(d.meta.target_high_mgdl ?? ''))} mg/dL</p>` : ''}
                </section>
              </div>
              `;
        }

        /* ---------- Multi-Day (Final) ---------- */

        function renderMultiDay(d) {
            const stats = d.overall_statistics || {};
            const blocks = d.diurnal_patterns || {};
            const episodes = d.episodes || {};

            const statsTable = table({
                head: ['Metric', 'Value'],
                rows: [
                    ['Average Glucose', fmt(stats.average_glucose_mgdl, ' mg/dL')],
                    ['Median Glucose', fmt(stats.median_glucose_mgdl, ' mg/dL')],
                    ['Standard Deviation', fmt(stats.standard_deviation_mgdl, ' mg/dL')],
                    ['CV', fmt(stats.cv_percent, ' %')],
                    ['MAGE Overall', fmt(stats.mage_overall_mgdl, ' mg/dL')],
                    ['Time in Range', fmt(stats.time_in_range_percent, ' %')],
                    ['Time Below Range', fmt(stats.time_below_range_percent, ' %')],
                    ['Time Above Range', fmt(stats.time_above_range_percent, ' %')]
                ]
            });

            const patternsTable = table({
                head: ['Time Block', 'Avg', 'SD', 'Below %', 'In Range %', 'Above %'],
                rows: ['00-06', '06-12', '12-18', '18-24'].map((b) => {
                    const v = blocks[b] || {};
                    return [
                        b,
                        fmt(v.avg, ' mg/dL'),
                        fmt(v.sd, ' mg/dL'),
                        fmt(v.below_pct, ' %'),
                        fmt(v.in_range_pct, ' %'),
                        fmt(v.above_pct, ' %')
                    ];
                })
            });

            const epiTable = table({
                head: ['Type', 'Count', 'Total Minutes', 'Longest (min)', '00–06', '06–12', '12–18', '18–24'],
                rows: ['hypoglycemia', 'hyperglycemia'].map((t) => {
                    const e = episodes[t] || {};
                    const by = (e.by_block || {});
                    return [
                        t,
                        escapeHtml(e.count ?? '-'),
                        escapeHtml(e.total_minutes ?? '-'),
                        escapeHtml(e.longest_min ?? '-'),
                        escapeHtml(by['00-06'] ?? '-'),
                        escapeHtml(by['06-12'] ?? '-'),
                        escapeHtml(by['12-18'] ?? '-'),
                        escapeHtml(by['18-24'] ?? '-')
                    ];
                })
            });

            const perDayTable = table({
                head: ['Date', 'Avg', 'CV %', 'TIR %', 'TBR %', 'TAR %', 'Hypo Ep.', 'Hyper Ep.', 'Notes'],
                rows: (d.per_day || []).map((x) => [
                    escapeHtml(x.date || ''),
                    fmt(x.average_glucose_mgdl, ' mg/dL'),
                    fmt(x.cv_percent, ' %'),
                    fmt(x.tir_percent, ' %'),
                    fmt(x.tbr_percent, ' %'),
                    fmt(x.tar_percent, ' %'),
                    escapeHtml(x.hypo_episodes ?? '-'),
                    escapeHtml(x.hyper_episodes ?? '-'),
                    escapeHtml((x.notes || []).join('; '))
                ])
            });

            const rec = d.recommendations || {};
            const recHtml = `
                <div class="cgm-grid-3col">
                  <section>
                    <h3>Therapy Settings</h3>${list(rec.therapy_settings || [])}
                  </section>
                  <section>
                    <h3>Behavioral Timing</h3>${list(rec.behavioral_timing || [])}
                  </section>
                  <section>
                    <h3>Monitoring</h3>${list(rec.monitoring || [])}
                  </section>
                </div>
              `;

            return `
              <div class="cgm-wrap">
                <h1>Multi‑Day CGM Report — ${escapeHtml((d.period?.from || '') + ' – ' + (d.period?.to || ''))}</h1>
                <p class="cgm-meta">${escapeHtml(String(d.period?.days ?? ''))} days total</p>

                <section>
                  <h2>Summary</h2>
                  ${list(d.summary || [])}
                </section>

                <section class="final-response-overall-statistic">
                  <h2>Overall Statistics</h2>
                  ${statsTable}
                </section>
                <section class="final-response-diurnal-patterns">
                  <h2>Diurnal Patterns</h2>
                  ${patternsTable}
                </section>
                <section class="final-response-episodes">
                  <h2>Episodes</h2>
                  ${epiTable}
                </section>

                <section>
                  <h2>Trends</h2>
                  ${list((d.trends || []).map(t => `${t.label}: ${t.evidence}`))}
                </section>

                <section>
                  <h2>Recommendations</h2>
                  ${recHtml}
                </section>

                <section>
                  <h2>Daily Breakdown</h2>
                  ${perDayTable}
                </section>

                <section>
                  <h2>Data Quality Notes</h2>
                  ${list(d.data_quality_notes || [])}
                  ${d.meta ? `<p class="cgm-meta">Units: ${escapeHtml(d.meta.units || 'mg/dL')} · Target ${escapeHtml(String(d.meta.target_low_mgdl ?? ''))}–${escapeHtml(String(d.meta.target_high_mgdl ?? ''))} mg/dL · Aggregation: ${escapeHtml(d.meta.aggregation || '')}</p>` : ''}
                </section>
              </div>
              `;
        }

        const sendButton = document.getElementById('sendToAiButton');
        if (sendButton) {

            async function callAiWithRetry(payload, retries = 2) {
                const apiEndpoint = (passedInClient.settings.baseURL || '') + '/api/v1/ai_eval';
                const requestHeaders = passedInClient.headers ? passedInClient.headers() : {};
                requestHeaders['Content-Type'] = 'application/json';

                if (passedInClient.settings.ai_llm_debug === true) {
                    console.log(`AI Eval: Sending payload (retries left: ${retries}):`, JSON.stringify(payload, null, 2));
                }

                const response = await fetch(apiEndpoint, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Network response was not ok. Status: ${response.status}. Body: ${errorText}`);
                }

                const data = await response.json();
                const usage = data.usage || {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0};
                window.accumulatedInterimTokens.prompt_tokens += usage.prompt_tokens;
                window.accumulatedInterimTokens.completion_tokens += usage.completion_tokens;
                window.accumulatedInterimTokens.total_tokens += usage.total_tokens;

                try {
                    // First, try to clean up the response by removing markdown fences
                    const cleanedContent = data.html_content.trim().replace(/^```json\s*/, '').replace(/```$/, '').trim();
                    // Now, try to parse the cleaned content
                    JSON.parse(cleanedContent);
                    // If parsing succeeds, return the original data object, as it's what we need to store
                    return data;
                } catch (e) {
                    if (retries > 0) {
                        if (passedInClient.settings.ai_llm_debug === true) {
                            console.warn(`AI Eval: JSON parsing failed. Retrying... (${retries} retries left)`);
                            console.warn(`AI Eval: Invalid JSON content:`, data.html_content);
                        }
                        window.aiRepairCalls = (window.aiRepairCalls || 0) + 1;

                        const repairPayload = {
                            ...payload, // a-i-llm_model, temperature, etc.
                            messages: [
                                {
                                    role: "system",
                                    content: "Return the same content as valid JSON only; fix any trailing commas/quotes/NaNs; do not add text."
                                },
                                {
                                    role: "user",
                                    content: data.html_content // The invalid JSON string
                                }
                            ]
                        };
                        return callAiWithRetry(repairPayload, retries - 1);
                    } else {
                        console.error("AI Eval: JSON parsing failed after multiple retries.");
                        throw new Error("Failed to parse JSON response from AI after retries.");
                    }
                }
            }

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
                window.parsedInterimResponses = []; // Reset parsed responses
                window.aiRepairCalls = 0; // Reset repair counter
                window.accumulatedInterimTokens = {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                };

                const interimResponseDebugArea = document.getElementById('aiEvalInterimResponseDebugArea');
                const responseOutputArea = document.getElementById('aiResponseOutputArea');

                interimResponseDebugArea.textContent = ''; // Clear previous debug content
                responseOutputArea.innerHTML = ''; // Clear output area at the beginning

                const totalPayloads = window.interimPayloads.length;
                responseOutputArea.innerHTML = `<p>Starting analysis for ${totalPayloads} days...</p>`;

                for (let i = 0; i < totalPayloads; i++) {


                    const payload = window.interimPayloads[i];
                    const statusMsg = `Processing day ${i + 1} of ${totalPayloads}...`;
                    console.log(`AI Eval: ${statusMsg}`);
                    button.textContent = `Sending (${i + 1}/${totalPayloads})...`;
                    responseOutputArea.innerHTML = `<p>${statusMsg}</p>`;


                    try {
                        const data = await callAiWithRetry(payload);
                        window.interimResponses.push(data);

                        // Always parse and store the interim response for later rendering
                        try {
                            const cleanedContent = data.html_content.trim().replace(/^```json\s*/, '').replace(/```$/, '').trim();
                            const parsedJson = JSON.parse(cleanedContent);
                            window.parsedInterimResponses.push(parsedJson);
                        } catch (parseError) {
                            console.error(`AI Eval: Error parsing interim response for day ${i + 1}:`, parseError);
                            // Optionally store an error object instead
                            window.parsedInterimResponses.push({
                                error: `Failed to parse response for day ${i + 1}`,
                                content: data.html_content
                            });
                        }


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
                button.textContent = 'Final call...';
                // Keep button disabled, will be re-enabled in sendFinalPayload's finally block.

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

                        const dummyFinalSystemPrompt = "You are an endocrinologist specialized in type 1 diabetes and Nightscout analytics. Your task is to synthesize multiple single-day analyses (already standardized JSON) plus the Nightscout profile.\n" +
                            "\n" +
                            "CONDUCT\n" +
                            "- Medical terminology only. Evidence-based. No generalities.\n" +
                            "- No hallucinations; if data insufficient, state explicitly.\n" +
                            "- Output strictly valid JSON (no markdown; no commentary).\n" +
                            "\n" +
                            "AGGREGATION RULES\n" +
                            "- Inputs: array of daily JSON objects (exact schema from interim step), covering {{DAYS}} days for {{TIMEFROM}}–{{TIMETILL}}.\n" +
                            "- Overall metrics:\n" +
                            "  • Averages/SD/CV computed on pooled time-weighted series if available; otherwise weight by each day’s valid time.\n" +
                            "  • TIR/TBR/TAR: time-weighted across all valid intervals; exclude gaps >15 min.\n" +
                            "  • MAGE_overall: if ≥60% of days have valid MAGE, compute median of per-day MAGE; else null with note.\n" +
                            "- Episodes: merge across midnight if separation <15 min. Provide counts & durations by (a) total, (b) diurnal blocks, and (c) weekday vs weekend if possible from timestamps.\n" +
                            "- Diurnal patterns: aggregate by local time of day; report avg, SD, and %below/in/above for each 6-hour block.\n" +
                            "- Trend detection:\n" +
                            "  • Nocturnal hypoglycemia signature: ≥2 days with hypo episodes 00–06 totaling ≥30 min/day.\n" +
                            "  • Dawn phenomenon: pre-breakfast rise (≈03:00–08:00) with no carbs/bolus within prior 3h on ≥2 days, and 2h mean > target_high.\n" +
                            "  • Postprandial hyperglycemia: peaks >180 within 1–3h after carb entries on ≥2 days.\n" +
                            "  • Persistent hyperglycemia: >50% time >180 on ≥3 days.\n" +
                            "- Recommendations must be tied to quantified evidence (reference blocks, % out of range, episode stats). Separate “therapy_settings” (basal/I:C/ISF/DIA) vs “behavioral_timing” (bolus timing, meal timing, exercise).\n" +
                            "\n" +
                            "OUTPUT\n" +
                            "- Use the exact schema provided via the user prompt. Valid JSON only.\n";

                        const dummyFinalUserPrompt = "Synthesize the following daily analyses for {{TIMEFROM}}–{{TIMETILL}} ({{DAYS}} days):\n" +
                            "\n" +
                            "{{INTERIMAIDATA}}\n" +
                            "\n" +
                            "Profile for context:\n" +
                            "{{PROFILE}}\n" +
                            "\n" +
                            "OBJECTIVES\n" +
                            "- Abnormalities & trends across days (hypo/hyper timing, frequency, duration, patterns).\n" +
                            "- Variability (SD, CV, MAGE_overall if feasible).\n" +
                            "- Diurnal patterns (00–06, 06–12, 12–18, 18–24).\n" +
                            "- Therapy adjustment suggestions: basal, I:C, ISF, DIA; timing issues; lifestyle factors.\n" +
                            "- Additional: TIR/TBR/TAR; sensor failures/data gaps; alarm exposure (if present); loop behavior (if present).\n" +
                            "\n" +
                            "RETURN FORMAT\n" +
                            "Return **only** valid JSON (no backticks, no text), matching the following schema and keys:\n" +
                            "\n" +
                            "{{FINALRETURNFORMAT}}\n";


                        let finalSystemPrompt = prompts.system_prompt || dummyFinalSystemPrompt;
                        let finalUserPrompt = prompts.user_prompt_template || dummyFinalUserPrompt;

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
                                        usage: response.usage
                                    };
                                }
                            } catch (e) {
                                console.error('AI Eval: Error parsing html_content to JSON:', e);
                                return {
                                    error: 'Failed to parse html_content',
                                    original_content: response.html_content,
                                    usage: response.usage
                                };
                            }
                            return null;
                        }).filter(Boolean); // Filtere null-Werte (falls Parsing oder Bedingungen fehlschlagen)

                        const parsedResponses = [];
                        let interimCallsAmount = 0;

                        for (const response of window.interimResponses) {
                            try {
                                if (
                                    response &&
                                    response.html_content &&
                                    typeof response.html_content === 'string'
                                ) {
                                    const raw = response.html_content.trim();
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
                                    interimCallsAmount++;
                                }
                            } catch (e) {
                                console.error('Error parsing or processing interim response:', e);
                            }
                        }

                        const interimCallTokens = window.accumulatedInterimTokens.total_tokens;
                        const totalPromptTokens = window.accumulatedInterimTokens.prompt_tokens;
                        const totalCompletionTokens = window.accumulatedInterimTokens.completion_tokens;
                        const totalTokensUsed = window.accumulatedInterimTokens.total_tokens;

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
                            prompt_tokens_used: totalPromptTokens,
                            completion_tokens_used: totalCompletionTokens,
                            date_from: date_from,
                            date_till: date_till
                        };

                        if (passedInClient.settings.ai_llm_debug === true) {
                            console.log('AI Eval Debug: new json from interim api responses:', aiResponsesDataObject);
                        }

                        function replacePlaceholders(template, replacements) {
                            for (const [key, value] of Object.entries(replacements)) {
                                template = template.replace(key, value);
                            }
                            return template;
                        }

                        // Base replacements
                        let replacements = {
                            '{{INTERIMAIDATA}}': JSON.stringify(aiResponsesDataObject.merged_by_date, null, 2),
                            '{{TIMEFROM}}': aiResponsesDataObject.date_from,
                            '{{TIMETILL}}': aiResponsesDataObject.date_till,
                            '{{DAYS}}': String(aiResponsesDataObject.interim_calls_amount),
                        };

                        // Add profile and response format depending on environment
                        let final_response_format;

                        if (typeof window !== 'undefined') {
                            let profile = window.cgmData.profile;
                            final_response_format = window.final_response_format;

                            replacements['{{PROFILE}}'] = profile;
                            replacements['{{FINALRETURNFORMAT}}'] = window.final_response_format_token;

                            // Apply to system prompt as well
                            finalSystemPrompt = replacePlaceholders(finalSystemPrompt, {
                                '{{FINALRETURNFORMAT}}': window.final_response_format_token
                            });
                        } else {
                            replacements['{{PROFILE}}'] = '_not available_';
                            replacements['{{FINALRETURNFORMAT}}'] = '_not available_';

                            finalSystemPrompt = replacePlaceholders(finalSystemPrompt, {
                                '{{FINALRETURNFORMAT}}': '_not available_'
                            });

                            console.error('No Profile data & response format for final prompt available');
                        }

                        if (!final_response_format) {
                            console.error('No Response format for final prompt available');
                            return; // can't send without response format
                        }

                        // Apply all replacements at once
                        finalUserPrompt = replacePlaceholders(finalUserPrompt, replacements);


                        /*
                        const interimDataString = JSON.stringify(aiResponsesDataObject.merged_by_date, null, 2);
                        finalUserPrompt = finalUserPrompt.replace('{{INTERIMAIDATA}}', interimDataString);
                        finalUserPrompt = finalUserPrompt.replace('{{TIMEFROM}}', aiResponsesDataObject.date_from);
                        finalUserPrompt = finalUserPrompt.replace('{{TIMETILL}}', aiResponsesDataObject.date_till);
                        finalUserPrompt = finalUserPrompt.replace('{{DAYS}}', String(aiResponsesDataObject.interim_calls_amount));


                        if (typeof window !== 'undefined') {
                            let profile = window.cgmData.profile;
                            finalUserPrompt = finalUserPrompt.replace('{{PROFILE}}', profile);

                            finalUserPrompt = finalUserPrompt.replace('{{FINALRETURNFORMAT}}', window.final_response_format_token);
                            finalSystemPrompt = finalSystemPrompt.replace('{{FINALRETURNFORMAT}}', window.final_response_format_token);

                            let final_response_format = window.final_response_format;
                        } else {
                            finalUserPrompt = finalUserPrompt.replace('{{PROFILE}}', '_not available_');
                            finalUserPrompt = finalUserPrompt.replace('{{FINALRETURNFORMAT}}', '_not available_');
                            finalSystemPrompt = finalSystemPrompt.replace('{{FINALRETURNFORMAT}}', '_not available_');
                            console.error('No Profile data & response format for final prompt available');
                        }

                        if (!final_response_format) {
                            console.error('No Response format for final prompt available');
                            return; //can't send without response format
                        }
                        */


                        const finalPayload = {
                            model: passedInClient.settings.ai_llm_model || 'gpt-4o',
                            temperature: typeof settings.ai_llm_temperature === 'number' ? settings.ai_llm_temperature : 0,
                            top_p: 0.1,
                            presence_penalty: 0,
                            frequency_penalty: 0,
                            max_tokens: typeof passedInClient.settings.ai_llm_max_tokens === 'number' ? passedInClient.settings.ai_llm_max_tokens : 4096,
                            messages: [
                                {role: "system", content: finalSystemPrompt},
                                {role: "user", content: finalUserPrompt}
                            ],
                            response_format: final_response_format
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
                            const button = document.getElementById('sendToAiButton');
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
                                    const finalUsage = finalData.usage || {
                                        total_tokens: 0,
                                        prompt_tokens: 0,
                                        completion_tokens: 0
                                    };

                                    // Add final call's token usage to the totals
                                    window.aiResponsesDataObject.total_tokens_used += finalUsage.total_tokens || 0;
                                    window.aiResponsesDataObject.prompt_tokens_used += finalUsage.prompt_tokens || 0;
                                    window.aiResponsesDataObject.completion_tokens_used += finalUsage.completion_tokens || 0;

                                    window.aiResponsesDataObject.final_response = finalData.html_content;
                                    window.aiResponsesDataObject.total_calls = (window.aiResponsesDataObject.interim_calls_amount || 0) + 1 + (window.aiRepairCalls || 0);
                                    window.aiResponsesDataObject.final_call = 1;

                                    // RENDER ALL RESULTS AT THE END
                                    const displayMode = document.getElementById('aiResponseDisplayMode').value;
                                    let finalReportHtml = '';
                                    let interimReportsHtml = '';

                                    // 1. Prepare the final report's HTML
                                    try {
                                        const finalContentCleaned = finalData.html_content.trim().replace(/^```json\s*/, '').replace(/```$/, '').trim();
                                        const finalContentParsed = JSON.parse(finalContentCleaned);
                                        const tempDiv = document.createElement('div');
                                        renderCgmReport(finalContentParsed, tempDiv);
                                        const finalTitle = tempDiv.querySelector('h1').outerHTML;
                                        tempDiv.querySelector('h1').remove();
                                        const finalContent = tempDiv.innerHTML;

                                        finalReportHtml = `
                                            <button class="accordion-button active">${finalTitle}</button>
                                            <div class="accordion-panel show">
                                                ${finalContent}
                                            </div>
                                        `;
                                    } catch (renderError) {
                                        console.error('AI Eval: Error rendering final response:', renderError);
                                        finalReportHtml = `<p style="color: red;">Error rendering final report. See console for details.</p>`;
                                        if (passedInClient.settings.ai_llm_debug === true) {
                                            finalReportHtml += `<pre>${escapeHtml(finalData.html_content)}</pre>`;
                                        }
                                    }

                                    // 2. Prepare interim reports' HTML if requested
                                    if (displayMode === 'Show all results' && window.parsedInterimResponses) {
                                        for (const interimReport of window.parsedInterimResponses) {
                                            if (interimReport.error) {
                                                interimReportsHtml += `<p style="color: orange;">Could not render an interim response. See console for details.</p>`;
                                                if (passedInClient.settings.ai_llm_debug === true) {
                                                    interimReportsHtml += `<pre>${escapeHtml(interimReport.content)}</pre>`;
                                                }
                                            } else {
                                                const tempDiv = document.createElement('div');
                                                renderCgmReport(interimReport, tempDiv);
                                                const interimTitle = tempDiv.querySelector('h1').outerHTML;
                                                tempDiv.querySelector('h1').remove();
                                                const interimContent = tempDiv.innerHTML;

                                                interimReportsHtml += `
                                                    <button class="accordion-button">${interimTitle}</button>
                                                    <div class="accordion-panel">
                                                        ${interimContent}
                                                    </div>
                                                `;
                                            }
                                        }
                                    }

                                    // 3. Combine and render
                                    responseOutputArea.innerHTML = `<div class="ai-accordion">${unifiedCss}${finalReportHtml}${interimReportsHtml}</div>`;

                                    // 4. Add accordion functionality
                                    const acc = responseOutputArea.getElementsByClassName("accordion-button");
                                    for (let i = 0; i < acc.length; i++) {
                                        acc[i].addEventListener("click", function () {
                                            this.classList.toggle("active");
                                            const panel = this.nextElementSibling;
                                            panel.classList.toggle("show");
                                        });
                                    }


                                    // --- New Statistics Formatting ---
                                    const costInput = passedInClient.settings.ai_llm_1k_token_costs_input || 0;
                                    const costOutput = passedInClient.settings.ai_llm_1k_token_costs_output || 0;
                                    const exchangeRateInfo = window.exchangeRateInfo;

                                    function calculateAndFormatCost(tokens, costPer1k, rateInfo) {
                                        if (!costPer1k) return '';
                                        const usdCost = (tokens / 1000) * costPer1k;
                                        let costString = `($${usdCost.toFixed(4)}`;
                                        if (rateInfo && rateInfo.rate) {
                                            const convertedCost = usdCost * rateInfo.rate;
                                            costString += ` / ${convertedCost.toFixed(4)} ${rateInfo.currency}`;
                                        }
                                        costString += ')';
                                        return costString;
                                    }

                                    const statsHtml = `<p><strong>AI Usage Statistics</strong><br>for ${window.aiResponsesDataObject.date_from} - ${window.aiResponsesDataObject.date_till} (${window.aiResponsesDataObject.interim_calls_amount} days)<br>Total API Calls: ${window.aiResponsesDataObject.total_calls} (Interim: ${window.aiResponsesDataObject.interim_calls_amount}, Final: 1, Repairs: ${window.aiRepairCalls || 0})</p>
                                    <p><strong>Overall Session Usage:</strong></p>
                                    <ul>
                                        <li>Prompt Tokens: ${window.aiResponsesDataObject.prompt_tokens_used} ${calculateAndFormatCost(window.aiResponsesDataObject.prompt_tokens_used, costInput, exchangeRateInfo)}</li>
                                        <li>Completion Tokens: ${window.aiResponsesDataObject.completion_tokens_used} ${calculateAndFormatCost(window.aiResponsesDataObject.completion_tokens_used, costOutput, exchangeRateInfo)}</li>
                                        <li>Total Tokens: ${window.aiResponsesDataObject.total_tokens_used} ${calculateAndFormatCost(window.aiResponsesDataObject.prompt_tokens_used, costInput, exchangeRateInfo)}</li>
                                    </ul>`;

                                    if (statisticsArea) {
                                        statisticsArea.innerHTML = statsHtml;
                                        statisticsArea.style.display = 'block';
                                    }
                                    // --- End of New Statistics Formatting ---


                                    // Post usage statistics to the server
                                    const usagePayload = {
                                        date_from: window.aiResponsesDataObject.date_from,
                                        date_till: window.aiResponsesDataObject.date_till,
                                        days_requested: window.aiResponsesDataObject.interim_calls_amount,
                                        prompt_tokens_used: window.aiResponsesDataObject.prompt_tokens_used,
                                        completion_tokens_used: window.aiResponsesDataObject.completion_tokens_used,
                                        total_tokens_used: window.aiResponsesDataObject.total_tokens_used,
                                        total_api_calls: window.aiResponsesDataObject.total_calls,
                                        repair_calls: window.aiRepairCalls || 0,
                                    };

                                    const usageHeaders = passedInClient.headers ? passedInClient.headers() : {};
                                    usageHeaders['Content-Type'] = 'application/json';

                                    fetch((passedInClient.settings.baseURL || '') + '/api/v1/ai_usage/record', {
                                        method: 'POST',
                                        headers: usageHeaders,
                                        body: JSON.stringify(usagePayload)
                                    })
                                        .then(response => {
                                            if (passedInClient.settings.ai_llm_debug === true) {
                                                console.log('AI Eval: Usage recording response:', response);
                                            }
                                            if (!response.ok) {
                                                console.error('AI Eval: Failed to record usage statistics. Status:', response.status);
                                                response.text().then(text => console.error('AI Eval: Usage recording response body:', text));
                                            } else {
                                                if (passedInClient.settings.ai_llm_debug === true) {
                                                    console.log('AI Eval: Usage statistics recorded successfully.');
                                                }
                                            }
                                        })
                                        .catch(error => {
                                            console.error('AI Eval: Error recording usage statistics:', error);
                                        });
                                }

                            } catch (error) {
                                console.error('AI Eval: Final AI API call failed:', error);
                                responseOutputArea.innerHTML = `<p style="color: red;">Error during final analysis. Please check the console and debug areas for details.</p>`;
                                if (responseDebugArea) {
                                    responseDebugArea.textContent = `--- FINAL CALL ERROR ---\n${error.message}`;
                                }
                            } finally {
                                // This block ensures the button is always re-enabled and reset,
                                // whether the try block succeeds or fails.
                                if (button) {
                                    button.textContent = 'Send to AI';
                                    button.disabled = false;
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
        let aiDebugMode;
        if (typeof window !== 'undefined' && window.aiEvalClient) {
            passedInClient = window.aiEvalClient;
            console.log('AI Eval: Retrieved passedInClient from window.aiEvalClient in processAiEvaluationData().');
            aiDebugMode = passedInClient.settings.ai_llm_debug;
            console.log('AI Debugmode:', aiDebugMode);
        } else {
            console.error('AI Eval: window.aiEvalClient not found. Cannot proceed with processing.');
            const debugArea = document.getElementById('aiEvalDebugArea');
            if (debugArea) {
                debugArea.textContent = 'CRITICAL DEBUG: `processAiEvaluationData` ran, but `window.aiEvalClient` was not found.';
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
            if (aiDebugMode === true) {
                console.log('AI Eval Debug: Retrieved reportData from window.tempAiEvalReportData:', reportData && !!reportData.datastorage);
            }
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

                    // Check monthly limit
                    $.ajax({
                        url: baseUrl + '/api/v1/ai_usage/check_limit',
                        type: 'GET',
                        headers: headers,
                        success: function (limitData) {
                            if (limitData.limitExceeded) {
                                const sendButton = document.getElementById('sendToAiButton');
                                if (sendButton) {
                                    sendButton.disabled = true;
                                }
                                const responseOutputArea = document.getElementById('aiResponseOutputArea');
                                if (responseOutputArea) {
                                    responseOutputArea.innerHTML = `<p style="color: red; font-weight: bold;">The monthly limit of $${limitData.limit.toFixed(2)} for AI API calls has been reached. (Current: $${limitData.currentCost.toFixed(2)})</p>`;
                                }
                            }
                        },
                        error: function (jqXHR, textStatus, errorThrown) {
                            console.error('AI Eval: Error checking monthly limit:', textStatus, errorThrown);
                        }
                    });

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

                        const interim_response_format = {
                                "type": "json_schema",
                                "json_schema": {
                                    "name": "DailyAnalysisSchema",
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "date": {
                                                "type": "string",
                                                "format": "date",
                                                "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                                            },
                                            "summary": {
                                                "type": "array",
                                                "items": {"type": "string"}
                                            },
                                            "statistics": {
                                                "type": "object",
                                                "properties": {
                                                    "average_glucose_mgdl": {"type": ["number", "null"]},
                                                    "median_glucose_mgdl": {"type": ["number", "null"]},
                                                    "standard_deviation_mgdl": {"type": ["number", "null"]},
                                                    "cv_percent": {"type": ["number", "null"]},
                                                    "mage_mgdl": {"type": ["number", "null"]},
                                                    "time_in_range_percent": {"type": ["number", "null"]},
                                                    "time_below_range_percent": {"type": ["number", "null"]},
                                                    "time_above_range_percent": {"type": ["number", "null"]},
                                                    "total_readings": {"type": ["integer", "null"]},
                                                    "valid_hours": {"type": ["number", "null"]},
                                                    "number_of_hypo_episodes": {"type": ["integer", "null"]},
                                                    "number_of_hyper_episodes": {"type": ["integer", "null"]},
                                                    "longest_hypo_min": {"type": ["integer", "null"]},
                                                    "longest_hyper_min": {"type": ["integer", "null"]}
                                                },
                                                "required": [
                                                    "average_glucose_mgdl",
                                                    "median_glucose_mgdl",
                                                    "standard_deviation_mgdl",
                                                    "cv_percent",
                                                    "time_in_range_percent",
                                                    "time_below_range_percent",
                                                    "time_above_range_percent"
                                                ]
                                            },
                                            "anomalies": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "type": {"type": "string"},
                                                        "start_local": {"type": "string", "pattern": "^[0-2]\\d:[0-5]\\d$"},
                                                        "end_local": {"type": "string", "pattern": "^[0-2]\\d:[0-5]\\d$"},
                                                        "duration_min": {"type": ["integer", "null"]},
                                                        "nadir_mgdl": {"type": ["number", "null"]},
                                                        "peak_mgdl": {"type": ["number", "null"]}
                                                    },
                                                    "required": ["type", "start_local", "end_local"]
                                                }
                                            },
                                            "dailyPatterns": {
                                                "type": "object",
                                                "properties": {
                                                    "00-06": {"$ref": "#/definitions/timeBlock"},
                                                    "06-12": {"$ref": "#/definitions/timeBlock"},
                                                    "12-18": {"$ref": "#/definitions/timeBlock"},
                                                    "18-24": {"$ref": "#/definitions/timeBlock"}
                                                }
                                            },
                                            "recommendations": {"type": "array", "items": {"type": "string"}},
                                            "notes": {"type": "array", "items": {"type": "string"}},
                                            "rawAnalysis": {"type": "array", "items": {"type": "string"}},
                                            "meta": {
                                                "type": "object",
                                                "properties": {
                                                    "units": {"type": "string"},
                                                    "target_low_mgdl": {"type": "integer"},
                                                    "target_high_mgdl": {"type": "integer"},
                                                    "profile_snapshot_used": {"type": "boolean"}
                                                }
                                            }
                                        },
                                        "required": ["date", "summary", "statistics"],
                                        "definitions": {
                                            "timeBlock": {
                                                "type": "object",
                                                "properties": {
                                                    "avg": {"type": ["number", "null"]},
                                                    "sd": {"type": ["number", "null"]},
                                                    "below_pct": {"type": ["number", "null"]},
                                                    "in_range_pct": {"type": ["number", "null"]},
                                                    "above_pct": {"type": ["number", "null"]}
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        ;

                        const final_response_format = {
                                "type": "json_schema",
                                "json_schema": {
                                    "name": "MultiDayAnalysisSchema",
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "period": {
                                                "type": "object",
                                                "properties": {
                                                    "from": {"type": "string", "format": "date"},
                                                    "to": {"type": "string", "format": "date"},
                                                    "days": {"type": "integer"}
                                                },
                                                "required": ["from", "to", "days"]
                                            },
                                            "summary": {"type": "array", "items": {"type": "string"}},
                                            "overall_statistics": {
                                                "type": "object",
                                                "properties": {
                                                    "average_glucose_mgdl": {"type": ["number", "null"]},
                                                    "median_glucose_mgdl": {"type": ["number", "null"]},
                                                    "standard_deviation_mgdl": {"type": ["number", "null"]},
                                                    "cv_percent": {"type": ["number", "null"]},
                                                    "mage_overall_mgdl": {"type": ["number", "null"]},
                                                    "time_in_range_percent": {"type": ["number", "null"]},
                                                    "time_below_range_percent": {"type": ["number", "null"]},
                                                    "time_above_range_percent": {"type": ["number", "null"]},
                                                    "total_readings": {"type": ["integer", "null"]},
                                                    "valid_hours": {"type": ["number", "null"]}
                                                }
                                            },
                                            "diurnal_patterns": {
                                                "type": "object",
                                                "properties": {
                                                    "00-06": {"$ref": "#/definitions/timeBlock"},
                                                    "06-12": {"$ref": "#/definitions/timeBlock"},
                                                    "12-18": {"$ref": "#/definitions/timeBlock"},
                                                    "18-24": {"$ref": "#/definitions/timeBlock"}
                                                }
                                            },
                                            "episodes": {
                                                "type": "object",
                                                "properties": {
                                                    "hypoglycemia": {"$ref": "#/definitions/episodeStats"},
                                                    "hyperglycemia": {"$ref": "#/definitions/episodeStats"}
                                                }
                                            },
                                            "trends": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "label": {"type": "string"},
                                                        "evidence": {"type": "string"}
                                                    },
                                                    "required": ["label", "evidence"]
                                                }
                                            },
                                            "recommendations": {
                                                "type": "object",
                                                "properties": {
                                                    "therapy_settings": {"type": "array", "items": {"type": "string"}},
                                                    "behavioral_timing": {"type": "array", "items": {"type": "string"}},
                                                    "monitoring": {"type": "array", "items": {"type": "string"}}
                                                }
                                            },
                                            "data_quality_notes": {"type": "array", "items": {"type": "string"}},
                                            "per_day": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "date": {"type": "string", "format": "date"},
                                                        "average_glucose_mgdl": {"type": ["number", "null"]},
                                                        "cv_percent": {"type": ["number", "null"]},
                                                        "tir_percent": {"type": ["number", "null"]},
                                                        "tbr_percent": {"type": ["number", "null"]},
                                                        "tar_percent": {"type": ["number", "null"]},
                                                        "hypo_episodes": {"type": ["integer", "null"]},
                                                        "hyper_episodes": {"type": ["integer", "null"]},
                                                        "notes": {"type": "array", "items": {"type": "string"}}
                                                    },
                                                    "required": ["date"]
                                                }
                                            },
                                            "meta": {
                                                "type": "object",
                                                "properties": {
                                                    "aggregation": {"type": "string"},
                                                    "gap_threshold_minutes": {"type": "integer"},
                                                    "units": {"type": "string"},
                                                    "target_low_mgdl": {"type": "integer"},
                                                    "target_high_mgdl": {"type": "integer"},
                                                    "profile_snapshot_used": {"type": "boolean"}
                                                }
                                            }
                                        },
                                        "required": ["period", "summary", "overall_statistics"],
                                        "definitions": {
                                            "timeBlock": {
                                                "type": "object",
                                                "properties": {
                                                    "avg": {"type": ["number", "null"]},
                                                    "sd": {"type": ["number", "null"]},
                                                    "below_pct": {"type": ["number", "null"]},
                                                    "in_range_pct": {"type": ["number", "null"]},
                                                    "above_pct": {"type": ["number", "null"]}
                                                }
                                            },
                                            "episodeStats": {
                                                "type": "object",
                                                "properties": {
                                                    "count": {"type": ["integer", "null"]},
                                                    "total_minutes": {"type": ["integer", "null"]},
                                                    "longest_min": {"type": ["integer", "null"]},
                                                    "by_block": {
                                                        "type": "object",
                                                        "properties": {
                                                            "00-06": {"type": ["integer", "null"]},
                                                            "06-12": {"type": ["integer", "null"]},
                                                            "12-18": {"type": ["integer", "null"]},
                                                            "18-24": {"type": ["integer", "null"]}
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        ;

                        const interim_response_format_token = JSON.stringify(interim_response_format.json_schema, null, 2);
                        const final_response_format_token = JSON.stringify(final_response_format, null, 2);


                        if (typeof window !== 'undefined') {
                            window.interimPayloads = [];
                            window.interim_response_format = interim_response_format;
                            window.final_response_format = final_response_format;
                            window.final_response_format_token = final_response_format_token;
                        }


                        const payload = {
                            model: settings.ai_llm_model || 'gpt-4o',
                            temperature: typeof settings.ai_llm_temperature === 'number' ? settings.ai_llm_temperature : 0,
                            top_p: 0.1,
                            presence_penalty: 0,
                            frequency_penalty: 0,
                            max_tokens: typeof settings.ai_llm_max_tokens === 'number' ? settings.ai_llm_max_tokens : 4096,
                            response_format: interim_response_format
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

                            // Check if the number of days exceeds the limit
                            if (cgmData.days.length > 14) {
                                const sendButton = document.getElementById('sendToAiButton');
                                if (sendButton) {
                                    sendButton.disabled = true;
                                }
                                const responseOutputArea = document.getElementById('aiResponseOutputArea');
                                if (responseOutputArea) {
                                    responseOutputArea.innerHTML = '<p style="color: red; font-weight: bold;">The selected period is too long. Please reduce the amount of days to 14 or less to use the AI Evaluation.</p>';
                                }
                                // Reset prompt statuses
                                const $ = window.jQuery;
                                $('#ai-system-interim-prompt-status').text('Not Set').removeClass('ai-setting-value-set ai-setting-value-loading').addClass('ai-setting-value-not-set');
                                $('#ai-user-interim-prompt-status').text('Not Set').removeClass('ai-setting-value-set ai-setting-value-loading').addClass('ai-setting-value-not-set');
                                $('#ai-system-prompt-status').text('Not Set').removeClass('ai-setting-value-set ai-setting-value-loading').addClass('ai-setting-value-not-set');
                                $('#ai-user-prompt-status').text('Not Set').removeClass('ai-setting-value-set ai-setting-value-loading').addClass('ai-setting-value-not-set');

                                // Clear debug areas and stop further processing
                                const interimDebugArea = document.getElementById('aiEvalInterimDebugArea');
                                if (interimDebugArea) interimDebugArea.textContent = 'Processing stopped: Date range exceeds 14 days.';
                                const debugArea = document.getElementById('aiEvalDebugArea');
                                if (debugArea) debugArea.textContent = '';

                                // Clean up temporary global data, as we are aborting.
                                if (typeof window !== 'undefined' && window.tempAiEvalReportData) {
                                    delete window.tempAiEvalReportData;
                                }
                                return; // Stop processing
                            } else {
                                // Explicitly enable the button if the date range is valid, in case it was disabled previously.
                                const sendButton = document.getElementById('sendToAiButton');
                                if (sendButton) {
                                    sendButton.disabled = false;
                                }
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

                            const dummyUserInterimPromptContent = "Analyze Nightscout data for date {{DATE}}.\n" +
                                "\n" +
                                "INPUTS\n" +
                                "{{CGMDATA}}\n" +
                                "\n" +
                                "PROFILE\n" +
                                "{{PROFILE}}\n" +
                                "\n" +
                                "OBJECTIVES\n" +
                                "- Abnormalities/trends: hypoglycemia, hyperglycemia (timing, frequency, duration, pattern), variability (SD, CV, MAGE if calculable), diurnal patterns.\n" +
                                "- Diurnal profile: distribution 00–06, 06–12, 12–18, 18–24; classify <70 / 70–180 / >180.\n" +
                                "- Therapy adjustment (day-restricted): basal/I:C/ISF notes, timing issues (e.g., late bolus), DIA plausibility, daily routine effects.\n" +
                                "- Additional: TIR/TBR/TAR; mean/median/variance; closed-loop info if present; sensor failures/data gaps; alarm exposure if present.\n" +
                                "\n" +
                                "RESPONSE RULES\n" +
                                "- Use data only from this date.\n" +
                                "- Use mg/dL and percent.\n" +
                                "- If anything is non-computable, set the numeric field to null and add a clear explanation in data_quality_notes.\n" +
                                "\n" +
                                "RETURN FORMAT\n" +
                                "Return **only** valid JSON (no backticks, no trailing commas), matching exactly this schema and keys:\n" +
                                "\n" +
                                "{{INTERIMRETURNFORMAT}}\n";

                            const dummySystemInterimPromptContent = "You are an endocrinologist specialized in type 1 diabetes, expert in Nightscout CGM analytics.\n" +
                                "\n" +
                                "SCOPE\n" +
                                "- Analyze exactly one calendar day of Nightscout data (CGM entries + treatments + profile).\n" +
                                "- Output must be self-contained, standardized, and aggregation-ready for later multi-day synthesis.\n" +
                                "\n" +
                                "CONDUCT\n" +
                                "- Use medical terminology only. Evidence-based, data-first. No speculation.\n" +
                                "- Do not reference other days. This analysis stands alone.\n" +
                                "- If a metric cannot be computed, return null and explain in data_quality_notes.\n" +
                                "- Output strictly valid JSON. No prose, no backticks.\n" +
                                "\n" +
                                "DATA & UNITS\n" +
                                "- Glucose mg/dL.\n" +
                                "- Day partition: 00–06, 06–12, 12–18, 18–24 (local timezone of the data; assume timestamps in ms since epoch unless explicit).\n" +
                                "- Ranges: Low <70; Target 70–180; High >180.\n" +
                                "- TIR/TBR/TAR should be **time-weighted** (prefer sampling intervals; if only points exist, assume uniform spacing between readings and exclude gaps >15 min).\n" +
                                "- CV = SD / mean × 100.\n" +
                                "- Count hypos/hypers as **episodes** with persistence ≥15 minutes (>=3 consecutive 5‑min points). Merge episodes if separation <15 minutes.\n" +
                                "- Episode duration = continuous time within the threshold.\n" +
                                "- Diurnal distributions report: mean (avg), SD, %below/%in_range/%above by time block (time-weighted).\n" +
                                "- Data gaps: any gap >15 min. Sensor failure: explicit flags if present; otherwise infer improbable plateaus (≥45 min identical SGV) or out-of-physiology SGV (<40 or >400) as quality issues (do not exclude unless clearly erroneous; if excluded, document explicitly).\n" +
                                "- MAGE (Mean Amplitude of Glycemic Excursions): compute if ≥18 hours valid data. Algorithm: identify turning points via derivative sign change; keep excursions with absolute amplitude ≥1 SD of the day; MAGE = mean amplitude of qualifying peak–nadir (or nadir–peak) pairs. If insufficient qualifying pairs (n<4), set null and note.\n" +
                                "\n" +
                                "RECOMMENDATION RULES (day-limited)\n" +
                                "- Recommendations must cite concrete evidence from this day (e.g., time windows, % out of range, episode counts/durations).\n" +
                                "- Basal/I:C/ISF comments only if patterns align with classic signatures (e.g., fasting hyperglycemia 03:00–06:00 without carbs/bolus suggests dawn phenomenon); otherwise write none.\n" +
                                "\n" +
                                "OUTPUT\n" +
                                "- Respond with JSON **exactly** in the schema provided via the user prompt. Valid JSON, no markdown.\n";

                            let userInterimPromptContent = prompts.user_interim_prompt_template || dummyUserInterimPromptContent;
                            let systemInterimPromptContent = prompts.system_interim_prompt || dummySystemInterimPromptContent;

                            userInterimPromptContent = userInterimPromptContent.replace('{{PROFILE}}', cgmProfile);
                            userInterimPromptContent = userInterimPromptContent.replace('{{INTERIMRETURNFORMAT}}', interim_response_format_token);

                            systemInterimPromptContent = systemInterimPromptContent.replace('{{PROFILE}}', cgmProfile);
                            systemInterimPromptContent = systemInterimPromptContent.replace('{{INTERIMRETURNFORMAT}}', interim_response_format_token);


                            let interimPayloads = [];

                            // Create Interim Payloads
                            for (let i = 0; i < cgmData.days.length; i++) {
                                let interimPayload = {};
                                interimPayload = {...payload};
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

                            // Display estimated cost and current month's cost
                            $.ajax({
                                url: baseUrl + '/api/v1/ai_usage/monthly_summary',
                                type: 'GET',
                                headers: headers,
                                success: function (summaryData) {
                                    let costHtml = '';
                                    const totalStats = summaryData.total;
                                    const exchangeRateInfo = summaryData.exchangeRateInfo;
                                    if (typeof window !== 'undefined') {
                                        window.exchangeRateInfo = exchangeRateInfo;
                                    }

                                    // Estimated cost for the current selection
                                    if (totalStats && totalStats.avg_costs_per_day_requested > 0) {
                                        const numberOfDays = window.cgmData.days.length;
                                        const estimatedCost = numberOfDays * totalStats.avg_costs_per_day_requested;
                                        costHtml += `Estimated costs for the ${numberOfDays} days based on the usage statistics: $${estimatedCost.toFixed(4)}`;

                                        if (exchangeRateInfo && exchangeRateInfo.rate) {
                                            const convertedCost = estimatedCost * exchangeRateInfo.rate;
                                            costHtml += ` (${convertedCost.toFixed(4)} ${exchangeRateInfo.currency})`;
                                        }
                                    }

                                    // Current month's total cost
                                    const now = new Date();
                                    const currentMonthStr = now.toISOString().substring(0, 7); // "YYYY-MM"
                                    const currentMonthData = summaryData.monthly.find(m => m._id === currentMonthStr);

                                    if (currentMonthData) {
                                        if (costHtml) {
                                            costHtml += '<br>'; // Add a line break if there's already content
                                        }
                                        costHtml += `Costs for current month: $${currentMonthData.total_costs.toFixed(4)}`;
                                        if (exchangeRateInfo && exchangeRateInfo.rate) {
                                            const convertedCost = currentMonthData.total_costs * exchangeRateInfo.rate;
                                            costHtml += ` / ${convertedCost.toFixed(4)} ${exchangeRateInfo.currency}`;
                                        }
                                    }

                                    if (costHtml) {
                                        $('#aiEstimatedCost').html(costHtml);
                                    }
                                },
                                error: function (jqXHR, textStatus, errorThrown) {
                                    console.error('AI Eval: Error fetching usage summary for cost estimation:', textStatus, errorThrown);
                                }
                            });

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


            if (originalClient && originalClient.settings.ai_llm_debug === true) {
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

            <div style="margin-bottom: 10px;">
              <label for="aiResponseDisplayMode" style="margin-right: 5px;">Display Mode:</label>
              <select id="aiResponseDisplayMode">
                <option value="Show all results">Show all results</option>
                <option value="Show final result only">Show final result only</option>
              </select>
            </div>
        
            <button id="sendToAiButton" style="margin-top: 10px; padding: 8px 15px;">Send to AI</button>

            <div id="aiEstimatedCost" style="margin-top: 10px;"></div>
            
          <div id="aiResponseOutputArea" style="margin-top: 20px;">
            <!-- The AI Response will be injected here -->
          </div>
          
          <div id="ai-info-panels" class="cgm-grid-2col">
            <section>
                    <p id="ai-eval-status-text">Loading AI settings status...</p>
            </section>
            <section>
                <div id="aiStatistics" style="display: none;">
                    <!-- AI Statistics (like token usage) be injected here -->
                </div>
            </section>
            <section></section>
          </div>
    

        

          <p><em>This tab provides AI-powered analysis of your Nightscout data.<br>
          <strong>Disclaimer:</strong>The information generated is not medical advice and must not be used as a substitute for professional diagnosis or treatment.<br>
          The AI analysis may be inaccurate, incomplete, or incorrect. Use it only as a general indicator or for informational purposes. 
          Always consult a qualified healthcare provider for medical decisions.</em></p>
        
          <div id="aiEvalInterimDebugArea">
            <!-- Debug content will be injected here -->
          </div>
          
          <div id="aiEvalInterimResponseDebugArea">
            <!-- Response Debug content will be injected here -->
          </div>
        
          <div id="aiEvalDebugArea">
            <!-- Debug content will be injected here -->
          </div>

        <div id="aiEvalResponseDebugArea">
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
        
        #ai-eval-container h1 { color: #007bff; }
                    
        #ai-info-panels { max-width: 850px; }
        #ai-info-panels #ai-eval-status-text,
        #ai-info-panels #aiStatistics {
          padding: 10px;
          border: 1px solid #ccc;
          background-color: #f8f9fa;
          margin-bottom: 15px;
          max-width: 400px;
        }
        
        #ai-eval-status-text {}
        #ai-eval-status-text strong { font-weight: bold; }
        .ai-setting-label { font-weight: normal; }
        .ai-setting-value-set { font-weight: normal; color: green; }
        .ai-setting-value-not-set { font-weight: normal; color: red; }
        .ai-setting-value-loading { font-weight: normal; color: orange; }
        
        /* Shared Debug Area styles */
        #aiEvalDebugArea,
        #aiEvalInterimDebugArea,
        #aiEvalInterimResponseDebugArea,
        #aiEvalResponseDebugArea {
          border: 1px solid #ccc;
          padding: 10px;
          white-space: pre-wrap;
          word-wrap: break-word;
          font-family: monospace;
          font-size: 0.85em;
          overflow-y: auto;
          max-height: 400px;
          margin-top: 20px;
        }
        #aiEvalDebugArea,
        #aiEvalInterimDebugArea {
          background-color: #f0f0f0;
          border-color: #ddd;

        }
        #aiEvalInterimResponseDebugArea,
        #aiEvalResponseDebugArea {
          background-color: #e0e0e0;
          border-color: #ccc;
        }
        
        #aiStatistics { margin-top: 17px; } 
        #aiStatistics p { margin: 0; }
      
    `,

        report: function (datastorage, sorteddaystoshow, options) {

            let passedInClient;
            let aiDebugMode;
            if (typeof window !== 'undefined' && window.aiEvalClient) {
                passedInClient = window.aiEvalClient;
                console.log('AI Eval: Retrieved passedInClient from window.aiEvalClient in report function.');
                aiDebugMode = passedInClient.settings.ai_llm_debug;
                console.log('AI Debugmode:', aiDebugMode);
            }

            if (aiDebugMode === true) {
                // This function is called when the "Show" button for this report is clicked.
                console.log('AI Eval Debug: REPORT function called. Data received:', !!datastorage, 'Options Report Name:', options ? options.reportName : 'N/A');
            }


            if (typeof window !== 'undefined') {
                if (aiDebugMode === true) {
                    // 1. Reset all AI-related data and UI elements
                    console.log('AI Eval Debug: Resetting AI data and UI from report function.');
                }

                // Reset global variables
                window.interimPayloads = [];
                window.interimResponses = [];
                window.aiResponsesDataObject = {}; // Clear the main data object
                if (window.currentAiEvalfinalPayload) {
                    delete window.currentAiEvalfinalPayload;
                }
                if (window.exchangeRateInfo) {
                    delete window.exchangeRateInfo;
                }

                // Reset UI Elements
                const responseOutputArea = document.getElementById('aiResponseOutputArea');
                if (responseOutputArea) responseOutputArea.innerHTML = 'Awaiting new data...';

                const statisticsArea = document.getElementById('aiStatistics');
                if (statisticsArea) {
                    statisticsArea.innerHTML = '';
                    statisticsArea.style.display = 'none';
                }

                const estimatedCostArea = document.getElementById('aiEstimatedCost');
                if (estimatedCostArea) estimatedCostArea.innerHTML = '';

                const interimDebugArea = document.getElementById('aiEvalInterimDebugArea');
                if (interimDebugArea) interimDebugArea.textContent = 'Awaiting report data processing...';

                const interimResponseDebugArea = document.getElementById('aiEvalInterimResponseDebugArea');
                if (interimResponseDebugArea) interimResponseDebugArea.textContent = 'Awaiting interim AI call...';

                const debugArea = document.getElementById('aiEvalDebugArea');
                if (debugArea) debugArea.textContent = 'Awaiting report data processing...';

                const responseDebugArea = document.getElementById('aiEvalResponseDebugArea');
                if (responseDebugArea) responseDebugArea.textContent = 'AI Response Debug Area: Waiting for AI call...';


                // 2. Store new data for processing
                window.tempAiEvalReportData = {
                    datastorage: datastorage,
                    options: options,
                    sorteddaystoshow: sorteddaystoshow
                };
                if (aiDebugMode === true) {
                    console.log('AI Eval Debug: Stored new datastorage, options, and sorteddaystoshow on window.tempAiEvalReportData.');
                }

                // 3. Call the processor for the new data
                if (typeof window.processAiEvaluationData === 'function') {
                    if (aiDebugMode === true) {
                        console.log('AI Eval Debug: Calling window.processAiEvaluationData from report function.');
                    }
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