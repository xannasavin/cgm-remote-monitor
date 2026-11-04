'use strict';

var renderUtils = require('./render_utils');
var translate = renderUtils.translate;
var escapeHtml = renderUtils.escapeHtml;
var formatDate = renderUtils.formatDate;
var fmt = renderUtils.fmt;
var table = renderUtils.table;
var tableCells = renderUtils.tableCells;
var glucoseUnits = require('./glucose_units');
var recommendationsRenderer = require('./recommendations_renderer');

/* ---------- Client-side Statistics Rendering ---------- */
// Renders deterministic statistics computed by lib/statistics.js.
// Always available, even when LLM call fails or is skipped.

function coverageBadge (pumpStats) {
  if (!pumpStats || !pumpStats.coverage) return '';
  var c = pumpStats.coverage;
  // R4-8: include both an explicit "days with pump data" phrase and a
  // percentage so the badge is unambiguous. "Coverage" alone was jargon.
  var pct = c.total_days > 0 ? Math.round((c.pump_days / c.total_days) * 100) : 0;
  var label = translate('Pump data: %1/%2 days (%3%)')
    .replace('%1', String(c.pump_days))
    .replace('%2', String(c.total_days))
    .replace('%3', String(pct));
  return '<span class="cgm-coverage-badge" title="' + escapeHtml(translate('Only pump-covered days contribute to this chart')) + '">'
    + escapeHtml(label) + '</span>';
}

function sectionSubtitle (key) {
  return '<p class="cgm-section-subtitle">' + escapeHtml(translate(key)) + '</p>';
}

// R4-5: skeleton placeholder instead of "Loading chart…" text so the transition
// from placeholder to D3 SVG isn't a visible text flash.
function chartPlaceholder (id, tall) {
  return '<div id="' + id + '" class="cgm-chart-mount">'
    + '<div class="cgm-chart-skeleton' + (tall ? ' cgm-chart-skeleton-tall' : '') + '" aria-hidden="true"></div>'
    + '</div>';
}

// The period table: 8 headline metrics for the whole report range.
// opts.explained adds GMI plus Target and Meaning columns with status colors
// (pump tab). Without it the short 8-row table is rendered (AI tab).
var TARGETS = {
  tir_min: 70       // % time in range, above is ok
  , tbr_max: 4      // % time below range, below is ok
  , tar_max: 25     // % time above range, below is ok
  , cv_max: 36      // % coefficient of variation, up to is ok
  , gmi_max: 7      // % GMI, below is ok
  , mage_rough: 60  // mg/dl, no coloring
  , sd_rough: 50    // mg/dl, no coloring
};

function statusCell (text, ok) {
  if (ok === null) return text;
  return { text: text, cls: ok ? 'cgm-ok' : 'cgm-warn' };
}

function isNum (v) {
  return typeof v === 'number' && !Number.isNaN(v);
}

