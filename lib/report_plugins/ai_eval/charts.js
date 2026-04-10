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
 * @param {object} meta - Metadata object
 */
function renderDailyTirChart (containerId, dayStats, dayDates, meta) {
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

module.exports = {
  renderDiurnalChart: renderDiurnalChart
  , renderDailyTirChart: renderDailyTirChart
};
