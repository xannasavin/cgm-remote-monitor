'use strict';

var d3 = (global && global.d3) || require('d3');
var renderUtils = require('./render_utils');
var glucoseUnits = require('./glucose_units');

/**
 * Render a 24-hour diurnal pattern chart: median line with P25-P75 and
 * P10-P90 bands and the target range.
 *
 * @param {string} containerId - CSS selector for mount element
 * @param {Array} percentiles - Array of { hour, p10, p25, p50, p75, p90, n } in display units
 * @param {object} meta - { target_low, target_high, units }
 */
function renderDiurnalChart (containerId, percentiles, meta) {
  var container = document.querySelector(containerId);
  if (!container) return;
  if (!d3 || typeof d3.select !== 'function') {
    container.textContent = translate('Charts unavailable');
    return;
  }
  container.textContent = '';
  var data = Array.isArray(percentiles) ? percentiles.filter(function hasMedian (p) {
    return p && typeof p.p50 === 'number' && isFinite(p.p50);
  }) : [];
  if (data.length === 0) {
    chartEmpty(container, translate('Not enough data'));
    return;
  }

  meta = meta || {};
  var targetLow = meta.target_low || 70;
  var targetHigh = meta.target_high || 180;
  var units = meta.units || 'mg/dL';

  var margin = { top: 20, right: 30, bottom: 35, left: 50 };
  var width = 900 - margin.left - margin.right;
  var height = 280 - margin.top - margin.bottom;

  // Compute Y domain from data
  var yMin = Math.min(d3.min(data, function (p) { return p.p10; }), targetLow * 0.85);
  var yMax = Math.max(d3.max(data, function (p) { return p.p90; }), targetHigh * 1.1);

  var svg = d3.select(containerId).append('svg')
    .attr('viewBox', '0 0 900 280')
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', translate('Diurnal glucose pattern chart showing the median with 25 to 75 and 10 to 90 percentile bands'));

  var g = svg.append('g')
    .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

  var x = d3.scaleLinear().domain([0, 23]).range([0, width]);
  var y = d3.scaleLinear().domain([yMin, yMax]).range([height, 0]);

  // Gridlines
  g.append('g').attr('class', 'grid')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).tickSize(-height).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);

  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);

  // Target range band
  g.append('rect')
    .attr('x', 0).attr('width', width)
    .attr('y', y(targetHigh)).attr('height', y(targetLow) - y(targetHigh))
    .attr('fill', '#28a745').attr('opacity', 0.1);

  // One slot per hour; hours without data stay null so .defined() breaks the
  // band and the median line there instead of joining across the gap.
  var byHour = [];
  for (var hh = 0; hh < 24; hh++) byHour.push(null);
  data.forEach(function placeHour (p) {
    if (p.hour >= 0 && p.hour < 24) byHour[p.hour] = p;
  });
  function hasValue (d) { return d !== null; }

  // P10-P90 band (outer), then P25-P75 band (inner)
  function band (lowKey, highKey) {
    return d3.area()
      .defined(function bandDefined (d) {
        return hasValue(d) && isFinite(d[lowKey]) && isFinite(d[highKey])
          && d[lowKey] !== null && d[highKey] !== null;
      })
      .x(function (d) { return x(d.hour); })
      .y0(function (d) { return y(d[lowKey]); })
      .y1(function (d) { return y(d[highKey]); });
  }

  g.append('path')
    .datum(byHour)
    .attr('class', 'cgm-diurnal-band cgm-diurnal-band-outer')
    .attr('fill', '#17a2b8').attr('opacity', 0.15)
    .attr('d', band('p10', 'p90'));

  g.append('path')
    .datum(byHour)
    .attr('class', 'cgm-diurnal-band cgm-diurnal-band-inner')
    .attr('fill', '#17a2b8').attr('opacity', 0.3)
    .attr('d', band('p25', 'p75'));

  // Median line
  var line = d3.line()
    .defined(hasValue)
    .x(function (d) { return x(d.hour); })
    .y(function (d) { return y(d.p50); });

  g.append('path')
    .datum(byHour)
    .attr('class', 'cgm-diurnal-median')
    .attr('fill', 'none').attr('stroke', '#117a8b').attr('stroke-width', 2.5)
    .attr('d', line);

  // Data points
  g.selectAll('.dot')
    .data(data).enter().append('circle')
    .attr('cx', function (d) { return x(d.hour); })
    .attr('cy', function (d) { return y(d.p50); })
    .attr('r', 3).attr('fill', '#117a8b');

  // Target range lines
  g.append('line')
    .attr('x1', 0).attr('x2', width)
    .attr('y1', y(targetLow)).attr('y2', y(targetLow))
    .attr('stroke', '#28a745').attr('stroke-dasharray', '4,4').attr('opacity', 0.6);

  g.append('line')
    .attr('x1', 0).attr('x2', width)
    .attr('y1', y(targetHigh)).attr('y2', y(targetHigh))
    .attr('stroke', '#28a745').attr('stroke-dasharray', '4,4').attr('opacity', 0.6);

  // Axes
  g.append('g')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).ticks(24).tickFormat(function (d) { return d + ':00'; }))
    .selectAll('text').style('font-size', '10px');

  g.append('g')
    .call(d3.axisLeft(y).ticks(8))
    .selectAll('text').style('font-size', '10px');

  // Axis labels
  svg.append('text')
    .attr('x', margin.left + width / 2).attr('y', height + margin.top + 32)
    .attr('text-anchor', 'middle').style('font-size', '11px').text(translate('Hour of Day'));

  svg.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(margin.top + height / 2)).attr('y', 14)
    .attr('text-anchor', 'middle').style('font-size', '11px').text(units);

  // Legend
  var legend = svg.append('g').attr('class', 'cgm-diurnal-legend')
    .attr('transform', 'translate(' + (margin.left + width - 240) + ',0)');
  [
    { label: translate('Median'), color: '#117a8b', opacity: 1 }
    , { label: translate('P25-P75'), color: '#17a2b8', opacity: 0.3 }
    , { label: translate('P10-P90'), color: '#17a2b8', opacity: 0.15 }
  ].forEach(function (item, i) {
    legend.append('rect')
      .attr('x', i * 80).attr('y', 0).attr('width', 10).attr('height', 10)
      .attr('fill', item.color).attr('opacity', item.opacity);
    legend.append('text')
      .attr('x', i * 80 + 13).attr('y', 9)
      .style('font-size', '9px').text(item.label);
  });
}

