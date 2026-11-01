'use strict';

// AI Evaluation plugin - single-call architecture (Phase 2)
// Statistics and charts live in the Pump Analysis tab; this tab shows a short
// KPI table plus the LLM flow. The analysis is shared via pump_analysis/analysis_cache.
// LLM call provides interpretation, trends, and recommendations.
// All HTML rendering uses escapeHtml() for LLM-sourced content (XSS mitigation).

var renderer = require('./ai_eval/renderer');
var llmClient = require('./ai_eval/llm_client');
var costTracker = require('./ai_eval/cost_tracker');
var dataProcessor = require('./ai_eval/data_processor');
var analysisCache = require('./pump_analysis/analysis_cache');
var renderUtils = require('./pump_analysis/render_utils');
var statsRenderer = require('./pump_analysis/stats_renderer');

var AI_MAX_DAYS = 14;

function exceedsDayLimit (dayCount) {
  return dayCount > AI_MAX_DAYS;
}

function init (_ctx) {

  function initializeAiEvalTab (passedInClient) {
    if (passedInClient.settings.ai_llm_debug === true) {
      console.log('AI Eval: initializeAiEvalTab called.');
    }

    if (typeof window === 'undefined') {
      console.error('AI Eval: window object not available.');
      return;
    }

    // Namespace for plugin state (Finding #19)
    window.aiEvalClient = passedInClient;

    // Wire the host Nightscout translate() so user-facing strings go through i18n.
    if (passedInClient && typeof passedInClient.translate === 'function') {
      renderUtils.setTranslate(passedInClient.translate);
    }

    window.aiEvalState = {
      cgmData: null
      , dayStats: null
      , periodStats: null
      , payload: null
    };

    var settings = passedInClient.settings || {};

    // --- Display Settings Status ---
    var modelFromSettings = settings.ai_llm_model;
    var modelIsSet = modelFromSettings && modelFromSettings.trim() !== '';
    var statusHTML = '<strong>AI Settings Status:</strong><br>';

    if (settings.ai_llm_debug === true) {
      statusHTML += '<div><span class="ai-setting-label ai-setting-value-not-set">Debug Mode is active</span></div>';
    }

    var modelValueClass = modelIsSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set';
    var modelText = modelIsSet ? modelFromSettings : 'Not Set';
    statusHTML += '<div><span class="ai-setting-label">Model: </span><span class="' + modelValueClass + '">' + renderer.escapeHtml(modelText) + '</span></div>';
    statusHTML += '<div><span class="ai-setting-label">System Prompt: </span><span id="ai-system-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';
    statusHTML += '<div><span class="ai-setting-label">User Prompt: </span><span id="ai-user-prompt-status" class="ai-setting-value-loading">Waiting for data...</span></div>';

    // statusHTML is built from static strings and escapeHtml-sanitized values
    var el = document.getElementById('ai-eval-status-text');
    if (el) {
      el.innerHTML = statusHTML; // eslint-disable-line no-unsanitized/property
    }

    var debugEnabled = settings.ai_llm_debug === true;
    var debugArea = document.getElementById('aiEvalDebugArea');
    if (debugArea) {
      debugArea.style.display = debugEnabled ? 'block' : 'none';
      if (debugEnabled) debugArea.textContent = 'Awaiting report data processing...';
    }

    // --- Send Button Handler ---
    var sendButton = document.getElementById('sendToAiButton');
    if (sendButton) {
      sendButton.addEventListener('click', async function () {
        var button = this;
        // F29: Guard against double-submit race
        if (button.disabled) return;
        var state = window.aiEvalState;

        if (!state.payload) {
          alert('AI Evaluation payload is not ready. Please load data first.');
          return;
        }

        button.disabled = true;
        button.textContent = 'Analyzing\u2026';
        button.setAttribute('aria-busy', 'true');
        var aiSuccess = false;

        var analysisArea = document.getElementById('aiAnalysisArea');
        if (analysisArea) {
          // Note: static string, no user/LLM content - safe for innerHTML
          analysisArea.innerHTML = '<p>Sending analysis request to AI...</p>'; // eslint-disable-line no-unsanitized/property
        }

        try {
          var result = await llmClient.callAiWithRetry(state.payload, passedInClient);
          var data = result.data;
          var usage = result.usage;
          var repairCalls = result.repairCalls;

          if (settings.ai_llm_debug === true) {
            var dbg = document.getElementById('aiEvalDebugArea');
            if (dbg) dbg.textContent = 'AI Response:\n\n' + JSON.stringify(data, null, 2);
          }

          // Parse and render LLM analysis
          var parsed = llmClient.tryParseJson(data.html_content || '');
          // Unwrap schema envelope if the LLM mirrored the {name, schema} wrapper
          if (parsed && parsed.schema && !parsed.period) {
            parsed = parsed.schema;
          }
          if (parsed) {
            // renderAnalysis() escapes all LLM-sourced content via escapeHtml().
            var analysisHtml = renderer.renderAnalysis(parsed);
            if (analysisArea) {
              analysisArea.innerHTML = '<div class="ai-section ai-section-analysis">' + analysisHtml + '</div>'; // eslint-disable-line no-unsanitized/property
              // Scroll to analysis and flash highlight
              analysisArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
              analysisArea.classList.add('ai-flash');
              setTimeout(function () { analysisArea.classList.remove('ai-flash'); }, 2000);
            }
            aiSuccess = true;
          } else {
            if (analysisArea) {
              // Note: static string, no user/LLM content - safe for innerHTML
              analysisArea.innerHTML = '<div class="ai-section-error">Could not parse AI response. See debug area for details.</div>'; // eslint-disable-line no-unsanitized/property
            }
          }

          // Usage cost display
          var costInput = settings.ai_llm_1k_token_costs_input || 0;
          var costOutput = settings.ai_llm_1k_token_costs_output || 0;

          // F23: Sanitize token values before HTML insertion
          var safePromptTokens = parseInt(usage.prompt_tokens, 10) || 0;
          var safeCompletionTokens = parseInt(usage.completion_tokens, 10) || 0;
          var safeTotalTokens = parseInt(usage.total_tokens, 10) || 0;
          var statsHtml = '<p><strong>AI Usage</strong><br>'
            + 'API Calls: ' + (1 + repairCalls) + (repairCalls > 0 ? ' (Repairs: ' + repairCalls + ')' : '') + '</p>'
            + '<ul>'
            + '<li>Prompt Tokens: ' + safePromptTokens + ' ' + costTracker.formatCost(safePromptTokens, costInput) + '</li>'
            + '<li>Completion Tokens: ' + safeCompletionTokens + ' ' + costTracker.formatCost(safeCompletionTokens, costOutput) + '</li>'
            + '<li>Total Tokens: ' + safeTotalTokens + '</li>'
            + '</ul>';

          var usageArea = document.getElementById('aiUsageStats');
          if (usageArea) {
            usageArea.innerHTML = statsHtml; // eslint-disable-line no-unsanitized/property
            usageArea.style.display = 'block';
          }

          // Record usage
          var meta = state.cgmData ? state.cgmData.meta : {};
          var usagePayload = {
            date_from: meta.from
            , date_till: meta.to
            , days_requested: meta.days
            , prompt_tokens_used: usage.prompt_tokens
            , completion_tokens_used: usage.completion_tokens
            , total_tokens_used: usage.total_tokens
            , total_api_calls: 1 + repairCalls
            , repair_calls: repairCalls
          };

          var usageHeaders = passedInClient.headers ? passedInClient.headers() : {};
          usageHeaders['Content-Type'] = 'application/json';

          var recordUrl = (settings.baseURL || '') + '/api/v1/ai_usage/record';
          var recordBody = JSON.stringify(usagePayload);
          var recordUsage = function (attempt) {
            fetch(recordUrl, { method: 'POST', headers: usageHeaders, body: recordBody })
              .then(function (resp) {
                if (!resp.ok && attempt < 2) {
                  console.warn('AI Eval: Usage recording failed (attempt ' + (attempt + 1) + '), retrying...');
                  setTimeout(function () { recordUsage(attempt + 1); }, 2000);
                } else if (!resp.ok) {
                  console.error('AI Eval: Failed to record usage after retries. Status:', resp.status);
                }
              })
              .catch(function (error) {
                if (attempt < 2) {
                  setTimeout(function () { recordUsage(attempt + 1); }, 2000);
                } else {
                  console.error('AI Eval: Error recording usage:', error);
                }
              });
          };
          recordUsage(0);

        } catch (error) {
          console.error('AI Eval: AI API call failed:', error);
          if (analysisArea) {
            var rawMsg = error && error.message ? error.message : String(error);
            var isTimeout = /timeout/i.test(rawMsg) || /ESOCKETTIMEDOUT|ETIMEDOUT/.test(rawMsg);
            var isTooLarge = /Status:\s*413/.test(rawMsg) || /PayloadTooLarge/i.test(rawMsg) || /request entity too large/i.test(rawMsg);
            var isRateLimit = /Status:\s*429/.test(rawMsg);
            var isUnauth = /Status:\s*(401|403)/.test(rawMsg);
            var isServerErr = /Status:\s*5\d\d/.test(rawMsg);

            var headline;
            if (isTimeout) {
              headline = 'The LLM took too long to answer. Try again, or pick a shorter date range.';
            } else if (isTooLarge) {
              headline = 'The request payload is too large for the server. This usually happens with long date ranges — pick fewer days and try again. (If this keeps happening, the server upload limit may need to be raised.)';
            } else if (isRateLimit) {
              headline = 'Too many requests in a short time. Wait a minute and try again.';
            } else if (isUnauth) {
              headline = 'Authorization failed. Check that you are logged in and the AI endpoint permission is granted.';
            } else if (isServerErr) {
              headline = 'The AI endpoint reported a server error. Try again, and if it persists check the server logs.';
            } else {
              headline = 'The AI analysis failed. See details below.';
            }

            var errorDiv = document.createElement('div');
            errorDiv.className = 'ai-section-error';

            var headlineEl = document.createElement('p');
            headlineEl.className = 'ai-error-headline';
            headlineEl.textContent = headline;
            errorDiv.appendChild(headlineEl);

            // Collapsible raw details — hidden by default so the error area
            // doesn't dump a screen full of HTML from the server error page.
            var detailsEl = document.createElement('details');
            detailsEl.className = 'ai-error-details';
            var summaryEl = document.createElement('summary');
            summaryEl.textContent = 'Technical details';
            detailsEl.appendChild(summaryEl);
            var preEl = document.createElement('pre');
            preEl.className = 'ai-error-raw';
            preEl.textContent = rawMsg;
            detailsEl.appendChild(preEl);
            errorDiv.appendChild(detailsEl);

            var retryBtn = document.createElement('button');
            retryBtn.textContent = 'Retry';
            retryBtn.className = 'ai-error-retry';
            retryBtn.addEventListener('click', function () {
              var btn = document.getElementById('sendToAiButton');
              if (btn) btn.click();
            });
            errorDiv.appendChild(retryBtn);

            analysisArea.textContent = '';
            analysisArea.appendChild(errorDiv);
          }
        } finally {
          button.setAttribute('aria-busy', 'false');
          if (aiSuccess) {
            button.textContent = 'Report Ready \u2714';
            button.disabled = true;
          } else {
            button.textContent = 'Send to AI';
            button.disabled = false;
          }
        }
      });
    }
  }

  function processAiEvaluationData () {
    console.log('AI Eval: processAiEvaluationData called.');

    if (typeof window === 'undefined' || !window.aiEvalClient) {
      console.error('AI Eval: window.aiEvalClient not found.');
      return;
    }

    var passedInClient = window.aiEvalClient;
    var settings = passedInClient.settings || {};
    var aiDebugMode = settings.ai_llm_debug === true;

    var reportData = window.tempAiEvalReportData;
    if (!reportData) {
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

    if (!reportData.datastorage) return;

    // The Pump Analysis tab computes the same result for this report; the
    // shared cache makes this a lookup instead of a second computation.
    var result;
    try {
      result = analysisCache.getAnalysis(
        reportData.datastorage
        , settings
        , reportData.options || {}
        , reportData.sorteddaystoshow
      );
    } catch (err) {
      console.error('AI Eval: could not compute pump analysis:', err);
      var failBtn = document.getElementById('sendToAiButton');
      if (failBtn) failBtn.disabled = true;
      var failArea = document.getElementById('aiAnalysisArea');
      if (failArea) {
        failArea.innerHTML = '<div class="ai-section-error" role="alert">' // eslint-disable-line no-unsanitized/property
          + renderUtils.escapeHtml(renderUtils.translate('Pump analysis could not be computed for this period.'))
          + '</div>';
      }
      $('#ai-system-prompt-status, #ai-user-prompt-status')
        .text('Skipped').removeClass('ai-setting-value-loading ai-setting-value-set').addClass('ai-setting-value-not-set');
      delete window.tempAiEvalReportData;
      return;
    }

    var state = window.aiEvalState;
    state.cgmData = result.cgmData;
    state.dayStats = result.dayStats;
    state.periodStats = result.periodStats;
    state.pumpActionStats = result.pumpActionStats;
    state.episodeTiming = result.episodeTiming;

    // renderPeriodSummary() escapes all dynamic values
    var kpiArea = document.getElementById('aiKpiArea');
    if (kpiArea) {
      kpiArea.innerHTML = statsRenderer.renderPeriodSummary(result.periodStats, result.cgmData.meta); // eslint-disable-line no-unsanitized/property
    }

    if (exceedsDayLimit(result.dayCount)) {
      var sendBtn = document.getElementById('sendToAiButton');
      if (sendBtn) sendBtn.disabled = true;
      var limitArea = document.getElementById('aiAnalysisArea');
      if (limitArea) {
        limitArea.innerHTML = '<div class="ai-section-error" role="alert">' // eslint-disable-line no-unsanitized/property
          + renderUtils.escapeHtml(renderUtils.translate('AI analysis is limited to 14 days. The statistics are in the Pump Analysis tab. Please reduce the date range to enable AI analysis.'))
          + '</div>';
      }
      $('#ai-system-prompt-status, #ai-user-prompt-status')
        .text('Skipped').removeClass('ai-setting-value-loading ai-setting-value-set').addClass('ai-setting-value-not-set');
      delete window.tempAiEvalReportData;
      return;
    }

    // Update prompt status to Loading
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
          { key: 'system_prompt', id: '#ai-system-prompt-status' }
          , { key: 'user_prompt_template', id: '#ai-user-prompt-status' }
        ];
        for (var f = 0; f < fields.length; f++) {
          var isSet = prompts && prompts[fields[f].key] && prompts[fields[f].key].trim() !== '';
          $(fields[f].id).text(isSet ? 'Set' : 'Not Set')
            .removeClass('ai-setting-value-loading')
            .addClass(isSet ? 'ai-setting-value-set' : 'ai-setting-value-not-set');
        }

        // F25: Check monthly limit and track completion to avoid race with button enable
        var limitExceeded = false;
        $.ajax({
          url: baseUrl + '/api/v1/ai_usage/check_limit'
          , type: 'GET'
          , headers: headers
          , success: function (limitData) {
            if (limitData.limitExceeded) {
              limitExceeded = true;
              var btn = document.getElementById('sendToAiButton');
              if (btn) btn.disabled = true;
              var area = document.getElementById('aiAnalysisArea');
              if (area) area.textContent = 'Monthly limit of $' + limitData.limit.toFixed(2) + ' reached. (Current: $' + limitData.currentCost.toFixed(2) + ')';
            }
          }
          , error: function (jqXHR, textStatus) {
            console.error('AI Eval: Error checking monthly limit:', textStatus);
          }
        });

        // Build single-call payload
        var language = settings.language || 'en';
        var payload = dataProcessor.buildSinglePayload(result.cgmData, prompts, settings, language);
        state.payload = payload;

        // Enable button (F25: only if limit check passed or hasn't returned yet)
        var enableBtn = document.getElementById('sendToAiButton');
        if (enableBtn && !limitExceeded) enableBtn.disabled = false;

        if (aiDebugMode) {
          var debugArea = document.getElementById('aiEvalDebugArea');
          if (debugArea) {
            debugArea.textContent = 'Payload prepared (' + result.dayCount + ' days):\n\n'
              + JSON.stringify(payload, null, 2);
          }
        }

        var costArea = document.getElementById('aiEstimatedCost');
        if (costArea) {
          var meta = result.cgmData.meta;
          costArea.textContent = 'Ready: ' + meta.days + ' days (' + renderer.formatDate(meta.from || '') + ' \u2013 ' + renderer.formatDate(meta.to || '') + ')';
        }

        if (window.tempAiEvalReportData) {
          delete window.tempAiEvalReportData;
        }
      }
      , error: function (jqXHR, textStatus) {
        console.error('AI Eval: Error fetching prompts:', textStatus);
        $('#ai-system-prompt-status, #ai-user-prompt-status')
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
    , exceedsDayLimit: exceedsDayLimit

    , html: function (originalClient) {
      if (typeof window !== 'undefined') {
        window.tempAiClient = originalClient;
      }
      var tr = originalClient && typeof originalClient.translate === 'function'
        ? originalClient.translate
        : function (s) { return s; };

      return ''
        + '<div id="ai-eval-container" style="padding: 20px;">'
        + '<div class="ai-disclaimer" role="alert"><strong>Important:</strong> The AI-generated analysis is <strong>not medical advice</strong>. Always consult a qualified healthcare provider before making treatment changes based on this analysis.</div>'
        + '<p class="ai-pump-pointer">' + renderer.escapeHtml(tr('Charts and the full statistics for this period are in the Pump Analysis tab.')) + '</p>'
        + '<div id="aiKpiArea" aria-live="polite" style="margin-top: 10px;"></div>'
        + '<button id="sendToAiButton" disabled aria-busy="false" style="margin-top: 10px; padding: 8px 15px;">Send to AI</button>'
        + '<div id="aiEstimatedCost" style="margin-top: 10px;"></div>'
        + '<div id="aiAnalysisArea" aria-live="polite" style="margin-top: 20px;"></div>'
        + '<div id="ai-info-panels" class="cgm-grid-2col">'
        + '<section><p id="ai-eval-status-text" aria-live="polite">Loading AI settings status...</p></section>'
        + '<section><div id="aiUsageStats" style="display: none;"></div></section>'
        + '</div>'
        + '<div id="aiEvalDebugArea" style="display:none;"></div>'
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
      + '#ai-info-panels #ai-eval-status-text, #ai-info-panels #aiUsageStats { padding: 10px; border: 1px solid #ccc; background-color: #f8f9fa; margin-bottom: 15px; max-width: 400px; }'
      + '#ai-eval-status-text strong { font-weight: bold; }'
      + '.ai-setting-label { font-weight: normal; }'
      + '.ai-setting-value-set { font-weight: 600; color: #047857; }'
      + '.ai-setting-value-not-set { font-weight: 600; color: #dc2626; }'
      + '.ai-setting-value-loading { font-weight: normal; color: #b45309; }'
      + '.ai-disclaimer { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 4px; padding: 10px 14px; margin-bottom: 12px; font-size: 0.9rem; color: #92400e; }'
      + '#sendToAiButton[aria-busy="true"] { position: relative; padding-left: 32px; }'
      + '#sendToAiButton[aria-busy="true"]::before { content: ""; position: absolute; left: 10px; top: 50%; width: 14px; height: 14px; margin-top: -7px; border: 2px solid #ccc; border-top-color: #333; border-radius: 50%; animation: ai-spin .6s linear infinite; }'
      + '@keyframes ai-spin { to { transform: rotate(360deg); } }'
      + '#aiEvalDebugArea { border: 1px solid #ccc; padding: 10px; white-space: pre-wrap; word-wrap: break-word; font-family: monospace; font-size: 0.85em; overflow-y: auto; max-height: 400px; margin-top: 20px; background-color: #f0f0f0; }'
      + '.ai-flash { animation: ai-flash-bg 2s ease-out; }'
      + '@keyframes ai-flash-bg { 0% { background-color: #fef9c3; } 100% { background-color: transparent; } }'
      + '.ai-trends-list { display: flex; flex-direction: column; gap: 10px; }'
      + '.ai-trend-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }'
      + '.ai-trend-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }'
      + '.ai-severity-badge { display: inline-block; padding: 2px 8px; border-radius: 3px; color: #fff; font-size: .75rem; font-weight: 600; text-transform: uppercase; }'
      + '.ai-trend-evidence { margin: 0; color: #555; font-size: .9rem; line-height: 1.5; }'
      + '.ai-error-headline { margin: 0 0 10px 0; font-size: 0.95rem; line-height: 1.45; font-weight: 500; }'
      + '.ai-error-details { margin: 0 0 10px 0; }'
      + '.ai-error-details > summary { cursor: pointer; font-size: 0.85rem; color: #991b1b; user-select: none; }'
      + '.ai-error-raw { margin: 8px 0 0 0; padding: 10px; background: #fff; border: 1px solid #fecaca; border-radius: 4px; font-family: monospace; font-size: 0.75rem; max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-word; color: #450a0a; }'
      + '.ai-error-retry { padding: 6px 14px; background: #fff; border: 1px solid #991b1b; border-radius: 4px; color: #991b1b; font-size: 0.85rem; cursor: pointer; }'
      + '.ai-error-retry:hover { background: #991b1b; color: #fff; }'
      + '#aiUsageStats ul { padding-left: 1.2rem; margin: .2rem 0; }'

    , report: function (datastorage, sorteddaystoshow, options) {
      if (typeof window === 'undefined') return;

      var state = window.aiEvalState;
      if (state) {
        state.cgmData = null;
        state.dayStats = null;
        state.periodStats = null;
        state.payload = null;
      }

      // Reset UI
      var kpiArea = document.getElementById('aiKpiArea');
      if (kpiArea) kpiArea.textContent = '';
      var analysisArea = document.getElementById('aiAnalysisArea');
      if (analysisArea) analysisArea.textContent = '';
      var usageArea = document.getElementById('aiUsageStats');
      if (usageArea) { usageArea.textContent = ''; usageArea.style.display = 'none'; }
      var costArea = document.getElementById('aiEstimatedCost');
      if (costArea) costArea.textContent = '';

      // Store report data with generation counter (F30: prevent stale data processing)
      window.aiEvalReportGeneration = (window.aiEvalReportGeneration || 0) + 1;
      var currentGeneration = window.aiEvalReportGeneration;
      window.tempAiEvalReportData = {
        datastorage: datastorage
        , options: options
        , sorteddaystoshow: sorteddaystoshow
      };

      if (typeof window.processAiEvaluationData === 'function') {
        setTimeout(function () {
          // Only process if this is still the latest generation
          if (window.aiEvalReportGeneration === currentGeneration) {
            window.processAiEvaluationData();
          }
        }, 0);
      }
    }
  };

  return aiEvalPlugin;
}

module.exports = init;
