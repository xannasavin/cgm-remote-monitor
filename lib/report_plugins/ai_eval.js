'use strict';

// AI Evaluation plugin - modular architecture
// All HTML rendering uses escapeHtml() for LLM-sourced content (XSS mitigation).
// innerHTML assignments contain only pre-escaped content from renderer module.

var renderer = require('./ai_eval/renderer');
var llmClient = require('./ai_eval/llm_client');
var schemas = require('./ai_eval/schemas');
var promptsModule = require('./ai_eval/prompts');
var costTracker = require('./ai_eval/cost_tracker');
var dataProcessor = require('./ai_eval/data_processor');

var unifiedCss = '<style>'
  + '.cgm-wrap { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 1024px; min-width: 60%; margin: auto; line-height: 1.45; }'
  + '.cgm-wrap h1 { font-size: 1.6rem; margin: 0 0 .5rem; }'
  + '.cgm-wrap h2 { font-size: 1.2rem; margin: 1.2rem 0 .6rem; }'
  + '.cgm-wrap h3 { font-size: 1rem; margin: 1rem 0 .5rem; color: #333; }'
  + '.cgm-table { width: 100%; border-collapse: collapse; font-size: .95rem; }'
  + '.cgm-table th, .cgm-table td { border: 1px solid #e5e7eb; padding: .5rem .6rem; text-align: left; vertical-align: top; }'
  + '.cgm-table thead th { background: #f8fafc; font-weight: 600; }'
  + 'ul { padding-left: 1.2rem; margin: .2rem 0; }'
  + '.cgm-meta { color: #555; font-size: .9rem; }'
  + '.cgm-grid-2col, .cgm-grid-3col { display: grid; grid-template-columns: 1fr; gap: 1rem; }'
  + '.cgm-wrap section.final-response-overall-statistic table, .cgm-wrap section.final-response-diurnal-patterns table, .cgm-wrap section.final-response-episodes table { width: auto; }'
  + '@media (min-width: 900px) { .cgm-grid-2col { grid-template-columns: repeat(2, 1fr); } .cgm-grid-3col { grid-template-columns: repeat(3, 1fr); } }'
  + '.ai-accordion .accordion-button { background-color: #eee; color: #444; cursor: pointer; padding: 18px; width: 100%; border: none; text-align: left; outline: none; font-size: 1.6rem; transition: 0.4s; margin-top: 10px; }'
  + '.ai-accordion .active, .ai-accordion .accordion-button:hover { background-color: #ccc; }'
  + '.ai-accordion .accordion-button h1 { margin: 0; font-size: 1.6rem; }'
  + '.ai-accordion .accordion-panel { padding: 0 18px; background-color: white; display: none; overflow: hidden; }'
  + '.ai-accordion .accordion-panel.show { display: block; }'
  + '</style>';