/**
 * Value ranges of the five daily ranges for the legend, in display units.
 * mg/dl shows whole numbers with inclusive bounds (55-79, 80-190, 191-260);
 * mmol shows one decimal with the limits as bounds.
 *
 * @param {{veryLow: number, low: number, high: number, veryHigh: number}|null} limits - mg/dl
 * @param {string} units
 * @returns {object|null} { veryLow, low, inRange, high, veryHigh } strings, null without limits
 */
function rangeLegendValues (limits, units) {
  if (!limits) return null;
  var dash = '–';
  if (glucoseUnits.isMmol(units)) {
    var f = function mmol (v) { return glucoseUnits.fromMgdl(v, units).toFixed(1); };
    return {
      veryLow: '< ' + f(limits.veryLow)
      , low: f(limits.veryLow) + dash + f(limits.low)
      , inRange: f(limits.low) + dash + f(limits.high)
      , high: f(limits.high) + dash + f(limits.veryHigh)
      , veryHigh: '> ' + f(limits.veryHigh)
    };
  }
  var r = Math.round;
  return {
    veryLow: '< ' + r(limits.veryLow)
    , low: r(limits.veryLow) + dash + (r(limits.low) - 1)
    , inRange: r(limits.low) + dash + r(limits.high)
    , high: (r(limits.high) + 1) + dash + r(limits.veryHigh)
    , veryHigh: '> ' + r(limits.veryHigh)
  };
}

/**
 * Render daily five-range stacked horizontal bar chart (very low, low, in
 * range, high, very high).
 *
 * @param {string} containerId - CSS selector for mount element
 * @param {Array} ranges - Array of { dateKey, veryLow, low, inRange, high, veryHigh } (percent)
 * @param {Array} dayDates - Array of YYYY-MM-DD date strings (fallback labels)
 * @param {object} [limits] - mg/dl range limits (pumpExtras.rangeLimits); the legend shows the values
 * @param {string} [units] - display units for the legend values
 */
