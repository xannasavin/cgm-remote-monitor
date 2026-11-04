'use strict';

var statistics = require('../../statistics');
var rules = require('./recommendation_rules');
var bolusClassifier = require('./bolus_classifier');
var basalRec = require('./basal_recommendations');
var factorRec = require('./factor_recommendations');
var glucoseUnits = require('./glucose_units');
var u = require('./recommendation_utils');

var MIN_MS = u.MIN_MS;
var HOUR_MS = u.HOUR_MS;
var EPS = u.EPS;
// Readings further apart than this break a high run (as GAP_THRESHOLD_MS in lib/statistics.js).
var HIGH_RUN_GAP_MIN = 15;
var MAX_REASONS = 4;

// Marks a translation key. The engine returns keys and args; the renderer
// translates them. The translations guard in tests/pump_analysis.test.js
// collects the string literals passed to textKey.
function textKey (key) {
  return key;
}

var PROFILE_SWITCH_KEY = textKey('Profile switch in this period: suggestions refer to the latest profile and may be less accurate');

function reason (key, args) {
  return { key: key, args: (args || []).map(String) };
}

var isMmol = glucoseUnits.isMmol;

function pad2 (n) {
  return String(n).padStart(2, '0');
}

function hourLabel (h) {
  return pad2(h) + ':00';
}

// '+0.30', '-0.14', '0.00'
function signed (x, digits) {
  var s = x.toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return x > 0 ? '+' + s : s;
}

function pct (x) {
  return signed(Math.round(x * 100), 0);
}

// Finite numeric values of a field; nonPositive cases carry null there and
// are left out of the shown medians.
function finiteValues (list, field) {
  return list.map(function get (c) { return c[field]; }).filter(function finite (v) {
    return typeof v === 'number' && isFinite(v);
  });
}

function fixedOrDash (x, digits) {
  return typeof x === 'number' && isFinite(x) ? x.toFixed(digits) : '-';
}

function mean (values) {
  if (!values.length) return null;
  return values.reduce(function sum (a, b) { return a + b; }, 0) / values.length;
}

/**
 * Confidence level (spec 5.4, 5.5). < MIN_CASES cases: insufficient;
 * >= STRONG_COUNTER_DAYS counter-signal days: warning; 1-2 days lower the
 * level by one (high -> medium -> low, low stays low).
 *
 * @param {{caseCount: number, sameDirShare: (number|null), counterDays: number}} p
 * @returns {string} 'high' | 'medium' | 'low' | 'insufficient' | 'warning'
 */
function rateConfidence (p) {
  var n = p && typeof p.caseCount === 'number' ? p.caseCount : 0;
  var share = p && typeof p.sameDirShare === 'number' ? p.sameDirShare : 0;
  var counter = p && typeof p.counterDays === 'number' ? p.counterDays : 0;
  if (n < rules.MIN_CASES) return 'insufficient';
  if (counter >= rules.STRONG_COUNTER_DAYS) return 'warning';
  var level;
  if (n >= rules.HIGH_CASES && share >= rules.HIGH_SHARE - EPS) level = 'high';
  else if (share >= rules.MEDIUM_SHARE - EPS) level = 'medium';
  else level = 'low';
  if (counter > 0) level = level === 'high' ? 'medium' : 'low';
  return level;
}

/**
 * Runs of consecutive readings above thresholdMgdl lasting at least
 * minDurationMin. The duration of a run is first to last reading plus one
 * 5-min sample interval (each reading stands for its sample), so 3 readings
 * make 15 min, consistent with the hypo episodes of lib/statistics.js
 * (>= 3 readings). start/end are the first and last reading. A gap over
 * 15 min ends a run.
 *
 * @param {Array<{mills: number, sgv: number}>} readings - mg/dl, ascending
 * @returns {Array<{start: number, end: number}>}
 */
