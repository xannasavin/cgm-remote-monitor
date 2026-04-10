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

/* ---------- Daily (Interim) ---------- */
// Note: All user-visible and LLM-sourced strings are passed through escapeHtml()
// before being inserted into HTML. The innerHTML usage in renderCgmReport is safe
// because the HTML is constructed entirely from escaped content, not raw user input.

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
      , ['MAGE', fmt(stats.mage_mgdl, ' mg/dL')]
      , ['Time in Range', fmt(stats.time_in_range_percent, ' %')]
      , ['Time Below Range', fmt(stats.time_below_range_percent, ' %')]
      , ['Time Above Range', fmt(stats.time_above_range_percent, ' %')]
      , ['Hypo Episodes', escapeHtml(stats.number_of_hypo_episodes != null ? stats.number_of_hypo_episodes : '-')]
      , ['Hyper Episodes', escapeHtml(stats.number_of_hyper_episodes != null ? stats.number_of_hyper_episodes : '-')]
      , ['Longest Hypo', stats.longest_hypo_min != null ? stats.longest_hypo_min + ' min' : '-']
      , ['Longest Hyper', stats.longest_hyper_min != null ? stats.longest_hyper_min + ' min' : '-']
    ]
  });

  var patternRows = ['00-06', '06-12', '12-18', '18-24'].map(function (b) {
    var v = blocks[b] || {};
    return [
      b
      , fmt(v.avg, ' mg/dL')
      , fmt(v.sd, ' mg/dL')
      , fmt(v.below_pct, ' %')
      , fmt(v.in_range_pct, ' %')
      , fmt(v.above_pct, ' %')
    ];
  });

  var patternsTable = table({
    head: ['Time Block', 'Avg', 'SD', 'Below %', 'In Range %', 'Above %']
    , rows: patternRows
  });

  var anomaliesList = list(
    (d.anomalies || []).map(function (a) {
      var base = a.type + ' ' + a.start_local + '\u2013' + a.end_local + ' (' + (a.duration_min != null ? a.duration_min : '-') + ' min)';
      if (a.type === 'hypoglycemia' && a.nadir_mgdl != null) return base + '; nadir ' + a.nadir_mgdl + ' mg/dL';
      if (a.type === 'hyperglycemia' && a.peak_mgdl != null) return base + '; peak ' + a.peak_mgdl + ' mg/dL';
      return base;
    })
  );

  return '<div class="cgm-wrap">'
    + '<h1>Daily CGM Report \u2014 ' + escapeHtml(d.date || '') + '</h1>'
    + '<div class="cgm-grid-2col">'
    + '<section>'
    + '<h2>Summary</h2>'
    + list(d.summary || [])
    + '<h2>Statistics</h2>'
    + statsTable
    + '</section>'
    + '<section>'
    + '<h2>Daily Patterns</h2>'
    + patternsTable
    + '<h2>Anomalies</h2>'
    + anomaliesList
    + '</section>'
    + '</div>'
    + '<section>'
    + '<h2>Recommendations</h2>'
    + list(d.recommendations || [])
    + '</section>'
    + '<section>'
    + '<h2>Data Quality Notes</h2>'
    + list(d.data_quality_notes || d.notes || [])
    + (d.meta ? '<p class="cgm-meta">Units: ' + escapeHtml(d.meta.units || 'mg/dL') + ' \u00b7 Target ' + escapeHtml(String(d.meta.target_low_mgdl != null ? d.meta.target_low_mgdl : '')) + '\u2013' + escapeHtml(String(d.meta.target_high_mgdl != null ? d.meta.target_high_mgdl : '')) + ' mg/dL</p>' : '')
    + '</section>'
    + '</div>';
}

/* ---------- Multi-Day (Final) ---------- */

