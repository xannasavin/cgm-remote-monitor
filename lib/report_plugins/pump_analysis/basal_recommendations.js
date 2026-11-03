'use strict';

var statistics = require('../../statistics');
var rules = require('./recommendation_rules');
var bolusClassifier = require('./bolus_classifier');

var u = require('./recommendation_utils');

var MIN_MS = u.MIN_MS;
var HOUR_MS = u.HOUR_MS;
var SLOTS_PER_HOUR = 60 / u.SLOT_MIN;
var EPS = u.EPS;
var dateKeyToLocalMs = u.dateKeyToLocalMs;
var median = u.median;
var direction = u.direction;
var scheduledUnits = u.scheduledUnits;
var offsetsByDay = u.offsetsByDay;
var allReadings = u.allReadings;
var lowerBound = u.lowerBound;
var nearestReading = u.nearestReading;

function pad2 (n) {
  return String(n).padStart(2, '0');
}

function hhmm (minuteOfDay) {
  var m = ((minuteOfDay % 1440) + 1440) % 1440;
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

// Dawn insulin in [start, end): each dawn bolus spread evenly over spreadMs
// from its time, pro rata per overlap.
function dawnUnitsIn (dawnBoluses, start, end, spreadMs) {
  var total = 0;
  dawnBoluses.forEach(function eachDawn (b) {
    var overlap = Math.min(end, b.mills + spreadMs) - Math.max(start, b.mills);
    if (overlap > 0) total += b.insulin * overlap / spreadMs;
  });
  return total;
}

// The value in [lo, hi] closest to 0 (lo <= hi).
function closestToZero (lo, hi) {
  if (lo > 0) return lo;
  if (hi < 0) return hi;
  return 0;
}

/**
 * Fasting-window cases per day and hour (spec 5.1). A case is an hour on a
 * pump day without meal, correction or unclear bolus and without carb entry
 * (except carbs of ignored dawn boluses) in the 4 h before or within the hour,
 * with at least 80 % CGM coverage.
 *
 * dLo = (delivered basal + auto boluses + BG drift / sens) / scheduled basal - 1
 * dHi = dLo + dawn insulin in the hour / scheduled basal
 * d   = the value in [dLo, dHi] closest to 0 (R22). Each dawn bolus counts as
 * insulin spread evenly over FASTING_LOOKBACK_H hours from its time, its carbs
 * are ignored. d only points in a direction that holds whether or not the
 * dawn bolus is counted. Hours without dawn insulin have dLo = dHi.
 *
 * The returned array carries `skipped` counts: { disturbed, lowCoverage,
 * noDrift, noSens, noSchedule }.
 *
 * @param {object} input - { treatments, readingsByDay, pumpDayKeys, profile, profileStore, classified }
 * @returns {Array<{dateKey: string, hour: number, d: number, deliveredU: number, scheduledU: number, autoU: number, dawnU: number, drift: number}>} drift in mg/dl over the hour
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
  var dawnBoluses = [];
  var disturb = [];
  classified.forEach(function eachBolus (b) {
    if (b.cls === 'dawn') {
      dawnMills[b.mills] = true;
      if (b.insulin > 0) dawnBoluses.push(b);
    } else {
      disturb.push(b.mills);
    }
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
      var dawnU = dawnUnitsIn(dawnBoluses, start, end, lookbackMs);
      var dLo = (deliveredU + autoU + drift / sens) / scheduledU - 1;
      cases.push({
        dateKey: dk
        , hour: h
        , d: closestToZero(dLo, dLo + dawnU / scheduledU)
        , deliveredU: deliveredU
        , scheduledU: scheduledU
        , autoU: autoU
        , dawnU: dawnU
        , drift: drift
      });
    }
  }
  return cases;
}

// Profile rate times (1 + d), capped to MAX_STEP and rounded to ROUND_BASAL
// without the rounding pushing the change past the cap. The result always
// moves strictly in the block's direction; if no grid step in that direction
// fits inside the cap, the rate stays and the row is marked unchanged.
function newRate (oldRate, d, state) {
  var f = Math.max(-rules.MAX_STEP, Math.min(rules.MAX_STEP, d));
  var hi = oldRate * (1 + rules.MAX_STEP) + EPS;
  var lo = oldRate * (1 - rules.MAX_STEP) - EPS;
  var res = u.guardedStep(oldRate, oldRate * (1 + f), state === 'up', lo, hi, rules.ROUND_BASAL);
  return { rate: res.value, unchanged: res.unchanged };
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
    , sameDirShare: state === 'insufficient' || !ds.length ? null : same / ds.length
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
    var row = { from: r.from, to: r.to, oldRate: r.oldRate, newRate: null };
    if (state === 'up' || state === 'down') {
      var res = newRate(r.oldRate, medianD, state);
      row.newRate = res.rate;
      if (res.unchanged) row.unchanged = true;
    } else if (state === 'ok') {
      row.newRate = r.oldRate;
    }
    return row;
  });
}

/**
 * Merge hours into blocks of equal state (circular over midnight), extend
 * up/down blocks one hour earlier when that hour is 'ok', and compute new
 * rates per profile segment (spec 5.1).
 *
 * startHour includes the extension; extendedFrom is the prepended hour or
 * null. Block statistics (caseCount, sameDirShare, medianD) use the original
 * hours only; sameDirShare is null for insufficient blocks. A block covering
 * the whole day has startHour 0, endHour 24. A row whose rate cannot move in
 * the block's direction within MAX_STEP keeps newRate = oldRate and carries
 * `unchanged: true`; other rows have no `unchanged` key.
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