function renderDailyTirChart (containerId, ranges, dayDates, limits, units) {
  var container = document.querySelector(containerId);
  if (!container) return;
  if (!d3 || typeof d3.select !== 'function') {
    container.textContent = translate('Charts unavailable');
    return;
  }
  container.textContent = '';
  if (!Array.isArray(ranges) || ranges.length === 0) {
    chartEmpty(container, translate('Not enough data'));
    return;
  }

  dayDates = dayDates || [];

  var margin = { top: 20, right: 30, bottom: 25, left: 80 };
  var barHeight = 22;
  var gap = 4;
  var totalHeight = margin.top + margin.bottom + ranges.length * (barHeight + gap);
  var width = 900 - margin.left - margin.right;
  var height = totalHeight - margin.top - margin.bottom;

  var labels = ranges.map(function (r, i) {
    var key = r.dateKey || dayDates[i];
    return key ? renderUtils.formatDate(key) : translate('Day %1').replace('%1', i + 1);
  });

  var svg = d3.select(containerId).append('svg')
    .attr('viewBox', '0 0 900 ' + totalHeight)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', translate('Daily time-in-range stacked bar chart'));

  var g = svg.append('g')
    .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

  var yScale = d3.scaleBand()
    .domain(labels)
    .range([0, height])
    .padding(0.15);

  var xScale = d3.scaleLinear().domain([0, 100]).range([0, width]);

  var segments = [
    { key: 'veryLow', label: translate('Very Low'), color: COLORS.rangeVeryLow, text: '#fff' }
    , { key: 'low', label: translate('Low'), color: COLORS.rangeLow, text: '#fff' }
    , { key: 'inRange', label: translate('In Range'), color: COLORS.rangeInRange, text: '#fff' }
    , { key: 'high', label: translate('High'), color: COLORS.rangeHigh, text: '#333' }
    , { key: 'veryHigh', label: translate('Very High'), color: COLORS.rangeVeryHigh, text: '#fff' }
  ];

  ranges.forEach(function (r, i) {
    var yPos = yScale(labels[i]);
    var bh = yScale.bandwidth();
    var offset = 0;
    segments.forEach(function (seg) {
      var pct = r[seg.key] || 0;
      if (pct > 0) {
        g.append('rect')
          .attr('class', 'cgm-tir-seg')
          .attr('x', xScale(offset)).attr('y', yPos)
          .attr('width', xScale(pct)).attr('height', bh)
          .attr('fill', seg.color);
        if (pct >= 8) {
          g.append('text').attr('x', xScale(offset + pct / 2)).attr('y', yPos + bh / 2 + 4)
            .attr('text-anchor', 'middle').style('font-size', '10px').style('fill', seg.text)
            .text(Math.round(pct) + '%');
        }
      }
      offset += pct;
    });
  });

  // Y axis (day labels)
  g.append('g')
    .call(d3.axisLeft(yScale))
    .selectAll('text').style('font-size', '10px');

  // X axis (percentage)
  g.append('g')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(function (d) { return d + '%'; }))
    .selectAll('text').style('font-size', '10px');

  // Legend, right-aligned; entry widths estimated from the text length
  // (about 5 px per character at 9 px).
  var values = rangeLegendValues(limits, units);
  var entries = segments.map(function (seg) {
    var text = values ? seg.label + ' (' + values[seg.key] + ')' : seg.label;
    return { seg: seg, text: text, width: 13 + text.length * 5 + 12 };
  });
  var legendWidth = entries.reduce(function (sum, e) { return sum + e.width; }, 0);
  var legend = svg.append('g').attr('class', 'cgm-tir-legend')
    .attr('transform', 'translate(' + Math.max(0, margin.left + width - legendWidth) + ',0)');

  var x = 0;
  entries.forEach(function (e) {
    legend.append('rect')
      .attr('x', x).attr('y', 0).attr('width', 10).attr('height', 10)
      .attr('fill', e.seg.color);
    legend.append('text')
      .attr('x', x + 13).attr('y', 9)
      .style('font-size', '9px').text(e.text);
    x += e.width;
  });
}

/* ---------- Pump Action Pipeline Charts (Phase C) ---------- */
// Ported from playground/ai-eval-redesign.html. Each function takes a CSS
// selector, consumes the shapes returned by computePumpActionStats /
// computeEpisodesWithHours, and renders a self-contained D3 SVG. No strings
// are interpreted — all labels come from i18n via the optional translate fn.

function pad2 (n) {
  return n < 10 ? '0' + n : '' + n;
}

// The translate store is shared with the renderers via render_utils, so a
// single setTranslate call wires every pump_analysis module at once.
var translate = renderUtils.translate;
function setTranslate (fn) {
  renderUtils.setTranslate(fn);
}

// R1-5 / R3-9: centralized chart color palette. Previously hardcoded across
// ~15 locations. `#e0af68` (auto correction) was lightened to `#b45309` to
// clear WCAG AA (>=4.5:1 on white). Other values match the existing Nightscout
// palette (see charts.js renderDiurnalChart / renderDailyTirChart).
var COLORS = {
  hypo: '#17a2b8'          // teal
  , hyper: '#dc3545'        // red
  , basalActual: '#17a2b8'  // teal (insulin stack)
  , basalScheduled: '#6c757d' // slate (dashed scheduled line)
  , userBolus: '#6f42c1'    // purple
  , autoBolus: '#b45309'    // dark amber — WCAG AA on white (R1-5)
  , hotspotOutline: '#e0af68' // gold (outline only, not background text)
  , gridLine: '#eee'
  , rangeVeryLow: '#8f1d2c'   // dark red
  , rangeLow: '#dc3545'       // red
  , rangeInRange: '#28a745'   // green
  , rangeHigh: '#ffc107'      // amber
  , rangeVeryHigh: '#b45309'  // dark orange, white text >= 4.5:1
  , neutral: 'rgba(120, 130, 150, 0.15)'
  , basalBelow: '#1f6feb'   // blue (actual basal below scheduled)
  , directionUpBase: '220, 53, 69'  // red rgb triple
  , directionDownBase: '23, 162, 184' // teal rgb triple
  , targetBand: 'rgba(40, 167, 69, 0.12)' // target range behind meal curves
};

function selectContainer (containerId) {
  var container = typeof containerId === 'string'
    ? document.querySelector(containerId)
    : containerId;
  if (!container) return null;
  container.textContent = '';
  return container;
}

function chartEmpty (container, msg) {
  var p = document.createElement('p');
  p.className = 'cgm-meta';
  p.textContent = msg;
  container.appendChild(p);
}

/**
 * Render the pump-action hotspot strip — a 24-hour horizontal grid where each
 * cell encodes how often (across pump-covered days) the pump fought the
 * scheduled therapy at that hour. Red = pushing insulin up, blue =
 * suppressing it. Hotspot hours (>= hotspotMinDays with signal) are outlined.
 *
 * @param {string} containerId - CSS selector for mount element
 * @param {object} data - { perHour, hotspots, pumpDays } from detectHotspots
 * @param {object} options - { episodeOverlay, episodeData }
 */