function renderExplainedSummary (periodStats, meta) {
  var units = (meta && meta.units) || 'mg/dL';
  // Missing targets show '-' instead of an empty gap in the Meaning texts.
  var low = meta && isNum(meta.target_low) ? String(meta.target_low) : '-';
  var high = meta && isNum(meta.target_high) ? String(meta.target_high) : '-';
  var gmi = glucoseUnits.computeGmi(isNum(periodStats.average) ? glucoseUnits.toMgdl(periodStats.average, units) : null);
  var roughDecimals = glucoseUnits.fromMgdl(60, units) !== 60 ? 1 : 0;
  function rough (mgdl) {
    return translate('< %1 (rough)').replace('%1', fmt(glucoseUnits.fromMgdl(mgdl, units), '', roughDecimals));
  }
  var pctOf = function (v, test) { return isNum(v) ? test(v) : null; };

  return tableCells({
    head: [translate('Metric'), translate('Value'), translate('Target value'), translate('Meaning')]
    , rows: [
      [translate('Average Glucose'), fmt(periodStats.average, ' ' + units), '-', translate('Mean of all sensor values.')]
      , [translate('Median Glucose'), fmt(periodStats.median, ' ' + units), '-', translate('Middle value: half of the readings are higher, half lower.')]
      , [translate('GMI'), statusCell(fmt(gmi, ' %'), pctOf(gmi, function (v) { return v < TARGETS.gmi_max; })), '< ' + TARGETS.gmi_max + ' %'
        , translate('Glucose Management Indicator: HbA1c estimated from the average. Roughly comparable to the lab value.')]
      , [translate('Standard Deviation'), fmt(periodStats.sd, ' ' + units), rough(TARGETS.sd_rough), translate('Typical distance of the values from the mean.')]
      , [translate('CV'), statusCell(fmt(periodStats.cv, ' %'), pctOf(periodStats.cv, function (v) { return v <= TARGETS.cv_max; })), '≤ ' + TARGETS.cv_max + ' %'
        , translate('Coefficient of variation: how much glucose varies relative to the mean. Below %1 % is considered stable.').replace('%1', String(TARGETS.cv_max))]
      , [translate('MAGE'), fmt(periodStats.mage_overall, ' ' + units), rough(TARGETS.mage_rough)
        , translate('Mean height of the large swings (peak to trough). Small wiggles do not count. Lower is calmer.')]
      , [translate('Time in Range'), statusCell(fmt(periodStats.tir_pct, ' %'), pctOf(periodStats.tir_pct, function (v) { return v > TARGETS.tir_min; })), '> ' + TARGETS.tir_min + ' %'
        , translate('Share of time between %1 and %2 %3.').replace('%1', low).replace('%2', high).replace('%3', units)]
      , [translate('Time Below Range'), statusCell(fmt(periodStats.tbr_pct, ' %'), pctOf(periodStats.tbr_pct, function (v) { return v < TARGETS.tbr_max; })), '< ' + TARGETS.tbr_max + ' %'
        , translate('Share of time below %1 %2.').replace('%1', low).replace('%2', units)]
      , [translate('Time Above Range'), statusCell(fmt(periodStats.tar_pct, ' %'), pctOf(periodStats.tar_pct, function (v) { return v < TARGETS.tar_max; })), '< ' + TARGETS.tar_max + ' %'
        , translate('Share of time above %1 %2.').replace('%1', high).replace('%2', units)]
    ]
  });
}

function renderPeriodSummary (periodStats, meta, opts) {
  periodStats = periodStats || {};
  if (opts && opts.explained) return renderExplainedSummary(periodStats, meta);
  var units = (meta && meta.units) || 'mg/dL';
  return table({
    head: [translate('Metric'), translate('Value')]
    , rows: [
      [translate('Average Glucose'), fmt(periodStats.average, ' ' + units)]
      , [translate('Median Glucose'), fmt(periodStats.median, ' ' + units)]
      , [translate('Standard Deviation'), fmt(periodStats.sd, ' ' + units)]
      , [translate('CV'), fmt(periodStats.cv, ' %')]
      , [translate('MAGE'), fmt(periodStats.mage_overall, ' ' + units)]
      , [translate('Time in Range'), fmt(periodStats.tir_pct, ' %')]
      , [translate('Time Below Range'), fmt(periodStats.tbr_pct, ' %')]
      , [translate('Time Above Range'), fmt(periodStats.tar_pct, ' %')]
    ]
  });
}

