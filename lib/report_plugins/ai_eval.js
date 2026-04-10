'use strict';

// AI Evaluation plugin - single-call architecture (Phase 2)
// Client-side statistics are always visible (computed by lib/statistics.js).
// LLM call provides interpretation, trends, and recommendations.
// All HTML rendering uses escapeHtml() for LLM-sourced content (XSS mitigation).

var renderer = require('./ai_eval/renderer');
var llmClient = require('./ai_eval/llm_client');
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
  + '@media (min-width: 900px) { .cgm-grid-2col { grid-template-columns: repeat(2, 1fr); } .cgm-grid-3col { grid-template-columns: repeat(3, 1fr); } }'
  + '.ai-section { border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-top: 16px; }'
  + '.ai-section-stats { background: #f8fffe; }'
  + '.ai-section-analysis { background: #fffff8; }'
  + '.ai-section-error { background: #fff5f5; color: #c53030; padding: 12px; border-radius: 4px; }'
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

    // Namespace for plugin state (Finding #19)
    window.aiEvalClient = passedInClient;
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
    statusHTML += '<div><span class="ai-setting-label">Please make sure that <em>AI_LLM_KEY</em><br>Environment variable is set.</span></div>';
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

        var analysisArea = document.getElementById('aiAnalysisArea');
        if (analysisArea) {
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
          if (parsed) {
            var analysisHtml = renderer.renderAnalysis(parsed);
            if (analysisArea) {
              analysisArea.innerHTML = '<div class="ai-section ai-section-analysis">' + analysisHtml + '</div>'; // eslint-disable-line no-unsanitized/property
            }
          } else {
            if (analysisArea) {
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
            var isTimeout = /timeout/i.test(error.message) || /ESOCKETTIMEDOUT|ETIMEDOUT/.test(error.message);
            var errorMsg = isTimeout
              ? 'LLM analysis timed out. Statistics are still available above. Try again or try a shorter date range.'
              : 'Error during analysis: ' + renderer.escapeHtml(error.message);
            var errorDiv = document.createElement('div');
            errorDiv.className = 'ai-section-error';
            errorDiv.textContent = errorMsg;
            var retryBtn = document.createElement('button');
            retryBtn.textContent = 'Retry';
            retryBtn.addEventListener('click', function () {
              var btn = document.getElementById('sendToAiButton');
              if (btn) btn.click();
            });
            errorDiv.appendChild(document.createElement('br'));
            errorDiv.appendChild(retryBtn);
            analysisArea.textContent = '';
            analysisArea.appendChild(errorDiv);
          }
        } finally {
          button.textContent = 'Send to AI';
          button.disabled = false;
          button.setAttribute('aria-busy', 'false');
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

        if (reportData && reportData.datastorage) {
          // Prepare data with client-side statistics
          var options = reportData.options || {};
          var result = dataProcessor.prepareCgmData(reportData.datastorage, settings, options);

          // Store on state
          var state = window.aiEvalState;
          state.cgmData = result.cgmData;
          state.dayStats = result.dayStats;
          state.periodStats = result.periodStats;

          // Render client-side statistics immediately (always visible, even if > 14 days)
          var statsArea = document.getElementById('aiStatsArea');
          if (statsArea) {
            var statsHtml = renderer.renderStats(result.periodStats, result.dayStats, result.cgmData.meta);
            var limitWarning = result.exceedsLimit
              ? '<div class="ai-section-error" style="margin-bottom:12px;" role="alert">AI analysis is limited to 14 days. Statistics are shown below. Please reduce the date range to enable AI analysis.</div>'
              : '';
            statsArea.innerHTML = limitWarning + '<div class="ai-section ai-section-stats">' + unifiedCss + statsHtml + '</div>'; // eslint-disable-line no-unsanitized/property
          }

          if (result.exceedsLimit) {
            var sendBtn = document.getElementById('sendToAiButton');
            if (sendBtn) sendBtn.disabled = true;
            if (window.tempAiEvalReportData) delete window.tempAiEvalReportData;
            return;
          }

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
                + JSON.stringify(payload, null, 2).substring(0, 2000) + '...';
            }
          }

          var costArea = document.getElementById('aiEstimatedCost');
          if (costArea) {
            var meta = result.cgmData.meta;
            costArea.textContent = 'Ready: ' + meta.days + ' days (' + (meta.from || '') + ' \u2013 ' + (meta.to || '') + ')';
          }
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

    , html: function (originalClient) {
      if (typeof window !== 'undefined') {
        window.tempAiClient = originalClient;
      }

      return ''
        + '<div id="ai-eval-container" style="padding: 20px;">'
        + '<div class="ai-disclaimer" role="alert"><strong>Important:</strong> The AI-generated analysis is <strong>not medical advice</strong>. Always consult a qualified healthcare provider before making treatment changes based on this analysis.</div>'
        + '<button id="sendToAiButton" disabled aria-busy="false" style="margin-top: 10px; padding: 8px 15px;">Send to AI</button>'
        + '<div id="aiEstimatedCost" style="margin-top: 10px;"></div>'
        + '<div id="aiStatsArea" aria-live="polite" style="margin-top: 20px;"></div>'
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
      var statsArea = document.getElementById('aiStatsArea');
      if (statsArea) statsArea.textContent = 'Computing statistics...';
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