function init (ctx) {

  function initializeAiEvalTab (passedInClient) {
    if (passedInClient.settings.ai_llm_debug === true) {
      console.log('AI Eval: initializeAiEvalTab called.');
    }

    if (typeof window === 'undefined') {
      console.error('AI Eval: window object not available.');
      return;
    }

    // Consolidate window globals into namespace (Finding #19)
    window.aiEvalClient = passedInClient;
    window.aiEvalState = {
      interimPayloads: []
      , interimResponses: []
      , parsedInterimResponses: []
      , repairCalls: 0
      , accumulatedInterimTokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      , aiResponsesDataObject: {}
      , currentFinalPayload: null
      , cgmData: {}
    };

    var settings = passedInClient.settings || {};

    // --- Display Static Settings Status ---
    var modelFromSettings = settings.ai_llm_model;
    var modelIsSet = modelFromSettings && modelFromSettings.trim() !== '';
    var statusHTML = '<strong>AI Settings Status:</strong><br>';

    if (settings.ai_llm_debug === true) {
      statusHTML += '<div><span class="ai-setting-label ai-setting-value-not-set">Debug Mode is active</span></div>';
    }

    var modelValueClass = modelIsSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set';
    var modelText = modelIsSet ? modelFromSettings : 'Not Set';
    statusHTML += '<div><span class="ai-setting-label">Model: </span><span class="' + modelValueClass + '">' + renderer.escapeHtml(modelText) + '</span></div>';
    statusHTML += '<div><span class="ai-setting-label">Please make sure that <em>AI_LLM_KEY</em><br>Environment variable is set.</span></div>';

    statusHTML += '<div><span class="ai-setting-label">System Interim Prompt: </span><span id="ai-system-interim-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';
    statusHTML += '<div><span class="ai-setting-label">User Interim Prompt: </span><span id="ai-user-interim-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';
    statusHTML += '<div><span class="ai-setting-label">System Prompt: </span><span id="ai-system-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';
    statusHTML += '<div><span class="ai-setting-label">User Prompt: </span><span id="ai-user-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';

    // statusHTML is built from static strings and escapeHtml-sanitized values
    var el = document.getElementById('ai-eval-status-text');
    if (el) {
      el.innerHTML = statusHTML; // eslint-disable-line no-unsanitized/property
    }

    var defaultDisplayMode = settings.ai_llm_default_display || 'Show all results';
    var displayModeDropdown = document.getElementById('aiResponseDisplayMode');
    if (displayModeDropdown) {
      displayModeDropdown.value = defaultDisplayMode;
    }

    function toggleDebugArea (id, message, debugEnabled) {
      var area = document.getElementById(id);
      if (!area) return;
      if (debugEnabled) {
        area.style.display = 'block';
        area.textContent = message;
      } else {
        area.style.display = 'none';
      }
    }

    var debugEnabled = settings.ai_llm_debug === true;
    toggleDebugArea('aiEvalDebugArea', 'Awaiting report data processing...', debugEnabled);
    toggleDebugArea('aiEvalInterimDebugArea', 'Awaiting report data processing...', debugEnabled);
    toggleDebugArea('aiEvalInterimResponseDebugArea', 'Awaiting interim AI call...', debugEnabled);
    toggleDebugArea('aiEvalResponseDebugArea', 'AI Response Debug Area: Waiting for AI call...', debugEnabled);

    // --- Send Button Handler ---
    var sendButton = document.getElementById('sendToAiButton');
    if (sendButton) {
      sendButton.addEventListener('click', async function () {
        if (settings.ai_llm_debug === true) {
          console.log('AI Eval: Send to AI button clicked.');
        }
        var button = this;
        var state = window.aiEvalState;

        if (!state.interimPayloads || state.interimPayloads.length === 0) {
          console.error('AI Eval: No interim payloads available to send.');
          alert('AI Evaluation interim payloads are not ready. Please load data first.');
          return;
        }

        button.disabled = true;
        state.interimResponses = [];
        state.parsedInterimResponses = [];
        state.repairCalls = 0;
        state.accumulatedInterimTokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

        var interimResponseDebugArea = document.getElementById('aiEvalInterimResponseDebugArea');
        var responseOutputArea = document.getElementById('aiResponseOutputArea');

        interimResponseDebugArea.textContent = '';
        responseOutputArea.textContent = '';

        var totalPayloads = state.interimPayloads.length;
        responseOutputArea.textContent = 'Starting analysis for ' + totalPayloads + ' days...';

        // --- Interim calls loop ---
        for (var i = 0; i < totalPayloads; i++) {
          var payload = state.interimPayloads[i];
          var statusMsg = 'Processing day ' + (i + 1) + ' of ' + totalPayloads + '...';
          console.log('AI Eval: ' + statusMsg);
          button.textContent = 'Sending (' + (i + 1) + '/' + totalPayloads + ')...';
          responseOutputArea.textContent = statusMsg;

          try {
            var data = await llmClient.callAiWithRetry(payload, passedInClient);
            state.interimResponses.push(data);

            var parsed = llmClient.tryParseJson(data.html_content || '');
            if (parsed) {
              state.parsedInterimResponses.push(parsed);
            } else {
              state.parsedInterimResponses.push({ error: 'Failed to parse response for day ' + (i + 1), content: data.html_content });
            }

            if (settings.ai_llm_debug === true) {
              interimResponseDebugArea.textContent += '\n\n--- Response for Day ' + (i + 1) + ' ---\n' + JSON.stringify(data, null, 2);
            }
          } catch (error) {
            console.error('AI Eval: AI API call failed for interim payload #' + (i + 1) + ':', error);
            responseOutputArea.textContent = 'Error during analysis of day ' + (i + 1) + '. See console for details.';
            interimResponseDebugArea.textContent += '\n\n--- ERROR for Day ' + (i + 1) + ' ---\n' + error.message;
            button.textContent = 'Send to AI';
            button.disabled = false;
            return;
          }
        }

        console.log('AI Eval: All interim payloads processed.');
        responseOutputArea.textContent = 'All daily analyses complete. Ready to build final report.';
        button.textContent = 'Final call...';

        // --- Fetch prompts and send final payload ---
        var $ = window.jQuery;
        var baseUrl = passedInClient.settings.baseURL || '';
        var headers = passedInClient.headers ? passedInClient.headers() : {};

        $.ajax({
          url: baseUrl + '/api/v1/ai_settings/prompts'
          , type: 'GET'
          , headers: headers
          , success: function (prompts) {
            buildAndSendFinalPayload(prompts, passedInClient, button, state);
          }
          , error: function (jqXHR, textStatus, errorThrown) {
            console.error('AI Eval: Error fetching final prompts:', textStatus, errorThrown);
            responseOutputArea.textContent = 'Error fetching final prompts. Cannot construct final payload.';
            button.textContent = 'Send to AI';
            button.disabled = false;
          }
        });
      });
    }

    if (settings.ai_llm_debug === true) {
      console.log('AI Eval: initializeAiEvalTab completed.');
    }
  }

  function buildAndSendFinalPayload (prompts, passedInClient, button, state) {
    var settings = passedInClient.settings || {};
    var responseOutputArea = document.getElementById('aiResponseOutputArea');
    var responseDebugArea = document.getElementById('aiEvalResponseDebugArea');
    var statisticsArea = document.getElementById('aiStatistics');

    var finalSystemPrompt = prompts.system_prompt || '';
    var finalUserPrompt = prompts.user_prompt_template || '';

    // Parse interim responses to build data object
    var parsedResponses = [];
    var interimCallsAmount = 0;

    for (var r = 0; r < state.interimResponses.length; r++) {
      var resp = state.interimResponses[r];
      try {
        if (resp && resp.html_content && typeof resp.html_content === 'string') {
          var parsedContent = llmClient.tryParseJson(resp.html_content);
          if (parsedContent && parsedContent.date) {
            parsedResponses.push({ date: parsedContent.date, content: parsedContent });
            interimCallsAmount++;
          }
        }
      } catch (e) {
        console.error('Error parsing interim response:', e);
      }
    }

    parsedResponses.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });

    var mergedByDate = {};
    for (var p = 0; p < parsedResponses.length; p++) {
      mergedByDate[parsedResponses[p].date] = parsedResponses[p].content;
    }

    var dateFrom = parsedResponses.length > 0 ? parsedResponses[0].date : null;
    var dateTill = parsedResponses.length > 0 ? parsedResponses[parsedResponses.length - 1].date : null;

    var aiResponsesDataObject = {
      merged_by_date: mergedByDate
      , interim_call_tokens: state.accumulatedInterimTokens.total_tokens
      , interim_calls_amount: interimCallsAmount
      , total_tokens_used: state.accumulatedInterimTokens.total_tokens
      , prompt_tokens_used: state.accumulatedInterimTokens.prompt_tokens
      , completion_tokens_used: state.accumulatedInterimTokens.completion_tokens
      , date_from: dateFrom
      , date_till: dateTill
    };

    var final_response_format = schemas.final_response_format;
    var final_response_format_token = JSON.stringify(final_response_format, null, 2);

    // Replace placeholders in final prompts (uses replaceAll - Fix #14)
    var replacements = {
      '{{INTERIMAIDATA}}': JSON.stringify(aiResponsesDataObject.merged_by_date, null, 2)
      , '{{TIMEFROM}}': aiResponsesDataObject.date_from
      , '{{TIMETILL}}': aiResponsesDataObject.date_till
      , '{{DAYS}}': String(aiResponsesDataObject.interim_calls_amount)
      , '{{PROFILE}}': (state.cgmData && state.cgmData.profile) || '_not available_'
      , '{{FINALRETURNFORMAT}}': final_response_format_token
    };

    finalUserPrompt = promptsModule.replacePlaceholders(finalUserPrompt, replacements);
    finalSystemPrompt = promptsModule.replacePlaceholders(finalSystemPrompt, { '{{FINALRETURNFORMAT}}': final_response_format_token });

    var finalPayload = {
      model: settings.ai_llm_model || 'gpt-4o'
      , temperature: typeof settings.ai_llm_temperature === 'number' ? settings.ai_llm_temperature : 0
      , top_p: 0.1
      , max_tokens: typeof settings.ai_llm_max_tokens === 'number' ? settings.ai_llm_max_tokens : 4096
      , messages: [
        { role: 'system', content: finalSystemPrompt }
        , { role: 'user', content: finalUserPrompt }
      ]
      , response_format: final_response_format
    };

    if (settings.ai_llm_debug === true) {
      var debugArea = document.getElementById('aiEvalDebugArea');
      if (debugArea) {
        debugArea.textContent = 'Final AI Payload (DEBUG):\n\n' + JSON.stringify(finalPayload, null, 2);
      }
    }

    state.currentFinalPayload = finalPayload;
    state.aiResponsesDataObject = aiResponsesDataObject;

    var $ = window.jQuery;
    $('#ai-system-prompt-status').text('Set').removeClass('ai-setting-value-loading').addClass('ai-setting-value-set');
    $('#ai-user-prompt-status').text('Set').removeClass('ai-setting-value-loading').addClass('ai-setting-value-set');

    // Send the final payload
    var sendFinalPayload = async function () {
      responseOutputArea.textContent = 'Sending final analysis request to AI...';
      if (settings.ai_llm_debug === true && responseDebugArea) {
        responseDebugArea.textContent = 'Calling final API...';
      }

      try {
        var apiEndpoint = (settings.baseURL || '') + '/api/v1/ai_eval';
        var requestHeaders = passedInClient.headers ? passedInClient.headers() : {};
        requestHeaders['Content-Type'] = 'application/json';

        var finalResponse = await fetch(apiEndpoint, {
          method: 'POST'
          , headers: requestHeaders
          , body: JSON.stringify(finalPayload)
        });

        if (!finalResponse.ok) {
          var errorText = await finalResponse.text();
          throw new Error('Status: ' + finalResponse.status + '. Body: ' + errorText);
        }

        var finalData = await finalResponse.json();

        if (settings.ai_llm_debug === true && responseDebugArea) {
          responseDebugArea.textContent = 'Final AI Response (RAW):\n\n' + JSON.stringify(finalData, null, 2);
        }

        // Update usage
        var finalUsage = finalData.usage || { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0 };
        aiResponsesDataObject.total_tokens_used += finalUsage.total_tokens || 0;
        aiResponsesDataObject.prompt_tokens_used += finalUsage.prompt_tokens || 0;
        aiResponsesDataObject.completion_tokens_used += finalUsage.completion_tokens || 0;
        aiResponsesDataObject.final_response = finalData.html_content;
        aiResponsesDataObject.total_calls = (aiResponsesDataObject.interim_calls_amount || 0) + 1 + (state.repairCalls || 0);
        aiResponsesDataObject.final_call = 1;

        // Render results
        var displayMode = document.getElementById('aiResponseDisplayMode').value;
        var finalReportHtml = '';
        var interimReportsHtml = '';

        try {
          var finalContentParsed = llmClient.tryParseJson(finalData.html_content || '');
          if (finalContentParsed) {
            var tempDiv = document.createElement('div');
            renderer.renderCgmReport(finalContentParsed, tempDiv);
            var finalTitle = tempDiv.querySelector('h1').outerHTML;
            tempDiv.querySelector('h1').remove();
            var finalContent = tempDiv.innerHTML;

            finalReportHtml = '<button class="accordion-button active">' + finalTitle + '</button>'
              + '<div class="accordion-panel show">' + finalContent + '</div>';
          } else {
            throw new Error('Could not parse final response');
          }
        } catch (renderError) {
          console.error('AI Eval: Error rendering final response:', renderError);
          finalReportHtml = '<p style="color: red;">Error rendering final report. See console.</p>';
          if (settings.ai_llm_debug === true) {
            finalReportHtml += '<pre>' + renderer.escapeHtml(finalData.html_content) + '</pre>';
          }
        }

        // Render interim reports if requested
        if (displayMode === 'Show all results' && state.parsedInterimResponses) {
          for (var ir = 0; ir < state.parsedInterimResponses.length; ir++) {
            var interimReport = state.parsedInterimResponses[ir];
            if (interimReport.error) {
              interimReportsHtml += '<p style="color: orange;">Could not render an interim response.</p>';
            } else {
              var iDiv = document.createElement('div');
              renderer.renderCgmReport(interimReport, iDiv);
              var iTitle = iDiv.querySelector('h1').outerHTML;
              iDiv.querySelector('h1').remove();
              interimReportsHtml += '<button class="accordion-button">' + iTitle + '</button>'
                + '<div class="accordion-panel">' + iDiv.innerHTML + '</div>';
            }
          }
        }

        // All rendered HTML is from escaped content via renderer module
        responseOutputArea.innerHTML = '<div class="ai-accordion">' + unifiedCss + finalReportHtml + interimReportsHtml + '</div>'; // eslint-disable-line no-unsanitized/property

        // Add accordion functionality
        var acc = responseOutputArea.getElementsByClassName('accordion-button');
        for (var ai = 0; ai < acc.length; ai++) {
          acc[ai].addEventListener('click', function () {
            this.classList.toggle('active');
            this.nextElementSibling.classList.toggle('show');
          });
        }

        // Statistics display (Fix #15: separate input/output costs)
        var costInput = settings.ai_llm_1k_token_costs_input || 0;
        var costOutput = settings.ai_llm_1k_token_costs_output || 0;
        var exchangeRateInfo = window.aiEvalState.exchangeRateInfo;

        var statsHtml = '<p><strong>AI Usage Statistics</strong><br>'
          + 'for ' + renderer.escapeHtml(aiResponsesDataObject.date_from || '') + ' - ' + renderer.escapeHtml(aiResponsesDataObject.date_till || '')
          + ' (' + aiResponsesDataObject.interim_calls_amount + ' days)<br>'
          + 'Total API Calls: ' + aiResponsesDataObject.total_calls
          + ' (Interim: ' + aiResponsesDataObject.interim_calls_amount + ', Final: 1, Repairs: ' + (state.repairCalls || 0) + ')</p>'
          + '<p><strong>Overall Session Usage:</strong></p>'
          + '<ul>'
          + '<li>Prompt Tokens: ' + aiResponsesDataObject.prompt_tokens_used + ' ' + costTracker.formatCost(aiResponsesDataObject.prompt_tokens_used, costInput, exchangeRateInfo) + '</li>'
          + '<li>Completion Tokens: ' + aiResponsesDataObject.completion_tokens_used + ' ' + costTracker.formatCost(aiResponsesDataObject.completion_tokens_used, costOutput, exchangeRateInfo) + '</li>'
          + '<li>Total Tokens: ' + aiResponsesDataObject.total_tokens_used + '</li>'
          + '</ul>';

        // statsHtml is built from escaped values and numeric data
        if (statisticsArea) {
          statisticsArea.innerHTML = statsHtml; // eslint-disable-line no-unsanitized/property
          statisticsArea.style.display = 'block';
        }

        // Record usage
        var usagePayload = {
          date_from: aiResponsesDataObject.date_from
          , date_till: aiResponsesDataObject.date_till
          , days_requested: aiResponsesDataObject.interim_calls_amount
          , prompt_tokens_used: aiResponsesDataObject.prompt_tokens_used
          , completion_tokens_used: aiResponsesDataObject.completion_tokens_used
          , total_tokens_used: aiResponsesDataObject.total_tokens_used
          , total_api_calls: aiResponsesDataObject.total_calls
          , repair_calls: state.repairCalls || 0
        };

        var usageHeaders = passedInClient.headers ? passedInClient.headers() : {};
        usageHeaders['Content-Type'] = 'application/json';

        fetch((settings.baseURL || '') + '/api/v1/ai_usage/record', {
          method: 'POST'
          , headers: usageHeaders
          , body: JSON.stringify(usagePayload)
        }).then(function (response) {
          if (!response.ok) {
            console.error('AI Eval: Failed to record usage. Status:', response.status);
          }
        }).catch(function (error) {
          console.error('AI Eval: Error recording usage:', error);
        });

      } catch (error) {
        console.error('AI Eval: Final AI API call failed:', error);
        responseOutputArea.textContent = 'Error during final analysis. See console for details.';
        if (responseDebugArea) {
          responseDebugArea.textContent = '--- FINAL CALL ERROR ---\n' + error.message;
        }
      } finally {
        if (button) {
          button.textContent = 'Send to AI';
          button.disabled = false;
        }
      }
    };

    sendFinalPayload();
  }

  function processAiEvaluationData () {
    console.log('AI Eval: processAiEvaluationData called.');

    if (typeof window === 'undefined' || !window.aiEvalClient) {
      console.error('AI Eval: window.aiEvalClient not found.');
      var debugArea = document.getElementById('aiEvalDebugArea');
      if (debugArea) {
        debugArea.textContent = 'CRITICAL: window.aiEvalClient was not found.';
      }
      if (typeof window !== 'undefined' && window.tempAiEvalReportData) {
        delete window.tempAiEvalReportData;
      }
      return;
    }

    var passedInClient = window.aiEvalClient;
    var settings = passedInClient.settings || {};
    var aiDebugMode = settings.ai_llm_debug === true;

    var reportData = null;
    if (window.tempAiEvalReportData) {
      reportData = window.tempAiEvalReportData;
    } else {
      console.warn('AI Eval: window.tempAiEvalReportData not found.');
      return;
    }

    if (typeof window.jQuery !== 'function') {
      console.error('AI Eval: jQuery not available.');
      return;
    }

    var $ = window.jQuery;
    var baseUrl = settings.baseURL || '';
    var headers = passedInClient.headers ? passedInClient.headers() : {};

    // Update prompt status to Loading
    $('#ai-system-interim-prompt-status').text('Loading...').removeClass('ai-setting-value-set ai-setting-value-not-set').addClass('ai-setting-value-loading');
    $('#ai-user-interim-prompt-status').text('Loading...').removeClass('ai-setting-value-set ai-setting-value-not-set').addClass('ai-setting-value-loading');
    $('#ai-system-prompt-status').text('Loading...').removeClass('ai-setting-value-set ai-setting-value-not-set').addClass('ai-setting-value-loading');
    $('#ai-user-prompt-status').text('Loading...').removeClass('ai-setting-value-set ai-setting-value-not-set').addClass('ai-setting-value-loading');

    $.ajax({
      url: baseUrl + '/api/v1/ai_settings/prompts'
      , type: 'GET'
      , headers: headers
      , success: function (prompts) {
        if (aiDebugMode) {
          console.log('AI Eval: Fetched prompts:', prompts);
        }

        // Update prompt statuses
        var fields = [
          { key: 'system_interim_prompt', id: '#ai-system-interim-prompt-status' }
          , { key: 'user_interim_prompt_template', id: '#ai-user-interim-prompt-status' }
          , { key: 'system_prompt', id: '#ai-system-prompt-status' }
          , { key: 'user_prompt_template', id: '#ai-user-prompt-status' }
        ];
        for (var f = 0; f < fields.length; f++) {
          var isSet = prompts && prompts[fields[f].key] && prompts[fields[f].key].trim() !== '';
          $(fields[f].id).text(isSet ? 'Set' : 'Not Set')
            .removeClass('ai-setting-value-loading')
            .addClass(isSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set');
        }

        // Check monthly limit
        $.ajax({
          url: baseUrl + '/api/v1/ai_usage/check_limit'
          , type: 'GET'
          , headers: headers
          , success: function (limitData) {
            if (limitData.limitExceeded) {
              var btn = document.getElementById('sendToAiButton');
              if (btn) btn.disabled = true;
              var area = document.getElementById('aiResponseOutputArea');
              if (area) area.textContent = 'Monthly limit of $' + limitData.limit.toFixed(2) + ' reached. (Current: $' + limitData.currentCost.toFixed(2) + ')';
            }
          }
          , error: function (jqXHR, textStatus) {
            console.error('AI Eval: Error checking monthly limit:', textStatus);
          }
        });

        if (reportData && reportData.datastorage) {
          // Use data_processor for pure data extraction
          var result = dataProcessor.prepareCgmData(reportData.datastorage, settings);

          if (result.exceedsLimit) {
            var sendBtn = document.getElementById('sendToAiButton');
            if (sendBtn) sendBtn.disabled = true;
            var outputArea = document.getElementById('aiResponseOutputArea');
            if (outputArea) outputArea.textContent = 'The selected period is too long. Please reduce to 14 days or less.';
            $('#ai-system-interim-prompt-status, #ai-user-interim-prompt-status, #ai-system-prompt-status, #ai-user-prompt-status')
              .text('Not Set').removeClass('ai-setting-value-set ai-setting-value-loading').addClass('ai-setting-value-not-set');
            if (window.tempAiEvalReportData) delete window.tempAiEvalReportData;
            return;
          }

          // Enable button
          var enableBtn = document.getElementById('sendToAiButton');
          if (enableBtn) enableBtn.disabled = false;

          // Store cgmData on state for final payload builder
          window.aiEvalState.cgmData = result.cgmData;

          if (aiDebugMode) {
            console.log('AI Eval DEBUG: cgmData:', result.cgmData);
          }

          // Build interim payloads using data_processor
          var interimPayloads = dataProcessor.buildInterimPayloads(
            result.cgmData, result.cgmProfile, prompts, settings
          );
          window.aiEvalState.interimPayloads = interimPayloads;

          // Store schemas on state
          window.aiEvalState.interim_response_format = schemas.interim_response_format;
          window.aiEvalState.final_response_format = schemas.final_response_format;

          if (aiDebugMode) {
            var interimDebug = document.getElementById('aiEvalInterimDebugArea');
            if (interimDebug) {
              interimDebug.textContent = 'Interim Payloads (' + interimPayloads.length + ' days):\n\n'
                + JSON.stringify(interimPayloads[0], null, 2).substring(0, 500) + '...';
            }
          }

          // Estimated cost display
          var estimatedCostArea = document.getElementById('aiEstimatedCost');
          if (estimatedCostArea) {
            estimatedCostArea.textContent = 'Ready: ' + result.cgmData.days.length + ' days prepared (' + result.cgmData.dateFrom + ' - ' + result.cgmData.dateTill + ')';
          }
        }

        // Clean up temporary data
        if (window.tempAiEvalReportData) {
          delete window.tempAiEvalReportData;
        }
      }
      , error: function (jqXHR, textStatus) {
        console.error('AI Eval: Error fetching prompts:', textStatus);
        $('#ai-system-interim-prompt-status, #ai-user-interim-prompt-status, #ai-system-prompt-status, #ai-user-prompt-status')
          .text('Error').removeClass('ai-setting-value-loading').addClass('ai-setting-value-not-set');
      }
    });
  }

  // Expose to window for the plugin system
  if (typeof window !== 'undefined') {
    window.initializeAiEvalTab = initializeAiEvalTab;
    window.processAiEvaluationData = processAiEvaluationData;
  }

  var aiEvalPlugin = {
    name: 'ai_eval'
    , label: 'AI Evaluation'

    , html: function (originalClient) {
      if (typeof window !== 'undefined') {
        window.tempAiClient = originalClient;
      }

      return ''
        + '<div id="ai-eval-container" style="padding: 20px;">'
        + '<div style="margin-bottom: 10px;">'
        + '<label for="aiResponseDisplayMode" style="margin-right: 5px;">Display Mode:</label>'
        + '<select id="aiResponseDisplayMode">'
        + '<option value="Show all results">Show all results</option>'
        + '<option value="Show final result only">Show final result only</option>'
        + '</select>'
        + '</div>'
        + '<button id="sendToAiButton" style="margin-top: 10px; padding: 8px 15px;">Send to AI</button>'
        + '<div id="aiEstimatedCost" style="margin-top: 10px;"></div>'
        + '<div id="aiResponseOutputArea" style="margin-top: 20px;"></div>'
        + '<div id="ai-info-panels" class="cgm-grid-2col">'
        + '<section><p id="ai-eval-status-text">Loading AI settings status...</p></section>'
        + '<section><div id="aiStatistics" style="display: none;"></div></section>'
        + '<section></section>'
        + '</div>'
        + '<p><em>This tab provides AI-powered analysis of your Nightscout data.<br>'
        + '<strong>Disclaimer:</strong> The information generated is not medical advice.<br>'
        + 'Always consult a qualified healthcare provider for medical decisions.</em></p>'
        + '<div id="aiEvalInterimDebugArea"></div>'
        + '<div id="aiEvalInterimResponseDebugArea"></div>'
        + '<div id="aiEvalDebugArea"></div>'
        + '<div id="aiEvalResponseDebugArea"></div>'
        + '</div>'
        + '<script type="text/javascript">'
        + '(function() {'
        + '  try {'
        + '    if (typeof window.initializeAiEvalTab === "function" && window.tempAiClient) {'
        + '      window.initializeAiEvalTab(window.tempAiClient);'
        + '      delete window.tempAiClient;'
        + '    } else {'
        + '      var s = document.getElementById("ai-eval-status-text");'
        + '      if (s) { s.textContent = "Error: Could not initialize AI Evaluation tab."; s.style.color = "red"; }'
        + '    }'
        + '  } catch (e) {'
        + '    var s = document.getElementById("ai-eval-status-text");'
        + '    if (s) { s.textContent = "CRITICAL: " + e.message; s.style.color = "red"; }'
        + '  }'
        + '})();'
        + '</script>';
    }

    , css: ''
      + '#ai-eval-container h1 { color: #007bff; }'
      + '#ai-info-panels { max-width: 850px; }'
      + '#ai-info-panels #ai-eval-status-text, #ai-info-panels #aiStatistics { padding: 10px; border: 1px solid #ccc; background-color: #f8f9fa; margin-bottom: 15px; max-width: 400px; }'
      + '#ai-eval-status-text strong { font-weight: bold; }'
      + '.ai-setting-label { font-weight: normal; }'
      + '.ai-setting-value-set { font-weight: normal; color: green; }'
      + '.ai-setting-value-not-set { font-weight: normal; color: red; }'
      + '.ai-setting-value-loading { font-weight: normal; color: orange; }'
      + '#aiEvalDebugArea, #aiEvalInterimDebugArea, #aiEvalInterimResponseDebugArea, #aiEvalResponseDebugArea { border: 1px solid #ccc; padding: 10px; white-space: pre-wrap; word-wrap: break-word; font-family: monospace; font-size: 0.85em; overflow-y: auto; max-height: 400px; margin-top: 20px; }'
      + '#aiEvalDebugArea, #aiEvalInterimDebugArea { background-color: #f0f0f0; border-color: #ddd; }'
      + '#aiEvalInterimResponseDebugArea, #aiEvalResponseDebugArea { background-color: #e0e0e0; border-color: #ccc; }'
      + '#aiStatistics { margin-top: 17px; }'
      + '#aiStatistics p { margin: 0; }'

    , report: function (datastorage, sorteddaystoshow, options) {
      var passedInClient;
      var aiDebugMode;
      if (typeof window !== 'undefined' && window.aiEvalClient) {
        passedInClient = window.aiEvalClient;
        aiDebugMode = passedInClient.settings.ai_llm_debug;
      }

      if (aiDebugMode === true) {
        console.log('AI Eval Debug: REPORT function called.');
      }

      if (typeof window !== 'undefined') {
        // Reset state
        var state = window.aiEvalState;
        if (state) {
          state.interimPayloads = [];
          state.interimResponses = [];
          state.parsedInterimResponses = [];
          state.aiResponsesDataObject = {};
          state.currentFinalPayload = null;
        }

        // Reset UI
        var responseOutputArea = document.getElementById('aiResponseOutputArea');
        if (responseOutputArea) responseOutputArea.textContent = 'Awaiting new data...';
        var statisticsArea = document.getElementById('aiStatistics');
        if (statisticsArea) { statisticsArea.textContent = ''; statisticsArea.style.display = 'none'; }
        var estimatedCostArea = document.getElementById('aiEstimatedCost');
        if (estimatedCostArea) estimatedCostArea.textContent = '';

        // Store report data
        window.tempAiEvalReportData = {
          datastorage: datastorage
          , options: options
          , sorteddaystoshow: sorteddaystoshow
        };

        if (typeof window.processAiEvaluationData === 'function') {
          setTimeout(function () {
            window.processAiEvaluationData();
          }, 0);
        } else {
          console.error('AI Eval: window.processAiEvaluationData is not defined.');
        }
      }
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