function findHighEpisodes (readings, thresholdMgdl, minDurationMin) {
  var list = Array.isArray(readings) ? readings : [];
  var out = [];
  var run = null;
  var minMs = minDurationMin * MIN_MS;
  var gapMs = HIGH_RUN_GAP_MIN * MIN_MS;
  var sampleMs = u.SLOT_MIN * MIN_MS;
  function close () {
    if (run && run.end - run.start + sampleMs >= minMs - EPS) out.push({ start: run.start, end: run.end });
    run = null;
  }
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (!r || typeof r.sgv !== 'number') continue;
    if (r.sgv > thresholdMgdl) {
      if (run && r.mills - run.end > gapMs) close();
      if (!run) run = { start: r.mills, end: r.mills };
      else run.end = r.mills;
    } else {
      close();
    }
  }
  close();
  return out;
}

// Readings per day converted to mg/dl (copies; the input stays untouched).
function readingsToMgdl (readingsByDay, units) {
  var out = {};
  Object.keys(readingsByDay || {}).forEach(function eachDay (k) {
    var list = readingsByDay[k];
    if (!Array.isArray(list)) return;
    out[k] = list.filter(function valid (r) {
      return r && typeof r.mills === 'number' && typeof r.sgv === 'number' && isFinite(r.sgv);
    }).map(function convert (r) {
      var c = { mills: r.mills, sgv: glucoseUnits.toMgdl(r.sgv, units) };
      if (typeof r.localHour === 'number') c.localHour = r.localHour;
      return c;
    });
  });
  return out;
}

// Hypo episodes (start/end) below the fixed counter-signal limit
// HYPO_COUNTER_MGDL, not below the report's lower target: a lower target of
// e.g. 80 would count 15 min at 78 as a hypo. Uses the episode detection of
// lib/statistics.js (>= 3 readings) on the mg/dl readings.
function hypoEpisodes (byDayMgdl) {
  var eps = [];
  Object.keys(byDayMgdl).forEach(function eachDay (k) {
    var day = statistics.computeDayStats(byDayMgdl[k], [], { targetLow: rules.HYPO_COUNTER_MGDL, targetHigh: rules.HYPER_COUNTER_MGDL });
    day.hypo_episodes.forEach(function eachEp (e) { eps.push({ start: e.start, end: e.end }); });
  });
  return eps;
}

// Distinct days whose window [start, end) overlaps an episode.
function daysWithEpisode (windows, episodes) {
  var days = {};
  windows.forEach(function eachWindow (w) {
    if (days[w.dateKey]) return;
    for (var i = 0; i < episodes.length; i++) {
      if (episodes[i].start < w.end && episodes[i].end >= w.start) { days[w.dateKey] = true; return; }
    }
  });
  return Object.keys(days).length;
}

function distinctDays (list) {
  var seen = {};
  list.forEach(function each (x) { seen[x.dateKey] = true; });
  return Object.keys(seen).length;
}

// Engine context: converted readings, classification, cases.
function buildContext (input) {
  var units = input.units || 'mg/dl';
  var treatments = Array.isArray(input.treatments) ? input.treatments : [];
  var byDayMgdl = readingsToMgdl(input.readingsByDay, units);
  var dayKeys = Array.isArray(input.dayKeys) ? input.dayKeys.slice() : Object.keys(byDayMgdl).sort();
  var pumpDayKeys = Array.isArray(input.pumpDayKeys) ? input.pumpDayKeys : [];
  var hasPump = pumpDayKeys.length > 0 && (input.basalSource === undefined || input.basalSource === 'pump');
  var readings = u.allReadings(byDayMgdl);
  var classified = bolusClassifier.classifyUserBoluses(treatments, readings);
  var caseInput = {
    treatments: treatments
    , readingsByDay: byDayMgdl
    , pumpDayKeys: hasPump ? pumpDayKeys : []
    , profile: input.profile || {}
    , profileStore: input.profileStore || null
    , classified: classified
  };
  var offsets = u.offsetsByDay(treatments);
  var fallbackOffset = typeof input.utcOffsetMin === 'number' ? input.utcOffsetMin : 0;
  var targetHighMgdl = typeof input.targetHigh === 'number' ? glucoseUnits.toMgdl(input.targetHigh, units) : 180;
  // The treatments also cover days outside the report (the cases need them,
  // e.g. a late bolus disturbing the next morning); counts shown in reasons
  // and the basis only use boluses on report days.
  var reportDay = {};
  dayKeys.forEach(function mark (dk) { reportDay[dk] = true; });
  var onReportDays = classified.filter(function inReport (b) { return reportDay[b.dateKey] === true; });

  return {
    units: units
    , treatments: treatments
    , byDayMgdl: byDayMgdl
    , dayKeys: dayKeys
    , pumpDayKeys: pumpDayKeys
    , hasPump: hasPump
    , readings: readings
    , classified: classified
    , classifiedOnReportDays: onReportDays
    , caseInput: caseInput
    , profileStore: input.profileStore || null
    , targetHighMgdl: targetHighMgdl
    , dayStart: function dayStart (dk) {
      var off = Object.prototype.hasOwnProperty.call(offsets, dk) ? offsets[dk] : fallbackOffset;
      return u.dateKeyToLocalMs(dk) - off * MIN_MS;
    }
    , hypo: hypoEpisodes(byDayMgdl)
    , hyper: findHighEpisodes(readings, rules.HYPER_COUNTER_MGDL, rules.COUNTER_MIN_DURATION_MIN)
    , unclear: onReportDays.filter(function isUnclear (b) { return b.cls === 'unclear'; }).length
    , dawn: onReportDays.filter(function isDawn (b) { return b.cls === 'dawn'; })
  };
}

