'use strict';

var statistics = require('../../statistics');
var recommendationEngine = require('./recommendation_engine');
var glucoseDistribution = require('./glucose_distribution');
var glucoseUnits = require('./glucose_units');

/**
 * Select the profile that was valid at the end of the report range.
 * Works on an unsorted list: the latest startDate not after the end of
 * lastDayKey wins; when every profile starts later, the earliest one is used.
 * Without lastDayKey the latest profile is used.
 *
 * @param {object[]} profiles - profile documents with a startDate
 * @param {string|null} lastDayKey - 'YYYY-MM-DD' of the last report day
 * @returns {object|null}
 */
function selectProfileForRange (profiles, lastDayKey) {
  if (!Array.isArray(profiles) || profiles.length === 0) return null;
  var limit = lastDayKey ? Date.parse(lastDayKey + 'T23:59:59.999Z') : Infinity;
  var best = null;
  var bestTime = -Infinity;
  var earliest = null;
  var earliestTime = Infinity;
  for (var i = 0; i < profiles.length; i++) {
    var p = profiles[i];
    if (!p) continue;
    var t = Date.parse(p.startDate);
    if (isNaN(t)) continue;
    if (t <= limit && t > bestTime) { best = p; bestTime = t; }
    if (t < earliestTime) { earliest = p; earliestTime = t; }
  }
  return best || earliest || null;
}

/**
 * Extract and format CGM data from Nightscout datastorage.
 * Returns compact JSON + client-computed statistics. Used by the Pump Analysis
 * report and (via buildSinglePayload in ai_eval) the AI evaluation.
 *
 * @param {object} datastorage - The Nightscout datastorage object from a report
 * @param {object} settings - Plugin settings
 * @param {object} options - Report options { targetLow, targetHigh, units }
 * @param {string[]} [dayKeys] - Optional 'YYYY-MM-DD' keys; when an array, only these days are processed
 * @returns {object} { cgmData, dayCount, dayStats, periodStats, pumpActionStats, episodeTiming, pumpExtras }
 *   pumpExtras = { recommendations, readingsByDayMgdl, mealCases } is page-only and never part of cgmData.
 */