function renderPumpActionHotspot (containerId, data, options) {
  var container = selectContainer(containerId);
  if (!container) return;
  if (!d3 || typeof d3.select !== 'function') {
    container.textContent = translate('Charts unavailable');
    return;
  }
  options = options || {};
  data = data || {};
  var perHour = data.perHour || [];
  var hotspots = data.hotspots || [];
  var pumpDays = data.pumpDays || 0;
  var deltaUnits = Array.isArray(data.deltaUnitsPerHour) ? data.deltaUnitsPerHour : null;

  if (pumpDays === 0) {
    chartEmpty(container, translate('No pump data for this timeframe'));
    return;
  }

  // Readability pass: taller cells, episode row as its own labeled band,
  // fraction labels only on hotspot cells, non-hotspots visually flattened,
  // every-hour x-axis ticks.
  var svgWidth = 1100;
  var svgHeight = 200;
  var margin = { top: 20, right: 28, bottom: 44, left: 90 };
  var episodeRowH = 22;
  var width = svgWidth - margin.left - margin.right;
  var cellAreaH = svgHeight - margin.top - margin.bottom - episodeRowH;

  var svg = d3.select(containerId).append('svg')
    .attr('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', translate('Pump Action Hotspots') + ' — ' + translate('hourly pump override intensity with hypo and hyper episode markers'));

  var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
  var x = d3.scaleLinear().domain([0, 24]).range([0, width]);
  var cellW = width / 24;

  // Build a quick lookup so hotspot membership is O(1).
  var hotspotSet = {};
  for (var hi = 0; hi < hotspots.length; hi++) hotspotSet[hotspots[hi]] = true;

  for (var i = 0; i < perHour.length; i++) {
    var p = perHour[i];
    var t = p.intensity || 0;
    var isHotspot = !!hotspotSet[p.hour];
    var fill;
    if (t < 0.05) {
      fill = COLORS.neutral;
    } else if ((p.direction || 0) >= 0) {
      fill = 'rgba(' + COLORS.directionUpBase + ', ' + (0.15 + t * 0.7).toFixed(3) + ')';
    } else {
      fill = 'rgba(' + COLORS.directionDownBase + ', ' + (0.15 + t * 0.7).toFixed(3) + ')';
    }

    // Non-hotspot cells are shorter and lower opacity so the eye locks onto
    // the outlined hotspot cells.
    var cellY = isHotspot ? 0 : 6;
    var cellH = isHotspot ? cellAreaH : cellAreaH - 12;
    var cellOpacity = isHotspot ? 1 : 0.45;

    g.append('rect')
      .attr('x', x(p.hour) + 1).attr('y', cellY)
      .attr('width', cellW - 2).attr('height', cellH)
      .attr('fill', fill).attr('fill-opacity', cellOpacity)
      .attr('stroke', isHotspot ? COLORS.hotspotOutline : 'none')
      .attr('stroke-width', 2.5)
      .attr('rx', 2);

    // Only label hotspot cells — hides 17+ numeric labels that were fighting
    // for attention on non-hotspot cells.
    if (isHotspot && p.signalDays > 0) {
      g.append('text')
        .attr('x', x(p.hour) + cellW / 2)
        .attr('y', cellAreaH / 2 + 5)
        .attr('text-anchor', 'middle')
        .style('font-size', '13px')
        .style('font-weight', '600')
        .style('fill', '#1a1a1a')
        .text(p.signalDays + '/' + pumpDays);

      // Per-hour unit delta (actual - scheduled) below the day counter.
      // null/undefined mean "no value"; Number(null) would turn them into 0.00.
      var rawDelta = deltaUnits ? deltaUnits[p.hour] : null;
      var deltaU = (rawDelta === null || rawDelta === undefined) ? NaN : Number(rawDelta);
      if (isFinite(deltaU)) {
        // Round first, then sign: no '+0.00' / '-0.00'.
        var deltaR = Number(deltaU.toFixed(2)) || 0;
        g.append('text')
          .attr('x', x(p.hour) + cellW / 2)
          .attr('y', cellAreaH / 2 + 22)
          .attr('text-anchor', 'middle')
          .style('font-size', '11px')
          .style('fill', '#1a1a1a')
          .text((deltaR > 0 ? '+' : '') + deltaR.toFixed(2));
      }
    }
  }

  // Episode row — its own labeled band below the cell grid so the dots
  // stop being mystery marks. Only rendered when episode data is provided.
  if (options.episodeOverlay && options.episodeData) {
    var ep = options.episodeData;
    var episodeY = cellAreaH + 12;

    g.append('text')
      .attr('x', -8).attr('y', episodeY + 6)
      .attr('text-anchor', 'end')
      .style('font-size', '11px')
      .style('fill', '#555')
      .text(translate('Episodes'));

    for (var h = 0; h < 24; h++) {
      if ((ep.hypoHourly && ep.hypoHourly[h] > 0)) {
        var hypoDot = g.append('circle')
          .attr('cx', x(h) + cellW / 2 - 5).attr('cy', episodeY + 5)
          .attr('r', 3.5).attr('fill', COLORS.hypo).attr('opacity', 0.9);
        hypoDot.append('title').text(translate('Hypo episode marker'));
      }
      if ((ep.hyperHourly && ep.hyperHourly[h] > 0)) {
        var hyperDot = g.append('circle')
          .attr('cx', x(h) + cellW / 2 + 5).attr('cy', episodeY + 5)
          .attr('r', 3.5).attr('fill', COLORS.hyper).attr('opacity', 0.9);
        hyperDot.append('title').text(translate('Hyper episode marker'));
      }
    }
  }

  // Hour axis: every hour (25 ticks for 00..24) at a larger font so the
  // labels are readable without squinting.
  g.append('g')
    .attr('transform', 'translate(0,' + (cellAreaH + episodeRowH + 14) + ')')
    .call(d3.axisBottom(x).ticks(24).tickFormat(function (d) { return pad2(d); }))
    .selectAll('text').style('font-size', '11px');
}

