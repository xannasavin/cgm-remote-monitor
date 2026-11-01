'use strict';

var renderUtils = require('../pump_analysis/render_utils');
var escapeHtml = renderUtils.escapeHtml;
var formatDate = renderUtils.formatDate;
var fmt = renderUtils.fmt;
var list = renderUtils.list;
var table = renderUtils.table;
var translate = renderUtils.translate;

/* ---------- Sanitizers ---------- */

// Defensive post-processor: some LLMs echo raw CGMDATA_JSON millisecond
// epoch values straight into `evidence`/insight text instead of formatting
// them as clock times. The default system prompt instructs against this,
// but this sanitizer is the last line of defence. Matches any 10–13 digit
// run whose numeric value parses as an epoch with year 2010–2040 and
// rewrites it to `dd.mm.yyyy HH:MM` local time. Non-epoch numbers (counts,
// mg/dL values, percentages) are untouched because they fall outside the
// 10-digit minimum length.
function sanitizeEvidenceText (text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(/\b\d{10,13}\b/g, function (match) {
    var n = Number(match);
    if (!Number.isFinite(n)) return match;
    var ms;
    if (match.length === 13) ms = n;
    else if (match.length === 10) ms = n * 1000;
    else return match;
    var d = new Date(ms);
    if (isNaN(d.getTime())) return match;
    var year = d.getFullYear();
    if (year < 2010 || year > 2040) return match;
    var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + year
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  });
}

// Walk the parsed analysis object and sanitize every string leaf in place.
// Covers trends.evidence, trends.label, summary, recommendations.*, per_day
// notes, data_quality_notes, and treatment_insights.*.text — everything the
// LLM might emit as free text.
function sanitizeAnalysisStrings (obj) {
  if (obj == null) return;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') obj[i] = sanitizeEvidenceText(obj[i]);
      else if (typeof obj[i] === 'object') sanitizeAnalysisStrings(obj[i]);
    }
    return;
  }
  if (typeof obj === 'object') {
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (typeof obj[k] === 'string') obj[k] = sanitizeEvidenceText(obj[k]);
      else if (typeof obj[k] === 'object') sanitizeAnalysisStrings(obj[k]);
    }
  }
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

/* ---------- LLM Analysis Rendering (Unified Schema) ---------- */
// Renders interpretation, trends, and recommendations from LLM.
// Displayed below the client-side stats section.

function renderAnalysis (d) {
  if (!d) return '<p>No AI analysis available.</p>';

  sanitizeAnalysisStrings(d);

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
  , renderAnalysis: renderAnalysis
  , renderDaily: renderDaily
  , renderMultiDay: renderMultiDay
  , renderCgmReport: renderCgmReport
  , sanitizeEvidenceText: sanitizeEvidenceText
  , sanitizeAnalysisStrings: sanitizeAnalysisStrings
};
