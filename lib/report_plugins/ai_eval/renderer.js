'use strict';

/* ---------- i18n ---------- */
// Client-supplied translate function injected via setTranslate. Defaults to
// identity so the module renders plain English when not wired.
//
// R3-1 / R2-3: the translate reference lives on window instead of a
// module-level singleton so multiple concurrent AI eval instances
// (e.g. report opened in two tabs sharing the same bundle) share the same
// store. R3-4: translate() re-reads the function on every call and
// defensively checks it's still callable, so a stale reference or a
// disappeared client.translate cannot produce `'undefined'` in the UI.
var TRANSLATE_STORE_KEY = '__aiEvalTranslate';
var translateHost = (typeof window !== 'undefined')
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : {});
function setTranslate (fn) {
  if (typeof fn === 'function') translateHost[TRANSLATE_STORE_KEY] = fn;
}
function translate (key) {
  var fn = translateHost[TRANSLATE_STORE_KEY];
  return (typeof fn === 'function') ? fn(key) : key;
}

/* ---------- Utilities ---------- */

function escapeHtml (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate (dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return String(dateStr || '');
  var parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (parts) return parts[3] + '.' + parts[2] + '.' + parts[1];
  return dateStr;
}

function fmt (val, unit, decimals) {
  if (unit === undefined) unit = '';
  if (decimals === undefined) decimals = 1;
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return Number(val).toFixed(decimals) + unit;
}

function list (items) {
  items = items || [];
  return '<ul>' + items.map(function (x) { return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>';
}

// Render a treatment-insight list. Items are { text } objects per the current
// schema; legacy bare strings are also accepted for defence-in-depth when an
// older cached response slips through. Non-string `text` is normalised to ''
// and logged as a schema-violation warning instead of silently coercing.
//
// The extra `validHotspots` parameter is ignored and kept only for signature
// compatibility with callers that still pass it; the refers_to_hotspot
// citation feature was removed (see the historical note in schemas.js).
function coerceText (raw) {
  if (typeof raw === 'string') return raw;
  if (raw == null) return '';
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[ai_eval] renderInsightItem: non-string text on insight item:', raw);
  }
  return String(raw);
}

function renderInsightItem (item) {
  if (item == null) return '';
  var text;
  if (typeof item === 'string') {
    text = item;
  } else if (typeof item === 'object') {
    text = coerceText(item.text);
  } else {
    return '';
  }
  if (!text) return '';
  return '<li>' + escapeHtml(text) + '</li>';
}

function renderInsightList (items) {
  // R2-8: guard against non-array inputs (schema should prevent this but
  // a malformed LLM response shouldn't crash the renderer).
  if (!Array.isArray(items)) items = [];
  return '<ul>' + items.map(function (item) { return renderInsightItem(item); }).join('') + '</ul>';
}

function table (opts) {
  var head = opts.head;
  var rows = opts.rows;
  return '\n<table class="cgm-table" role="table">\n'
    + '<thead><tr>' + head.map(function (h) { return '<th scope="col">' + escapeHtml(h) + '</th>'; }).join('') + '</tr></thead>\n'
    + '<tbody>\n'
    + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + escapeHtml(c) + '</td>'; }).join('') + '</tr>'; }).join('\n')
    + '\n</tbody>\n</table>';
}

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