/**
 * Render the basal delta chart — scheduled (dashed) vs actual delivered
 * (solid) basal per hour averaged across pump-covered days. Gap between the
 * lines is where the profile does not match reality.
 *
 * @param {string} containerId - CSS selector for mount element
 * @param {object} data - { actualHourly, scheduledHourly, pumpDays }
 */
function renderBasalDeltaChart (containerId, data) {
  var container = selectContainer(containerId);
  if (!container) return;
  if (!d3 || typeof d3.select !== 'function') {
    container.textContent = translate('Charts unavailable');
    return;
  }
  data = data || {};
  var scheduledHourly = data.scheduledHourly || new Array(24).fill(0);
  var actualHourly = data.actualHourly || new Array(24).fill(0);
  if (!data.pumpDays || data.pumpDays === 0) {
    chartEmpty(container, translate('No pump data for this timeframe'));
    return;
  }

  var margin = { top: 16, right: 24, bottom: 36, left: 50 };
  var width = 900 - margin.left - margin.right;
  var height = 220 - margin.top - margin.bottom;

  var svg = d3.select(containerId).append('svg')
    .attr('viewBox', '0 0 900 220')
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', translate('Basal Delta') + ' — ' + translate('scheduled vs actual basal per hour'));

  var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
  var x = d3.scaleLinear().domain([0, 23]).range([0, width]);
  var allVals = scheduledHourly.concat(actualHourly).filter(function (v) { return isFinite(v); });
  var yMax = Math.max(d3.max(allVals) || 1, 0.1);
  var y = d3.scaleLinear().domain([0, yMax * 1.2]).range([height, 0]);

  g.append('g').attr('class', 'grid')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).tickSize(-height).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);

  // Directional fill: red where actual > scheduled, blue where below. Zero
  // crossings between two hours are interpolated linearly so the two fills
  // meet exactly on the scheduled line.
  var points = [];
  var hasAbove = false;
  var hasBelow = false;
  function isNum (v) { return typeof v === 'number' && isFinite(v); }
  for (var pi = 0; pi < 24; pi++) {
    var s0 = scheduledHourly[pi];
    var a0 = actualHourly[pi];
    var ok0 = isNum(s0) && isNum(a0);
    points.push({ x: pi, s: s0, a: a0, ok: ok0 });
    if (ok0 && a0 > s0) hasAbove = true;
    if (ok0 && a0 < s0) hasBelow = true;
    if (pi < 23 && ok0) {
      var s1 = scheduledHourly[pi + 1];
      var a1 = actualHourly[pi + 1];
      if (isNum(s1) && isNum(a1)) {
        var d0 = a0 - s0;
        var d1 = a1 - s1;
        if ((d0 > 0 && d1 < 0) || (d0 < 0 && d1 > 0)) {
          var frac = d0 / (d0 - d1);
          points.push({ x: pi + frac, s: s0 + (s1 - s0) * frac, a: a0 + (a1 - a0) * frac, ok: true });
        }
      }
    }
  }
  function directionalArea (pick) {
    return d3.area()
      .defined(function (d) { return d.ok; })
      .x(function (d) { return x(d.x); })
      .y0(function (d) { return y(d.s); })
      .y1(function (d) { return y(pick(d.a, d.s)); });
  }
  if (hasAbove) {
    g.append('path')
      .datum(points)
      .attr('fill', COLORS.hyper).attr('fill-opacity', 0.18).attr('d', directionalArea(Math.max));
  }
  if (hasBelow) {
    g.append('path')
      .datum(points)
      .attr('fill', COLORS.basalBelow).attr('fill-opacity', 0.18).attr('d', directionalArea(Math.min));
  }

  var schedLine = d3.line().x(function (d, i) { return x(i); }).y(function (d, i) { return y(scheduledHourly[i]); });
  g.append('path')
    .datum(scheduledHourly)
    .attr('fill', 'none').attr('stroke', COLORS.basalScheduled).attr('stroke-width', 2).attr('stroke-dasharray', '5,4').attr('d', schedLine);

  var actualLine = d3.line().x(function (d, i) { return x(i); }).y(function (d, i) { return y(actualHourly[i]); });
  g.append('path')
    .datum(actualHourly)
    .attr('fill', 'none').attr('stroke', COLORS.basalActual).attr('stroke-width', 2.5).attr('d', actualLine);

  g.append('g')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).ticks(12).tickFormat(function (d) { return pad2(d) + ':00'; }))
    .selectAll('text').style('font-size', '10px');
  g.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(function (d) { return d.toFixed(2) + 'U'; }))
    .selectAll('text').style('font-size', '10px');

  // R1-7: Y-axis label so insulin units are explicit like the diurnal chart
  svg.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(margin.top + height / 2)).attr('y', 14)
    .attr('text-anchor', 'middle').style('font-size', '11px')
    .text(translate('Insulin (U/h)'));
}