// pumpExtras (7th parameter, pump tab only): { recommendations, ... }. The AI
// tab and old callers omit it; without recommendations no cards are rendered.
function renderStats (periodStats, dayStats, meta, dayDates, pumpActionStats, episodeTiming, pumpExtras) {
  meta = meta || {};
  var recommendationsHtml = pumpExtras && pumpExtras.recommendations
    ? recommendationsRenderer.renderRecommendations(pumpExtras.recommendations)
    : '';
  periodStats = periodStats || {};
  dayStats = dayStats || [];
  dayDates = dayDates || [];
  pumpActionStats = pumpActionStats || null;
  episodeTiming = episodeTiming || null;

  var units = meta.units || 'mg/dL';

  var periodTable = renderPeriodSummary(periodStats, meta, { explained: true });

  /* ---------- Pump Action sections (Phase C) ---------- */
  // Hotspot, Basal Delta, Insulin Distribution, Episode Timing. The first
  // two hide and show a notice when no pump data. The others always render.
  var pumpSectionsHtml = '';
  var introHtml = '';
  var hasPumpData = !!(pumpActionStats && pumpActionStats.basal_source === 'pump' && pumpActionStats.coverage && pumpActionStats.coverage.pump_days > 0);
  var profileValid = !pumpActionStats || pumpActionStats.profile_valid !== false;

  if (pumpActionStats || episodeTiming) {
    // R4-10: section intro — users previously saw 5 chart sections with no
    // guidance on what to look at first. One short framing sentence plus a
    // profile switch caveat (R5-4) if any switches were detected.
    var introText = hasPumpData
      ? translate('Pump automation analysis — the charts below show where your pump modified the scheduled therapy and when glucose episodes clustered.')
      : translate('Automation analysis — the charts below show when glucose episodes clustered. Pump-specific views are hidden because no pump events were found in this period.');
    introHtml = '<div class="cgm-analysis-intro" role="note"><strong>'
      + escapeHtml(translate('Automation analysis')) + '</strong> \u2014 '
      + escapeHtml(introText);
    if (pumpActionStats && pumpActionStats.profile_switch_detected) {
      introHtml += ' ' + escapeHtml(translate('Profile switch detected — basal delta may be approximate for this period.'));
    }
    introHtml += '</div>';
  }

  if (pumpActionStats) {
    if (hasPumpData) {
      // Pump Action Hotspots
      var hotspotsList = pumpActionStats.hotspots && pumpActionStats.hotspots.hotspots
        ? pumpActionStats.hotspots.hotspots : [];
      // R4-6: neutral observation instead of "therapy appears stable"
      // (clinical claim the software shouldn't make).
      var hotspotEmptyMsg = hotspotsList.length === 0
        ? '<p class="cgm-meta">' + escapeHtml(translate('No pump adjustments beyond scheduled rates detected for this period.')) + '</p>'
        : '';
      pumpSectionsHtml += '<section class="cgm-pump-section">'
        + '<h2>' + escapeHtml(translate('Pump Action Hotspots')) + coverageBadge(pumpActionStats) + '</h2>'
        + sectionSubtitle('Hours where the pump modified the scheduled therapy most often. Red shading = pump added insulin, blue = pump held it back.')
        + chartPlaceholder('aiPumpActionHotspot', false)
        + hotspotEmptyMsg
        + '</section>';

      // Basal Delta (only when profile is valid — otherwise show issue notice).
      // R2-2: surface profile_issue string when validation failed so users
      // can actually diagnose their profile.
      if (profileValid) {
        pumpSectionsHtml += '<section class="cgm-pump-section">'
          + '<h2>' + escapeHtml(translate('Basal Delta')) + coverageBadge(pumpActionStats) + '</h2>'
          + sectionSubtitle('Your profile\u2019s scheduled basal rate (dashed) vs the basal the pump actually delivered (solid). Gaps between the two lines are candidates for profile tweaks.')
          + chartPlaceholder('aiBasalDeltaChart', true)
          + '</section>';
      } else {
        var profileIssue = pumpActionStats.profile_issue || '';
        var issueDetail = profileIssue
          ? ' (' + translate('reason') + ': ' + profileIssue + ')'
          : '';
        pumpSectionsHtml += '<section class="cgm-pump-section">'
          + '<h2>' + escapeHtml(translate('Basal Delta')) + '</h2>'
          + '<p class="cgm-meta">'
          + escapeHtml(translate('Profile data unavailable \u2014 basal delta cannot be computed') + issueDetail)
          + '</p>'
          + '</section>';
      }
    } else {
      // Fallback notice for both pump sections.
      // R4-7: explain which sections are hidden AND why Insulin Distribution
      // still renders below.
      pumpSectionsHtml += '<section class="cgm-pump-notice" role="note">'
        + '<p><strong>' + escapeHtml(translate('No pump events in this period')) + '.</strong> '
        + escapeHtml(translate('The Pump Action Hotspots and Basal Delta views need Temp Basal / Auto Bolus / Basal Suspension events to work, so they are hidden.')) + '</p>'
        + '<p class="cgm-meta">' + escapeHtml(translate('Insulin Distribution below still renders, using your profile\u2019s scheduled basal as the basal layer.')) + '</p>'
        + '</section>';
    }

    // Insulin Distribution (always shows — uses profile fallback when no pump)
    pumpSectionsHtml += '<section class="cgm-pump-section">'
      + '<h2>' + escapeHtml(translate('Insulin Distribution')) + '</h2>'
      + sectionSubtitle('24-hour stacked view: basal at the bottom, user boluses in the middle, automatic corrections on top.')
      + chartPlaceholder('aiInsulinDistributionChart', true)
      + renderInsulinLegend(pumpActionStats)
      + '</section>';
  }

  // Meal Response Curves (pump tab only: pumpExtras is given). The charts
  // fill in client-side; without meal cases they show an empty state.
  if (pumpExtras) {
    pumpSectionsHtml += '<section class="cgm-pump-section">'
      + '<h2>' + escapeHtml(translate('Meal Response Curves')) + '</h2>'
      + sectionSubtitle('Glucose from the meal bolus up to 4 hours later. Thin lines are single meals, the bold line is the median, the green band is your target range.');
    ['breakfast', 'lunch', 'dinner'].forEach(function eachSlot (slot) {
      pumpSectionsHtml += '<h3>' + escapeHtml(renderUtils.slotLabel(slot)) + '</h3>'
        + chartPlaceholder('aiMealCurve_' + slot, true);
    });
    pumpSectionsHtml += '</section>';
  }

  // Episode Timing — always renders when episodeTiming is available
  if (episodeTiming) {
    pumpSectionsHtml += '<section class="cgm-pump-section">'
      + '<h2>' + escapeHtml(translate('Episode Timing')) + '</h2>'
      + sectionSubtitle('Hourly minutes spent in hypo (left) and hyper (right). Dashed outlines mark hours where episodes recurred across multiple days.')
      + chartPlaceholder('aiEpisodeTimingChart', true)
      + '</section>';
  }

  // R5-1: surface validation warnings the stats layer may attach
  if (pumpActionStats && Array.isArray(pumpActionStats.validation_warnings) && pumpActionStats.validation_warnings.length > 0) {
    var warnCount = pumpActionStats.validation_warnings.length;
    var warnItems = pumpActionStats.validation_warnings.slice(0, 10).map(function (w) {
      return '<li>' + escapeHtml(String(w)) + '</li>';
    }).join('');
    pumpSectionsHtml += '<details class="cgm-details">'
      + '<summary>\u26A0 ' + escapeHtml(translate('Data validation warnings')) + ' (' + warnCount + ')</summary>'
      + '<ul>' + warnItems + '</ul>'
      + (warnCount > 10 ? '<p class="cgm-meta">' + escapeHtml(translate('\u2026 and more, truncated for display')) + '</p>' : '')
      + '</details>';
  }

  /* ---------- Treatment Summary (new split) ---------- */
  var treatmentHtml = '';
  var ts = periodStats.treatment_summary;
  if (ts && (ts.total_carbs > 0 || ts.total_insulin > 0)) {
    var tsRows = [
      [translate('Avg Daily Carbs'), fmt(ts.avg_daily_carbs, ' g')]
      , [translate('Avg Daily Insulin'), fmt(ts.avg_daily_insulin, ' U')]
    ];
    if (ts.avg_daily_user_boluses != null || ts.avg_daily_auto_boluses != null) {
      tsRows.push([translate('Avg Daily User Boluses'), fmt(ts.avg_daily_user_boluses, '')]);
      tsRows.push([translate('Avg Daily Auto Boluses'), fmt(ts.avg_daily_auto_boluses, '')]);
      tsRows.push([translate('Avg Daily User Bolus Insulin'), fmt(ts.avg_daily_user_bolus_insulin, ' U')]);
      tsRows.push([translate('Avg Daily Auto Bolus Insulin'), fmt(ts.avg_daily_auto_bolus_insulin, ' U')]);
    } else {
      tsRows.push([translate('Avg Daily Boluses'), fmt(ts.avg_daily_boluses, '')]);
    }
    tsRows.push([translate('Total Carbs'), fmt(ts.total_carbs, ' g')]);
    tsRows.push([translate('Total Insulin'), fmt(ts.total_insulin, ' U')]);

    treatmentHtml = table({ head: [translate('Metric'), translate('Value')], rows: tsRows });
  }

  // Data-quality callout — shows under Treatment Summary when totals reflect
  // what Nightscout has rather than what the pump delivered. R2-7: trigger
  // whenever any day is CGM-only (not only < 50%) so mixed-coverage weeks
  // always get the disclosure. R4-4: softened tone so it reads as a friendly
  // coverage note instead of "your data is broken".
  var dataQualityHtml = '';
  if (pumpActionStats) {
    var coverage = pumpActionStats.coverage || {};
    var mixedCoverage = coverage.total_days > 0 && coverage.pump_days < coverage.total_days;
    if (pumpActionStats.basal_source === 'profile_fallback' || mixedCoverage) {
      var missingDays = coverage.total_days - coverage.pump_days;
      var noteBody;
      if (pumpActionStats.basal_source === 'profile_fallback') {
        noteBody = translate('No pump events were found for this period, so totals come from Nightscout\u2019s bolus and carb entries plus your profile\u2019s scheduled basal. They\u2019re a reasonable picture for CGM-only days but will differ from your pump\u2019s own total daily dose.');
      } else {
        noteBody = translate('%1 of %2 days in this period have no pump events. Insulin totals reflect what Nightscout has, so they can be lower than your pump\u2019s own total daily dose on those days.')
          .replace('%1', String(missingDays))
          .replace('%2', String(coverage.total_days));
      }
      dataQualityHtml = '<div class="cgm-data-quality-note" role="note">'
        + '<strong>' + escapeHtml(translate('Coverage note')) + ':</strong> '
        + escapeHtml(noteBody)
        + '</div>';
    }
  }

  /* ---------- Diurnal / Daily Breakdown (collapsed) ---------- */
  var diurnalHtml = '';
  // Gated on the page-only percentiles (display units), not on the legacy
  // periodStats.diurnal_patterns, which are empty for mmol users.
  var hasDiurnal = !!(pumpExtras && Array.isArray(pumpExtras.diurnalPercentiles) && pumpExtras.diurnalPercentiles.length > 0);
  if (hasDiurnal) {
    diurnalHtml = table({
      head: [translate('Hour'), translate('P25'), translate('Median'), translate('P75'), translate('Readings')]
      , rows: pumpExtras.diurnalPercentiles.map(function (p) {
        return [
          String(p.hour) + ':00'
          , fmt(p.p25, ' ' + units)
          , fmt(p.p50, ' ' + units)
          , fmt(p.p75, ' ' + units)
          , String(p.n || 0)
        ];
      })
    });
  }

  var dayRows = dayStats.map(function (ds, i) {
    var dateLabel = dayDates[i] ? formatDate(dayDates[i]) : String(i + 1);
    var coverageKeys = pumpActionStats && pumpActionStats.coverage
      ? (pumpActionStats.coverage.pump_day_keys || [])
      : [];
    var pumpCovered = coverageKeys.indexOf(dayDates[i]) !== -1;
    return [
      dateLabel
      , pumpCovered ? translate('pump') : translate('CGM-only')
      , fmt(ds.average, '', 0)
      , fmt(ds.sd, '', 0)
      , fmt(ds.cv, ' %')
      , fmt(ds.mage, '', 0)
      , fmt(ds.tir_pct, ' %')
      , fmt(ds.tbr_pct, ' %')
      , fmt(ds.tar_pct, ' %')
      , fmt(ds.total_carbs, ' g', 0)
      , fmt(ds.total_insulin, ' U')
      , String((ds.user_bolus_count || 0) + '/' + (ds.auto_bolus_count || 0))
      , String(ds.hypo_episodes ? ds.hypo_episodes.length : 0)
      , String(ds.hyper_episodes ? ds.hyper_episodes.length : 0)
      , String(ds.total_readings || 0)
    ];
  });

  var dayTable = dayRows.length > 0 ? table({
    head: [translate('Date'), translate('Coverage'), translate('Avg'), translate('SD'), translate('CV'), translate('MAGE'), translate('TIR'), translate('TBR'), translate('TAR'), translate('Carbs'), translate('Insulin'), translate('User/Auto'), translate('Hypo'), translate('Hyper'), translate('Readings')]
    , rows: dayRows
  }) : '<p>' + escapeHtml(translate('No daily data available.')) + '</p>';

  // R4-9: User/Auto split is confusing for non-Control-IQ users whose Auto
  // column is always 0. A short footnote explains it without cluttering the
  // table header.
  var userAutoFootnote = '<p class="cgm-meta">'
    + escapeHtml(translate('User/Auto column shows the count of user-initiated boluses and automatic correction boluses (Control-IQ and similar systems). If you\u2019re not on an automated pump, the Auto count will stay at 0.'))
    + '</p>';

  var from = formatDate(meta.from || '');
  var to = formatDate(meta.to || '');

  // Charts live above their collapsible tables — the charts are the primary
  // signal, the tables are the drill-down data. Keeping charts outside the
  // <details> means they stay visible regardless of expand/collapse state.
  return '<div class="cgm-wrap">'
    + '<h1>' + escapeHtml(translate('CGM Statistics')) + ' \u2014 ' + escapeHtml(from + ' \u2013 ' + to) + '</h1>'
    + '<p class="cgm-meta">' + escapeHtml(String(meta.days || 0)) + ' ' + escapeHtml(translate('days')) + ' \u00b7 '
    + escapeHtml(units) + ' \u00b7 ' + escapeHtml(translate('Target')) + ' '
    + escapeHtml(String(meta.target_low || '')) + '\u2013' + escapeHtml(String(meta.target_high || ''))
    + '</p>'
    + introHtml
    + recommendationsHtml
    + '<section><h2>' + escapeHtml(translate('Period Statistics')) + '</h2><div class="cgm-table-scroll">' + periodTable + '</div></section>'
    + pumpSectionsHtml
    + (treatmentHtml ? '<details class="cgm-details"><summary>' + escapeHtml(translate('Treatment Summary')) + '</summary>' + treatmentHtml + dataQualityHtml + '</details>' : '')
    + (hasDiurnal
      ? '<section class="cgm-chart-section"><h2>' + escapeHtml(translate('Diurnal Patterns')) + '</h2>'
        + chartPlaceholder('aiDiurnalChart', true)
        + (diurnalHtml
          ? '<details class="cgm-details"><summary>' + escapeHtml(translate('Hourly breakdown')) + '</summary>' + diurnalHtml + '</details>'
          : '')
        + '</section>'
      : '')
    + '<section class="cgm-chart-section"><h2>' + escapeHtml(translate('Daily Breakdown')) + '</h2>'
    + (dayStats.length > 1 ? chartPlaceholder('aiDailyTirChart', true) : '')
    + '<details class="cgm-details"><summary>' + escapeHtml(translate('Per-day table')) + '</summary>'
    + dayTable
    + userAutoFootnote
    + '</details>'
    + '</section>'
    + '</div>';
}