// BG value for display in the report unit.
function fmtBg (ctx, mgdl) {
  return isMmol(ctx.units) ? glucoseUnits.fromMgdl(mgdl, ctx.units).toFixed(1) : Math.round(mgdl).toFixed(0);
}

function isfDigits (units) {
  return isMmol(units) ? 1 : 0;
}

// Keep priority of a reason when capReasons has to drop some (higher stays).
// Pinned reasons (dawn note, one-hour extension hint) are never dropped.
var KEEP_TAIL = 0;        // extra context: corrections, mixed profile, fast rise
var KEEP_NO_COUNTER = 1;  // "no hypo / no values above" status line
var KEEP_LEAD = 2;        // the reasons explaining the direction
var KEEP_COUNTER = 3;     // a counter-signal that was actually found

function withKeep (r, keep) {
  r.keep = keep;
  return r;
}

function pinned (r) {
  r.pinned = true;
  return r;
}

// Counter-signal reasons (status line, always shown for up/down).
function counterReason (ctx, dir, counterDays, totalDays) {
  var keep = counterDays > 0 ? KEEP_COUNTER : KEEP_NO_COUNTER;
  if (dir === 'up') {
    return withKeep(counterDays > 0
      ? reason(textKey('Hypo on %1/%2 days'), [counterDays, totalDays])
      : reason(textKey('No hypo in this period')), keep);
  }
  var limit = fmtBg(ctx, rules.HYPER_COUNTER_MGDL);
  return withKeep(counterDays > 0
    ? reason(textKey('Values above %1 on %2/%3 days'), [limit, counterDays, totalDays])
    : reason(textKey('No values above %1 in this period'), [limit]), keep);
}

function warningReason (ctx, kind, dir, counterDays, totalDays) {
  var limit = fmtBg(ctx, rules.HYPER_COUNTER_MGDL);
  var r;
  if (kind === 'basal') {
    r = dir === 'up'
      ? reason(textKey('Pump often raises basal here, but hypo on %1/%2 days, clarify the cause first'), [counterDays, totalDays])
      : reason(textKey('Pump often lowers basal here, but values above %1 on %2/%3 days, clarify the cause first'), [limit, counterDays, totalDays]);
  } else {
    r = dir === 'up'
      ? reason(textKey('More insulin would fit here, but hypo on %1/%2 days, clarify the cause first'), [counterDays, totalDays])
      : reason(textKey('Less insulin would fit here, but values above %1 on %2/%3 days, clarify the cause first'), [limit, counterDays, totalDays]);
  }
  return withKeep(r, KEEP_COUNTER);
}

// At most MAX_REASONS reasons in their original order. While too many, the
// non-pinned reason with the lowest keep priority is dropped (the last one
// on a tie). Lead reasons default to KEEP_LEAD, tail reasons to KEEP_TAIL.
function capReasons (list) {
  var out = list.slice();
  while (out.length > MAX_REASONS) {
    var drop = -1;
    for (var i = 0; i < out.length; i++) {
      if (out[i].pinned) continue;
      if (drop === -1 || out[i].keep <= out[drop].keep) drop = i;
    }
    if (drop === -1) break;
    out.splice(drop, 1);
  }
  return out.map(function strip (r) { return { key: r.key, args: r.args }; });
}

