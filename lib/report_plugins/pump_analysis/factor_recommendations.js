'use strict';

var statistics = require('../../statistics');
var rules = require('./recommendation_rules');
var bolusClassifier = require('./bolus_classifier');
var glucoseUnits = require('./glucose_units');
var u = require('./recommendation_utils');

var MIN_MS = u.MIN_MS;
var HOUR_MS = u.HOUR_MS;
var EPS = u.EPS;

function isPositive (v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

// Shared lookups for meal and correction cases.
function buildContext (input) {
  var treatments = Array.isArray(input.treatments) ? input.treatments : [];
  var classified = Array.isArray(input.classified) ? input.classified : [];
  var store = input.profileStore;
  var basalLookup = statistics.buildProfileBasalLookup(store);
  var scheduled = [];
  for (var h = 0; h < 24; h++) scheduled.push(u.scheduledUnits(basalLookup, h));

  // utcOffset of each treatment by mills (bolus local minute), day offsets as fallback.
  var offsetByMills = {};
  treatments.forEach(function eachTreatment (t) {
    var lt = bolusClassifier.localTime(t);
    if (lt && typeof t.utcOffset === 'number') offsetByMills[lt.mills] = t.utcOffset;
  });

  // Dawn boluses neither count as meals nor disturb a window, and their carbs
  // are ignored; their insulin is counted spread over FASTING_LOOKBACK_H
  // hours (as in R22) wherever it overlaps a meal or correction window.
  var dawnMills = {};
  var boluses = [];
  var dawnBoluses = [];
  classified.forEach(function eachBolus (b) {
    if (b.cls === 'dawn') {
      dawnMills[b.mills] = true;
      if (b.insulin > 0) dawnBoluses.push(b);
    } else {
      boluses.push(b);
    }
  });
  var carbs = bolusClassifier.carbEntries(treatments).filter(function notDawn (c) {
    return !(c.consumedBy !== null && dawnMills[c.consumedBy]);
  });

  var autos = [];
  var hypoTreatments = [];
  treatments.forEach(function eachAuto (t) {
    var lt = bolusClassifier.localTime(t);
    if (!lt) return;
    if (statistics.isAutoBolusEvent(t)) {
      var units = Number(t.insulin);
      if (isFinite(units) && units > 0) autos.push({ mills: lt.mills, insulin: units });
    }
    if (typeof t.eventType === 'string' && /hypo/i.test(t.eventType)) hypoTreatments.push(lt.mills);
  });

  return {
    treatments: treatments
    , store: store
    , units: (store && store.units) || (input.profile && input.profile.units) || 'mg/dl'
    , readings: u.allReadings(input.readingsByDay)
    , hasPump: Array.isArray(input.pumpDayKeys) && input.pumpDayKeys.length > 0
    , scheduled: scheduled
    , dayOffsets: u.offsetsByDay(treatments)
    , offsetByMills: offsetByMills
    , boluses: boluses
    , dawnBoluses: dawnBoluses
    , carbs: carbs
    , autos: autos
    , hypoTreatments: hypoTreatments
    , carbRatioAt: statistics.buildProfileScheduleLookup(store, 'carbratio')
    , sensAt: bolusClassifier.profileSensMgdl(input.profile, store)
    , dayBasal: u.dayBasalLookup(treatments, store)
  };
}

// Dawn insulin in [start, end), each dawn bolus spread over FASTING_LOOKBACK_H.
function dawnUnits (ctx, start, end) {
  return u.spreadUnitsIn(ctx.dawnBoluses, start, end, rules.FASTING_LOOKBACK_H * HOUR_MS);
}

// Local wall-clock time of a classified bolus in the shifted frame.
function localOf (ctx, b) {
  var off = Object.prototype.hasOwnProperty.call(ctx.offsetByMills, b.mills)
    ? ctx.offsetByMills[b.mills]
    : (ctx.dayOffsets[b.dateKey] || 0);
  var localMs = b.mills + off * MIN_MS;
  var d = new Date(localMs);
  return { localMs: localMs, hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

function dayBasal (ctx, dk) {
  var res = ctx.dayBasal(dk);
  return res.coverageByDay[dk] ? res : null;
}

// Net basal deviation (delivered minus scheduled) over the window, pro rata
// per touched hour. 0 without any pump data; null when a pump user has no
// basal data for a touched day.
function basalDeviation (ctx, startLocalMs, windowMs) {
  if (!ctx.hasPump) return 0;
  var dev = 0;
  var t = startLocalMs;
  var end = startLocalMs + windowMs;
  while (t < end) {
    var dk = u.localMsToDateKey(t);
    var dayStart = u.dateKeyToLocalMs(dk);
    var h = Math.floor((t - dayStart) / HOUR_MS);
    var segEnd = Math.min(dayStart + (h + 1) * HOUR_MS, end);
    var basal = dayBasal(ctx, dk);
    if (!basal) return null;
    dev += (basal.hourly[h] - ctx.scheduled[h]) * (segEnd - t) / HOUR_MS;
    t = segEnd;
  }
  return dev;
}

function sumAuto (ctx, start, end) {
  var total = 0;
  ctx.autos.forEach(function eachAuto (a) {
    if (a.mills >= start && a.mills < end) total += a.insulin;
  });
  return total;
}

// Other (non-dawn) user boluses in [start, end).
function sumOtherBoluses (ctx, ownMills, start, end) {
  var total = 0;
  ctx.boluses.forEach(function eachBolus (b) {
    if (b.mills !== ownMills && b.mills >= start && b.mills < end) total += b.insulin;
  });
  return total;
}

function hasCoverage (ctx, start, windowMs) {
  var count = u.lowerBound(ctx.readings, start + windowMs) - u.lowerBound(ctx.readings, start);
  var expected = windowMs / (u.SLOT_MIN * MIN_MS);
  return count >= rules.MIN_CGM_COVERAGE * expected - EPS;
}

function startBgOf (ctx, b) {
  if (typeof b.bgAtBolus === 'number' && isFinite(b.bgAtBolus)) return b.bgAtBolus;
  var r = u.nearestReading(ctx.readings, b.mills);
  return r ? r.sgv : null;
}

function sgvAt (ctx, mills) {
  var r = u.nearestReading(ctx.readings, mills);
  return r ? r.sgv : null;
}

function slotOf (slots, hour) {
  for (var i = 0; i < slots.length; i++) {
    if (hour >= slots[i].startHour && hour < slots[i].endHour) return slots[i];
  }
  return null;
}

// Another meal (meal bolus or carb entry not belonging to this bolus) within
// the meal window before or after it.
function otherMealNear (ctx, b, windowMs) {
  var near = function near (mills) { return Math.abs(mills - b.mills) < windowMs; };
  var i;
  for (i = 0; i < ctx.boluses.length; i++) {
    var o = ctx.boluses[i];
    if (o.mills !== b.mills && o.cls === 'meal' && near(o.mills)) return true;
  }
  for (i = 0; i < ctx.carbs.length; i++) {
    var c = ctx.carbs[i];
    if (c.consumedBy !== b.mills && near(c.mills)) return true;
  }
  return false;
}

// 5-min grid 0..windowMin; grid points without a reading within 2.5 min are omitted.
function curveOf (ctx, start, windowMin) {
  var curve = [];
  for (var m = 0; m <= windowMin; m += u.SLOT_MIN) {
    var r = u.nearestReading(ctx.readings, start + m * MIN_MS, u.SLOT_MIN / 2);
    if (r) curve.push({ min: m, sgv: r.sgv });
  }
  return curve;
}

function peakOf (ctx, start, end) {
  var from = u.lowerBound(ctx.readings, start);
  var to = u.lowerBound(ctx.readings, end + 1);
  var best = null;
  for (var i = from; i < to; i++) {
    if (!best || ctx.readings[i].sgv > best.sgv) best = ctx.readings[i];
  }
  return best ? { bg: best.sgv, min: Math.round((best.mills - start) / MIN_MS) } : { bg: null, min: null };
}

/**
 * Meal cases per slot (spec 5.2). A case is a meal bolus with carbs in a meal
 * slot, without another meal (meal bolus or carb entry, dawn carbs excepted)
 * within 4 h before or after, with >= 80 % CGM coverage in the 4 h after.
 *
 * effectiveRatio = carbs / (meal bolus + other user boluses + auto boluses
 *   + dawn insulin overlapping the 4 h + net basal deviation in the 4 h
 *   + (BG after 4 h - start BG) / sens)
 * d = profile ratio / effectiveRatio - 1 (positive = more insulin needed)
 *
 * A denominator <= 0 means far more insulin than the carbs needed: the true
 * d tends to -1. Such a case is kept with d = -1, effectiveRatio null and
 * `nonPositive: true` (dropping it would bias the median toward more
 * insulin); it counts for the direction but not for the shown ratio median.
 *
 * The returned array carries `skipped` counts: { noSlot, otherMeal,
 * lowCoverage, noStartBg, noEndBg, noRatio, noSens, noPumpBasal } and
 * `windows`: { slot, dateKey, mills } of every meal bolus with carbs in a
 * slot, usable or not, for the counter-signal check (spec 5.5, R21).
 *
 * @param {object} input - { treatments, readingsByDay, pumpDayKeys, profile, profileStore, classified, slots }
 * @returns {Array<object>} MealCase[]
 */
function computeMealCases (input) {
  var ctx = buildContext(input);
  var slots = Array.isArray(input.slots) ? input.slots : rules.MEAL_SLOTS;
  var windowMs = rules.MEAL_WINDOW_H * HOUR_MS;
  var windowMin = rules.MEAL_WINDOW_H * 60;
  var cases = [];
  var skipped = cases.skipped = { noSlot: 0, otherMeal: 0, lowCoverage: 0, noStartBg: 0, noEndBg: 0, noRatio: 0, noSens: 0, noPumpBasal: 0 };
  var windows = cases.windows = [];

  ctx.boluses.forEach(function eachMeal (b) {
    if (b.cls !== 'meal' || !(b.carbs > 0)) return;
    var slot = slotOf(slots, b.localHour);
    if (!slot) { skipped.noSlot++; return; }
    windows.push({ slot: slot.key, dateKey: b.dateKey, mills: b.mills });
    if (otherMealNear(ctx, b, windowMs)) { skipped.otherMeal++; return; }
    var start = b.mills;
    var end = start + windowMs;
    if (!hasCoverage(ctx, start, windowMs)) { skipped.lowCoverage++; return; }

    var startBg = startBgOf(ctx, b);
    if (startBg === null) { skipped.noStartBg++; return; }
    var bg4h = sgvAt(ctx, end);
    if (bg4h === null) { skipped.noEndBg++; return; }

    var local = localOf(ctx, b);
    var ratio = ctx.carbRatioAt(local.hour, local.minute);
    if (!isPositive(ratio)) { skipped.noRatio++; return; }
    var sens = ctx.sensAt(local.hour, local.minute);
    if (!isPositive(sens)) { skipped.noSens++; return; }
    var dev = basalDeviation(ctx, local.localMs, windowMs);
    if (dev === null) { skipped.noPumpBasal++; return; }

    var dawnU = dawnUnits(ctx, start, end);
    var denom = b.insulin + sumOtherBoluses(ctx, b.mills, start, end) + sumAuto(ctx, start, end)
      + dawnU + dev + (bg4h - startBg) / sens;
    var nonPositive = !(denom > EPS);
    var effective = nonPositive ? null : b.carbs / denom;
    var peak = peakOf(ctx, start, end);
    var mealCase = {
      slot: slot.key
      , dateKey: b.dateKey
      , mills: b.mills
      , carbs: b.carbs
      , bolusU: b.insulin
      , dawnU: dawnU
      , startBg: startBg
      , peakBg: peak.bg
      , peakMin: peak.min
      , bg2h: sgvAt(ctx, start + windowMs / 2)
      , bg4h: bg4h
      , effectiveRatio: effective
      , profileRatio: ratio
      , d: nonPositive ? -1 : ratio / effective - 1
      , curve: curveOf(ctx, start, windowMin)
    };
    if (nonPositive) mealCase.nonPositive = true;
    cases.push(mealCase);
  });
  return cases;
}

/**
 * Correction cases (spec 5.3): correction at BG > 240, not fast rising,
 * without carbs, other user bolus or hypo treatment within 3 h before and
 * after, with >= 80 % CGM coverage in the 3 h after.
 *
 * measuredIsf = (start BG - BG after 3 h) / (bolus + auto boluses
 *   + dawn insulin overlapping the 3 h + net basal deviation)
 * d = sens / measuredIsf - 1 (positive = stronger factor needed)
 *
 * A correction without a BG drop is dropped (noDrop). With a BG drop but
 * total insulin <= 0 the true d tends to -1: the case is kept with d = -1,
 * measuredIsf null and `nonPositive: true`, so it counts for the direction
 * but not for the shown median of the measured drop.
 *
 * profileIsf and measuredIsf are mg/dl per U; `units` is the profile unit.
 * The returned array carries `skipped` counts: { fastRise, noStartBg,
 * noEndBg, disturbed, lowCoverage, noSens, noPumpBasal, noDrop } and
 * `windows`: { dateKey, mills } of every correction, measured or not, for
 * the counter-signal check (spec 5.5, R21).
 *
 * @param {object} input - same as computeMealCases
 * @returns {Array<object>} CorrectionCase[]
 */
function computeCorrectionCases (input) {
  var ctx = buildContext(input);
  var windowMs = rules.CORRECTION_WINDOW_H * HOUR_MS;
  var cases = [];
  var skipped = cases.skipped = { fastRise: 0, noStartBg: 0, noEndBg: 0, disturbed: 0, lowCoverage: 0, noSens: 0, noPumpBasal: 0, noDrop: 0 };
  var windows = cases.windows = [];

  ctx.boluses.forEach(function eachCorrection (b) {
    if (b.cls !== 'correction') return;
    windows.push({ dateKey: b.dateKey, mills: b.mills });
    if (b.fastRise) { skipped.fastRise++; return; }
    // Start BG missing or not above the correction threshold.
    if (!(typeof b.bgAtBolus === 'number' && b.bgAtBolus > rules.CORRECTION_BG_MGDL)) { skipped.noStartBg++; return; }

    var near = function near (mills) { return Math.abs(mills - b.mills) < windowMs; };
    var disturbed = ctx.boluses.some(function otherBolus (o) { return o.mills !== b.mills && near(o.mills); })
      || ctx.carbs.some(function carb (c) { return near(c.mills); })
      || ctx.hypoTreatments.some(near);
    if (disturbed) { skipped.disturbed++; return; }

    var start = b.mills;
    var end = start + windowMs;
    if (!hasCoverage(ctx, start, windowMs)) { skipped.lowCoverage++; return; }
    var bg3h = sgvAt(ctx, end);
    if (bg3h === null) { skipped.noEndBg++; return; }

    var local = localOf(ctx, b);
    var sens = ctx.sensAt(local.hour, local.minute);
    if (!isPositive(sens)) { skipped.noSens++; return; }
    var dev = basalDeviation(ctx, local.localMs, windowMs);
    if (dev === null) { skipped.noPumpBasal++; return; }

    var drop = b.bgAtBolus - bg3h;
    if (!(drop > EPS)) { skipped.noDrop++; return; }
    var dawnU = dawnUnits(ctx, start, end);
    var insulin = b.insulin + sumAuto(ctx, start, end) + dawnU + dev;
    var nonPositive = !(insulin > EPS);

    var measured = nonPositive ? null : drop / insulin;
    var corrCase = {
      dateKey: b.dateKey
      , mills: b.mills
      , bolusU: b.insulin
      , dawnU: dawnU
      , startBg: b.bgAtBolus
      , bg3h: bg3h
      , measuredIsf: measured
      , profileIsf: sens
      , d: nonPositive ? -1 : sens / measured - 1
      , units: ctx.units
    };
    if (nonPositive) corrCase.nonPositive = true;
    cases.push(corrCase);
  });
  return cases;
}

// Most frequent value; a tie goes to the value whose first occurrence comes
// first (the cases are in chronological order, so: the earliest case).
function mode (values) {
  var counts = {};
  var order = [];
  values.forEach(function count (v) {
    if (!Object.prototype.hasOwnProperty.call(counts, v)) { counts[v] = 0; order.push(v); }
    counts[v]++;
  });
  var best = null;
  var bestCount = 0;
  order.forEach(function pick (v) {
    if (counts[v] > bestCount) { best = v; bestCount = counts[v]; }
  });
  return best;
}

/**
 * New factor (carb ratio or ISF): old / (1 + d) with d capped at MAX_STEP,
 * rounded to step and kept within MAX_STEP both in insulin terms and in the
 * value itself. d > 0 (more insulin) lowers the factor. The result moves
 * strictly in the needed direction or stays with unchanged: true.
 */
function newFactor (oldValue, d, state, step) {
  var f = Math.max(-rules.MAX_STEP, Math.min(rules.MAX_STEP, d));
  var lo = Math.max(oldValue / (1 + rules.MAX_STEP), oldValue * (1 - rules.MAX_STEP)) - EPS;
  var hi = Math.min(oldValue / (1 - rules.MAX_STEP), oldValue * (1 + rules.MAX_STEP)) + EPS;
  return u.guardedStep(oldValue, oldValue / (1 + f), state === 'down', lo, hi, step);
}

// state, caseCount, sameDirShare, medianD and the new value for d cases.
function summarizeDs (ds, state, oldValue, step) {
  var med = u.median(ds);
  var res = {
    state: state
    , caseCount: ds.length
    , sameDirShare: null
    , medianD: med
    , newValue: null
    , unchanged: false
  };
  if (state !== 'insufficient' && ds.length) {
    var dir = state === 'up' || state === 'down' ? state : u.direction(med);
    res.sameDirShare = ds.filter(function sameDir (d) { return u.direction(d) === dir; }).length / ds.length;
  }
  if ((state === 'up' || state === 'down') && isPositive(oldValue)) {
    var step2 = newFactor(oldValue, med, state, step);
    res.newValue = step2.value;
    res.unchanged = step2.unchanged;
  } else if (state === 'ok') {
    res.newValue = oldValue;
  }
  return res;
}

function validCases (cases) {
  return (Array.isArray(cases) ? cases : []).filter(function valid (c) {
    return c && typeof c.d === 'number' && isFinite(c.d);
  });
}

function isLateBolus (c) {
  if (!(typeof c.bg4h === 'number' && c.bg4h < c.startBg)) return false;
  return (c.curve || []).some(function earlyPeak (p) {
    return p.min <= rules.LATE_BOLUS_PEAK_MIN && p.sgv >= c.startBg + rules.LATE_BOLUS_RISE_MGDL - EPS;
  });
}

/**
 * Summary of one meal slot (spec 5.2). 'timing' (check bolus-to-meal
 * interval) replaces a ratio change when >= 60 % of the cases rise by
 * >= 80 mg/dl within 90 min and end below the start after 4 h. newRatio is
 * null for 'insufficient' and 'timing', the old ratio for 'ok'. `unchanged:
 * true` marks an up/down slot whose ratio cannot move within MAX_STEP.
 * oldRatio is the most frequent profile ratio of the cases; mixedProfile
 * is true when the cases saw different profile ratios.
 *
 * @param {Array<object>} cases - MealCase[] of one slot
 * @param {string} [slotKey] - slot key, also used to filter the cases
 */
function summarizeMealSlot (cases, slotKey) {
  var list = validCases(cases).filter(function inSlot (c) { return !slotKey || c.slot === slotKey; });
  var ds = list.map(function getD (c) { return c.d; });
  var lateCount = list.filter(isLateBolus).length;
  var lateShare = list.length ? lateCount / list.length : null;

  var state;
  if (list.length < rules.MIN_CASES) state = 'insufficient';
  else if (lateShare >= rules.LATE_BOLUS_SHARE - EPS) state = 'timing';
  else state = u.direction(u.median(ds));

  var ratios = list.map(function getRatio (c) { return c.profileRatio; });
  var oldRatio = mode(ratios);
  var s = summarizeDs(ds, state, oldRatio, rules.ROUND_CARB_RATIO);
  var out = {
    slot: slotKey || (list[0] ? list[0].slot : null)
    , state: state
    , caseCount: s.caseCount
    , sameDirShare: s.sameDirShare
    , medianD: s.medianD
    , oldRatio: oldRatio
    , newRatio: s.newValue
    , latePattern: { share: lateShare, count: lateCount }
    , mixedProfile: ratios.some(function differs (r) { return r !== oldRatio; })
  };
  if (s.unchanged) out.unchanged = true;
  return out;
}

/**
 * Summary of the correction cases (spec 5.3). The new ISF is computed and
 * rounded in mg/dl; oldIsf and newIsf are returned in the profile unit
 * (`units`). newIsf is null for 'insufficient', the old value for 'ok'.
 *
 * @param {Array<object>} cases - CorrectionCase[]
 */
function summarizeCorrections (cases) {
  var list = validCases(cases);
  var ds = list.map(function getD (c) { return c.d; });
  var state = list.length < rules.MIN_CASES ? 'insufficient' : u.direction(u.median(ds));
  var isfs = list.map(function getIsf (c) { return c.profileIsf; });
  var oldMgdl = mode(isfs);
  var units = list[0] ? list[0].units : null;
  var s = summarizeDs(ds, state, oldMgdl, rules.ROUND_ISF);
  var toProfile = function toProfile (v) { return v === null ? null : glucoseUnits.fromMgdl(v, units); };
  var out = {
    state: state
    , caseCount: s.caseCount
    , sameDirShare: s.sameDirShare
    , medianD: s.medianD
    , oldIsf: toProfile(oldMgdl)
    , newIsf: toProfile(s.newValue)
    , units: units
    , mixedProfile: isfs.some(function differs (v) { return v !== oldMgdl; })
  };
  if (s.unchanged) out.unchanged = true;
  return out;
}

/**
 * Median glucose curve over meal cases (spec 6.7). Per minute the median of
 * the values that exist in the cases' curves is taken (curves may have gaps);
 * minutes without any value are omitted. Result is sorted by minute, mg/dl.
 *
 * @param {Array<object>} cases - MealCase[] (only `curve` is read)
 * @returns {Array<{min: number, sgv: number}>}
 */
function medianCurve (cases) {
  var byMin = {};
  (Array.isArray(cases) ? cases : []).forEach(function eachCase (c) {
    (c && Array.isArray(c.curve) ? c.curve : []).forEach(function eachPoint (p) {
      if (!p || typeof p.min !== 'number' || typeof p.sgv !== 'number' || !isFinite(p.sgv)) return;
      if (!byMin[p.min]) byMin[p.min] = [];
      byMin[p.min].push(p.sgv);
    });
  });
  return Object.keys(byMin).map(Number).sort(function asc (a, b) { return a - b; }).map(function toPoint (m) {
    return { min: m, sgv: u.median(byMin[m]) };
  });
}

module.exports = {
  computeMealCases: computeMealCases
  , medianCurve: medianCurve
  , summarizeMealSlot: summarizeMealSlot
  , computeCorrectionCases: computeCorrectionCases
  , summarizeCorrections: summarizeCorrections
};
