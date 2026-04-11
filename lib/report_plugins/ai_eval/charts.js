'use strict';

var d3 = (global && global.d3) || require('d3');
var renderer = require('./renderer');

/**
 * Render a 24-hour diurnal pattern chart with SD band and target range.
 *
 * @param {string} containerId - CSS selector for mount element
 * @param {Array} diurnalPatterns - Array of { hour, avg, sd, days_with_data }
 * @param {object} meta - { target_low, target_high, units }
 */
function renderDiurnalChart (containerId, diurnalPatterns, meta) {
  var container = document.querySelector(containerId);
  if (!container) return;
  if (!d3 || typeof d3.select !== 'function') {
    container.textContent = 'Charts unavailable';
    return;
  }
  if (!diurnalPatterns || diurnalPatterns.length === 0) {
    container.textContent = '';
    return;
  }
  container.textContent = '';

  meta = meta || {};
  var targetLow = meta.target_low || 70;
  var targetHigh = meta.target_high || 180;
  var units = meta.units || 'mg/dL';

  var margin = { top: 20, right: 30, bottom: 35, left: 50 };
  var width = 900 - margin.left - margin.right;
  var height = 280 - margin.top - margin.bottom;

  // Compute Y domain from data
  var allValues = [];
  diurnalPatterns.forEach(function (p) {
    allValues.push(p.avg - (p.sd || 0));
    allValues.push(p.avg + (p.sd || 0));
  });
  var yMin = Math.min(d3.min(allValues), targetLow - 10);
  var yMax = Math.max(d3.max(allValues), targetHigh + 10);

  var svg = d3.select(containerId).append('svg')
    .attr('viewBox', '0 0 900 280')
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', 'Diurnal glucose pattern chart showing hourly averages with standard deviation band');

  var g = svg.append('g')
    .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

  var x = d3.scaleLinear().domain([0, 23]).range([0, width]);
  var y = d3.scaleLinear().domain([yMin, yMax]).range([height, 0]);

  // Gridlines
  g.append('g').attr('class', 'grid')
    .attr('transform', 'translate(0,' + height + ')')
    .call(d3.axisBottom(x).tickSize(-height).tickFormat(''))
    .selectAll('line').style('stroke', '#eee');

  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
    .selectAll('line').style('stroke', '#eee');

  // Target range band
  g.append('rect')
    .attr('x', 0).attr('width', width)
    .attr('y', y(targetHigh)).attr('height', y(targetLow) - y(targetHigh))
    .attr('fill', '#28a745').attr('opacity', 0.1);

  // SD band (area)
  var area = d3.area()
    .x(function (d) { return x(d.hour); })
    .y0(function (d) { return y(Math.max(yMin, d.avg - (d.sd || 0))); })
    .y1(function (d) { return y(Math.min(yMax, d.avg + (d.sd || 0))); });

  g.append('path')
    .datum(diurnalPatterns)
    .attr('fill', '#17a2b8').attr('opacity', 0.2)
    .attr('d', area);

  // Average line
  var line = d3.line()
    .x(function (d) { return x(d.hour); })
    .y(function (d) { return y(d.avg); });

  g.append('path')
    .datum(diurnalPatterns)
    .attr('fill', 'none').attr('stroke', '#17a2b8').attr('stroke-width', 2.5)
    .attr('d', line);

  // Data points
  g.selectAll('.dot')
    .data(diurnalPatterns).enter().append('circle')
    .attr('cx', function (d) { return x(d.hour); })
    .attr('cy', function (d) { return y(d.avg); })
    .attr('r', 3).attr('fill', '#17a2b8');

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
    .attr('text-anchor', 'middle').style('font-size', '11px').text('Hour of Day');

  svg.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(margin.top + height / 2)).attr('y', 14)
    .attr('text-anchor', 'middle').style('font-size', '11px').text(units);
}

/**
 * Render daily TIR stacked horizontal bar chart.
 *
 * @param {string} containerId - CSS selector for mount element
 * @param {Array} dayStats - Array of day stat objects with tir_pct, tbr_pct, tar_pct
 * @param {Array} dayDates - Array of YYYY-MM-DD date strings
 */