function prepareCgmData (datastorage, settings, options, dayKeys) {
  var targetLow = (options && options.targetLow) || 70;
  var targetHigh = (options && options.targetHigh) || 180;
  var units = (options && options.units) || 'mg/dL';
  var pumpActionOptions = (options && options.pumpAction) || {};

  // Flat cross-period treatment array for the pump-action pipeline.
  // datastorage.treatments is the top-level unfiltered collection; the
  // per-day loop below reads the same events from each day bucket.
  var allTreatments = Array.isArray(datastorage.treatments) ? datastorage.treatments : [];

  // Remove metadata keys to isolate day entries
  var keysToDelete = [
    'devicestatus', 'combobolusTreatments', 'tempbasalTreatments'
    , 'profileSwitchTreatments', 'profiles', 'allstatsrecords'
    , 'alldays', 'treatments'
  ];

  var datastorageAltered = Object.assign({}, datastorage);
  for (var d = 0; d < keysToDelete.length; d++) {
    delete datastorageAltered[keysToDelete[d]];
  }

  // Browser-local utcOffset — used for SGV hour bucketing. Treatments use
  // their own per-event utcOffset via parseTreatmentLocal inside the stats
  // layer, so traveling users get correct treatment bucketing; SGV readings
  // lack per-reading offsets and inherit the browser's current zone.
  var utcOffset = typeof window !== 'undefined' ? -(new Date().getTimezoneOffset() / 60) : 0;
  var utcOffsetMs = utcOffset * 60 * 60 * 1000;

  // Extract day-by-day data in compact format.
  // entriesByDay is built here so computeEpisodesWithHours can consume it
  // at the period level without re-walking each day's SGVs.
  var days = [];
  var allDayStats = [];
  var dayKeyList = Object.keys(datastorageAltered);
  if (Array.isArray(dayKeys)) {
    // datastorage accumulates every day ever loaded; restrict to the report's days
    dayKeyList = dayKeys.filter(function (k) {
      return Object.prototype.hasOwnProperty.call(datastorageAltered, k);
    });
  }
  var entriesByDay = {};
  var dayTreatments = [];

  for (var dk = 0; dk < dayKeyList.length; dk++) {
    var key = dayKeyList[dk];
    var value = datastorageAltered[key];

    // F14: Skip non-object day entries (guard against null/primitive values)
    if (!value || typeof value !== 'object') continue;

    // Compact SGV: [[mills, sgv], ...]
    var sgv = [];
    var sgvRecords = [];
    var entriesForDay = [];
    if (Array.isArray(value.sgv) && value.sgv.length > 0) {
      for (var e = 0; e < value.sgv.length; e++) {
        if (value.sgv[e].mills && value.sgv[e].sgv != null) {
          var mills = value.sgv[e].mills;
          var sgvVal = value.sgv[e].sgv;
          sgv.push([mills, sgvVal]);
          sgvRecords.push({ mills: mills, sgv: sgvVal });
          // Shift into the browser's local frame to derive localHour.
          var localDate = new Date(mills + utcOffsetMs);
          entriesForDay.push({
            mills: mills
            , sgv: sgvVal
            , localHour: localDate.getUTCHours()
          });
        }
      }
    }
    if (entriesForDay.length > 0) entriesByDay[key] = entriesForDay;

    // Compact treatments: [[mills, carbs, insulin, notes], ...]
    // Notes are JSON-encoded strings (Finding #8: prompt injection mitigation)
    //
    // Payload-size fix: the LLM-bound `treatments` array is filtered to exclude
    // zero-value rows (no carbs, no insulin, no notes). These are typically
    // pump-tick / Temp Basal micro-entries that appear every 5 min and balloon
    // the payload by ~40KB per 6-day report. `treatmentObjs` (used for
    // statistics computation) keeps the full unfiltered list so pump-action
    // stats, coverage, and hotspots still see every event.
    var treatments = [];
    var treatmentObjs = [];
    if (Array.isArray(value.treatments) && value.treatments.length > 0) {
      for (var t = 0; t < value.treatments.length; t++) {
        var src = value.treatments[t];
        treatmentObjs.push(src);
        dayTreatments.push(src);
        var hasCarbs = typeof src.carbs === 'number' && src.carbs > 0;
        var hasInsulin = typeof src.insulin === 'number' && src.insulin > 0;
        var noteStr = src.notes != null ? String(src.notes) : '';
        var hasNote = noteStr.trim() !== '';
        if (!hasCarbs && !hasInsulin && !hasNote) continue;
        treatments.push([
          src.mills || 0
          , src.carbs || 0
          , src.insulin || 0
          , hasNote ? noteStr : null
        ]);
      }
    }

    // Compute client-side statistics for this day
    // F9: Pass UTC offset so time blocks use local time in the browser
    var statsOpts = { targetLow: targetLow, targetHigh: targetHigh, units: units, utcOffset: utcOffset };
    var dayStatResult = statistics.computeDayStats(sgvRecords, treatmentObjs, statsOpts);
    allDayStats.push(dayStatResult);

    days.push({
      date: key
      , sgv: sgv
      , treatments: treatments
      , stats: dayStatResult
    });
  }

  // Sort days by date
  days.sort(function (a, b) {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
  allDayStats = days.map(function (day) { return day.stats; });
  var sortedDayKeys = days.map(function (day) { return day.date; });

  // Profile valid at the end of the report range (datastorage.profiles is not
  // reliably ordered; reportclient may add a profile starting after the range).
  var rawProfile = selectProfileForRange(
    datastorage.profiles
    , sortedDayKeys.length > 0 ? sortedDayKeys[sortedDayKeys.length - 1] : null
  );
  var rawProfileStore = null;
  if (rawProfile && rawProfile.store && rawProfile.defaultProfile) {
    rawProfileStore = rawProfile.store[rawProfile.defaultProfile] || null;
  }

  // Period statistics
  var periodStats = statistics.computePeriodStats(allDayStats);

  // Pump-action pipeline (AI eval pattern-first redesign).
  // Runs on the flat cross-period treatment array so temp basals that span
  // midnight and auto-bolus classification over multi-day windows work
  // correctly. Thresholds come from pumpActionOptions (default locked values
  // when absent). Fail-soft: if the raw profile is missing the orchestrator
  // returns a shape with profile_valid=false and basal_source=profile_fallback.
  var pumpActionStats = statistics.computePumpActionStats(
    allTreatments
    , rawProfileStore
    , sortedDayKeys
    , pumpActionOptions
  );

  // Hourly hypo/hyper episode distribution (new episode-timing chart).
  // Uses entriesByDay (mills, sgv, localHour) built above.
  var episodeTiming = statistics.computeEpisodesWithHours(entriesByDay, targetLow, targetHigh);

  // Date range
  var dateFrom = days.length > 0 ? days[0].date : null;
  var dateTill = days.length > 0 ? days[days.length - 1].date : null;

  // Build compact JSON for LLM
  var cgmData = {
    days: days
    , period_stats: periodStats
    , pump_action_stats: pumpActionStats
    , episode_timing: episodeTiming
    , raw_profile: rawProfile
    , meta: {
      days: days.length
      , from: dateFrom
      , to: dateTill
      , units: units
      , target_low: targetLow
      , target_high: targetHigh
    }
  };

  // Page-only results (recommendations, mg/dl readings, meal cases). Kept
  // top-level and out of cgmData/periodStats/dayStats, which go to the AI.
  var pumpExtras = computeExtras({
    treatments: allTreatments.length > 0 ? allTreatments : dayTreatments
    , readingsByDay: entriesByDay
    , units: units
    , dayKeys: sortedDayKeys
    , pumpDayKeys: pumpActionStats.coverage ? pumpActionStats.coverage.pump_day_keys : []
    , basalSource: pumpActionStats.basal_source
    , profile: rawProfile
    , profileStore: rawProfileStore
    , dayStats: allDayStats
    , targetLow: targetLow
    , targetHigh: targetHigh
    , utcOffsetMin: utcOffset * 60
    , profileSwitch: !!pumpActionStats.profile_switch_detected
  });

  addDistributions(pumpExtras, units, targetLow, targetHigh, utcOffsetMs);

  return {
    cgmData: cgmData
    , dayCount: days.length
    , dayStats: allDayStats
    , periodStats: periodStats
    , pumpActionStats: pumpActionStats
    , episodeTiming: episodeTiming
    , pumpExtras: pumpExtras
  };
}

// Percentile bands (display units) and five daily ranges (mg/dl limits) for the
// charts. Page-only: written to pumpExtras, never to cgmData/periodStats.
function addDistributions (pumpExtras, units, targetLow, targetHigh, utcOffsetMs) {
  var byDay = pumpExtras.readingsByDayMgdl || {};
  try {
    pumpExtras.diurnalPercentiles = glucoseDistribution.hourlyPercentiles(byDay, utcOffsetMs, units);
    var lowMgdl = typeof targetLow === 'number' ? glucoseUnits.toMgdl(targetLow, units) : 70;
    var highMgdl = typeof targetHigh === 'number' ? glucoseUnits.toMgdl(targetHigh, units) : 180;
    pumpExtras.dailyRanges = glucoseDistribution.dailyRanges(byDay, lowMgdl, highMgdl);
  } catch (err) {
    if (typeof console !== 'undefined') console.error('pump_analysis distributions failed', err);
    pumpExtras.diurnalPercentiles = [];
    pumpExtras.dailyRanges = [];
  }
}

// Fail-soft: an engine error must not take down the rest of the page.
function computeExtras (input) {
  try {
    return recommendationEngine.computePumpExtras(input);
  } catch (err) {
    if (typeof console !== 'undefined') console.error('pump_analysis recommendations failed', err);
    return { recommendations: null, readingsByDayMgdl: {}, mealCases: [], error: String(err && err.message ? err.message : err) };
  }
}

module.exports = {
  prepareCgmData: prepareCgmData
  , selectProfileForRange: selectProfileForRange
};
