'use strict';

/* ---------- Utilities ---------- */

function escapeHtml (s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

function table (opts) {
  var head = opts.head;
  var rows = opts.rows;
  return '\n<table class="cgm-table" role="table">\n'
    + '<thead><tr>' + head.map(function (h) { return '<th scope="col">' + escapeHtml(h) + '</th>'; }).join('') + '</tr></thead>\n'
    + '<tbody>\n'
    + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('\n')
    + '\n</tbody>\n</table>';
}

/* ---------- Client-side Statistics Rendering ---------- */
// Renders deterministic statistics computed by lib/statistics.js.
// Always available, even when LLM call fails or is skipped.

function renderStats (periodStats, dayStats, meta) {
  meta = meta || {};
  periodStats = periodStats || {};
  dayStats = dayStats || [];

  var periodTable = table({
    head: ['Metric', 'Value']
    , rows: [
      ['Average Glucose', fmt(periodStats.average, ' ' + (meta.units || 'mg/dL'))]
      , ['Median Glucose', fmt(periodStats.median, ' ' + (meta.units || 'mg/dL'))]
      , ['Standard Deviation', fmt(periodStats.sd, ' ' + (meta.units || 'mg/dL'))]
      , ['CV', fmt(periodStats.cv, ' %')]
      , ['MAGE', fmt(periodStats.mage_overall, ' ' + (meta.units || 'mg/dL'))]
      , ['Time in Range', fmt(periodStats.tir_pct, ' %')]
      , ['Time Below Range', fmt(periodStats.tbr_pct, ' %')]
      , ['Time Above Range', fmt(periodStats.tar_pct, ' %')]
    ]
  });

  var episodeSummary = periodStats.episode_summary || {};
  var episodeTable = table({
    head: ['Type', 'Count', 'Total Minutes']
    , rows: [
      ['Hypoglycemia', escapeHtml(String(episodeSummary.hypo_count || 0)), fmt(episodeSummary.hypo_total_min, ' min', 0)]
      , ['Hyperglycemia', escapeHtml(String(episodeSummary.hyper_count || 0)), fmt(episodeSummary.hyper_total_min, ' min', 0)]
    ]
  });

  // Diurnal patterns from period stats
  var diurnalHtml = '';
  if (periodStats.diurnal_patterns && periodStats.diurnal_patterns.length > 0) {
    diurnalHtml = table({
      head: ['Hour', 'Avg', 'SD', 'Days with Data']
      , rows: periodStats.diurnal_patterns.map(function (p) {
        return [
          escapeHtml(String(p.hour) + ':00')
          , fmt(p.avg, ' ' + (meta.units || 'mg/dL'))
          , fmt(p.sd, ' ' + (meta.units || 'mg/dL'))
          , escapeHtml(String(p.days_with_data || 0))
        ];
      })
    });
  }

  // Per-day breakdown from client stats
  var dayRows = dayStats.map(function (ds, i) {
    return [
      escapeHtml(String(i + 1))
      , fmt(ds.average, '', 0)
      , fmt(ds.sd, '', 0)
      , fmt(ds.cv, ' %')
      , fmt(ds.mage, '', 0)
      , fmt(ds.tir_pct, ' %')
      , fmt(ds.tbr_pct, ' %')
      , fmt(ds.tar_pct, ' %')
      , escapeHtml(String(ds.hypo_episodes ? ds.hypo_episodes.length : 0))
      , escapeHtml(String(ds.hyper_episodes ? ds.hyper_episodes.length : 0))
      , escapeHtml(String(ds.total_readings || 0))
    ];
  });

  var dayTable = dayRows.length > 0 ? table({
    head: ['Day', 'Avg', 'SD', 'CV', 'MAGE', 'TIR', 'TBR', 'TAR', 'Hypo Ep.', 'Hyper Ep.', 'Readings']
    , rows: dayRows
  }) : '<p>No daily data available.</p>';

  var from = meta.from || '';
  var to = meta.to || '';

  return '<div class="cgm-wrap">'
    + '<h1>CGM Statistics \u2014 ' + escapeHtml(from + ' \u2013 ' + to) + '</h1>'
    + '<p class="cgm-meta">' + escapeHtml(String(meta.days || 0)) + ' days \u00b7 '
    + escapeHtml(meta.units || 'mg/dL') + ' \u00b7 Target '
    + escapeHtml(String(meta.target_low || '')) + '\u2013' + escapeHtml(String(meta.target_high || ''))
    + '</p>'
    + '<section><h2>Period Statistics</h2>' + periodTable + '</section>'
    + '<section><h2>Episodes</h2>' + episodeTable + '</section>'
    + (diurnalHtml ? '<section><h2>Diurnal Patterns</h2>' + diurnalHtml + '</section>' : '')
    + '<section><h2>Daily Breakdown</h2>' + dayTable + '</section>'
    + '</div>';
}

/* ---------- LLM Analysis Rendering (Unified Schema) ---------- */
// Renders interpretation, trends, and recommendations from LLM.
// Displayed below the client-side stats section.

function renderAnalysis (d) {
  if (!d) return '<p>No AI analysis available.</p>';

  var periodFrom = d.period ? d.period.from || '' : '';
  var periodTo = d.period ? d.period.to || '' : '';

  // Trends with severity badges
  var severityColors = { critical: '#dc3545', warning: '#ffc107', info: '#17a2b8' };
  var trendsList = (d.trends || []).map(function (t) {
    var color = severityColors[t.severity] || '#6c757d';
    return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:'
      + color + ';color:#fff;font-size:.8rem;margin-right:4px;">' + escapeHtml(t.severity || '') + '</span> '
      + '<strong>' + escapeHtml(t.label || '') + '</strong>: ' + escapeHtml(t.evidence || '');
  });
  var trendsHtml = '<ul>' + trendsList.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>';

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

  // Per-day notes
  var perDayHtml = '';
  if (d.per_day && d.per_day.length > 0) {
    var perDayRows = d.per_day.map(function (pd) {
      return [
        escapeHtml(pd.date || '')
        , escapeHtml((pd.notes || []).join('; '))
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
    + '<section><h2>Trends</h2>' + list((d.trends || []).map(function (t) { return t.label + ': ' + t.evidence; })) + '</section>'
    + '<section><h2>Recommendations</h2>' + recHtml + '</section>'
    + '</div>';
}

module.exports = {
  escapeHtml: escapeHtml
  , fmt: fmt
  , list: list
  , table: table
  , renderStats: renderStats
  , renderAnalysis: renderAnalysis
  , renderDaily: renderDaily
  , renderMultiDay: renderMultiDay
  , renderCgmReport: renderCgmReport
};
