'use strict';

var statistics = require('../../statistics');
var rules = require('./recommendation_rules');
var bolusClassifier = require('./bolus_classifier');

var MIN_MS = 60 * 1000;
var HOUR_MS = 60 * MIN_MS;
var SLOT_MIN = 5;
var SLOTS_PER_HOUR = 60 / SLOT_MIN;
var DRIFT_TOLERANCE_MIN = 10;
// Guards threshold comparisons against floating point noise (0.66 / 0.6 - 1).
var EPS = 1e-9;

function dateKeyToLocalMs (dk) {
  var parts = dk.split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function pad2 (n) {
  return String(n).padStart(2, '0');
}

function hhmm (minuteOfDay) {
  var m = ((minuteOfDay % 1440) + 1440) % 1440;
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

function median (values) {
  if (values.length === 0) return null;
  var s = values.slice().sort(function asc (a, b) { return a - b; });
  var mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function direction (d) {
  if (d >= rules.DIRECTION_THRESHOLD - EPS) return 'up';
  if (d <= -rules.DIRECTION_THRESHOLD + EPS) return 'down';
  return 'ok';
}

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
  return all.sort(function byMills (a, b) { return a.mills - b.mills; });
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

function nearestReading (list, target) {
  var idx = lowerBound(list, target);
  var best = null;
  var bestDist = Infinity;
  for (var i = idx - 1; i <= idx; i++) {
    if (i < 0 || i >= list.length) continue;
    var dist = Math.abs(list[i].mills - target);
    if (dist < bestDist) { best = list[i]; bestDist = dist; }
  }
  return best && bestDist <= DRIFT_TOLERANCE_MIN * MIN_MS ? best : null;
}

/**
 * Fasting-window cases per day and hour (spec 5.1). A case is an hour on a
 * pump day without meal, correction or unclear bolus and without carb entry
 * (except carbs of ignored dawn boluses) in the 4 h before or within the hour,
 * with at least 80 % CGM coverage.
 *
 * d = (delivered basal + auto boluses + BG drift / sens) / scheduled basal - 1
 *
 * The returned array carries `skipped` counts: { disturbed, lowCoverage,
 * noDrift, noSens, noSchedule }.
 *
 * @param {object} input - { treatments, readingsByDay, pumpDayKeys, profile, profileStore, classified }
 * @returns {Array<{dateKey: string, hour: number, d: number, deliveredU: number, scheduledU: number, autoU: number}>}
 */
function computeBasalCases (input) {
  var treatments = Array.isArray(input.treatments) ? input.treatments : [];
  var classified = Array.isArray(input.classified) ? input.classified : [];
  var dayKeys = Array.isArray(input.pumpDayKeys) ? input.pumpDayKeys : [];
  var readings = allReadings(input.readingsByDay);
  var basalLookup = statistics.buildProfileBasalLookup(input.profileStore);
  var sensAt = bolusClassifier.profileSensMgdl(input.profile, input.profileStore);
  var offsets = offsetsByDay(treatments);

  var cases = [];
  cases.skipped = { disturbed: 0, lowCoverage: 0, noDrift: 0, noSens: 0, noSchedule: 0 };

  // Disturbing events (absolute mills).
  var dawnMills = {};
  var disturb = [];
  classified.forEach(function eachBolus (b) {
    if (b.cls === 'dawn') dawnMills[b.mills] = true;
    else disturb.push(b.mills);
  });
  bolusClassifier.carbEntries(treatments).forEach(function eachCarb (c) {
    if (c.consumedBy !== null && dawnMills[c.consumedBy]) return;
    disturb.push(c.mills);
  });

  // Auto boluses per local day and hour.
  var autoByDayHour = {};
  treatments.forEach(function eachAuto (t) {
    if (!statistics.isAutoBolusEvent(t)) return;
    var u = Number(t.insulin);
    if (!isFinite(u) || u <= 0) return;
    var lt = bolusClassifier.localTime(t);
    if (!lt) return;
    var key = lt.dateKey + '|' + lt.localHour;
    autoByDayHour[key] = (autoByDayHour[key] || 0) + u;
  });

  var scheduled = [];
  for (var sh = 0; sh < 24; sh++) scheduled.push(scheduledUnits(basalLookup, sh));
  var lookbackMs = rules.FASTING_LOOKBACK_H * HOUR_MS;
  var minReadings = rules.MIN_CGM_COVERAGE * SLOTS_PER_HOUR;

  for (var di = 0; di < dayKeys.length; di++) {
    var dk = dayKeys[di];
    var basal = statistics.integrateActualBasalByHour(treatments, input.profileStore, [dk]);
    if (!basal.coverageByDay[dk]) continue;
    var dayStart = dateKeyToLocalMs(dk) - (offsets[dk] || 0) * MIN_MS;

    for (var h = 0; h < 24; h++) {
      var start = dayStart + h * HOUR_MS;
      var end = start + HOUR_MS;

      var disturbed = false;
      for (var k = 0; k < disturb.length; k++) {
        if (disturb[k] > start - lookbackMs && disturb[k] < end) { disturbed = true; break; }
      }
      if (disturbed) { cases.skipped.disturbed++; continue; }

      var count = lowerBound(readings, end) - lowerBound(readings, start);
      if (count < minReadings - EPS) { cases.skipped.lowCoverage++; continue; }

      var first = nearestReading(readings, start);
      var last = nearestReading(readings, end);
      if (!first || !last) { cases.skipped.noDrift++; continue; }

      var sens = sensAt(h, 30);
      if (!(typeof sens === 'number' && isFinite(sens) && sens > 0)) { cases.skipped.noSens++; continue; }

      var scheduledU = scheduled[h];
      if (!(scheduledU > 0)) { cases.skipped.noSchedule++; continue; }

      var deliveredU = basal.hourly[h];
      var autoU = autoByDayHour[dk + '|' + h] || 0;
      var drift = last.sgv - first.sgv;
      cases.push({
        dateKey: dk
        , hour: h
        , d: (deliveredU + autoU + drift / sens) / scheduledU - 1
        , deliveredU: deliveredU
        , scheduledU: scheduledU
        , autoU: autoU
      });
    }
  }
  return cases;
}

function roundTo (x, step) {
  return Math.round(Math.round(x / step) * step * 100) / 100;
}

// Profile rate times (1 + d), capped to MAX_STEP and rounded to ROUND_BASAL
// without the rounding pushing the change past the cap.
function newRate (oldRate, d) {
  var f = Math.max(-rules.MAX_STEP, Math.min(rules.MAX_STEP, d));
  var target = oldRate * (1 + f);
  var step = rules.ROUND_BASAL;
  var r = roundTo(target, step);
  var hi = oldRate * (1 + rules.MAX_STEP) + EPS;
  var lo = oldRate * (1 - rules.MAX_STEP) - EPS;
  if (r > hi) r = Math.round(Math.floor(hi / step + EPS) * step * 100) / 100;
  if (r < lo) r = Math.round(Math.ceil(lo / step - EPS) * step * 100) / 100;
  return r;
}

function hoursOf (startHour, length) {
  var list = [];
  for (var i = 0; i < length; i++) list.push((startHour + i) % 24);
  return list;
}

function blockStats (state, hours, byHour) {
  var ds = [];
  var minCount = Infinity;
  hours.forEach(function eachHour (h) {
    ds = ds.concat(byHour[h]);
    minCount = Math.min(minCount, byHour[h].length);
  });
  var med = median(ds);
  var dir = state === 'up' || state === 'down' ? state : (med === null ? null : direction(med));
  var same = ds.filter(function sameDir (d) { return direction(d) === dir; }).length;
  return {
    caseCount: minCount === Infinity ? 0 : minCount
    , sameDirShare: ds.length ? same / ds.length : 0
    , medianD: med
  };
}

function profileRows (state, startHour, length, medianD, basalLookup) {
  var rows = [];
  var startMin = startHour * 60;
  var endMin = startMin + length * 60;
  var current = null;
  for (var m = startMin; m < endMin; m++) {
    var mod = m % 1440;
    var rate = basalLookup(Math.floor(mod / 60), mod % 60);
    if (!current || current.oldRate !== rate) {
      if (current) current.to = hhmm(m);
      current = { from: hhmm(m), to: null, oldRate: rate };
      rows.push(current);
    }
  }
  if (current) current.to = hhmm(endMin);
  return rows.map(function withNewRate (r) {
    var nr = null;
    if (state === 'up' || state === 'down') nr = newRate(r.oldRate, medianD);
    else if (state === 'ok') nr = r.oldRate;
    return { from: r.from, to: r.to, oldRate: r.oldRate, newRate: nr };
  });
}

/**
 * Merge hours into blocks of equal state (circular over midnight), extend
 * up/down blocks one hour earlier when that hour is 'ok', and compute new
 * rates per profile segment (spec 5.1).
 *
 * startHour includes the extension; extendedFrom is the prepended hour or
 * null. Block statistics (caseCount, sameDirShare, medianD) use the original
 * hours only. A block covering the whole day has startHour 0, endHour 24.
 *
 * @param {Array<{hour: number, d: number}>} cases
 * @param {object} profileStore
 * @returns {Array<object>} BasalBlock[] sorted by startHour
 */
function buildBasalBlocks (cases, profileStore) {
  var basalLookup = statistics.buildProfileBasalLookup(profileStore);
  var byHour = [];
  var h;
  for (h = 0; h < 24; h++) byHour.push([]);
  (cases || []).forEach(function eachCase (c) {
    if (c && c.hour >= 0 && c.hour < 24 && typeof c.d === 'number' && isFinite(c.d)) byHour[c.hour].push(c.d);
  });

  var states = byHour.map(function hourState (ds) {
    if (ds.length < rules.MIN_CASES) return 'insufficient';
    return direction(median(ds));
  });

  // Circular grouping.
  var groups = [];
  var origin = 0;
  for (h = 0; h < 24; h++) {
    if (states[h] !== states[(h + 23) % 24]) { origin = h; break; }
  }
  var allSame = states.every(function same (s) { return s === states[0]; });
  if (allSame) {
    groups.push({ state: states[0], start: 0, length: 24 });
  } else {
    for (var i = 0; i < 24; i++) {
      var hr = (origin + i) % 24;
      var last = groups[groups.length - 1];
      if (last && last.state === states[hr]) last.length++;
      else groups.push({ state: states[hr], start: hr, length: 1 });
    }
  }

  groups.forEach(function stats (g) {
    g.hours = hoursOf(g.start, g.length);
    g.extendedFrom = null;
    g.span = { start: g.start, length: g.length };
  });

  // One-hour-earlier extension into a preceding 'ok' hour.
  if (!allSame) {
    groups.forEach(function extend (g) {
      if (g.state !== 'up' && g.state !== 'down') return;
      var prev = (g.start + 23) % 24;
      if (states[prev] !== 'ok') return;
      g.extendedFrom = prev;
      g.span = { start: prev, length: g.length + 1 };
      groups.forEach(function shrink (o) {
        if (o.state === 'ok' && (o.start + o.length) % 24 === g.start) {
          o.length--;
          o.hours = hoursOf(o.start, o.length);
          o.span = { start: o.start, length: o.length };
        }
      });
    });
  }

  return groups.filter(function nonEmpty (g) { return g.length > 0; }).map(function toBlock (g) {
    var st = blockStats(g.state, g.hours, byHour);
    var full = allSame;
    return {
      state: g.state
      , startHour: full ? 0 : g.span.start
      , endHour: full ? 24 : (g.span.start + g.span.length) % 24
      , extendedFrom: g.extendedFrom
      , caseCount: st.caseCount
      , sameDirShare: st.sameDirShare
      , medianD: st.medianD
      , rows: profileRows(g.state, full ? 0 : g.span.start, g.span.length, st.medianD, basalLookup)
    };
  }).sort(function byStart (a, b) { return a.startHour - b.startHour; });
}

module.exports = {
  computeBasalCases: computeBasalCases
  , buildBasalBlocks: buildBasalBlocks
};