function keepDefault (list, keep) {
  return list.map(function setKeep (r) {
    return typeof r.keep === 'number' ? r : withKeep(r, keep);
  });
}

// Why the card has its confidence level: the share of cases pointing in the
// card's direction against the thresholds of rateConfidence, plus the one
// level downgrade by a weak counter-signal. Null for insufficient and warning
// cards and when no share is known.
function confidenceNote (card, confidence, counterDays) {
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') return null;
  if (typeof card.sameDirShare !== 'number' || !isFinite(card.sameDirShare)) return null;
  var args = [
    Math.round(card.sameDirShare * 100)
    , Math.round(rules.MEDIUM_SHARE * 100)
    , Math.round(rules.HIGH_SHARE * 100)
    , rules.HIGH_CASES
  ];
  if (counterDays > 0) {
    return reason(textKey('Confidence: %1 % of the cases point in this direction (medium from %2 %, high from %3 % with at least %4 cases), counter-signal on %5 days lowers it by one level'), args.concat([counterDays]));
  }
  return reason(textKey('Confidence: %1 % of the cases point in this direction (medium from %2 %, high from %3 % with at least %4 cases)'), args);
}

/**
 * Apply confidence and counter-signals to a card. dir is 'up'/'down' for a
 * change, otherwise null (no counter-signal check).
 */
function finishCard (ctx, card, dir, windows, totalDays, leadReasons, tailReasons) {
  var counterDays = 0;
  var reasons = keepDefault(leadReasons, KEEP_LEAD);
  if (dir) {
    counterDays = daysWithEpisode(windows, dir === 'up' ? ctx.hypo : ctx.hyper);
  }
  var confidence = rateConfidence({ caseCount: card.caseCount, sameDirShare: card.sameDirShare, counterDays: counterDays });
  if (dir && card.state !== 'insufficient') {
    if (confidence === 'warning') {
      card.direction = card.state;
      card.state = 'warning';
      card.rows.forEach(function noChange (r) { r.newValue = null; delete r.unchanged; });
      reasons.unshift(warningReason(ctx, card.kind, dir, counterDays, totalDays));
    } else {
      reasons.push(counterReason(ctx, dir, counterDays, totalDays));
    }
  }
  if (card.state === 'insufficient') {
    confidence = 'insufficient';
    card.sameDirShare = null;
  }
  card.confidence = confidence;
  card.counterDays = counterDays;
  card.confidenceNote = confidenceNote(card, confidence, counterDays);
  card.reasons = capReasons(reasons.concat(keepDefault(tailReasons || [], KEEP_TAIL)));
  card.allUnchanged = (card.state === 'up' || card.state === 'down') && card.rows.length > 0
    && card.rows.every(function same (r) { return r.unchanged === true; });
  return card;
}

/* ---------- Basal ---------- */

function blockHours (block) {
  var length = block.endHour === 24 ? 24 : ((block.endHour - block.startHour + 24) % 24 || 24);
  var hours = [];
  for (var i = 0; i < length; i++) hours.push((block.startHour + i) % 24);
  return hours;
}

function blockLabel (block) {
  return hourLabel(block.startHour) + '-' + (block.endHour === 0 ? '24:00' : hourLabel(block.endHour));
}

function basalWindows (ctx, block) {
  var length = blockHours(block).length;
  return ctx.dayKeys.map(function windowOf (dk) {
    var start = ctx.dayStart(dk) + block.startHour * HOUR_MS;
    return { dateKey: dk, start: start, end: start + length * HOUR_MS };
  });
}

