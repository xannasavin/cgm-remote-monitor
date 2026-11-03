'use strict';

var rules = require('./recommendation_rules');
var bolusClassifier = require('./bolus_classifier');

// Shared helpers for the recommendation modules (basal, carb ratio, ISF).

var MIN_MS = 60 * 1000;
var HOUR_MS = 60 * MIN_MS;
var SLOT_MIN = 5;
var NEAREST_TOLERANCE_MIN = 10;
// Guards threshold comparisons against floating point noise (0.66 / 0.6 - 1).
var EPS = 1e-9;

// Local midnight of a date key in the shifted (local wall clock as UTC) frame.
function dateKeyToLocalMs (dk) {
  var parts = dk.split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

// Date key of a shifted (local wall clock as UTC) ms value.
function localMsToDateKey (ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-'
    + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(d.getUTCDate()).padStart(2, '0');
}

function median (values) {
  if (values.length === 0) return null;
  var s = values.slice().sort(function asc (a, b) { return a - b; });
  var mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 'up' (more insulin), 'down' (less insulin) or 'ok' for a relative deviation d.
function direction (d) {
  if (d >= rules.DIRECTION_THRESHOLD - EPS) return 'up';
  if (d <= -rules.DIRECTION_THRESHOLD + EPS) return 'down';
  return 'ok';
}

// Scheduled basal units in one local hour.
function scheduledUnits (basalLookup, hour) {
  var total = 0;
  for (var m = 0; m < 60; m += SLOT_MIN) total += basalLookup(hour, m) * (SLOT_MIN / 60);
  return total;
}

// utcOffset (minutes) per local date, taken from that day's treatments.
// CGM readings carry no offset of their own.
function offsetsByDay (treatments) {
  var map = {};
  for (var i = 0; i < treatments.length; i++) {
    var t = treatments[i];
    if (!t || typeof t.utcOffset !== 'number') continue;
    var lt = bolusClassifier.localTime(t);
    if (lt && !Object.prototype.hasOwnProperty.call(map, lt.dateKey)) map[lt.dateKey] = t.utcOffset;
  }
  return map;
}

// All readings of all days, ascending, deduplicated by mills.
function allReadings (readingsByDay) {
  var all = [];
  Object.keys(readingsByDay || {}).forEach(function eachDay (k) {
    var list = readingsByDay[k];
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r && typeof r.mills === 'number' && typeof r.sgv === 'number' && isFinite(r.sgv)) all.push(r);
    }
  });
  all.sort(function byMills (a, b) { return a.mills - b.mills; });
  // Duplicate readings (same mills) would inflate CGM coverage.
  return all.filter(function unique (r, i) { return i === 0 || r.mills !== all[i - 1].mills; });
}

// First index with mills >= target.
function lowerBound (list, target) {
  var lo = 0;
  var hi = list.length;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (list[mid].mills < target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Reading closest to target within toleranceMin (default 10 min), else null.
function nearestReading (list, target, toleranceMin) {
  var tol = (typeof toleranceMin === 'number' ? toleranceMin : NEAREST_TOLERANCE_MIN) * MIN_MS;
  var idx = lowerBound(list, target);
  var best = null;
  var bestDist = Infinity;
  for (var i = idx - 1; i <= idx; i++) {
    if (i < 0 || i >= list.length) continue;
    var dist = Math.abs(list[i].mills - target);
    if (dist < bestDist) { best = list[i]; bestDist = dist; }
  }
  return best && bestDist <= tol + EPS ? best : null;
}

function roundTo (x, step) {
  return Math.round(Math.round(x / step) * step * 100) / 100;
}

function gridValue (n, step) {
  return Math.round(n * step * 100) / 100;
}

/**
 * Round target to the step grid, keep it inside [lo, hi] and make it move
 * strictly away from oldValue in the wanted direction (moveUp: larger value).
 * If no grid value in that direction fits, the old value stays and the result
 * is marked unchanged.
 *
 * @returns {{value: number, unchanged: boolean}}
 */
function guardedStep (oldValue, target, moveUp, lo, hi, step) {
  var r = roundTo(target, step);
  if (r > hi) r = gridValue(Math.floor(hi / step + EPS), step);
  if (r < lo) r = gridValue(Math.ceil(lo / step - EPS), step);

  if (moveUp && !(r > oldValue + EPS)) {
    r = gridValue(Math.floor(oldValue / step + EPS) + 1, step);
    if (r > hi) return { value: oldValue, unchanged: true };
  } else if (!moveUp && !(r < oldValue - EPS)) {
    r = gridValue(Math.ceil(oldValue / step - EPS) - 1, step);
    if (r < lo || r <= 0) return { value: oldValue, unchanged: true };
  }
  return { value: r, unchanged: false };
}

module.exports = {
  MIN_MS: MIN_MS
  , HOUR_MS: HOUR_MS
  , SLOT_MIN: SLOT_MIN
  , EPS: EPS
  , dateKeyToLocalMs: dateKeyToLocalMs
  , localMsToDateKey: localMsToDateKey
  , median: median
  , direction: direction
  , scheduledUnits: scheduledUnits
  , offsetsByDay: offsetsByDay
  , allReadings: allReadings
  , lowerBound: lowerBound
  , nearestReading: nearestReading
  , roundTo: roundTo
  , gridValue: gridValue
  , guardedStep: guardedStep
};