function renderStats (periodStats, dayStats, meta, dayDates, pumpActionStats, episodeTiming) {
  meta = meta || {};
  periodStats = periodStats || {};
  dayStats = dayStats || [];
  dayDates = dayDates || [];
  pumpActionStats = pumpActionStats || null;
  episodeTiming = episodeTiming || null;

  var units = meta.units || 'mg/dL';

  var periodTable = table({
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

  /* ---------- Pump Action sections (Phase C) ---------- */
  // Hotspot, Basal Delta, Insulin Distribution, Episode Timing. The first
  // two hide and show a notice when no pump data. The others always render.
  var pumpSectionsHtml = '';
  var hasPumpData = !!(pumpActionStats && pumpActionStats.basal_source === 'pump' && pumpActionStats.coverage && pumpActionStats.coverage.pump_days > 0);
  var profileValid = !pumpActionStats || pumpActionStats.profile_valid !== false;

  if (pumpActionStats || episodeTiming) {
    // R4-10: section intro — users previously saw 5 chart sections with no
    // guidance on what to look at first. One short framing sentence plus a
    // profile switch caveat (R5-4) if any switches were detected.
    var introText = hasPumpData
      ? translate('Pump automation analysis — the charts below show where your pump modified the scheduled therapy and when glucose episodes clustered.')
      : translate('Automation analysis — the charts below show when glucose episodes clustered. Pump-specific views are hidden because no pump events were found in this period.');
    pumpSectionsHtml += '<div class="cgm-analysis-intro" role="note"><strong>'
      + escapeHtml(translate('Automation analysis')) + '</strong> \u2014 '
      + escapeHtml(introText);
    if (pumpActionStats && pumpActionStats.profile_switch_detected) {
      pumpSectionsHtml += ' ' + escapeHtml(translate('Profile switch detected — basal delta may be approximate for this period.'));
    }
    pumpSectionsHtml += '</div>';
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
  if (periodStats.diurnal_patterns && periodStats.diurnal_patterns.length > 0) {
    diurnalHtml = table({
      head: [translate('Hour'), translate('Avg'), translate('SD'), translate('Days with Data')]
      , rows: periodStats.diurnal_patterns.map(function (p) {
        return [
          String(p.hour) + ':00'
          , fmt(p.avg, ' ' + units)
          , fmt(p.sd, ' ' + units)
          , String(p.days_with_data || 0)
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
    + '<section><h2>' + escapeHtml(translate('Period Statistics')) + '</h2>' + periodTable + '</section>'
    + pumpSectionsHtml
    + (treatmentHtml ? '<details class="cgm-details"><summary>' + escapeHtml(translate('Treatment Summary')) + '</summary>' + treatmentHtml + dataQualityHtml + '</details>' : '')
    + (diurnalHtml
      ? '<section class="cgm-chart-section"><h2>' + escapeHtml(translate('Diurnal Patterns')) + '</h2>'
        + chartPlaceholder('aiDiurnalChart', true)
        + '<details class="cgm-details"><summary>' + escapeHtml(translate('Hourly breakdown')) + '</summary>' + diurnalHtml + '</details>'
        + '</section>'
      : '')
    + '<section class="cgm-chart-section"><h2>' + escapeHtml(translate('Daily Breakdown')) + '</h2>'
    + chartPlaceholder('aiDailyTirChart', true)
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
  var totalDays = coverage.total_days || 1;

  var basalLabel;
  var basalPerDay;
  if (source === 'pump' && pumpDays > 0) {
    basalLabel = translate('basal delivered (pump, incl. Control-IQ adjustments)');
    basalPerDay = (actual.total || 0) / pumpDays;
  } else {
    basalLabel = translate('basal (profile-scheduled, no pump data)');
    basalPerDay = (scheduled.total || 0) / totalDays;
  }

  var userPerDay = (dist.user_total || 0) / totalDays;
  var autoPerDay = pumpDays > 0 ? ((dist.auto_total_by_bucket && (
    (dist.auto_total_by_bucket.near_meal || 0)
    + (dist.auto_total_by_bucket.intermediate || 0)
    + (dist.auto_total_by_bucket.far_from_meal || 0)
  )) || 0) / pumpDays : 0;

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

/* ---------- LLM Analysis Rendering (Unified Schema) ---------- */
// Renders interpretation, trends, and recommendations from LLM.
// Displayed below the client-side stats section.

function renderAnalysis (d) {
  if (!d) return '<p>No AI analysis available.</p>';

  var periodFrom = d.period ? formatDate(d.period.from || '') : '';
  var periodTo = d.period ? formatDate(d.period.to || '') : '';

  // Trends as cards with colored left border
  var severityColors = { critical: '#dc3545', warning: '#ffc107', info: '#17a2b8' };
  var trendsHtml = '<div class="ai-trends-list">';
  (d.trends || []).forEach(function (t) {
    var color = severityColors[t.severity] || '#6c757d';
    trendsHtml += '<div class="ai-trend-card" style="border-left:4px solid ' + color + ';">'
      + '<div class="ai-trend-header">'
      + '<span class="ai-severity-badge" style="background:' + color + ';">' + escapeHtml(t.severity || '') + '</span>'
      + '<strong>' + escapeHtml(t.label || '') + '</strong>'
      + '</div>'
      + '<p class="ai-trend-evidence">' + escapeHtml(t.evidence || '') + '</p>'
      + '</div>';
  });
  trendsHtml += '</div>';

  // Recommendations with action + rationale
  var rec = d.recommendations || {};
  var therapyList = (rec.therapy_settings || []).map(function (r) {
    return escapeHtml(r.action || '') + ' \u2014 <em>' + escapeHtml(r.rationale || '') + '</em>';
  });
  var behavioralList = (rec.behavioral_timing || []).map(function (r) {
    return escapeHtml(r.action || '') + ' \u2014 <em>' + escapeHtml(r.rationale || '') + '</em>';
  });
  var monitoringList = (rec.monitoring || []).map(function (m) {
    return escapeHtml(m);
  });

  var recHtml = '<div class="cgm-grid-3col">'
    + '<section><h3>Therapy Settings</h3><ul>' + therapyList.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></section>'
    + '<section><h3>Behavioral Timing</h3><ul>' + behavioralList.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></section>'
    + '<section><h3>Monitoring</h3><ul>' + monitoringList.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></section>'
    + '</div>';

  // Treatment Insights (optional from LLM).
  // Items arrive as { text } objects per the current schema; legacy bare
  // strings are also tolerated by renderInsightItem.
  var treatmentInsightsHtml = '';
  if (d.treatment_insights) {
    var ti = d.treatment_insights;
    treatmentInsightsHtml = '<section><h2>' + escapeHtml(translate('Treatment Insights')) + '</h2>'
      + '<div class="cgm-grid-2col">'
      + '<section><h3>' + escapeHtml(translate('Carb Patterns')) + '</h3>' + renderInsightList(ti.carb_patterns) + '</section>'
      + '<section><h3>' + escapeHtml(translate('Insulin Patterns')) + '</h3>' + renderInsightList(ti.insulin_patterns) + '</section>'
      + '<section><h3>' + escapeHtml(translate('Basal Observations')) + '</h3>' + renderInsightList(ti.basal_observations) + '</section>'
      + '<section><h3>' + escapeHtml(translate('Dosing Observations')) + '</h3>' + renderInsightList(ti.dosing_observations) + '</section>'
      + '</div></section>';
  }

  // Per-day notes
  var perDayHtml = '';
  if (d.per_day && d.per_day.length > 0) {
    var perDayRows = d.per_day.map(function (pd) {
      return [
        formatDate(pd.date || '')
        , (pd.notes || []).join('; ')
      ];
    });
    perDayHtml = table({
      head: ['Date', 'Notes']
      , rows: perDayRows
    });
  }

  return '<div class="cgm-wrap">'
    + '<h1>AI Analysis \u2014 ' + escapeHtml(periodFrom + ' \u2013 ' + periodTo) + '</h1>'
    + '<section><h2>Summary</h2>' + list(d.summary || []) + '</section>'
    + '<section><h2>Trends</h2>' + trendsHtml + '</section>'
    + '<section><h2>Recommendations</h2>' + recHtml + '</section>'
    + treatmentInsightsHtml
    + (perDayHtml ? '<section><h2>Daily Notes</h2>' + perDayHtml + '</section>' : '')
    + (d.data_quality_notes && d.data_quality_notes.length > 0
      ? '<section><h2>Data Quality Notes</h2>' + list(d.data_quality_notes) + '</section>'
      : '')
    + '</div>';
}

// renderCgmReport sets innerHTML on a mount element with HTML constructed entirely
// from escaped content (all LLM-sourced and user strings pass through escapeHtml).
function renderCgmReport (data, mount) {
  var el = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!el) throw new Error('Mount element not found');

  // Unified schema detection: has trends + recommendations.therapy_settings
  var isUnified = data.trends && data.recommendations && data.recommendations.therapy_settings;
  if (isUnified) {
    el.innerHTML = renderAnalysis(data); // eslint-disable-line no-unsanitized/property
  } else if (data.period) {
    el.innerHTML = renderMultiDay(data); // eslint-disable-line no-unsanitized/property
  } else {
    el.innerHTML = renderDaily(data); // eslint-disable-line no-unsanitized/property
  }
}

/* ---------- Legacy renderers (kept for backward compat during transition) ---------- */

function renderDaily (d) {
  var stats = d.statistics || {};
  var blocks = d.dailyPatterns || {};

  var statsTable = table({
    head: ['Metric', 'Value']
    , rows: [
      ['Average Glucose', fmt(stats.average_glucose_mgdl, ' mg/dL')]
      , ['Median Glucose', fmt(stats.median_glucose_mgdl, ' mg/dL')]
      , ['Standard Deviation', fmt(stats.standard_deviation_mgdl, ' mg/dL')]
      , ['CV', fmt(stats.cv_percent, ' %')]
      , ['Time in Range', fmt(stats.time_in_range_percent, ' %')]
      , ['Time Below Range', fmt(stats.time_below_range_percent, ' %')]
      , ['Time Above Range', fmt(stats.time_above_range_percent, ' %')]
    ]
  });

  var patternRows = ['00-06', '06-12', '12-18', '18-24'].map(function (b) {
    var v = blocks[b] || {};
    return [b, fmt(v.avg, ' mg/dL'), fmt(v.sd, ' mg/dL'), fmt(v.in_range_pct, ' %')];
  });
  var patternsTable = table({
    head: ['Time Block', 'Avg', 'SD', 'In Range %']
    , rows: patternRows
  });

  return '<div class="cgm-wrap">'
    + '<h1>Daily CGM Report \u2014 ' + escapeHtml(d.date || '') + '</h1>'
    + '<section><h2>Summary</h2>' + list(d.summary || []) + '</section>'
    + '<section><h2>Statistics</h2>' + statsTable + '</section>'
    + '<section><h2>Daily Patterns</h2>' + patternsTable + '</section>'
    + '<section><h2>Recommendations</h2>' + list(d.recommendations || []) + '</section>'
    + '</div>';
}

function renderMultiDay (d) {
  var stats = d.overall_statistics || {};
  var rec = d.recommendations || {};

  var statsTable = table({
    head: ['Metric', 'Value']
    , rows: [
      ['Average Glucose', fmt(stats.average_glucose_mgdl, ' mg/dL')]
      , ['CV', fmt(stats.cv_percent, ' %')]
      , ['Time in Range', fmt(stats.time_in_range_percent, ' %')]
    ]
  });

  var recHtml = '<div class="cgm-grid-3col">'
    + '<section><h3>Therapy Settings</h3>' + list(rec.therapy_settings || []) + '</section>'
    + '<section><h3>Behavioral Timing</h3>' + list(rec.behavioral_timing || []) + '</section>'
    + '<section><h3>Monitoring</h3>' + list(rec.monitoring || []) + '</section>'
    + '</div>';

  var periodFrom = d.period ? d.period.from || '' : '';
  var periodTo = d.period ? d.period.to || '' : '';

  return '<div class="cgm-wrap">'
    + '<h1>Multi\u2011Day CGM Report \u2014 ' + escapeHtml(periodFrom + ' \u2013 ' + periodTo) + '</h1>'
    + '<section><h2>Summary</h2>' + list(d.summary || []) + '</section>'
    + '<section><h2>Overall Statistics</h2>' + statsTable + '</section>'
    + '<section><h2>Trends</h2>' + list((d.trends || []).map(function (t) { return (t.label || '') + ': ' + (t.evidence || ''); })) + '</section>'
    + '<section><h2>Recommendations</h2>' + recHtml + '</section>'
    + '</div>';
}

module.exports = {
  escapeHtml: escapeHtml
  , formatDate: formatDate
  , fmt: fmt
  , list: list
  , table: table
  , renderStats: renderStats
  , renderAnalysis: renderAnalysis
  , renderDaily: renderDaily
  , renderMultiDay: renderMultiDay
  , renderCgmReport: renderCgmReport
  , setTranslate: setTranslate
};