// Pump action in the block: per case delivered + auto - scheduled (U/h).
// Raise or lower wording follows the sign of the median pump delta (not the
// block state, which also includes BG drift). Null when the median delta
// rounds to 0 or no day moved in that direction.
// %2 is the number of days with a clean fasting window in the block: pump
// action is only measured there. The counter-signal reasons ("Hypo on
// %1/%2 days") use all report days instead, because a hypo in the block
// counts on every day, also on days whose fasting windows were disturbed.
function pumpReason (cases) {
  var byDay = {};
  var deltas = [];
  var rels = [];
  cases.forEach(function eachCase (c) {
    var rel = (c.deliveredU + c.autoU) / c.scheduledU - 1;
    deltas.push(c.deliveredU + c.autoU - c.scheduledU);
    rels.push(rel);
    (byDay[c.dateKey] = byDay[c.dateKey] || []).push(rel);
  });
  if (!deltas.length) return null;
  var delta = Number(u.median(deltas).toFixed(2));
  if (delta === 0) return null;
  var pumpDir = delta > 0 ? 'up' : 'down';
  var days = Object.keys(byDay);
  var hit = days.filter(function moved (dk) { return u.direction(u.median(byDay[dk])) === pumpDir; }).length;
  if (hit === 0) return null;
  var key = pumpDir === 'up'
    ? textKey('On %1/%2 days Control-IQ raised basal in this period, avg %3 U/h (%4 %)')
    : textKey('On %1/%2 days Control-IQ lowered basal in this period, avg %3 U/h (%4 %)');
  return reason(key, [hit, days.length, signed(u.median(deltas), 2), pct(u.median(rels))]);
}

// Median BG drift per hour of the block's fasting windows in the report unit,
// signed. Null when it rounds to 0 for display.
function driftReason (ctx, cases) {
  var drifts = cases.map(function drift (c) { return c.drift; }).filter(function num (v) {
    return typeof v === 'number' && isFinite(v);
  });
  if (!drifts.length) return null;
  var med = u.median(drifts);
  var text = fmtBg(ctx, Math.abs(med));
  if (Number(text) === 0) return null;
  var unit = isMmol(ctx.units) ? 'mmol/L' : 'mg/dl';
  return reason(textKey('BG in fasting windows changes by %1 per hour (median)'), [(med > 0 ? '+' : '-') + text + ' ' + unit]);
}

function correctionReason (ctx, hours) {
  var byDay = {};
  ctx.classifiedOnReportDays.forEach(function eachBolus (b) {
    if (b.cls === 'correction' && hours.indexOf(b.localHour) !== -1) byDay[b.dateKey] = (byDay[b.dateKey] || 0) + b.insulin;
  });
  var totals = Object.keys(byDay).map(function total (k) { return byDay[k]; });
  if (!totals.length) return null;
  return reason(textKey('On %1/%2 days correction in this period, avg %3 U'), [totals.length, ctx.dayKeys.length, u.median(totals).toFixed(1)]);
}

function dawnReason (ctx, hours) {
  if (!ctx.dawn.length) return null;
  var inMorning = hours.some(function morning (h) { return h >= rules.DAWN_WINDOW.startHour && h < rules.DAWN_WINDOW.endHour; });
  if (!inMorning) return null;
  var units = ctx.dawn.map(function ins (b) { return b.insulin; });
  return reason(textKey('Dawn bolus on %1/%2 days taken into account as a range, avg %3 U'), [distinctDays(ctx.dawn), ctx.dayKeys.length, mean(units).toFixed(1)]);
}

function basalRows (block) {
  return block.rows.map(function toRow (r) {
    var row = {
      from: r.from
      , to: r.to === '00:00' ? '24:00' : r.to
      , oldValue: r.oldRate.toFixed(2)
      , newValue: r.newRate === null || r.newRate === undefined ? null : r.newRate.toFixed(2)
      , unit: 'U/h'
    };
    if (r.unchanged) row.unchanged = true;
    return row;
  });
}