/**
 * Render the insulin distribution chart — 24-hour stacked area with basal at
 * the bottom, user boluses in the middle, auto corrections on top. Mirrors
 * the playground stacked style.
 *
 * @param {string} containerId - CSS selector for mount element
 * @param {object} data - { basalHourly, userBolusHourly, autoBolusHourly }
 */
function renderInsulinDistributionChart (containerId, data) {
  var container = selectContainer(containerId);
  if (!container) return;
  if (!d3 || typeof d3.select !== 'function') {
    container.textContent = translate('Charts unavailable');
    return;
  }
  data = data || {};
  var basal = (data.basalHourly || new Array(24).fill(0)).slice();
  var user = (data.userBolusHourly || new Array(24).fill(0)).slice();
  var auto = (data.autoBolusHourly || new Array(24).fill(0)).slice();

  var margin = { top: 16, right: 24, bottom: 36, left: 50 };
  var width = 900 - margin.left - margin.right;
  var height = 240 - margin.top - margin.bottom;

  var svg = d3.select(containerId).append('svg')
    .attr('viewBox', '0 0 900 240')
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', translate('Insulin Distribution') + ' — ' + translate('hourly stacked basal, user bolus, and auto correction'));

  var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
  var x = d3.scaleLinear().domain([0, 23]).range([0, width]);
  var hours = [];
  var totals = [];
  for (var h = 0; h < 24; h++) {
    hours.push(h);
    totals.push((basal[h] || 0) + (user[h] || 0) + (auto[h] || 0));
  }
  var yMax = Math.max(d3.max(totals) || 0.1, 0.1);
  var y = d3.scaleLinear().domain([0, yMax * 1.2]).range([height, 0]);

  g.append('g').attr('class', 'grid')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).tickSize(-height).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);

  var areaBasal = d3.area().x(function (d, i) { return x(i); }).y0(function () { return y(0); }).y1(function (d, i) { return y(basal[i]); });
  var areaUser = d3.area().x(function (d, i) { return x(i); }).y0(function (d, i) { return y(basal[i]); }).y1(function (d, i) { return y(basal[i] + user[i]); });
  var areaAuto = d3.area().x(function (d, i) { return x(i); }).y0(function (d, i) { return y(basal[i] + user[i]); }).y1(function (d, i) { return y(basal[i] + user[i] + auto[i]); });

  g.append('path').datum(basal).attr('d', areaBasal).attr('fill', COLORS.basalActual).attr('opacity', 0.7);
  g.append('path').datum(user).attr('d', areaUser).attr('fill', COLORS.userBolus).attr('opacity', 0.8);
  g.append('path').datum(auto).attr('d', areaAuto).attr('fill', COLORS.autoBolus).attr('opacity', 0.85);

  g.append('g')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).ticks(12).tickFormat(function (d) { return pad2(d); }))
    .selectAll('text').style('font-size', '10px');
  g.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(function (d) { return d.toFixed(2) + 'U'; }))
    .selectAll('text').style('font-size', '10px');
}

/**
 * Render the episode timing histogram — hourly hypo/hyper minutes per day
 * with hotspot-outlined bars where `hypoDaysAtHour` or `hyperDaysAtHour`
 * meets the hotspot threshold.
 *
 * @param {string} containerId - CSS selector for mount element
 * @param {object} data - { hypoHourly, hyperHourly, hypoDaysAtHour, hyperDaysAtHour, hotspotMinDays, totalDays }
 */
