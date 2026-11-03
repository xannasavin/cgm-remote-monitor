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

  // Dawn boluses and their carbs are ignored everywhere.
  var dawnMills = {};
  var boluses = [];
  classified.forEach(function eachBolus (b) {
    if (b.cls === 'dawn') dawnMills[b.mills] = true;
    else boluses.push(b);
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
    , carbs: carbs
    , autos: autos
    , hypoTreatments: hypoTreatments
    , carbRatioAt: statistics.buildProfileScheduleLookup(store, 'carbratio')
    , sensAt: bolusClassifier.profileSensMgdl(input.profile, store)
    , basalByDay: {}
  };
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
  if (!Object.prototype.hasOwnProperty.call(ctx.basalByDay, dk)) {
    var res = statistics.integrateActualBasalByHour(ctx.treatments, ctx.store, [dk]);
    ctx.basalByDay[dk] = res.coverageByDay[dk] ? res : null;
  }
  return ctx.basalByDay[dk];
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
 *   + net basal deviation in the 4 h + (BG after 4 h - start BG) / sens)
 * d = profile ratio / effectiveRatio - 1 (positive = more insulin needed)
 *
 * The returned array carries `skipped` counts: { noSlot, otherMeal,
 * lowCoverage, noBg, noRatio, noSens, noPumpBasal, nonPositive }.
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
  var skipped = cases.skipped = { noSlot: 0, otherMeal: 0, lowCoverage: 0, noBg: 0, noRatio: 0, noSens: 0, noPumpBasal: 0, nonPositive: 0 };

  ctx.boluses.forEach(function eachMeal (b) {
    if (b.cls !== 'meal' || !(b.carbs > 0)) return;
    var slot = slotOf(slots, b.localHour);
    if (!slot) { skipped.noSlot++; return; }
    if (otherMealNear(ctx, b, windowMs)) { skipped.otherMeal++; return; }
    var start = b.mills;
    var end = start + windowMs;
    if (!hasCoverage(ctx, start, windowMs)) { skipped.lowCoverage++; return; }

    var startBg = startBgOf(ctx, b);
    var bg4h = sgvAt(ctx, end);
    if (startBg === null || bg4h === null) { skipped.noBg++; return; }

    var local = localOf(ctx, b);
    var ratio = ctx.carbRatioAt(local.hour, local.minute);
    if (!isPositive(ratio)) { skipped.noRatio++; return; }
    var sens = ctx.sensAt(local.hour, local.minute);
    if (!isPositive(sens)) { skipped.noSens++; return; }
    var dev = basalDeviation(ctx, local.localMs, windowMs);
    if (dev === null) { skipped.noPumpBasal++; return; }

    var denom = b.insulin + sumOtherBoluses(ctx, b.mills, start, end) + sumAuto(ctx, start, end)
      + dev + (bg4h - startBg) / sens;
    if (!(denom > EPS)) { skipped.nonPositive++; return; }

    var effective = b.carbs / denom;
    var peak = peakOf(ctx, start, end);
    cases.push({
      slot: slot.key
      , dateKey: b.dateKey
      , mills: b.mills
      , carbs: b.carbs
      , bolusU: b.insulin
      , startBg: startBg
      , peakBg: peak.bg
      , peakMin: peak.min
      , bg2h: sgvAt(ctx, start + windowMs / 2)
      , bg4h: bg4h
      , effectiveRatio: effective
      , profileRatio: ratio
      , d: ratio / effective - 1
      , curve: curveOf(ctx, start, windowMin)
    });
  });
  return cases;
}

/**
 * Correction cases (spec 5.3): correction at BG > 240, not fast rising,
 * without carbs, other user bolus or hypo treatment within 3 h before and
 * after, with >= 80 % CGM coverage in the 3 h after.
 *
 * measuredIsf = (start BG - BG after 3 h) / (bolus + auto boluses + net basal deviation)
 * d = sens / measuredIsf - 1 (positive = stronger factor needed)
 *
 * profileIsf and measuredIsf are mg/dl per U; `units` is the profile unit.
 * The returned array carries `skipped` counts: { fastRise, noBg, disturbed,
 * lowCoverage, noSens, noPumpBasal, nonPositive }.
 *
 * @param {object} input - same as computeMealCases
 * @returns {Array<object>} CorrectionCase[]
 */
function computeCorrectionCases (input) {
  var ctx = buildContext(input);
  var windowMs = rules.CORRECTION_WINDOW_H * HOUR_MS;
  var cases = [];
  var skipped = cases.skipped = { fastRise: 0, noBg: 0, disturbed: 0, lowCoverage: 0, noSens: 0, noPumpBasal: 0, nonPositive: 0 };

  ctx.boluses.forEach(function eachCorrection (b) {
    if (b.cls !== 'correction') return;
    if (b.fastRise) { skipped.fastRise++; return; }
    if (!(typeof b.bgAtBolus === 'number' && b.bgAtBolus > rules.CORRECTION_BG_MGDL)) { skipped.noBg++; return; }

    var near = function near (mills) { return Math.abs(mills - b.mills) < windowMs; };
    var disturbed = ctx.boluses.some(function otherBolus (o) { return o.mills !== b.mills && near(o.mills); })
      || ctx.carbs.some(function carb (c) { return near(c.mills); })
      || ctx.hypoTreatments.some(near);
    if (disturbed) { skipped.disturbed++; return; }

    var start = b.mills;
    var end = start + windowMs;
    if (!hasCoverage(ctx, start, windowMs)) { skipped.lowCoverage++; return; }
    var bg3h = sgvAt(ctx, end);
    if (bg3h === null) { skipped.noBg++; return; }

    var local = localOf(ctx, b);
    var sens = ctx.sensAt(local.hour, local.minute);
    if (!isPositive(sens)) { skipped.noSens++; return; }
    var dev = basalDeviation(ctx, local.localMs, windowMs);
    if (dev === null) { skipped.noPumpBasal++; return; }

    var insulin = b.insulin + sumAuto(ctx, start, end) + dev;
    var drop = b.bgAtBolus - bg3h;
    if (!(insulin > EPS) || !(drop > EPS)) { skipped.nonPositive++; return; }

    var measured = drop / insulin;
    cases.push({
      dateKey: b.dateKey
      , mills: b.mills
      , bolusU: b.insulin
      , startBg: b.bgAtBolus
      , bg3h: bg3h
      , measuredIsf: measured
      , profileIsf: sens
      , d: sens / measured - 1
      , units: ctx.units
    });
  });
  return cases;
}

// Most frequent value; ties go to the earliest case.
function mode (values) {
  var counts = {};
  var best = null;
  var bestCount = 0;
  values.forEach(function count (v) {
    counts[v] = (counts[v] || 0) + 1;
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

module.exports = {
  computeMealCases: computeMealCases
  , summarizeMealSlot: summarizeMealSlot
  , computeCorrectionCases: computeCorrectionCases
  , summarizeCorrections: summarizeCorrections
};