function basalCards (ctx) {
  if (!ctx.hasPump) {
    return {
      cases: []
      , cards: [{
        kind: 'basal'
        , state: 'insufficient'
        , confidence: 'insufficient'
        , timeLabel: '00:00-24:00'
        , startHour: 0
        , caseCount: 0
        , sameDirShare: null
        , counterDays: 0
        , allUnchanged: false
        , rows: []
        , reasons: [reason(textKey('No pump basal data, basal recommendations are not available'))]
        , basisLine: reason(textKey('Data: %1 days, no pump basal data'), [ctx.dayKeys.length])
      }]
    };
  }
  var cases = basalRec.computeBasalCases(ctx.caseInput);
  var blocks = basalRec.buildBasalBlocks(cases, ctx.profileStore);
  var cards = blocks.map(function toCard (block) {
    var hours = blockHours(block);
    var ownHours = hours.filter(function own (h) { return h !== block.extendedFrom; });
    var blockCases = cases.filter(function inBlock (c) { return ownHours.indexOf(c.hour) !== -1; });
    var card = {
      kind: 'basal'
      , state: block.state
      , timeLabel: blockLabel(block)
      , startHour: block.startHour
      , caseCount: block.caseCount
      , sameDirShare: block.sameDirShare
      , rows: basalRows(block)
      , basisLine: reason(textKey('Data: %1 pump days, %2 clean fasting windows; %3 unclear boluses not evaluated')
        , [ctx.pumpDayKeys.length, distinctDays(blockCases), ctx.unclear])
    };
    var lead = [];
    var tail = [];
    var dir = null;
    if (block.state === 'up' || block.state === 'down') {
      dir = block.state;
      var pump = pumpReason(blockCases);
      if (pump) lead.push(pump);
      var drift = driftReason(ctx, blockCases);
      if (drift) lead.push(drift);
    } else if (block.state === 'ok') {
      lead.push(reason(textKey('Delivered basal deviates from the profile by only %1 % (median)'), [pct(block.medianD || 0)]));
    } else {
      lead.push(reason(textKey('Only %1 clean fasting windows per hour, at least %2 needed'), [block.caseCount, rules.MIN_CASES]));
    }
    // Spec 5.1: the dawn note is on every basal card in the morning window.
    var dawn = dawnReason(ctx, hours);
    if (dawn) (dir ? tail : lead).push(pinned(dawn));
    if (block.state === 'ok') {
      var hypoDays = daysWithEpisode(basalWindows(ctx, block), ctx.hypo);
      lead.push(counterReason(ctx, 'up', hypoDays, ctx.dayKeys.length));
    }
    if (dir) {
      var corr = correctionReason(ctx, hours);
      if (corr) tail.push(corr);
      if (block.extendedFrom !== null) {
        tail.push(pinned(reason(textKey('Suggestion starts 1 h earlier because insulin acts with a delay'))));
      }
    }
    return finishCard(ctx, card, dir, basalWindows(ctx, block), ctx.dayKeys.length, lead, tail);
  });
  return { cases: cases, cards: cards };
}

/* ---------- Carb ratio and timing ---------- */

function windowsAfter (cases, hours) {
  return cases.map(function windowOf (c) {
    return { dateKey: c.dateKey, start: c.mills, end: c.mills + hours * HOUR_MS };
  });
}

// Counter-signal candidates (R21): every meal bolus of the slot or every
// correction, including the ones dropped from the measurement (other meal,
// disturbed, coverage), so meals that ended in a treated hypo still count.
function counterCandidates (caseList, usable, keep) {
  var all = caseList && Array.isArray(caseList.windows) ? caseList.windows : usable;
  return all.filter(keep || function any () { return true; });
}

function mixedReason (mixed) {
  return mixed ? reason(textKey('Cases saw different profile values, the most frequent one is shown')) : null;
}

