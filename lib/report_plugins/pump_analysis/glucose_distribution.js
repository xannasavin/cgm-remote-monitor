'use strict';

// Page-only glucose distribution helpers (percentile bands per hour and the
// five-range split per day). Input readings are always mg/dl; only the
// percentile output is converted to display units.

var glucoseUnits = require('./glucose_units');

// Fallbacks for very low / very high when BG_LOW / BG_HIGH are not usable
// (international TIR consensus limits).
var VERY_LOW_MGDL = 54;
var VERY_HIGH_MGDL = 250;

// Linear interpolation between closest ranks (same as d3.quantile).
function quantileSorted (sorted, p) {
  var n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0];
  var idx = (n - 1) * p;
  var lo = Math.floor(idx);
  var hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function isValid (r) {
  return r && typeof r.sgv === 'number' && isFinite(r.sgv);
}

// The hour comes from reading.localHour (set by the data processor in the
// browser's local frame). utcOffsetMs is only the fallback for readings
// without localHour: hour = UTC hour of (mills + utcOffsetMs).
function hourOf (r, utcOffsetMs) {
  if (typeof r.localHour === 'number') return r.localHour;
  if (typeof r.mills !== 'number') return null;
  return new Date(r.mills + (utcOffsetMs || 0)).getUTCHours();
}

/**
 * Hourly glucose percentiles over all days.
 *
 * @param {object} readingsByDay - { dateKey: [{ mills, sgv (mg/dl), localHour? }] }
 * @param {number} [utcOffsetMs] - fallback offset for readings without localHour
 * @param {string} [units] - display units; output is converted with fromMgdl
 * @returns {Array<{hour: number, p10: number, p25: number, p50: number, p75: number, p90: number, n: number}>}
 *   only hours with readings, ascending
 */
function hourlyPercentiles (readingsByDay, utcOffsetMs, units) {
  var buckets = [];
  for (var h = 0; h < 24; h++) buckets.push([]);
  Object.keys(readingsByDay || {}).forEach(function eachDay (k) {
    var list = readingsByDay[k];
    if (!Array.isArray(list)) return;
    list.forEach(function eachReading (r) {
      if (!isValid(r)) return;
      var hour = hourOf(r, utcOffsetMs);
      if (hour === null || hour < 0 || hour > 23) return;
      buckets[hour].push(r.sgv);
    });
  });
  var out = [];
  buckets.forEach(function eachHour (values, hour) {
    if (values.length === 0) return;
    values.sort(function asc (a, b) { return a - b; });
    function q (p) { return glucoseUnits.fromMgdl(quantileSorted(values, p), units); }
    out.push({ hour: hour, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), n: values.length });
  });
  return out;
}

/**
 * Limits of the five ranges in mg/dl. veryLow/veryHigh come from the
 * Nightscout thresholds BG_LOW/BG_HIGH (settings.thresholds, always mg/dl)
 * and fall back to 54/250 when missing or not finite. They are clamped to the
 * target range so that no range has a negative width.
 *
 * @param {object} [thresholds] - settings.thresholds ({ bgLow, bgHigh })
 * @param {number} targetLowMgdl
 * @param {number} targetHighMgdl
 * @returns {{veryLow: number, low: number, high: number, veryHigh: number}}
 */
function rangeLimits (thresholds, targetLowMgdl, targetHighMgdl) {
  var t = thresholds || {};
  var bgLow = Number(t.bgLow);
  var bgHigh = Number(t.bgHigh);
  var veryLow = isFinite(bgLow) && bgLow > 0 ? bgLow : VERY_LOW_MGDL;
  var veryHigh = isFinite(bgHigh) && bgHigh > 0 ? bgHigh : VERY_HIGH_MGDL;
  return {
    veryLow: Math.min(veryLow, targetLowMgdl)
    , low: targetLowMgdl
    , high: targetHighMgdl
    , veryHigh: Math.max(veryHigh, targetHighMgdl)
  };
}

/**
 * Share of readings per day in five ranges (percent): very low (< veryLow),
 * low (< low), in range (<= high), high (<= veryHigh), very high (> veryHigh).
 * Days without readings are left out.
 *
 * @param {object} readingsByDay - { dateKey: [{ sgv (mg/dl) }] }
 * @param {{veryLow: number, low: number, high: number, veryHigh: number}} limits - mg/dl, see rangeLimits
 * @returns {Array<{dateKey: string, veryLow: number, low: number, inRange: number, high: number, veryHigh: number}>}
 */
function dailyRanges (readingsByDay, limits) {
  var out = [];
  Object.keys(readingsByDay || {}).sort().forEach(function eachDay (k) {
    var list = readingsByDay[k];
    if (!Array.isArray(list)) return;
    var c = { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0 };
    var n = 0;
    list.forEach(function eachReading (r) {
      if (!isValid(r)) return;
      n++;
      if (r.sgv < limits.veryLow) c.veryLow++;
      else if (r.sgv < limits.low) c.low++;
      else if (r.sgv <= limits.high) c.inRange++;
      else if (r.sgv <= limits.veryHigh) c.high++;
      else c.veryHigh++;
    });
    if (n === 0) return;
    out.push({
      dateKey: k
      , veryLow: c.veryLow * 100 / n
      , low: c.low * 100 / n
      , inRange: c.inRange * 100 / n
      , high: c.high * 100 / n
      , veryHigh: c.veryHigh * 100 / n
    });
  });
  return out;
}

module.exports = {
  hourlyPercentiles: hourlyPercentiles
  , dailyRanges: dailyRanges
  , rangeLimits: rangeLimits
  , quantileSorted: quantileSorted
};