function renderEpisodeTimingChart (containerId, data) {
  var container = selectContainer(containerId);
  if (!container) return;
  if (!d3 || typeof d3.select !== 'function') {
    container.textContent = translate('Charts unavailable');
    return;
  }
  data = data || {};
  var hypoHourly = data.hypoHourly || new Array(24).fill(0);
  var hyperHourly = data.hyperHourly || new Array(24).fill(0);
  var hypoDaysAtHour = data.hypoDaysAtHour || new Array(24).fill(0);
  var hyperDaysAtHour = data.hyperDaysAtHour || new Array(24).fill(0);
  var hotspotMinDays = data.hotspotMinDays || 3;

  var svgHeight = 260;
  var margin = { top: 16, right: 24, bottom: 36, left: 50 };
  // Reserve 24px below the bottom axis for the legend row.
  var legendHeight = 24;
  var width = 900 - margin.left - margin.right;
  var height = svgHeight - margin.top - margin.bottom - legendHeight;

  var svg = d3.select(containerId).append('svg')
    .attr('viewBox', '0 0 900 ' + svgHeight)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', translate('Episode Timing') + ' — ' + translate('hourly hypo minutes (left bar) and hyper minutes (right bar) with recurring hours outlined'));

  var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
  var x = d3.scaleLinear().domain([0, 24]).range([0, width]);
  var allVals = hypoHourly.concat(hyperHourly);
  var yMax = Math.max(d3.max(allVals) || 1, 1);
  var y = d3.scaleLinear().domain([0, yMax * 1.2]).range([height, 0]);

  g.append('g').attr('class', 'grid')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).tickSize(-height).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);

  var bw = width / 24 - 2;
  for (var h2 = 0; h2 < 24; h2++) {
    var hypoBar = hypoHourly[h2];
    var hyperBar = hyperHourly[h2];
    var isHot = (hypoDaysAtHour[h2] >= hotspotMinDays) || (hyperDaysAtHour[h2] >= hotspotMinDays);
    if (isHot) {
      var hotRect = g.append('rect')
        .attr('x', x(h2) - 2).attr('y', -2)
        .attr('width', bw + 4).attr('height', height + 4)
        .attr('fill', 'none').attr('stroke', COLORS.hotspotOutline).attr('stroke-width', 1.5).attr('stroke-dasharray', '3,2');
      hotRect.append('title').text(translate('Recurring episode hour') + ' (' + pad2(h2) + ':00)');
    }
    if (hypoBar > 0) {
      var hypoRect = g.append('rect')
        .attr('x', x(h2)).attr('y', y(hypoBar))
        .attr('width', bw / 2).attr('height', height - y(hypoBar))
        .attr('fill', COLORS.hypo);
      hypoRect.append('title').text(translate('Hypo') + ' ' + pad2(h2) + ':00 — ' + Math.round(hypoBar) + 'm');
    }
    if (hyperBar > 0) {
      var hyperRect = g.append('rect')
        .attr('x', x(h2) + bw / 2).attr('y', y(hyperBar))
        .attr('width', bw / 2).attr('height', height - y(hyperBar))
        .attr('fill', COLORS.hyper);
      hyperRect.append('title').text(translate('Hyper') + ' ' + pad2(h2) + ':00 — ' + Math.round(hyperBar) + 'm');
    }
  }

  g.append('g')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).ticks(12).tickFormat(function (d) { return pad2(d); }))
    .selectAll('text').style('font-size', '10px');
  g.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(function (d) { return Math.round(d) + 'm'; }))
    .selectAll('text').style('font-size', '10px');

  // Legend sits below the x-axis in its own row so it never overlaps bars.
  // Centered horizontally across the plot width.
  var legendY = margin.top + height + margin.bottom + 2;
  var legendGroupWidth = 220;
  var legendX = margin.left + (width - legendGroupWidth) / 2;
  var legend = svg.append('g').attr('transform', 'translate(' + legendX + ',' + legendY + ')');
  legend.append('rect').attr('x', 0).attr('y', 0).attr('width', 9).attr('height', 9).attr('fill', COLORS.hypo);
  legend.append('text').attr('x', 13).attr('y', 8).style('font-size', '10px').text(translate('Hypo (left bar)'));
  legend.append('rect').attr('x', 110).attr('y', 0).attr('width', 9).attr('height', 9).attr('fill', COLORS.hyper);
  legend.append('text').attr('x', 123).attr('y', 8).style('font-size', '10px').text(translate('Hyper (right bar)'));
}