function mealCards (ctx, mealCases) {
  return rules.MEAL_SLOTS.map(function toCard (slot) {
    var s = factorRec.summarizeMealSlot(mealCases, slot.key);
    var cases = mealCases.filter(function inSlot (c) { return c.slot === slot.key && typeof c.d === 'number' && isFinite(c.d); });
    var mealsInSlot = ctx.classified.filter(function inSlot (b) {
      return b.cls === 'meal' && b.localHour >= slot.startHour && b.localHour < slot.endHour;
    }).length;
    var from = hourLabel(slot.startHour);
    var to = hourLabel(slot.endHour);
    var rows = [];
    if (typeof s.oldRatio === 'number') {
      var row = {
        from: from
        , to: to
        , oldValue: s.oldRatio.toFixed(1)
        , newValue: typeof s.newRatio === 'number' && s.state !== 'timing' ? s.newRatio.toFixed(1) : null
        , unit: 'g/U'
      };
      if (s.unchanged) row.unchanged = true;
      rows.push(row);
    }
    var card = {
      kind: s.state === 'timing' ? 'timing' : 'carbratio'
      , state: s.state
      , slot: slot.key
      , timeLabel: from + '-' + to
      , startHour: slot.startHour
      , caseCount: s.caseCount
      , sameDirShare: s.state === 'timing' ? s.latePattern.share : s.sameDirShare
      , rows: rows
      , basisLine: reason(textKey('Data: %1 meals with carb entry, %2 usable; %3 unclear boluses not evaluated')
        , [mealsInSlot, cases.length, ctx.unclear])
    };
    var lead = [];
    var tail = [];
    var dir = null;
    var peaks = cases.map(function peak (c) { return c.peakBg; }).filter(function num (v) { return typeof v === 'number'; });
    if (s.state === 'insufficient') {
      lead.push(reason(textKey('Only %1 usable meals with carb entry, at least %2 needed'), [s.caseCount, rules.MIN_CASES]));
    } else if (s.state === 'timing') {
      var peakMins = cases.map(function pm (c) { return c.peakMin; }).filter(function num (v) { return typeof v === 'number'; });
      lead.push(reason(textKey('Peak median %1 min after bolus, below the start value after 4 h in %2/%3 meals')
        , [Math.round(u.median(peakMins) || 0), s.latePattern.count, s.caseCount]));
      lead.push(reason(textKey('Pattern fits a late bolus, not too little insulin')));
    } else {
      if (s.state === 'up' || s.state === 'down') dir = s.state;
      var above = cases.filter(function high (c) { return typeof c.bg2h === 'number' && c.bg2h > ctx.targetHighMgdl; }).length;
      lead.push(reason(textKey('After %1/%2 meals BG after 2 h above %3 (median peak %4)')
        , [above, cases.length, fmtBg(ctx, ctx.targetHighMgdl), peaks.length ? fmtBg(ctx, u.median(peaks)) : '-']));
      lead.push(reason(textKey('Median effective ratio %1 g/U (profile %2 g/U)')
        , [fixedOrDash(u.median(finiteValues(cases, 'effectiveRatio')), 1), s.oldRatio.toFixed(1)]));
    }
    var mixed = mixedReason(s.mixedProfile);
    if (mixed) tail.push(mixed);
    var candidates = counterCandidates(mealCases, cases, function inSlot (w) { return w.slot === slot.key; });
    return finishCard(ctx, card, dir, windowsAfter(candidates, rules.MEAL_WINDOW_H), distinctDays(candidates), lead, tail);
  });
}

/* ---------- ISF ---------- */

// Display rounding of ISF in the profile unit (0.1 mmol/L/U, 1 mg/dl/U).
function isfText (value, units) {
  return value.toFixed(isfDigits(units));
}