function renderInsulinLegend (pumpActionStats) {
  if (!pumpActionStats) return '';
  var source = pumpActionStats.basal_source;
  var actual = pumpActionStats.basal_actual || {};
  var scheduled = pumpActionStats.basal_scheduled || {};
  var dist = pumpActionStats.bolus_distribution || {};
  var coverage = pumpActionStats.coverage || {};
  var pumpDays = coverage.pump_days || 0;

  // The totals from computePumpActionStats are already per-day means
  // (sums of hourly means), so they are shown as they are.
  var basalLabel;
  var basalPerDay;
  if (source === 'pump' && pumpDays > 0) {
    basalLabel = translate('basal delivered (pump, incl. Control-IQ adjustments)');
    basalPerDay = actual.total || 0;
  } else {
    basalLabel = translate('basal (profile-scheduled, no pump data)');
    basalPerDay = scheduled.total || 0;
  }

  var userPerDay = dist.user_total || 0;
  var autoPerDay = pumpDays > 0 ? ((dist.auto_total_by_bucket && (
    (dist.auto_total_by_bucket.near_meal || 0)
    + (dist.auto_total_by_bucket.intermediate || 0)
    + (dist.auto_total_by_bucket.far_from_meal || 0)
  )) || 0) : 0;

  // R1-5 + R3-9: colors match the COLORS constant in charts.js.
  var items = [
    '<span class="cgm-legend-item"><span class="cgm-legend-swatch" style="background:#17a2b8"></span>'
      + escapeHtml(basalLabel) + ' ' + escapeHtml(basalPerDay.toFixed(2)) + ' '
      + escapeHtml(translate('U/day')) + '</span>'
    , '<span class="cgm-legend-item"><span class="cgm-legend-swatch" style="background:#6f42c1"></span>'
      + escapeHtml(translate('user bolus')) + ' ' + escapeHtml(userPerDay.toFixed(2)) + ' '
      + escapeHtml(translate('U/day')) + '</span>'
  ];
  if (source === 'pump' && pumpDays > 0) {
    items.push('<span class="cgm-legend-item"><span class="cgm-legend-swatch" style="background:#b45309"></span>'
      + escapeHtml(translate('auto correction')) + ' ' + escapeHtml(autoPerDay.toFixed(2)) + ' '
      + escapeHtml(translate('U/day')) + '</span>');
  }

  // eslint-disable-next-line no-unsanitized/method
  return '<div class="cgm-insulin-legend">' + items.join(' ') + '</div>';
}

module.exports = {
  renderStats: renderStats
  , renderPeriodSummary: renderPeriodSummary
};