function medianOf (values) {
  var s = values.filter(function finite (v) { return typeof v === 'number' && isFinite(v); })
    .sort(function asc (a, b) { return a - b; });
  if (s.length === 0) return null;
  var mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Replaces %1..%n (every occurrence) in a translated text.
function fillArgs (text, args) {
  return text.replace(/%(\d+)/g, function sub (m, n) {
    var v = args[Number(n) - 1];
    return v === undefined ? m : String(v);
  });
}

/**
 * Render the meal response curves of one slot: BG from the bolus up to 4 h
 * later, a thin line per meal, a bold median line, the target range behind,
 * and a one-line summary below. Values are mg/dl internally and converted to
 * `units` for display; targetLow/targetHigh are already in `units`.
 *
 * @param {string} containerId - CSS selector for mount element
 * @param {object} data - { slot, cases, medianCurve, targetLow, targetHigh, units }
 */
function renderMealCurveChart (containerId, data) {
  var container = selectContainer(containerId);
  if (!container) return;
  if (!d3 || typeof d3.select !== 'function') {
    container.textContent = translate('Charts unavailable');
    return;
  }
  data = data || {};
  var cases = Array.isArray(data.cases) ? data.cases : [];
  if (cases.length === 0) {
    chartEmpty(container, translate('Not enough data'));
    return;
  }
  var units = data.units || 'mg/dl';
  var mmol = glucoseUnits.fromMgdl(1, units) !== 1;
  // Same spelling as the page and the recommendation cards.
  var unitLabel = mmol ? 'mmol/L' : 'mg/dl';
  function show (mgdl) { return glucoseUnits.fromMgdl(mgdl, units); }
  function fmtBg (v) { return mmol ? v.toFixed(1) : String(Math.round(v)); }
  var windowMin = 240;

  var width0 = 900;
  var height0 = 260;
  var margin = { top: 16, right: 24, bottom: 36, left: 50 };
  var width = width0 - margin.left - margin.right;
  var height = height0 - margin.top - margin.bottom;

  // Points outside the 0..240 min window are dropped so no line runs past the axis.
  function inWindow (p) {
    return p && typeof p.min === 'number' && p.min >= 0 && p.min <= windowMin
      && typeof p.sgv === 'number' && isFinite(p.sgv);
  }
  var lines = cases.map(function curveOfCase (c) {
    return (Array.isArray(c.curve) ? c.curve : []).filter(inWindow);
  });
  var median = (Array.isArray(data.medianCurve) ? data.medianCurve : []).filter(inWindow);
  var allVals = [];
  lines.concat([median]).forEach(function collect (l) {
    l.forEach(function add (p) { allVals.push(show(p.sgv)); });
  });
  var targetLow = typeof data.targetLow === 'number' ? data.targetLow : show(70);
  var targetHigh = typeof data.targetHigh === 'number' ? data.targetHigh : show(180);
  var yMin = Math.min(d3.min(allVals) === undefined ? targetLow : d3.min(allVals), targetLow);
  var yMax = Math.max(d3.max(allVals) === undefined ? targetHigh : d3.max(allVals), targetHigh);
  var pad = (yMax - yMin) * 0.05;

  var svg = d3.select(container).append('svg')
    .attr('viewBox', '0 0 ' + width0 + ' ' + height0)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', translate('Meal Response Curves') + ' - ' + renderUtils.slotLabel(data.slot, translate));
  var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
  var x = d3.scaleLinear().domain([0, windowMin]).range([0, width]);
  var y = d3.scaleLinear().domain([yMin - pad, yMax + pad]).range([height, 0]);

  g.append('rect')
    .attr('class', 'cgm-meal-target')
    .attr('x', 0).attr('y', y(targetHigh)).attr('width', width)
    .attr('height', Math.max(0, y(targetLow) - y(targetHigh)))
    .attr('fill', COLORS.targetBand);
  g.append('g').attr('class', 'grid')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).tickValues([0, 60, 120, 180, 240]).tickSize(-height).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(''))
    .selectAll('line').style('stroke', COLORS.gridLine);

  var lineGen = d3.line()
    .x(function (p) { return x(p.min); })
    .y(function (p) { return y(show(p.sgv)); });
  lines.forEach(function drawLine (l) {
    if (l.length < 2) return;
    g.append('path').datum(l).attr('class', 'cgm-meal-line').attr('d', lineGen)
      .attr('fill', 'none').attr('stroke', COLORS.basalScheduled)
      .attr('stroke-width', 1).attr('opacity', 0.45);
  });
  if (median.length >= 2) {
    g.append('path').datum(median).attr('class', 'cgm-meal-median').attr('d', lineGen)
      .attr('fill', 'none').attr('stroke', COLORS.userBolus).attr('stroke-width', 3);
  }

  g.append('g')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).tickValues([0, 60, 120, 180, 240]).tickFormat(function (d) { return (d / 60) + ' h'; }))
    .selectAll('text').style('font-size', '10px');
  g.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(function (d) { return fmtBg(d); }))
    .selectAll('text').style('font-size', '10px');

  var peak = medianOf(cases.map(function (c) { return c.peakBg; }));
  var peakMin = medianOf(cases.map(function (c) { return c.peakMin; }));
  var bg4h = medianOf(cases.map(function (c) { return c.bg4h; }));
  var start = medianOf(cases.map(function (c) { return c.startBg; }));
  // Missing medians show '-'; the summary is hidden only when none is available.
  function bgOrDash (mgdl) { return mgdl === null ? '-' : fmtBg(show(mgdl)); }
  if (peak !== null || peakMin !== null || bg4h !== null || start !== null) {
    var summary = document.createElement('p');
    summary.className = 'cgm-meta cgm-meal-summary';
    summary.textContent = fillArgs(
      translate('Median peak %1 %2 after %3 min, 4 h value %4 %2 (start %5 %2), %6 meals')
      , [bgOrDash(peak), unitLabel, peakMin === null ? '-' : Math.round(peakMin), bgOrDash(bg4h), bgOrDash(start), cases.length]
    );
    container.appendChild(summary);
  }
}

module.exports = {
  renderMealCurveChart: renderMealCurveChart
  , renderDiurnalChart: renderDiurnalChart
  , renderDailyTirChart: renderDailyTirChart
  , rangeLegendValues: rangeLegendValues
  , renderPumpActionHotspot: renderPumpActionHotspot
  , renderBasalDeltaChart: renderBasalDeltaChart
  , renderInsulinDistributionChart: renderInsulinDistributionChart
  , renderEpisodeTimingChart: renderEpisodeTimingChart
  , setTranslate: setTranslate
  , COLORS: COLORS
};
