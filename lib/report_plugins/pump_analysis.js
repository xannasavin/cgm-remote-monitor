'use strict';

// Pump Analysis report tab: locally computed statistics and pump charts.
// Always registered; works without any AI key and never talks to the AI API.

var analysisCache = require('./pump_analysis/analysis_cache');
var renderUtils = require('./pump_analysis/render_utils');
var statsRenderer = require('./pump_analysis/stats_renderer');
var charts = require('./pump_analysis/charts');
var styles = require('./pump_analysis/styles');
var factorRec = require('./pump_analysis/factor_recommendations');

var reportClient = null;

function init (_ctx) {

  function renderCharts (result) {
    try {
      var pumpStats = result.pumpActionStats;
      var epTiming = result.episodeTiming;
      var dayDates = result.cgmData.days.map(function (d) { return d.date; });
      var hasPumpData = pumpStats && pumpStats.basal_source === 'pump'
        && pumpStats.coverage && pumpStats.coverage.pump_days > 0;

      // R3-3: validate nested `hotspots` shape before dispatch so a
      // partial orchestrator output can't crash D3 or leave a
      // "Loading chart…" forever. `perHour`, `hotspots`, `pumpDays`
      // must all exist for the hotspot strip to be meaningful.
      var hotspotsShape = pumpStats && pumpStats.hotspots;
      var hotspotsReady = hasPumpData
        && hotspotsShape
        && Array.isArray(hotspotsShape.perHour)
        && Array.isArray(hotspotsShape.hotspots)
        && typeof hotspotsShape.pumpDays === 'number';

      // R2-4: validate episodeTiming array shape before handing to D3.
      var epTimingReady = epTiming
        && Array.isArray(epTiming.hypoHourly) && epTiming.hypoHourly.length === 24
        && Array.isArray(epTiming.hyperHourly) && epTiming.hyperHourly.length === 24;

      // Per-hour unit delta (actual - scheduled); omitted when either hourly
      // array is missing (profile fallback / no pump).
      var deltaUnitsPerHour = null;
      // Also omitted when the profile is untrusted (basal_scheduled is not
      // reliable then; the basal chart is suppressed for the same reason).
      if (pumpStats && pumpStats.profile_valid !== false
          && pumpStats.basal_actual && Array.isArray(pumpStats.basal_actual.hourly)
          && pumpStats.basal_scheduled && Array.isArray(pumpStats.basal_scheduled.hourly)) {
        deltaUnitsPerHour = [];
        for (var dh = 0; dh < 24; dh++) {
          var actualH = pumpStats.basal_actual.hourly[dh];
          var schedH = pumpStats.basal_scheduled.hourly[dh];
          // Non-finite hourly values stay NaN so the chart skips that hour.
          deltaUnitsPerHour.push(typeof actualH === 'number' && isFinite(actualH)
            && typeof schedH === 'number' && isFinite(schedH)
            ? actualH - schedH : NaN);
        }
      }

      if (hotspotsReady) {
        charts.renderPumpActionHotspot('#aiPumpActionHotspot', {
          perHour: hotspotsShape.perHour
          , hotspots: hotspotsShape.hotspots
          , pumpDays: hotspotsShape.pumpDays
          , deltaUnitsPerHour: deltaUnitsPerHour
        }, {
          episodeOverlay: epTimingReady
          , episodeData: epTimingReady ? epTiming : null
        });

        if (pumpStats.profile_valid !== false
            && pumpStats.basal_actual && Array.isArray(pumpStats.basal_actual.hourly)
            && pumpStats.basal_scheduled && Array.isArray(pumpStats.basal_scheduled.hourly)) {
          charts.renderBasalDeltaChart('#aiBasalDeltaChart', {
            actualHourly: pumpStats.basal_actual.hourly
            , scheduledHourly: pumpStats.basal_scheduled.hourly
            , pumpDays: pumpStats.coverage.pump_days
          });
        }
      }

      if (pumpStats) {
        var dist = pumpStats.bolus_distribution || {};
        charts.renderInsulinDistributionChart('#aiInsulinDistributionChart', {
          basalHourly: (pumpStats.basal_for_chart && pumpStats.basal_for_chart.hourly) || new Array(24).fill(0)
          , userBolusHourly: dist.user_hourly || new Array(24).fill(0)
          , autoBolusHourly: dist.auto_hourly_total || new Array(24).fill(0)
        });
      }

      if (result.pumpExtras) {
        // Fail-soft: without mealCases every slot shows the empty state.
        var mealCases = Array.isArray(result.pumpExtras.mealCases) ? result.pumpExtras.mealCases : [];
        var meta = (result.cgmData && result.cgmData.meta) || {};
        ['breakfast', 'lunch', 'dinner'].forEach(function eachSlot (slot) {
          var slotCases = mealCases.filter(function inSlot (c) { return c && c.slot === slot; });
          charts.renderMealCurveChart('#aiMealCurve_' + slot, {
            slot: slot
            , cases: slotCases
            , medianCurve: factorRec.medianCurve(slotCases)
            , targetLow: meta.target_low
            , targetHigh: meta.target_high
            , units: meta.units
          });
        });
      }

      if (epTimingReady) {
        charts.renderEpisodeTimingChart('#aiEpisodeTimingChart', {
          hypoHourly: epTiming.hypoHourly
          , hyperHourly: epTiming.hyperHourly
          , hypoDaysAtHour: epTiming.hypoDaysAtHour || new Array(24).fill(0)
          , hyperDaysAtHour: epTiming.hyperDaysAtHour || new Array(24).fill(0)
          , hotspotMinDays: pumpStats && pumpStats.thresholds ? pumpStats.thresholds.hotspot_min_days : 3
          , totalDays: dayDates.length
        });
      }

      // Percentile bands and five ranges are page-only (pumpExtras); without
      // them (fail-soft / AI tab) the charts show their empty state.
      var extras = result.pumpExtras || {};
      if (result.periodStats.diurnal_patterns && result.periodStats.diurnal_patterns.length > 0) {
        charts.renderDiurnalChart('#aiDiurnalChart', extras.diurnalPercentiles, result.cgmData.meta);
      }
      if (result.dayStats && result.dayStats.length > 1) {
        charts.renderDailyTirChart('#aiDailyTirChart', extras.dailyRanges, dayDates);
      }
    } catch (err) {
      console.error('Pump Analysis: chart rendering failed:', err);
      var area = window.document.getElementById('pumpAnalysisStatsArea');
      if (area) {
        var skeletons = area.querySelectorAll('.cgm-chart-skeleton');
        for (var i = 0; i < skeletons.length; i++) {
          // escapeHtml() on the translated text
          skeletons[i].outerHTML = '<p class="cgm-meta">' // eslint-disable-line no-unsanitized/property
            + renderUtils.escapeHtml(renderUtils.translate('Chart unavailable.')) + '</p>';
        }
      }
    }
  }

  function html (client) {
    reportClient = client;
    var settings = (client && client.settings) || {};
    if (client && typeof client.translate === 'function') {
      renderUtils.setTranslate(client.translate);
    }
    var hint = settings.ai_llm_key_is_set
      ? ''
      : '<div id="pumpAnalysisAiHint" class="pump-analysis-hint" role="note">'
        + renderUtils.escapeHtml(renderUtils.translate('AI evaluation is not available: the AI_LLM_KEY environment variable is not set. All statistics on this page are calculated locally.'))
        + '</div>';
    return '<div id="pump-analysis-container">'
      + hint
      + '<div id="pumpAnalysisStatsArea"></div>'
      + '</div>';
  }

  function report (datastorage, sorteddaystoshow, options) {
    if (typeof window === 'undefined') return;
    var statsArea = window.document.getElementById('pumpAnalysisStatsArea');
    if (!statsArea) return;

    try {
      var result = analysisCache.getAnalysis(
        datastorage
        , (reportClient && reportClient.settings) || {}
        , options
        , sorteddaystoshow
      );
      var dayDates = result.cgmData.days.map(function (d) { return d.date; });
      var statsHtml = statsRenderer.renderStats(
        result.periodStats
        , result.dayStats
        , result.cgmData.meta
        , dayDates
        , result.pumpActionStats
        , result.episodeTiming
        , result.pumpExtras
      );
      // renderStats() output uses escapeHtml() on all dynamic values
      statsArea.innerHTML = '<div class="ai-section ai-section-stats">' + statsHtml + '</div>'; // eslint-disable-line no-unsanitized/property

      // Render D3 charts after the DOM has painted the container divs
      var draw = function () { renderCharts(result); };
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(draw);
      } else {
        setTimeout(draw, 0);
      }
    } catch (err) {
      console.error('Pump Analysis: could not compute statistics:', err);
      statsArea.innerHTML = '<div class="ai-section-error">' // eslint-disable-line no-unsanitized/property
        + renderUtils.escapeHtml(renderUtils.translate('Pump analysis could not be computed for this period.'))
        + '</div>';
    }
  }

  return {
    name: 'pump_analysis'
    , label: 'Pump Analysis'
    , html: html
    , css: styles.REPORT_CSS
    , report: report
    , renderCharts: renderCharts
  };
}

module.exports = init;