function renderDailyTirChart (containerId, dayStats, dayDates) {
  var container = document.querySelector(containerId);
  if (!container) return;
  if (!d3 || typeof d3.select !== 'function') {
    container.textContent = 'Charts unavailable';
    return;
  }
  if (!dayStats || dayStats.length === 0) {
    container.textContent = '';
    return;
  }
  container.textContent = '';

  dayDates = dayDates || [];

  var margin = { top: 10, right: 30, bottom: 25, left: 80 };
  var barHeight = 22;
  var gap = 4;
  var totalHeight = margin.top + margin.bottom + dayStats.length * (barHeight + gap);
  var width = 900 - margin.left - margin.right;
  var height = totalHeight - margin.top - margin.bottom;

  var labels = dayStats.map(function (ds, i) {
    return dayDates[i] ? renderer.formatDate(dayDates[i]) : 'Day ' + (i + 1);
  });

  var svg = d3.select(containerId).append('svg')
    .attr('viewBox', '0 0 900 ' + totalHeight)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('role', 'img')
    .attr('aria-label', 'Daily time-in-range stacked bar chart');

  var g = svg.append('g')
    .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

  var yScale = d3.scaleBand()
    .domain(labels)
    .range([0, height])
    .padding(0.15);

  var xScale = d3.scaleLinear().domain([0, 100]).range([0, width]);

  // Bars
  var colors = { tbr: '#dc3545', tir: '#28a745', tar: '#ffc107' };

  dayStats.forEach(function (ds, i) {
    var label = labels[i];
    var yPos = yScale(label);
    var bh = yScale.bandwidth();
    var tbr = ds.tbr_pct || 0;
    var tir = ds.tir_pct || 0;
    var tar = ds.tar_pct || 0;

    // TBR segment
    if (tbr > 0) {
      g.append('rect')
        .attr('x', xScale(0)).attr('y', yPos)
        .attr('width', xScale(tbr)).attr('height', bh)
        .attr('fill', colors.tbr);
      if (tbr >= 8) {
        g.append('text').attr('x', xScale(tbr / 2)).attr('y', yPos + bh / 2 + 4)
          .attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#fff')
          .text(Math.round(tbr) + '%');
      }
    }

    // TIR segment
    if (tir > 0) {
      g.append('rect')
        .attr('x', xScale(tbr)).attr('y', yPos)
        .attr('width', xScale(tir)).attr('height', bh)
        .attr('fill', colors.tir);
      if (tir >= 8) {
        g.append('text').attr('x', xScale(tbr + tir / 2)).attr('y', yPos + bh / 2 + 4)
          .attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#fff')
          .text(Math.round(tir) + '%');
      }
    }

    // TAR segment
    if (tar > 0) {
      g.append('rect')
        .attr('x', xScale(tbr + tir)).attr('y', yPos)
        .attr('width', xScale(tar)).attr('height', bh)
        .attr('fill', colors.tar);
      if (tar >= 8) {
        g.append('text').attr('x', xScale(tbr + tir + tar / 2)).attr('y', yPos + bh / 2 + 4)
          .attr('text-anchor', 'middle').style('font-size', '10px').style('fill', '#333')
          .text(Math.round(tar) + '%');
      }
    }
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

  // Legend
  var legend = svg.append('g')
    .attr('transform', 'translate(' + (margin.left + width - 200) + ',0)');

  var legendItems = [
    { label: 'Below Range', color: colors.tbr }
    , { label: 'In Range', color: colors.tir }
    , { label: 'Above Range', color: colors.tar }
  ];

  legendItems.forEach(function (item, i) {
    legend.append('rect')
      .attr('x', i * 75).attr('y', 0).attr('width', 10).attr('height', 10)
      .attr('fill', item.color);
    legend.append('text')
      .attr('x', i * 75 + 13).attr('y', 9)
      .style('font-size', '9px').text(item.label);
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

// R3-1 / R2-3: shared window-scoped translate store (see renderer.js for
// the rationale). Both modules read/write the same key so setTranslate in
// ai_eval.js init wires them at once. R3-4: defensive typeof check so a
// stale/undefined reference cannot produce the literal string 'undefined'
// in the UI.
var TRANSLATE_STORE_KEY = '__aiEvalTranslate';
var translateHost = (typeof window !== 'undefined')
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : {});
function translate (key) {
  var fn = translateHost[TRANSLATE_STORE_KEY];
  return (typeof fn === 'function') ? fn(key) : key;
}
function setTranslate (fn) {
  if (typeof fn === 'function') translateHost[TRANSLATE_STORE_KEY] = fn;
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
  , neutral: 'rgba(120, 130, 150, 0.15)'
  , directionUpBase: '220, 53, 69'  // red rgb triple
  , directionDownBase: '23, 162, 184' // teal rgb triple
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

  var area = d3.area()
    .x(function (d, i) { return x(i); })
    .y0(function (d, i) { return y(scheduledHourly[i]); })
    .y1(function (d, i) { return y(actualHourly[i]); });

  g.append('path')
    .datum(actualHourly)
    .attr('fill', COLORS.hyper).attr('fill-opacity', 0.12).attr('d', area);

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

module.exports = {
  renderDiurnalChart: renderDiurnalChart
  , renderDailyTirChart: renderDailyTirChart
  , renderPumpActionHotspot: renderPumpActionHotspot
  , renderBasalDeltaChart: renderBasalDeltaChart
  , renderInsulinDistributionChart: renderInsulinDistributionChart
  , renderEpisodeTimingChart: renderEpisodeTimingChart
  , setTranslate: setTranslate
};