function isfCard (ctx, corrCases) {
  var s = factorRec.summarizeCorrections(corrCases);
  var units = s.units || (ctx.profileStore && ctx.profileStore.units) || 'mg/dl';
  var cases = corrCases.filter(function valid (c) { return typeof c.d === 'number' && isFinite(c.d); });
  var corrections = ctx.classified.filter(function isCorr (b) { return b.cls === 'correction'; }).length;
  var rows = [];
  if (typeof s.oldIsf === 'number') {
    var oldText = isfText(s.oldIsf, units);
    var newText = null;
    var unchanged = !!s.unchanged;
    if ((s.state === 'up' || s.state === 'down' || s.state === 'ok') && typeof s.newIsf === 'number') {
      newText = isfText(s.newIsf, units);
      if (newText === oldText && s.state !== 'ok') unchanged = true;
    }
    var row = { from: '00:00', to: '24:00', oldValue: oldText, newValue: newText, unit: isMmol(units) ? 'mmol/L/U' : 'mg/dl/U' };
    if (unchanged) { row.unchanged = true; row.newValue = oldText; }
    rows.push(row);
  }
  var card = {
    kind: 'isf'
    , state: s.state
    , timeLabel: '00:00-24:00'
    , startHour: 0
    , caseCount: s.caseCount
    , sameDirShare: s.sameDirShare
    , rows: rows
    , basisLine: reason(textKey('Data: %1 corrections, %2 clean; %3 unclear boluses not evaluated')
      , [corrections, cases.length, ctx.unclear])
  };
  var lead = [];
  var tail = [];
  var dir = null;
  if (s.state === 'insufficient') {
    lead.push(reason(textKey('Only %1 clean corrections (BG above %2, no food 3 h before and after), at least %3 needed')
      , [s.caseCount, fmtBg(ctx, rules.CORRECTION_BG_MGDL), rules.MIN_CASES]));
  } else {
    if (s.state === 'up' || s.state === 'down') dir = s.state;
    var measured = u.median(finiteValues(cases, 'measuredIsf'));
    lead.push(reason(textKey('Median measured drop %1 per U (profile %2)')
      , [measured === null ? '-' : isfText(glucoseUnits.fromMgdl(measured, units), units), isfText(s.oldIsf, units)]));
  }
  var fastRise = corrCases.skipped ? corrCases.skipped.fastRise : 0;
  if (fastRise > 0) tail.push(reason(textKey('%1 corrections for a fast rise not measured'), [fastRise]));
  var mixed = mixedReason(s.mixedProfile);
  if (mixed) tail.push(mixed);
  var candidates = counterCandidates(corrCases, cases);
  return finishCard(ctx, card, dir, windowsAfter(candidates, rules.CORRECTION_WINDOW_H), distinctDays(candidates), lead, tail);
}

/* ---------- Assembly ---------- */

function groupOf (state) {
  if (state === 'ok') return 1;
  if (state === 'insufficient') return 2;
  return 0;
}

function sortCards (cards) {
  return cards.map(function withIndex (c, i) { return { c: c, i: i }; }).sort(function order (a, b) {
    return (groupOf(a.c.state) - groupOf(b.c.state)) || (a.c.startHour - b.c.startHour) || (a.i - b.i);
  }).map(function unwrap (x) { return x.c; });
}

/**
 * Everything the pump analysis page needs beyond the AI-bound statistics:
 * recommendations, readings in mg/dl and the meal cases (meal curves).
 * Readings in mmol are converted to mg/dl at the entry; all thresholds are
 * mg/dl.
 *
 * @param {object} input - { treatments, readingsByDay, units, dayKeys, pumpDayKeys,
 *   basalSource, profile, profileStore, dayStats, targetLow, targetHigh,
 *   utcOffsetMin, profileSwitch }
 * @returns {{recommendations: object, readingsByDayMgdl: object, mealCases: Array}}
 */
function computePumpExtras (input) {
  var ctx = buildContext(input || {});
  var basal = basalCards(ctx);
  var mealCases = factorRec.computeMealCases(ctx.caseInput);
  var corrCases = factorRec.computeCorrectionCases(ctx.caseInput);
  var cards = basal.cards.concat(mealCards(ctx, mealCases), [isfCard(ctx, corrCases)]);

  return {
    recommendations: {
      cards: sortCards(cards)
      , basis: {
        days: ctx.dayKeys.length
        , pumpDays: ctx.hasPump ? ctx.pumpDayKeys.length : 0
        , fastingWindows: basal.cases.length
        , mealsWithCarbs: ctx.classified.filter(function isMeal (b) { return b.cls === 'meal'; }).length
        , unclearBoluses: ctx.unclear
        , dawnBoluses: ctx.dawn.length
      }
      , profileSwitch: !!(input && input.profileSwitch)
    }
    , readingsByDayMgdl: ctx.byDayMgdl
    , mealCases: mealCases.slice()
  };
}

/**
 * Recommendation cards (spec 5.4-5.6): warnings and suggestions first (by
 * time), then 'ok', then 'insufficient'.
 *
 * @param {object} input - see computePumpExtras
 * @returns {{cards: Array<object>, basis: object, profileSwitch: boolean}}
 */
function buildRecommendations (input) {
  return computePumpExtras(input).recommendations;
}

module.exports = {
  rateConfidence: rateConfidence
  , findHighEpisodes: findHighEpisodes
  , buildRecommendations: buildRecommendations
  , computePumpExtras: computePumpExtras
  , PROFILE_SWITCH_KEY: PROFILE_SWITCH_KEY
};