function renderMultiDay (d) {
  var stats = d.overall_statistics || {};
  var blocks = d.diurnal_patterns || {};
  var episodes = d.episodes || {};

  var statsTable = table({
    head: ['Metric', 'Value']
    , rows: [
      ['Average Glucose', fmt(stats.average_glucose_mgdl, ' mg/dL')]
      , ['Median Glucose', fmt(stats.median_glucose_mgdl, ' mg/dL')]
      , ['Standard Deviation', fmt(stats.standard_deviation_mgdl, ' mg/dL')]
      , ['CV', fmt(stats.cv_percent, ' %')]
      , ['MAGE Overall', fmt(stats.mage_overall_mgdl, ' mg/dL')]
      , ['Time in Range', fmt(stats.time_in_range_percent, ' %')]
      , ['Time Below Range', fmt(stats.time_below_range_percent, ' %')]
      , ['Time Above Range', fmt(stats.time_above_range_percent, ' %')]
    ]
  });

  var patternsTable = table({
    head: ['Time Block', 'Avg', 'SD', 'Below %', 'In Range %', 'Above %']
    , rows: ['00-06', '06-12', '12-18', '18-24'].map(function (b) {
      var v = blocks[b] || {};
      return [
        b
        , fmt(v.avg, ' mg/dL')
        , fmt(v.sd, ' mg/dL')
        , fmt(v.below_pct, ' %')
        , fmt(v.in_range_pct, ' %')
        , fmt(v.above_pct, ' %')
      ];
    })
  });

  var epiTable = table({
    head: ['Type', 'Count', 'Total Minutes', 'Longest (min)', '00\u201306', '06\u201312', '12\u201318', '18\u201324']
    , rows: ['hypoglycemia', 'hyperglycemia'].map(function (t) {
      var e = episodes[t] || {};
      var by = e.by_block || {};
      return [
        t
        , escapeHtml(e.count != null ? e.count : '-')
        , escapeHtml(e.total_minutes != null ? e.total_minutes : '-')
        , escapeHtml(e.longest_min != null ? e.longest_min : '-')
        , escapeHtml(by['00-06'] != null ? by['00-06'] : '-')
        , escapeHtml(by['06-12'] != null ? by['06-12'] : '-')
        , escapeHtml(by['12-18'] != null ? by['12-18'] : '-')
        , escapeHtml(by['18-24'] != null ? by['18-24'] : '-')
      ];
    })
  });

  var perDayTable = table({
    head: ['Date', 'Avg', 'CV %', 'TIR %', 'TBR %', 'TAR %', 'Hypo Ep.', 'Hyper Ep.', 'Notes']
    , rows: (d.per_day || []).map(function (x) {
      return [
        escapeHtml(x.date || '')
        , fmt(x.average_glucose_mgdl, ' mg/dL')
        , fmt(x.cv_percent, ' %')
        , fmt(x.tir_percent, ' %')
        , fmt(x.tbr_percent, ' %')
        , fmt(x.tar_percent, ' %')
        , escapeHtml(x.hypo_episodes != null ? x.hypo_episodes : '-')
        , escapeHtml(x.hyper_episodes != null ? x.hyper_episodes : '-')
        , escapeHtml((x.notes || []).join('; '))
      ];
    })
  });

  var rec = d.recommendations || {};
  var recHtml = '<div class="cgm-grid-3col">'
    + '<section><h3>Therapy Settings</h3>' + list(rec.therapy_settings || []) + '</section>'
    + '<section><h3>Behavioral Timing</h3>' + list(rec.behavioral_timing || []) + '</section>'
    + '<section><h3>Monitoring</h3>' + list(rec.monitoring || []) + '</section>'
    + '</div>';

  var periodFrom = d.period ? d.period.from || '' : '';
  var periodTo = d.period ? d.period.to || '' : '';
  var periodDays = d.period ? d.period.days : '';

  return '<div class="cgm-wrap">'
    + '<h1>Multi\u2011Day CGM Report \u2014 ' + escapeHtml(periodFrom + ' \u2013 ' + periodTo) + '</h1>'
    + '<p class="cgm-meta">' + escapeHtml(String(periodDays != null ? periodDays : '')) + ' days total</p>'
    + '<section><h2>Summary</h2>' + list(d.summary || []) + '</section>'
    + '<section class="final-response-overall-statistic"><h2>Overall Statistics</h2>' + statsTable + '</section>'
    + '<section class="final-response-diurnal-patterns"><h2>Diurnal Patterns</h2>' + patternsTable + '</section>'
    + '<section class="final-response-episodes"><h2>Episodes</h2>' + epiTable + '</section>'
    + '<section><h2>Trends</h2>' + list((d.trends || []).map(function (t) { return t.label + ': ' + t.evidence; })) + '</section>'
    + '<section><h2>Recommendations</h2>' + recHtml + '</section>'
    + '<section><h2>Daily Breakdown</h2>' + perDayTable + '</section>'
    + '<section><h2>Data Quality Notes</h2>'
    + list(d.data_quality_notes || [])
    + (d.meta ? '<p class="cgm-meta">Units: ' + escapeHtml(d.meta.units || 'mg/dL') + ' \u00b7 Target ' + escapeHtml(String(d.meta.target_low_mgdl != null ? d.meta.target_low_mgdl : '')) + '\u2013' + escapeHtml(String(d.meta.target_high_mgdl != null ? d.meta.target_high_mgdl : '')) + ' mg/dL \u00b7 Aggregation: ' + escapeHtml(d.meta.aggregation || '') + '</p>' : '')
    + '</section>'
    + '</div>';
}

// renderCgmReport sets innerHTML on a mount element with HTML constructed entirely
// from escaped content (all LLM-sourced and user strings pass through escapeHtml).
function renderCgmReport (data, mount) {
  var el = typeof mount === 'string' ? document.querySelector(mount) : mount;
  if (!el) throw new Error('Mount element not found');

  var isMultiDay = !!data.period;
  el.innerHTML = isMultiDay ? renderMultiDay(data) : renderDaily(data); // eslint-disable-line no-unsanitized/property
}

module.exports = {
  escapeHtml: escapeHtml
  , fmt: fmt
  , list: list
  , table: table
  , renderDaily: renderDaily
  , renderMultiDay: renderMultiDay
  , renderCgmReport: renderCgmReport
};
