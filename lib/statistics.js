'use strict';

var ss = require('simple-statistics');

var GAP_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
var MIN_EPISODE_READINGS = 3; // >= 3 consecutive readings = >= 10 min at 5-min intervals
var EPISODE_MERGE_GAP_MS = 15 * 60 * 1000; // merge episodes < 15 min apart
var MIN_VALID_HOURS_FOR_MAGE = 18;
var MIN_QUALIFYING_EXCURSIONS = 4;
var SGV_MIN = 40;  // sensor valid range lower bound (mg/dL)
var SGV_MAX = 600; // sensor valid range upper bound (mg/dL)

/**
 * Compute statistics for a single day of CGM data.
 *
 * @param {Array} sgvRecords - Array of { mills: number, sgv: number }
 * @param {Array} treatments - Array of treatment objects (unused in v1, reserved)
 * @param {object} options - { targetLow: number, targetHigh: number, units: string }
 * @returns {object} Day statistics
 *
 * @example
 * var sgvs = [
 *   { mills: Date.UTC(2026, 2, 15,  0, 0, 0), sgv: 120 },
 *   { mills: Date.UTC(2026, 2, 15,  0, 5, 0), sgv: 125 },
 *   { mills: Date.UTC(2026, 2, 15,  0, 10, 0), sgv: 130 }
 * ];
 * var stats = computeDayStats(sgvs, [], { targetLow: 70, targetHigh: 180, units: 'mg/dl' });
 * // stats => { average: 125, tir_pct: 100, tbr_pct: 0, tar_pct: 0, total_readings: 3, ... }
 */
function computeDayStats (sgvRecords, treatments, options) {
  var targetLow = options.targetLow || 70;
  var targetHigh = options.targetHigh || 180;

  if (!sgvRecords || sgvRecords.length === 0) {
    return emptyStats();
  }

  // Sort by timestamp and filter out-of-range sensor values
  var sgvMin = (options && options.sgvMin) || SGV_MIN;
  var sgvMax = (options && options.sgvMax) || SGV_MAX;
  var sorted = sgvRecords.slice()
    .filter(function (r) { return r.sgv >= sgvMin && r.sgv <= sgvMax; })
    .sort(function (a, b) { return a.mills - b.mills; });

  if (sorted.length === 0) return emptyStats();

  var values = sorted.map(function (r) { return r.sgv; });
  var total = values.length;

  // Basic stats
  var average = ss.mean(values);
  var median = ss.median(values);
  var sd = ss.standard_deviation(values);
  var cv = average !== 0 ? (sd / average) * 100 : null;

  // TIR / TBR / TAR
  var below = 0;
  var inRange = 0;
  var above = 0;
  for (var i = 0; i < total; i++) {
    if (values[i] < targetLow) {
      below++;
    } else if (values[i] > targetHigh) {
      above++;
    } else {
      inRange++;
    }
  }
  var tbr_pct = (below / total) * 100;
  var tir_pct = (inRange / total) * 100;
  var tar_pct = (above / total) * 100;

  // Valid hours and data gaps
  var validMs = 0;
  var gapCount = 0;
  for (var g = 1; g < sorted.length; g++) {
    var delta = sorted[g].mills - sorted[g - 1].mills;
    if (delta <= GAP_THRESHOLD_MS) {
      validMs += delta;
    } else {
      gapCount++;
    }
  }
  var valid_hours = validMs / (1000 * 60 * 60);

  // Time blocks (hourly)
  var utcOffset = (options && typeof options.utcOffset === 'number') ? options.utcOffset : 0;
  var time_blocks = computeTimeBlocks(sorted, utcOffset);

  // Episode counting
  var hypo_episodes = countEpisodes(sorted, function (v) { return v < targetLow; }, 'nadir');
  var hyper_episodes = countEpisodes(sorted, function (v) { return v > targetHigh; }, 'peak');

  // MAGE
  var mage = computeMAGE(sorted, sd, valid_hours);

  // Treatment aggregates
  var treatmentStats = computeTreatmentStats(treatments);

  return {
    average: round2(average)
    , median: round2(median)
    , sd: round2(sd)
    , cv: cv !== null ? round2(cv) : null
    , mage: mage
    , tir_pct: round2(tir_pct)
    , tbr_pct: round2(tbr_pct)
    , tar_pct: round2(tar_pct)
    , hypo_episodes: hypo_episodes
    , hyper_episodes: hyper_episodes
    , time_blocks: time_blocks
    , total_readings: total
    , valid_hours: round2(valid_hours)
    , data_gaps: gapCount
    , total_carbs: treatmentStats.total_carbs
    , total_insulin: treatmentStats.total_insulin
    , bolus_count: treatmentStats.bolus_count
    , carb_entries: treatmentStats.carb_entries
    , user_bolus_count: treatmentStats.user_bolus_count
    , auto_bolus_count: treatmentStats.auto_bolus_count
    , user_bolus_insulin: treatmentStats.user_bolus_insulin
    , auto_bolus_insulin: treatmentStats.auto_bolus_insulin
  };
}

/**
 * MAGE algorithm per Service & Nelson (1980), adapted per
 * International Consensus on Use of CGM (2017).
 *
 * 1. Sort SGV readings by timestamp
 * 2. Exclude gaps > 15 min from derivative calculation
 * 3. Find turning points (sign changes in derivative)
 * 4. Compute excursion amplitudes between consecutive turning points
 * 5. Filter: keep excursions >= 1 SD
 * 6. MAGE = mean of qualifying amplitudes
 * 7. Return null if < 4 qualifying or < 18h valid data
 */
function computeMAGE (sorted, sd, validHours) {
  if (sorted.length < 3) return null;
  if (validHours < MIN_VALID_HOURS_FOR_MAGE) return null;
  if (sd === 0) return null;

  // Find turning points: local maxima and minima (F4: no synthetic endpoints)
  // Only consider consecutive readings without gaps
  var turningPoints = [];
  var prevDirection = 0; // 0 = unknown, 1 = rising, -1 = falling

  for (var i = 1; i < sorted.length; i++) {
    var gap = sorted[i].mills - sorted[i - 1].mills;
    if (gap > GAP_THRESHOLD_MS) {
      prevDirection = 0;
      continue;
    }

    var diff = sorted[i].sgv - sorted[i - 1].sgv;
    var direction = diff > 0 ? 1 : (diff < 0 ? -1 : 0);

    if (direction === 0) continue; // flat, skip

    if (prevDirection !== 0 && direction !== prevDirection) {
      // Direction changed: previous point is a turning point
      turningPoints.push({ mills: sorted[i - 1].mills, sgv: sorted[i - 1].sgv });
    }

    prevDirection = direction;
  }

  // Compute excursion amplitudes between consecutive turning points
  var amplitudes = [];
  for (var t = 1; t < turningPoints.length; t++) {
    var amp = Math.abs(turningPoints[t].sgv - turningPoints[t - 1].sgv);
    if (amp > 0) {
      amplitudes.push(amp);
    }
  }

  // Filter: keep only excursions >= 1 SD
  var qualifying = amplitudes.filter(function (a) { return a >= sd; });

  if (qualifying.length < MIN_QUALIFYING_EXCURSIONS) return null;

  return round2(ss.mean(qualifying));
}

/**
 * Count hypo or hyper episodes.
 * Episode = >= MIN_EPISODE_READINGS consecutive readings matching predicate.
 * Merge episodes separated by < EPISODE_MERGE_GAP_MS.
 */
function countEpisodes (sorted, predicate, extremeKey) {
  var episodes = [];
  var currentEpisode = null;

  for (var i = 0; i < sorted.length; i++) {
    var inEpisode = predicate(sorted[i].sgv);

    if (inEpisode) {
      if (!currentEpisode) {
        currentEpisode = {
          start: sorted[i].mills
          , end: sorted[i].mills
          , readings: [sorted[i]]
        };
      } else if (i > 0 && sorted[i].mills - sorted[i - 1].mills > GAP_THRESHOLD_MS) {
        // F8: Data gap inside episode -- finalize current and start new
        if (currentEpisode.readings.length >= MIN_EPISODE_READINGS) {
          episodes.push(currentEpisode);
        }
        currentEpisode = {
          start: sorted[i].mills
          , end: sorted[i].mills
          , readings: [sorted[i]]
        };
      } else {
        currentEpisode.end = sorted[i].mills;
        currentEpisode.readings.push(sorted[i]);
      }
    } else {
      if (currentEpisode) {
        // Check if we should finalize or continue watching for merge
        if (currentEpisode.readings.length >= MIN_EPISODE_READINGS) {
          episodes.push(currentEpisode);
        }
        currentEpisode = null;
      }
    }
  }

  // Finalize last episode
  if (currentEpisode && currentEpisode.readings.length >= MIN_EPISODE_READINGS) {
    episodes.push(currentEpisode);
  }

  // Merge episodes separated by < EPISODE_MERGE_GAP_MS
  var merged = [];
  for (var m = 0; m < episodes.length; m++) {
    if (merged.length > 0) {
      var prev = merged[merged.length - 1];
      var gapMs = episodes[m].start - prev.end;
      if (gapMs < EPISODE_MERGE_GAP_MS) {
        // Merge: extend previous
        prev.end = episodes[m].end;
        prev.readings = prev.readings.concat(episodes[m].readings);
        continue;
      }
    }
    merged.push(episodes[m]);
  }

  // Format output
  return merged.map(function (ep) {
    var sgvValues = ep.readings.map(function (r) { return r.sgv; });
    var result = {
      start: ep.start
      , end: ep.end
      , duration_min: round2((ep.end - ep.start) / (1000 * 60))
    };
    if (extremeKey === 'nadir') {
      result.nadir = Math.min.apply(null, sgvValues);
    } else {
      result.peak = Math.max.apply(null, sgvValues);
    }
    return result;
  });
}

/**
 * Group readings into hourly blocks.
 */
function computeTimeBlocks (sorted, utcOffset) {
  utcOffset = utcOffset || 0;
  var blocks = {};

  for (var i = 0; i < sorted.length; i++) {
    var hour = (new Date(sorted[i].mills).getUTCHours() + utcOffset + 24) % 24;
    if (!blocks[hour]) {
      blocks[hour] = { values: [], hour: hour };
    }
    blocks[hour].values.push(sorted[i].sgv);
  }

  return Object.keys(blocks).map(function (h) {
    var b = blocks[h];
    return {
      hour: b.hour
      , avg: round2(ss.mean(b.values))
      , sd: round2(ss.standard_deviation(b.values))
      , min: Math.min.apply(null, b.values)
      , max: Math.max.apply(null, b.values)
      , count: b.values.length
    };
  }).sort(function (a, b) { return a.hour - b.hour; });
}

/**
 * Compute aggregate statistics over a period of day stats.
 *
 * @param {Array} dayStatsArray - Array of objects from computeDayStats
 * @returns {object} Period statistics
 *
 * @example
 * // Shape-of-output example — concrete numbers are illustrative, not guaranteed.
 * var day1 = computeDayStats(sgvsDay1, [], { targetLow: 70, targetHigh: 180 });
 * var day2 = computeDayStats(sgvsDay2, [], { targetLow: 70, targetHigh: 180 });
 * var period = computePeriodStats([day1, day2]);
 * // period => {
 * //   average: 142,          // mean of day averages (illustrative)
 * //   median: 138,           // illustrative
 * //   sd: 34.2,              // illustrative
 * //   cv: 24.1,              // illustrative
 * //   tir_pct: 68,           // illustrative
 * //   tbr_pct: 4,            // illustrative
 * //   tar_pct: 28,           // illustrative
 * //   episode_summary: { hypo_count, hyper_count, hypo_total_min, hyper_total_min },
 * //   diurnal_patterns: [...],
 * //   treatment_summary: { total_carbs, total_insulin, ... }
 * // }
 */
function computePeriodStats (dayStatsArray) {
  if (!dayStatsArray || dayStatsArray.length === 0) {
    return {
      average: null
      , median: null
      , sd: null
      , cv: null
      , mage_overall: null
      , tir_pct: null
      , tbr_pct: null
      , tar_pct: null
      , episode_summary: { hypo_count: 0, hyper_count: 0, hypo_total_min: 0, hyper_total_min: 0 }
      , diurnal_patterns: []
      , treatment_summary: {
        total_carbs: 0, total_insulin: 0
        , avg_daily_carbs: 0, avg_daily_insulin: 0, avg_daily_boluses: 0
        , avg_daily_user_boluses: 0, avg_daily_auto_boluses: 0
        , avg_daily_user_bolus_insulin: 0, avg_daily_auto_bolus_insulin: 0
      }
    };
  }

  // Filter out days with no data
  var validDays = dayStatsArray.filter(function (d) { return d.total_readings > 0; });
  if (validDays.length === 0) {
    return computePeriodStats([]);
  }

  // Weighted averages by valid_hours (time-weighted, not reading-count-weighted)
  var totalWeight = 0;
  var sumAvg = 0;
  var sumTir = 0;
  var sumTbr = 0;
  var sumTar = 0;
  var allAverages = [];
  var allMages = [];

  for (var i = 0; i < validDays.length; i++) {
    var d = validDays[i];
    var w = d.valid_hours > 0 ? d.valid_hours : d.total_readings * (5 / 60);
    totalWeight += w;
    sumAvg += d.average * w;
    sumTir += d.tir_pct * w;
    sumTbr += d.tbr_pct * w;
    sumTar += d.tar_pct * w;
    allAverages.push(d.average);
    if (d.mage !== null) {
      allMages.push(d.mage);
    }
  }

  var periodAvg = totalWeight > 0 ? sumAvg / totalWeight : 0;
  var periodMedian = ss.median(allAverages);

  // F20: Pooled SD across all readings (not between-day SD of averages)
  var totalN = 0;
  var pooledVarianceSum = 0;
  for (var pv = 0; pv < validDays.length; pv++) {
    var pvd = validDays[pv];
    var n = pvd.total_readings;
    if (n > 0 && pvd.sd !== null) {
      totalN += n;
      pooledVarianceSum += n * (pvd.sd * pvd.sd + Math.pow(pvd.average - periodAvg, 2));
    }
  }
  var periodSd = totalN > 0 ? Math.sqrt(pooledVarianceSum / totalN) : 0;
  // F28: Single-day period has insufficient data for meaningful CV
  var periodCv = (validDays.length > 1 && periodAvg !== 0) ? (periodSd / periodAvg) * 100 : null;

  // Episode summary
  var hypoCount = 0;
  var hyperCount = 0;
  var hypoTotalMin = 0;
  var hyperTotalMin = 0;
  for (var e = 0; e < validDays.length; e++) {
    hypoCount += validDays[e].hypo_episodes.length;
    hyperCount += validDays[e].hyper_episodes.length;
    for (var he = 0; he < validDays[e].hypo_episodes.length; he++) {
      hypoTotalMin += validDays[e].hypo_episodes[he].duration_min;
    }
    for (var hpe = 0; hpe < validDays[e].hyper_episodes.length; hpe++) {
      hyperTotalMin += validDays[e].hyper_episodes[hpe].duration_min;
    }
  }

  // Diurnal patterns: aggregate time blocks across days
  var diurnal = computeDiurnalPatterns(validDays);

  // Treatment summary across period
  var sumCarbs = 0;
  var sumInsulin = 0;
  var sumBoluses = 0;
  var sumUserBoluses = 0;
  var sumAutoBoluses = 0;
  var sumUserBolusInsulin = 0;
  var sumAutoBolusInsulin = 0;
  for (var ts = 0; ts < validDays.length; ts++) {
    sumCarbs += validDays[ts].total_carbs || 0;
    sumInsulin += validDays[ts].total_insulin || 0;
    sumBoluses += validDays[ts].bolus_count || 0;
    sumUserBoluses += validDays[ts].user_bolus_count || 0;
    sumAutoBoluses += validDays[ts].auto_bolus_count || 0;
    sumUserBolusInsulin += validDays[ts].user_bolus_insulin || 0;
    sumAutoBolusInsulin += validDays[ts].auto_bolus_insulin || 0;
  }

  return {
    average: round2(periodAvg)
    , median: round2(periodMedian)
    , sd: round2(periodSd)
    , cv: periodCv !== null ? round2(periodCv) : null
    , mage_overall: allMages.length > 0 ? round2(ss.mean(allMages)) : null
    , tir_pct: totalWeight > 0 ? round2(sumTir / totalWeight) : 0
    , tbr_pct: totalWeight > 0 ? round2(sumTbr / totalWeight) : 0
    , tar_pct: totalWeight > 0 ? round2(sumTar / totalWeight) : 0
    , episode_summary: {
      hypo_count: hypoCount
      , hyper_count: hyperCount
      , hypo_total_min: round2(hypoTotalMin)
      , hyper_total_min: round2(hyperTotalMin)
    }
    , diurnal_patterns: diurnal
    , treatment_summary: {
      total_carbs: round2(sumCarbs)
      , total_insulin: round2(sumInsulin)
      , avg_daily_carbs: round2(sumCarbs / validDays.length)
      , avg_daily_insulin: round2(sumInsulin / validDays.length)
      , avg_daily_boluses: round2(sumBoluses / validDays.length)
      // New: honest bolus split. Control-IQ automatic corrections are tracked
      // separately from user-initiated boluses so the numbers point at the
      // right therapy conversation. Total insulin still includes both.
      , avg_daily_user_boluses: round2(sumUserBoluses / validDays.length)
      , avg_daily_auto_boluses: round2(sumAutoBoluses / validDays.length)
      , avg_daily_user_bolus_insulin: round2(sumUserBolusInsulin / validDays.length)
      , avg_daily_auto_bolus_insulin: round2(sumAutoBolusInsulin / validDays.length)
    }
  };
}

/**
 * Aggregate hourly time blocks across multiple days into diurnal patterns.
 */
function computeDiurnalPatterns (validDays) {
  var hourBuckets = {};

  for (var d = 0; d < validDays.length; d++) {
    var blocks = validDays[d].time_blocks || [];
    for (var b = 0; b < blocks.length; b++) {
      var h = blocks[b].hour;
      if (!hourBuckets[h]) {
        hourBuckets[h] = [];
      }
      hourBuckets[h].push(blocks[b].avg);
    }
  }

  return Object.keys(hourBuckets).map(function (h) {
    var avgs = hourBuckets[h];
    return {
      hour: parseInt(h, 10)
      , avg: round2(ss.mean(avgs))
      , sd: avgs.length > 1 ? round2(ss.standard_deviation(avgs)) : 0
      , days_with_data: avgs.length
    };
  }).sort(function (a, b) { return a.hour - b.hour; });
}

/**
 * Compute treatment aggregates for a single day.
 *
 * Splits bolus counts and insulin by source so Control-IQ automatic corrections
 * don't inflate the "user bolus" count or hide the decisions the user actually
 * made. Classification rule:
 *   - isBolus: eventType is one of Meal/Correction/Snack/Combo/Bolus
 *   - isAutoBolus: isBolus AND notes contains "automatic" (case-insensitive)
 *   - isUserBolus: isBolus AND NOT isAutoBolus
 *
 * Backwards compatible: total_insulin and bolus_count are retained and equal the
 * sum of user + auto. Downstream readers can additionally use user_bolus_count,
 * auto_bolus_count, user_bolus_insulin, auto_bolus_insulin.
 */
function computeTreatmentStats (treatments) {
  if (!treatments || !Array.isArray(treatments) || treatments.length === 0) {
    return {
      total_carbs: 0, total_insulin: 0, bolus_count: 0, carb_entries: 0
      , user_bolus_count: 0, auto_bolus_count: 0
      , user_bolus_insulin: 0, auto_bolus_insulin: 0
    };
  }
  var totalCarbs = 0;
  var totalInsulin = 0;
  var bolusCount = 0;
  var carbEntries = 0;
  var userBolusCount = 0;
  var autoBolusCount = 0;
  var userBolusInsulin = 0;
  var autoBolusInsulin = 0;
  for (var i = 0; i < treatments.length; i++) {
    var t = treatments[i];
    if (!t) continue;
    var rawCarbs = parseFloat(t.carbs);
    var rawInsulin = parseFloat(t.insulin);
    var carbs = isFinite(rawCarbs) ? rawCarbs : 0;
    var insulin = isFinite(rawInsulin) ? rawInsulin : 0;
    if (carbs > 0) { totalCarbs += carbs; carbEntries++; }
    if (insulin > 0) {
      totalInsulin += insulin;
      bolusCount++;
      if (isBolusEvent(t)) {
        if (isAutoBolusEvent(t)) { autoBolusCount++; autoBolusInsulin += insulin; }
        else { userBolusCount++; userBolusInsulin += insulin; }
      }
    }
  }
  return {
    total_carbs: round2(totalCarbs)
    , total_insulin: round2(totalInsulin)
    , bolus_count: bolusCount
    , carb_entries: carbEntries
    , user_bolus_count: userBolusCount
    , auto_bolus_count: autoBolusCount
    , user_bolus_insulin: round2(userBolusInsulin)
    , auto_bolus_insulin: round2(autoBolusInsulin)
  };
}

/* ================================================================
 * PUMP-ACTION STATISTICS (added for AI eval pattern-first redesign)
 * ================================================================
 *
 * These functions compute "where is the pump fighting the scheduled therapy"
 * signals from Temp Basal events, automatic correction boluses, and basal
 * suspensions. They are pure — every output is a number, count, or neutral
 * categorical tag. Clinical interpretation ("basal too low at 03:00") is
 * never generated here; the LLM handles that in Phase D.
 *
 * The pure design lets these functions run on any set of treatments+profile
 * without requiring the full Nightscout client context. They were ported
 * from `playground/ai-eval-redesign.html` after being iterated against real
 * user data and verified against pump TDD ground truth.
 */

var MS_HOUR = 60 * 60 * 1000;
var MS_DAY = 24 * MS_HOUR;
var AUTO_BOLUS_NEAR_MEAL_MIN_DEFAULT = 120;
var AUTO_BOLUS_FAR_FROM_MEAL_MIN_DEFAULT = 240;
var HOTSPOT_MIN_DAYS_DEFAULT = 3;
var TEMP_BASAL_DELTA_THRESHOLD_PCT_DEFAULT = 15;

// Positive-match keyword list for automatic correction boluses. Control-IQ
// via tconnectsync emits English "Automatic Bolus" notes, but looped setups
// and non-English pump firmware may use other wording. Missing/empty notes
// always classify as user bolus (we never assume auto). Keywords are lower-
// cased; match is substring-based to cover variants like "Auto Correction".
var AUTO_BOLUS_KEYWORDS = [
  'automatic'            // English: "Automatic Bolus", "Auto Correction Bolus"
  , 'auto correction'    // English variant
  , 'auto bolus'         // English variant / AndroidAPS
  , 'automatisch'        // German: "Automatisch Bolus", "Automatische Korrektur"
  , 'autom. korrektur'   // German abbreviation
  , 'automatique'        // French
  , 'automatico'         // Italian / Spanish
  , 'automatizado'       // Spanish alt
];

/**
 * Return true if the treatment is any kind of bolus event (user, auto, or combo).
 * Used as the outer guard before the user/auto split.
 *
 * @param {object} t - Nightscout treatment
 * @returns {boolean}
 *
 * @example
 * isBolusEvent({ eventType: 'Meal Bolus', insulin: 4 });        // true
 * isBolusEvent({ eventType: 'Correction Bolus', insulin: 1 });  // true
 * isBolusEvent({ eventType: 'Temp Basal', rate: 0.8 });         // false
 */
function isBolusEvent (t) {
  if (!t) return false;
  var type = t.eventType || '';
  return type === 'Meal Bolus' || type === 'Correction Bolus' || type === 'Bolus'
    || type === 'Combo Bolus' || type === 'Snack Bolus';
}

/**
 * Return true only for boluses whose notes explicitly mark them as
 * pump-delivered automatic corrections (Control-IQ, AndroidAPS, etc.).
 * Missing or empty notes NEVER classify as auto — we only count an auto
 * when the pump firmware told us so. See AUTO_BOLUS_KEYWORDS for supported
 * languages and phrasings.
 *
 * @param {object} t - Nightscout treatment
 * @returns {boolean}
 *
 * @example
 * isAutoBolusEvent({ eventType: 'Correction Bolus', notes: 'Automatic Bolus' });    // true
 * isAutoBolusEvent({ eventType: 'Correction Bolus', notes: 'Automatische Korrektur' }); // true (DE)
 * isAutoBolusEvent({ eventType: 'Correction Bolus', notes: '' });                    // false
 * isAutoBolusEvent({ eventType: 'Meal Bolus' });                                     // false (no notes)
 */
function isAutoBolusEvent (t) {
  if (!isBolusEvent(t)) return false;
  var notes = (t.notes || '').toLowerCase();
  if (!notes) return false;
  for (var i = 0; i < AUTO_BOLUS_KEYWORDS.length; i++) {
    if (notes.indexOf(AUTO_BOLUS_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}

/**
 * Return true for user-initiated boluses (the complement of isAutoBolusEvent
 * within the bolus family). Drives the R3-12 denominator split so user-bolus
 * averages are computed over total days, not only pump-covered days.
 *
 * @param {object} t - Nightscout treatment
 * @returns {boolean}
 *
 * @example
 * isUserBolusEvent({ eventType: 'Meal Bolus', notes: '' });                        // true
 * isUserBolusEvent({ eventType: 'Correction Bolus', notes: 'Automatic Bolus' });   // false
 * isUserBolusEvent({ eventType: 'Temp Basal' });                                   // false
 */
function isUserBolusEvent (t) {
  return isBolusEvent(t) && !isAutoBolusEvent(t);
}

/**
 * Validate that a profile store entry contains usable basal schedule data.
 * Used by computePumpActionStats to surface profile_valid / profile_issue
 * rather than silently computing zeros when profiles are missing fields.
 *
 * @param {object} profileStore - profile.store[defaultProfile]
 * @returns {{valid: boolean, reason: string|null}}
 *
 * @example
 * validateProfileForBasal({ basal: [{ time: '00:00', value: 0.5 }] });
 * // -> { valid: true, reason: null }
 * validateProfileForBasal(null);
 * // -> { valid: false, reason: 'profile_missing' }
 */
function validateProfileForBasal (profileStore) {
  if (!profileStore || typeof profileStore !== 'object') {
    return { valid: false, reason: 'profile_missing' };
  }
  if (!Array.isArray(profileStore.basal)) {
    return { valid: false, reason: 'basal_not_array' };
  }
  if (profileStore.basal.length === 0) {
    return { valid: false, reason: 'basal_empty' };
  }
  for (var i = 0; i < profileStore.basal.length; i++) {
    var s = profileStore.basal[i];
    if (!s || typeof s.time !== 'string') {
      return { valid: false, reason: 'basal_malformed_time' };
    }
    var v = parseFloat(s.value);
    if (!isFinite(v)) {
      return { valid: false, reason: 'basal_malformed_value' };
    }
  }
  return { valid: true, reason: null };
}

function parseTreatmentLocal (t) {
  if (!t || !t.created_at) return null;
  var mills = new Date(t.created_at).getTime();
  if (!isFinite(mills)) return null;
  var offsetMin = typeof t.utcOffset === 'number' ? t.utcOffset : 0;
  var localMills = mills + offsetMin * 60 * 1000;
  var d = new Date(localMills);
  var localHour = d.getUTCHours();
  var dateKey = d.getUTCFullYear() + '-'
    + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(d.getUTCDate()).padStart(2, '0');
  return { mills: mills, localHour: localHour, dateKey: dateKey, offsetMin: offsetMin };
}

function dateKeyToUtcMs (dk) {
  var parts = dk.split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Build a stepwise basal rate lookup from a Nightscout profile store entry.
 * Returns function(hour, minute) -> U/h based on the profile's basal schedule.
 * Returns a constant-zero function if no valid basal array is present.
 *
 * @example
 * var lookup = buildProfileBasalLookup({
 *   basal: [{ time: '00:00', value: 0.5 }, { time: '06:00', value: 0.8 }]
 * });
 * lookup(3, 0);  // -> 0.5 (before 06:00)
 * lookup(6, 30); // -> 0.8 (after 06:00)
 */
function buildProfileBasalLookup (profileStore) {
  if (!profileStore || !Array.isArray(profileStore.basal)) {
    return function () { return 0; };
  }
  var segments = profileStore.basal.map(function (s) {
    var parts = (s.time || '00:00').split(':').map(Number);
    return { startSec: parts[0] * 3600 + (parts[1] || 0) * 60, value: parseFloat(s.value) || 0 };
  }).sort(function (a, b) { return a.startSec - b.startSec; });
  if (segments.length === 0) return function () { return 0; };
  return function (hour, minute) {
    var sec = hour * 3600 + (minute || 0) * 60;
    var current = segments[segments.length - 1].value;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].startSec <= sec) current = segments[i].value;
      else break;
    }
    return current;
  };
}

/**
 * Sum profile-scheduled basal for each hour-of-day, averaged across a set of
 * date keys. Used as the "expected if nothing happened" baseline for the
 * basal delta chart and as the fallback when no pump data is present.
 *
 * Returns { totalUnits, hourly: number[24] } where hourly[h] = avg U delivered
 * in hour h per day across the requested dateKeys.
 *
 * @example
 * var flat = sumScheduledBasalByHour(
 *   { basal: [{ time: '00:00', value: 0.5 }] },
 *   ['2026-04-07', '2026-04-08']
 * );
 * // flat.totalUnits === 12 (0.5 U/h * 24 h)
 * // flat.hourly[0] === 0.5
 */
function sumScheduledBasalByHour (profileStore, dateKeys) {
  var lookup = buildProfileBasalLookup(profileStore);
  var hourly = new Array(24).fill(0);
  if (!dateKeys || dateKeys.length === 0) return { totalUnits: 0, hourly: hourly };
  // Average a single "typical day" of the profile schedule — same for every
  // day since the profile itself doesn't vary by date in the basic case.
  // If profile switches become relevant later, this function would need to
  // accept a per-day profile lookup.
  for (var h = 0; h < 24; h++) {
    var hourTotal = 0;
    for (var m = 0; m < 60; m += 5) {
      hourTotal += lookup(h, m) * (5 / 60);
    }
    hourly[h] = hourTotal;
  }
  var totalUnits = hourly.reduce(function (a, b) { return a + b; }, 0);
  return { totalUnits: totalUnits, hourly: hourly };
}

/**
 * Integrate ACTUAL basal delivered per hour across a set of date keys.
 *
 * Algorithm: for each date key, walk the 24 hours in 5-minute slots. At each
 * slot, determine the active basal rate:
 *   1. If a Temp Basal event is active at that slot, use its rate.
 *      Overlap semantics: events are sorted by start time; per slot, the
 *      latest-starting event whose end still contains the slot wins. This
 *      matches Control-IQ firmware, where issuing a new Temp Basal
 *      supersedes any prior still-active one. Nested suspensions or
 *      stacked overrides never occur on real pumps.
 *   2. Otherwise, fall back to the profile-scheduled rate for that time of
 *      day (matches Control-IQ: when not actively modulating the pump
 *      delivers the scheduled rate).
 *
 * This correctly handles days where the pump has partial temp basal coverage
 * (e.g., tconnectsync only synced the last 12 hours of a day). Without the
 * gap-fill the total is silently understated.
 *
 * Travel / timezone correctness: events are converted to `localStart =
 * mills + offsetMin*60000` using each treatment's own utcOffset, producing
 * a UTC-frame representation of the event's local wall time. Day windows
 * are `dateKeyToUtcMs(dk)` which represents local midnight of that date in
 * the same shifted frame. This makes event-vs-window overlap checks work
 * for any mix of offsets within a period — travelers are handled correctly
 * without any additional per-day offset resolution.
 *
 * Only days containing at least one Temp Basal event are marked pump-covered
 * in coverageByDay. CGM-only days are excluded from the integration because
 * we have no evidence of actual delivery.
 *
 * @example
 *   var result = integrateActualBasalByHour(
 *     treatments,
 *     profileStore,
 *     ['2026-04-07', '2026-04-08', '2026-04-09']
 *   );
 *   // result.totalUnits === 21.3  (U per day averaged over pump-covered days)
 *   // result.pumpDayCount === 3
 *   // result.coverageByDay === { '2026-04-07': true, ... }
 *
 * Returns { totalUnits, hourly: number[24] (avg U per hour per pump-covered day),
 *           coverageByDay: { [dateKey]: boolean }, pumpDayCount }
 */
function integrateActualBasalByHour (treatments, profileStore, dateKeys) {
  var hourly = new Array(24).fill(0);
  var coverageByDay = {};
  var i;
  for (i = 0; i < dateKeys.length; i++) coverageByDay[dateKeys[i]] = false;
  if (!Array.isArray(treatments) || dateKeys.length === 0) {
    return { totalUnits: 0, hourly: hourly, coverageByDay: coverageByDay, pumpDayCount: 0 };
  }

  var profileLookup = buildProfileBasalLookup(profileStore);

  // Parse Temp Basal events to localized [start, end] windows.
  var events = [];
  for (i = 0; i < treatments.length; i++) {
    var t = treatments[i];
    if (!t || t.eventType !== 'Temp Basal') continue;
    var parsed = parseTreatmentLocal(t);
    if (!parsed) continue;
    var rate = parseFloat(t.absolute);
    var durationMin = parseFloat(t.duration);
    if (!isFinite(rate) || !isFinite(durationMin) || durationMin <= 0) continue;
    var localStart = parsed.mills + parsed.offsetMin * 60 * 1000;
    events.push({ start: localStart, end: localStart + durationMin * 60 * 1000, rate: rate });
  }
  events.sort(function (a, b) { return a.start - b.start; });

  // Identify pump-covered days.
  var dayWindows = dateKeys.map(function (dk) {
    var ms = dateKeyToUtcMs(dk);
    return { key: dk, start: ms, end: ms + MS_DAY };
  });
  var di, ei;
  for (di = 0; di < dayWindows.length; di++) {
    var day = dayWindows[di];
    for (ei = 0; ei < events.length; ei++) {
      if (events[ei].end > day.start && events[ei].start < day.end) {
        coverageByDay[day.key] = true;
        break;
      }
    }
  }

  // Walk each pump-covered day in 5-min slots, gap-filling with profile rate.
  var SLOT_MS = 5 * 60 * 1000;
  var SLOTS_PER_HOUR = 12;
  var pumpDayCount = 0;
  for (di = 0; di < dayWindows.length; di++) {
    var dw = dayWindows[di];
    if (!coverageByDay[dw.key]) continue;
    pumpDayCount++;
    // Binary-search the first event with end > day.start.
    var idx = 0;
    while (idx < events.length && events[idx].end <= dw.start) idx++;
    for (var h = 0; h < 24; h++) {
      for (var slot = 0; slot < SLOTS_PER_HOUR; slot++) {
        var slotMs = dw.start + h * MS_HOUR + slot * SLOT_MS;
        var activeRate = null;
        for (var si = idx; si < events.length && events[si].start <= slotMs; si++) {
          if (events[si].end > slotMs) activeRate = events[si].rate;
        }
        var effectiveRate = activeRate !== null ? activeRate : profileLookup(h, slot * 5);
        hourly[h] += effectiveRate * (SLOT_MS / MS_HOUR);
      }
    }
  }

  if (pumpDayCount > 0) {
    for (var hh = 0; hh < 24; hh++) hourly[hh] /= pumpDayCount;
  }
  var totalUnits = hourly.reduce(function (a, b) { return a + b; }, 0);
  return {
    totalUnits: round2(totalUnits)
    , hourly: hourly
    , coverageByDay: coverageByDay
    , pumpDayCount: pumpDayCount
  };
}

/**
 * Raw (non-gap-filled) temp basal integration. Used by the hotspot detector
 * to measure explicit pump overrides, not total delivery. A gap-filled
 * integration would wash out the delta signal because "no temp basal" would
 * look identical to "temp basal == profile" when comparing percent deviation.
 *
 * Returns { totalUnits, hourly: number[24] (avg explicit delivery per day) }.
 *
 * @example
 * integrateTempBasalRawByHour([
 *   { eventType: 'Temp Basal', mills: ..., duration: 30, absolute: 0.8 }
 * ], ['2026-04-07']);
 * // hourly slots covered by the event get explicit values; others stay 0
 */
function integrateTempBasalRawByHour (treatments, dateKeys) {
  var hourly = new Array(24).fill(0);
  if (!Array.isArray(treatments) || dateKeys.length === 0) {
    return { totalUnits: 0, hourly: hourly };
  }
  var events = [];
  var i;
  for (i = 0; i < treatments.length; i++) {
    var t = treatments[i];
    if (!t || t.eventType !== 'Temp Basal') continue;
    var parsed = parseTreatmentLocal(t);
    if (!parsed) continue;
    var rate = parseFloat(t.absolute);
    var durationMin = parseFloat(t.duration);
    if (!isFinite(rate) || !isFinite(durationMin) || durationMin <= 0) continue;
    var localStart = parsed.mills + parsed.offsetMin * 60 * 1000;
    events.push({ start: localStart, end: localStart + durationMin * 60 * 1000, rate: rate });
  }
  events.sort(function (a, b) { return a.start - b.start; });

  var dayWindows = dateKeys.map(function (dk) {
    var ms = dateKeyToUtcMs(dk);
    return { start: ms, end: ms + MS_DAY };
  });
  for (var di = 0; di < dayWindows.length; di++) {
    var day = dayWindows[di];
    var dayEvents = events.filter(function (e) { return e.end > day.start && e.start < day.end; });
    var segments = [];
    for (var ei = 0; ei < dayEvents.length; ei++) {
      var ev = dayEvents[ei];
      if (segments.length > 0) {
        var prev = segments[segments.length - 1];
        if (prev.end > ev.start) prev.end = ev.start;
        if (prev.end <= prev.start) segments.pop();
      }
      segments.push({ start: Math.max(ev.start, day.start), end: Math.min(ev.end, day.end), rate: ev.rate });
    }
    for (var sgi = 0; sgi < segments.length; sgi++) {
      var s = segments[sgi];
      var cursor = s.start;
      while (cursor < s.end) {
        var localMs = cursor - day.start;
        var h = Math.floor(localMs / MS_HOUR);
        var hourEnd = day.start + (h + 1) * MS_HOUR;
        var segEnd = Math.min(s.end, hourEnd);
        var durHours = (segEnd - cursor) / MS_HOUR;
        hourly[h] += s.rate * durHours;
        cursor = segEnd;
      }
    }
  }
  for (var hh = 0; hh < 24; hh++) hourly[hh] /= dateKeys.length;
  return { totalUnits: hourly.reduce(function (a, b) { return a + b; }, 0), hourly: hourly };
}

/**
 * Classify automatic correction boluses by temporal proximity to the nearest
 * preceding user-initiated bolus. The classification is rule-based; the
 * clinical meaning of each bucket is for the LLM to name.
 *
 * Buckets:
 *   near_meal      — auto bolus within nearMealMinutes of a preceding user bolus
 *   far_from_meal  — auto bolus more than farFromMealMinutes from any user bolus
 *   intermediate   — auto bolus between the two thresholds
 *
 * Returns array of { mills, localHour, dateKey, insulin, bucket, minutesSinceUserBolus }.
 *
 * @example
 * classifyAutoBoluses([
 *   { eventType: 'Meal Bolus', mills: t0, insulin: 5 },
 *   { eventType: 'Combo Bolus', notes: 'Automatic Bolus', mills: t0 + 60*60*1000, insulin: 0.4 }
 * ], { nearMealMinutes: 120, farFromMealMinutes: 240 });
 * // -> [{ bucket: 'near_meal', minutesSinceUserBolus: 60, ... }]
 */
function classifyAutoBoluses (treatments, options) {
  var opts = options || {};
  var nearMealMs = (opts.nearMealMinutes || AUTO_BOLUS_NEAR_MEAL_MIN_DEFAULT) * 60 * 1000;
  var farFromMealMs = (opts.farFromMealMinutes || AUTO_BOLUS_FAR_FROM_MEAL_MIN_DEFAULT) * 60 * 1000;
  if (!Array.isArray(treatments)) return [];

  var userBolusMills = [];
  var autoEvents = [];
  var i;
  for (i = 0; i < treatments.length; i++) {
    var t = treatments[i];
    var parsed = parseTreatmentLocal(t);
    if (!parsed) continue;
    var ins = parseFloat(t.insulin);
    if (!isFinite(ins) || ins <= 0) continue;
    if (isAutoBolusEvent(t)) {
      autoEvents.push({ mills: parsed.mills, localHour: parsed.localHour, dateKey: parsed.dateKey, insulin: ins });
    } else if (isUserBolusEvent(t)) {
      userBolusMills.push(parsed.mills);
    }
  }
  userBolusMills.sort(function (a, b) { return a - b; });

  var classified = [];
  for (i = 0; i < autoEvents.length; i++) {
    var ae = autoEvents[i];
    // Binary search for the largest user bolus mills <= ae.mills
    var lo = 0, hi = userBolusMills.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (userBolusMills[mid] <= ae.mills) lo = mid + 1;
      else hi = mid;
    }
    var prevIdx = lo - 1;
    var deltaMs = prevIdx >= 0 ? ae.mills - userBolusMills[prevIdx] : Infinity;
    var bucket;
    if (deltaMs <= nearMealMs) bucket = 'near_meal';
    else if (deltaMs >= farFromMealMs) bucket = 'far_from_meal';
    else bucket = 'intermediate';
    classified.push({
      mills: ae.mills
      , localHour: ae.localHour
      , dateKey: ae.dateKey
      , insulin: ae.insulin
      , bucket: bucket
      , minutesSinceUserBolus: isFinite(deltaMs) ? Math.round(deltaMs / 60000) : null
    });
  }
  return classified;
}

/**
 * Pair Basal Suspension events with their matching Basal Resume events. An
 * unclosed suspension at the end of the period is closed at windowEndMs if
 * provided.
 *
 * Nested-suspension handling: if a second Suspension event arrives before a
 * Resume, the first suspension is closed at the second's start (re-attributed,
 * not orphaned), and the second Suspension becomes the new open. Real pumps
 * don't nest suspensions; this is defensive behavior for corrupt/partial
 * sync streams, not a feature.
 *
 * @example
 *   var events = [
 *     { eventType: 'Basal Suspension', created_at: '2026-04-10T09:00:00Z' },
 *     { eventType: 'Basal Resume',     created_at: '2026-04-10T09:15:00Z' }
 *   ];
 *   detectBasalSuspensions(events);
 *   // [{ startMills: ..., endMills: ..., durationMin: 15, localHour: 9, dateKey: '2026-04-10' }]
 *
 * Returns array of { startMills, endMills, durationMin, localHour, dateKey }.
 */
function detectBasalSuspensions (treatments, windowEndMs) {
  if (!Array.isArray(treatments)) return [];
  var events = [];
  var i;
  for (i = 0; i < treatments.length; i++) {
    var t = treatments[i];
    if (!t || (t.eventType !== 'Basal Suspension' && t.eventType !== 'Basal Resume')) continue;
    var parsed = parseTreatmentLocal(t);
    if (!parsed) continue;
    events.push({ type: t.eventType, mills: parsed.mills, localHour: parsed.localHour, dateKey: parsed.dateKey });
  }
  events.sort(function (a, b) { return a.mills - b.mills; });

  var suspensions = [];
  var open = null;
  for (i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.type === 'Basal Suspension') {
      if (open) {
        suspensions.push({
          startMills: open.mills, endMills: ev.mills
          , durationMin: Math.round((ev.mills - open.mills) / 60000)
          , localHour: open.localHour, dateKey: open.dateKey
        });
      }
      open = ev;
    } else if (ev.type === 'Basal Resume' && open) {
      suspensions.push({
        startMills: open.mills, endMills: ev.mills
        , durationMin: Math.round((ev.mills - open.mills) / 60000)
        , localHour: open.localHour, dateKey: open.dateKey
      });
      open = null;
    }
  }
  if (open && windowEndMs) {
    suspensions.push({
      startMills: open.mills, endMills: windowEndMs
      , durationMin: Math.round((windowEndMs - open.mills) / 60000)
      , localHour: open.localHour, dateKey: open.dateKey
    });
  }
  return suspensions;
}

/**
 * Determine which days in the period have pump data present. A day is
 * pump-covered if it contains any treatment entered by a pump source or any
 * Temp Basal / Basal Suspension / Basal Resume event.
 *
 * Returns { pumpCoveredKeys: Set<string>, cgmOnlyKeys: Set<string>,
 *           pumpDays: number, totalDays: number }.
 *
 * @example
 * detectPumpCoverage(
 *   [{ eventType: 'Temp Basal', mills: Date.parse('2026-04-07T08:00:00Z') }],
 *   ['2026-04-07', '2026-04-08']
 * );
 * // -> pumpDays === 1, totalDays === 2, pumpCoveredKeys.has('2026-04-07') === true
 */
function detectPumpCoverage (treatments, dateKeys) {
  var pumpDates = new Set();
  if (Array.isArray(treatments)) {
    for (var i = 0; i < treatments.length; i++) {
      var t = treatments[i];
      if (!t) continue;
      var parsed = parseTreatmentLocal(t);
      if (!parsed) continue;
      var isPumpEvent = (t.enteredBy && t.enteredBy.indexOf('Pump') !== -1)
        || t.eventType === 'Temp Basal'
        || t.eventType === 'Basal Suspension'
        || t.eventType === 'Basal Resume';
      if (isPumpEvent) pumpDates.add(parsed.dateKey);
    }
  }
  var pumpCoveredKeys = new Set();
  var cgmOnlyKeys = new Set();
  for (var k = 0; k < dateKeys.length; k++) {
    if (pumpDates.has(dateKeys[k])) pumpCoveredKeys.add(dateKeys[k]);
    else cgmOnlyKeys.add(dateKeys[k]);
  }
  return {
    pumpCoveredKeys: pumpCoveredKeys
    , cgmOnlyKeys: cgmOnlyKeys
    , pumpDays: pumpCoveredKeys.size
    , totalDays: dateKeys.length
  };
}

/**
 * Compute hourly bolus distribution for user and automatic boluses. Returns
 * average U delivered in each hour per day, split by source and by auto
 * classification bucket.
 *
 * Denominator split: user boluses divide by `dateKeys.length` because they
 * can exist on CGM-only days (manual entry). Automatic correction boluses
 * divide by `pumpDayCount` because they only occur on pump-covered days —
 * dividing by total days would understate the per-day auto rate when pump
 * coverage is sparse. If `pumpDayCount` is 0, auto-bucket hourly stays at
 * zero (no events anyway) so the division is safe.
 *
 * @example
 *   var dist = computeBolusDistribution(treatments, dateKeys, autoClassified, coverage.pumpDays);
 *   dist.userHourly[12]        // avg user bolus U in hour 12 per day
 *   dist.autoHourlyByBucket.near_meal[12]  // avg auto near-meal U in hour 12 per pump day
 *
 * @param {Array} treatments
 * @param {Array<string>} dateKeys
 * @param {Array} autoClassified  - from classifyAutoBoluses
 * @param {number} pumpDayCount   - number of pump-covered days; auto hourly
 *                                  divides by this (falls back to dateKeys.length
 *                                  if omitted for backward compat)
 *
 * Returns {
 *   userHourly: number[24]
 *   , autoHourlyByBucket: { near_meal, intermediate, far_from_meal: number[24] }
 *   , totalUser, totalAutoByBucket: { near_meal, intermediate, far_from_meal }
 * }
 */
function computeBolusDistribution (treatments, dateKeys, autoClassified, pumpDayCount) {
  var userHourly = new Array(24).fill(0);
  var autoByBucket = {
    near_meal: new Array(24).fill(0)
    , intermediate: new Array(24).fill(0)
    , far_from_meal: new Array(24).fill(0)
  };
  var dateKeySet = new Set(dateKeys);
  var i;
  if (Array.isArray(treatments)) {
    for (i = 0; i < treatments.length; i++) {
      var t = treatments[i];
      if (!isUserBolusEvent(t)) continue;
      var parsed = parseTreatmentLocal(t);
      if (!parsed || !dateKeySet.has(parsed.dateKey)) continue;
      var ins = parseFloat(t.insulin);
      if (isFinite(ins) && ins > 0) userHourly[parsed.localHour] += ins;
    }
  }
  for (i = 0; i < autoClassified.length; i++) {
    var ae = autoClassified[i];
    if (!dateKeySet.has(ae.dateKey)) continue;
    autoByBucket[ae.bucket][ae.localHour] += ae.insulin;
  }
  var userDays = Math.max(1, dateKeys.length);
  // Auto boluses only occur on pump-covered days. If pumpDayCount is
  // undefined (legacy callers) or 0, fall back gracefully.
  var autoDays = (typeof pumpDayCount === 'number' && pumpDayCount > 0)
    ? pumpDayCount
    : userDays;
  for (var h = 0; h < 24; h++) {
    userHourly[h] /= userDays;
    autoByBucket.near_meal[h] /= autoDays;
    autoByBucket.intermediate[h] /= autoDays;
    autoByBucket.far_from_meal[h] /= autoDays;
  }
  function sumArr (arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
  return {
    userHourly: userHourly
    , autoHourlyByBucket: autoByBucket
    , totalUser: sumArr(userHourly)
    , totalAutoByBucket: {
      near_meal: sumArr(autoByBucket.near_meal)
      , intermediate: sumArr(autoByBucket.intermediate)
      , far_from_meal: sumArr(autoByBucket.far_from_meal)
    }
  };
}

/**
 * Detect per-hour pump-action hotspots across a period. A hotspot is an hour
 * where the composite "pump fighting" signal fires on at least
 * `hotspotMinDays` of the pump-covered days. Signals considered (any subset
 * can be enabled via options):
 *
 *   - signalTempBasal: |actual - scheduled| / scheduled >= deltaThresholdPct
 *   - signalAutoBolus: any automatic correction bolus in that hour
 *   - signalSuspension: any basal suspension in that hour
 *
 * Returns { perHour: [{ hour, deltaPct, signalDays, signals, intensity, direction }],
 *           hotspots: number[] (hours meeting threshold),
 *           pumpDays, totalDays }.
 * `intensity` is 0..1 (fraction of pump days with any signal at that hour).
 * `direction` > 0 = pump pushing insulin; < 0 = pump withholding.
 *
 * @example
 * var result = detectHotspots({
 *   profileStore: profile.store.Default,
 *   treatments: allTreatments,
 *   dateKeys: ['2026-04-04','2026-04-05','2026-04-06','2026-04-07'],
 *   pumpCoveredKeys: new Set(['2026-04-04','2026-04-05','2026-04-06','2026-04-07']),
 *   hotspotMinDays: 3,
 *   deltaThresholdPct: 15
 * });
 * // result.hotspots === [3, 4] means hours 3 and 4 had signal on >= 3 of 4 days
 */
function detectHotspots (opts) {
  var profileStore = opts.profileStore;
  var treatments = opts.treatments;
  var dateKeys = opts.dateKeys;
  var pumpCoveredKeys = opts.pumpCoveredKeys;
  var hotspotMinDays = opts.hotspotMinDays || HOTSPOT_MIN_DAYS_DEFAULT;
  var deltaThresholdPct = opts.deltaThresholdPct || TEMP_BASAL_DELTA_THRESHOLD_PCT_DEFAULT;
  var signalTempBasal = opts.signalTempBasal !== false;
  var signalAutoBolus = opts.signalAutoBolus !== false;
  var signalSuspension = opts.signalSuspension !== false;

  var pumpKeysArr = Array.from(pumpCoveredKeys || []);
  var emptyPerHour = [];
  var h;
  for (h = 0; h < 24; h++) {
    emptyPerHour.push({ hour: h, deltaPct: 0, signalDays: 0, signals: {}, intensity: 0, direction: 0 });
  }
  if (pumpKeysArr.length === 0) {
    return { perHour: emptyPerHour, hotspots: [], pumpDays: 0, totalDays: dateKeys.length };
  }

  var lookup = buildProfileBasalLookup(profileStore);
  var scheduledPerHour = new Array(24).fill(0);
  for (h = 0; h < 24; h++) {
    var hourTotal = 0;
    for (var m = 0; m < 60; m += 5) hourTotal += lookup(h, m) * (5 / 60);
    scheduledPerHour[h] = hourTotal;
  }

  var tempByDay = {};
  for (var di = 0; di < pumpKeysArr.length; di++) {
    tempByDay[pumpKeysArr[di]] = integrateTempBasalRawByHour(treatments, [pumpKeysArr[di]]).hourly;
  }

  var autoEvents = classifyAutoBoluses(treatments, {
    nearMealMinutes: opts.nearMealMinutes
    , farFromMealMinutes: opts.farFromMealMinutes
  });
  var autoByDayHour = {};
  for (var ai = 0; ai < autoEvents.length; ai++) {
    var aev = autoEvents[ai];
    if (!pumpCoveredKeys.has(aev.dateKey)) continue;
    var ak = aev.dateKey + '|' + aev.localHour;
    autoByDayHour[ak] = (autoByDayHour[ak] || 0) + 1;
  }

  var suspensions = detectBasalSuspensions(treatments);
  var suspByDayHour = {};
  for (var ssi = 0; ssi < suspensions.length; ssi++) {
    var sev = suspensions[ssi];
    if (!pumpCoveredKeys.has(sev.dateKey)) continue;
    var sk = sev.dateKey + '|' + sev.localHour;
    suspByDayHour[sk] = (suspByDayHour[sk] || 0) + 1;
  }

  var perHour = [];
  for (h = 0; h < 24; h++) {
    var signalDaysUp = 0, signalDaysDown = 0;
    var deltaSumPct = 0, deltaDayCount = 0;
    var autoBolusDays = 0, suspensionDays = 0;
    var daysWithAnySignal = new Set();

    for (var pi = 0; pi < pumpKeysArr.length; pi++) {
      var dk = pumpKeysArr[pi];
      var actual = tempByDay[dk] ? tempByDay[dk][h] : 0;
      var scheduled = scheduledPerHour[h];
      var hadSignal = false;

      if (signalTempBasal && scheduled > 0) {
        var pct = ((actual - scheduled) / scheduled) * 100;
        deltaSumPct += pct;
        deltaDayCount++;
        if (Math.abs(pct) >= deltaThresholdPct) {
          if (pct > 0) signalDaysUp++;
          else signalDaysDown++;
          hadSignal = true;
        }
      }
      if (signalAutoBolus && (autoByDayHour[dk + '|' + h] || 0) > 0) {
        autoBolusDays++;
        signalDaysUp++;
        hadSignal = true;
      }
      if (signalSuspension && (suspByDayHour[dk + '|' + h] || 0) > 0) {
        suspensionDays++;
        signalDaysDown++;
        hadSignal = true;
      }
      if (hadSignal) daysWithAnySignal.add(dk);
    }

    var avgDeltaPct = deltaDayCount > 0 ? deltaSumPct / deltaDayCount : 0;
    var intensity = daysWithAnySignal.size / pumpKeysArr.length;
    var direction = signalDaysUp - signalDaysDown;

    perHour.push({
      hour: h
      , deltaPct: round2(avgDeltaPct)
      , signalDays: daysWithAnySignal.size
      , signals: {
        tempBasalDaysUp: signalDaysUp - autoBolusDays
        , tempBasalDaysDown: signalDaysDown - suspensionDays
        , autoBolusDays: autoBolusDays
        , suspensionDays: suspensionDays
      }
      , intensity: round2(intensity)
      , direction: direction
    });
  }

  var hotspots = perHour.filter(function (p) { return p.signalDays >= hotspotMinDays; }).map(function (p) { return p.hour; });
  return { perHour: perHour, hotspots: hotspots, pumpDays: pumpKeysArr.length, totalDays: dateKeys.length };
}

/**
 * Compute hourly hypo/hyper episode distribution across a period for a given
 * target range. Episodes are contiguous runs of >= 3 readings meeting the
 * predicate (<targetLow for hypo, >targetHigh for hyper), merged when within
 * 15 minutes. Each episode's duration is distributed across the hours its
 * readings fall in.
 *
 * `entriesByDay` is a map from dateKey -> array of { mills, sgv, localHour }.
 * Callers build this once at the period level using the same offset handling
 * as the rest of the stats pipeline.
 *
 * Returns { hypoHourly: number[24] (avg minutes per day),
 *           hyperHourly: number[24],
 *           hypoDaysAtHour: number[24] (# distinct dates with hypo in hour),
 *           hyperDaysAtHour: number[24],
 *           hypoCount, hyperCount, hypoTotalMin, hyperTotalMin }.
 *
 * @example
 * computeEpisodesWithHours({
 *   '2026-04-07': [
 *     { mills: 1000, sgv: 55, localHour: 3 },
 *     { mills: 1300, sgv: 58, localHour: 3 },
 *     { mills: 1600, sgv: 60, localHour: 3 }
 *   ]
 * }, 70, 180);
 * // -> hypoHourly[3] > 0, hypoCount === 1
 */
function computeEpisodesWithHours (entriesByDay, targetLow, targetHigh) {
  var MIN_EPISODE_READINGS = 3;
  var GAP_MS = 15 * 60 * 1000;
  var MERGE_GAP_MS = 15 * 60 * 1000;

  var hypoHourly = new Array(24).fill(0);
  var hyperHourly = new Array(24).fill(0);
  var hypoDaySetAtHour = [];
  var hyperDaySetAtHour = [];
  var h;
  for (h = 0; h < 24; h++) { hypoDaySetAtHour.push(new Set()); hyperDaySetAtHour.push(new Set()); }
  var hypoCount = 0, hyperCount = 0, hypoTotalMin = 0, hyperTotalMin = 0;

  // R2-11: on empty input return the all-zero shape explicitly so a future
  // caller isn't surprised by the raw (un-averaged) totals that would fall
  // out of the `Math.max(1, keys.length)` fallback below.
  if (!entriesByDay || Object.keys(entriesByDay).length === 0) {
    return {
      hypoHourly: hypoHourly
      , hyperHourly: hyperHourly
      , hypoDaysAtHour: new Array(24).fill(0)
      , hyperDaysAtHour: new Array(24).fill(0)
      , hypoCount: 0
      , hyperCount: 0
      , hypoTotalMin: 0
      , hyperTotalMin: 0
    };
  }

  function extractEpisodes (sorted, predicate) {
    var episodes = [];
    var current = null;
    var i;
    for (i = 0; i < sorted.length; i++) {
      var inEp = predicate(sorted[i].sgv);
      if (inEp) {
        if (!current) {
          current = { start: sorted[i].mills, end: sorted[i].mills, readings: [sorted[i]] };
        } else if (i > 0 && sorted[i].mills - sorted[i - 1].mills > GAP_MS) {
          if (current.readings.length >= MIN_EPISODE_READINGS) episodes.push(current);
          current = { start: sorted[i].mills, end: sorted[i].mills, readings: [sorted[i]] };
        } else {
          current.end = sorted[i].mills;
          current.readings.push(sorted[i]);
        }
      } else if (current) {
        if (current.readings.length >= MIN_EPISODE_READINGS) episodes.push(current);
        current = null;
      }
    }
    if (current && current.readings.length >= MIN_EPISODE_READINGS) episodes.push(current);
    var merged = [];
    for (i = 0; i < episodes.length; i++) {
      var ep = episodes[i];
      if (merged.length > 0 && ep.start - merged[merged.length - 1].end < MERGE_GAP_MS) {
        merged[merged.length - 1].end = ep.end;
        merged[merged.length - 1].readings = merged[merged.length - 1].readings.concat(ep.readings);
      } else {
        merged.push(ep);
      }
    }
    return merged;
  }

  var keys = Object.keys(entriesByDay);
  for (var k = 0; k < keys.length; k++) {
    var dk = keys[k];
    var sorted = entriesByDay[dk].slice().sort(function (a, b) { return a.mills - b.mills; });
    var hypos = extractEpisodes(sorted, function (v) { return v < targetLow; });
    var hypers = extractEpisodes(sorted, function (v) { return v > targetHigh; });
    hypoCount += hypos.length;
    hyperCount += hypers.length;

    for (var hi = 0; hi < hypos.length; hi++) {
      var hEp = hypos[hi];
      var durationMin = (hEp.end - hEp.start) / 60000;
      hypoTotalMin += durationMin;
      var hoursTouched = new Set(hEp.readings.map(function (r) { return r.localHour; }));
      var perHour = durationMin / hoursTouched.size;
      hoursTouched.forEach(function (hh) { hypoHourly[hh] += perHour; hypoDaySetAtHour[hh].add(dk); });
    }
    for (var hyi = 0; hyi < hypers.length; hyi++) {
      var yEp = hypers[hyi];
      var durationMinY = (yEp.end - yEp.start) / 60000;
      hyperTotalMin += durationMinY;
      var hoursTouchedY = new Set(yEp.readings.map(function (r) { return r.localHour; }));
      var perHourY = durationMinY / hoursTouchedY.size;
      hoursTouchedY.forEach(function (hh) { hyperHourly[hh] += perHourY; hyperDaySetAtHour[hh].add(dk); });
    }
  }

  var days = Math.max(1, keys.length);
  for (h = 0; h < 24; h++) { hypoHourly[h] /= days; hyperHourly[h] /= days; }

  return {
    hypoHourly: hypoHourly
    , hyperHourly: hyperHourly
    , hypoDaysAtHour: hypoDaySetAtHour.map(function (s) { return s.size; })
    , hyperDaysAtHour: hyperDaySetAtHour.map(function (s) { return s.size; })
    , hypoCount: hypoCount
    , hyperCount: hyperCount
    , hypoTotalMin: Math.round(hypoTotalMin)
    , hyperTotalMin: Math.round(hyperTotalMin)
  };
}

/**
 * Orchestrator: run the full pump-action pipeline for a period. Returns a
 * fully-numeric structure suitable both for rendering charts in the client
 * and for sending to the LLM in the payload.
 *
 * No clinical prose. No "suggests X" labels. Just numbers and neutral
 * categorical tags (bucket names, signal counts, intensity ratios).
 *
 * **Contract (R2-10):** Callers MUST check `profile_valid` before trusting
 * `basal_actual` / `basal_scheduled` numbers. When `profile_valid` is false,
 * `basal_scheduled` falls back to zero and the basal delta chart should not
 * be rendered — show `profile_issue` instead so the user can diagnose. When
 * `profile_switch_detected` is true, the basal delta should be labeled as
 * approximate (single-profile limitation documented as R3-11 in the plan).
 * The function is always fail-soft: it returns the full shape even with a
 * null/invalid profile and zero pump days, so the renderer can always
 * consume the output without defensive short-circuits.
 *
 * @param {Array} treatments - all treatment events across the full period
 * @param {object} profileStore - profile.store.Default (or similar)
 * @param {Array<string>} dateKeys - YYYY-MM-DD keys covering the period
 * @param {object} options - thresholds (nearMealMinutes, farFromMealMinutes,
 *                           hotspotMinDays, deltaThresholdPct) and signal toggles
 *
 * @example
 * var stats = computePumpActionStats(treatments, profile.store.Default,
 *   ['2026-04-04','2026-04-05','2026-04-06'], { hotspotMinDays: 3 });
 * if (stats.profile_valid !== false) {
 *   renderBasalDelta(stats.basal_actual.hourly, stats.basal_scheduled.hourly);
 * }
 */
function computePumpActionStats (treatments, profileStore, dateKeys, options) {
  var opts = options || {};
  var profileValidation = validateProfileForBasal(profileStore);
  var coverage = detectPumpCoverage(treatments, dateKeys);
  var scheduled = sumScheduledBasalByHour(profileStore, dateKeys);

  // R5-1: collect validation_warnings for malformed events so the renderer
  // can surface a data-quality alert. Non-fatal — bad events are still
  // skipped by the downstream integrators, the warning is informational.
  // R5-4: detect Profile Switch events in the period so the renderer can
  // show a "basal delta may be approximate" notice (plan R3-11 deferred
  // the full fix, but surfacing the flag is a one-line mitigation).
  var validationWarnings = [];
  var profileSwitchDetected = false;
  if (Array.isArray(treatments)) {
    for (var ti = 0; ti < treatments.length; ti++) {
      var ev = treatments[ti];
      if (!ev || typeof ev !== 'object') {
        validationWarnings.push('Treatment #' + ti + ': not an object');
        continue;
      }
      if (ev.eventType === 'Profile Switch') profileSwitchDetected = true;
      var mills = ev.mills;
      if (mills != null && !Number.isFinite(mills)) {
        validationWarnings.push('Treatment #' + ti + ' (' + (ev.eventType || '?') + '): non-finite mills');
      }
      if (ev.eventType === 'Temp Basal') {
        if (ev.duration != null && (!Number.isFinite(ev.duration) || ev.duration < 0)) {
          validationWarnings.push('Treatment #' + ti + ' (Temp Basal): invalid duration ' + ev.duration);
        }
      }
    }
  }

  var actual = coverage.pumpDays > 0
    ? integrateActualBasalByHour(treatments, profileStore, Array.from(coverage.pumpCoveredKeys))
    : { totalUnits: 0, hourly: new Array(24).fill(0), coverageByDay: {}, pumpDayCount: 0 };

  var autoClassified = classifyAutoBoluses(treatments, opts);
  var bolusDist = computeBolusDistribution(treatments, dateKeys, autoClassified, coverage.pumpDays);
  var autoHourlyTotal = new Array(24).fill(0);
  for (var h = 0; h < 24; h++) {
    autoHourlyTotal[h] = bolusDist.autoHourlyByBucket.near_meal[h]
      + bolusDist.autoHourlyByBucket.intermediate[h]
      + bolusDist.autoHourlyByBucket.far_from_meal[h];
  }

  var hotspots = detectHotspots({
    profileStore: profileStore
    , treatments: treatments
    , dateKeys: dateKeys
    , pumpCoveredKeys: coverage.pumpCoveredKeys
    , hotspotMinDays: opts.hotspotMinDays
    , deltaThresholdPct: opts.deltaThresholdPct
    , nearMealMinutes: opts.nearMealMinutes
    , farFromMealMinutes: opts.farFromMealMinutes
    , signalTempBasal: opts.signalTempBasal
    , signalAutoBolus: opts.signalAutoBolus
    , signalSuspension: opts.signalSuspension
  });

  var suspensions = detectBasalSuspensions(treatments);

  // Determine basal source for downstream rendering:
  //   'pump'              — gap-filled integration from real temp basal data
  //   'profile_fallback'  — no pump data at all; falls back to profile schedule
  var basalSource = coverage.pumpDays > 0 ? 'pump' : 'profile_fallback';
  var basalForChart = coverage.pumpDays > 0 ? actual.hourly : scheduled.hourly;
  var basalTotalForChart = coverage.pumpDays > 0 ? actual.totalUnits : scheduled.totalUnits;

  return {
    coverage: {
      pump_days: coverage.pumpDays
      , cgm_only_days: coverage.totalDays - coverage.pumpDays
      , total_days: coverage.totalDays
      , pump_day_keys: Array.from(coverage.pumpCoveredKeys)
    }
    , profile_valid: profileValidation.valid
    , profile_issue: profileValidation.reason
    , profile_switch_detected: profileSwitchDetected
    , validation_warnings: validationWarnings
    , basal_source: basalSource
    , basal_actual: { total: actual.totalUnits, hourly: actual.hourly }
    , basal_scheduled: { total: round2(scheduled.totalUnits), hourly: scheduled.hourly }
    , basal_for_chart: { total: round2(basalTotalForChart), hourly: basalForChart }
    , bolus_distribution: {
      user_hourly: bolusDist.userHourly
      , user_total: round2(bolusDist.totalUser)
      , auto_by_bucket_hourly: bolusDist.autoHourlyByBucket
      , auto_total_by_bucket: {
        near_meal: round2(bolusDist.totalAutoByBucket.near_meal)
        , intermediate: round2(bolusDist.totalAutoByBucket.intermediate)
        , far_from_meal: round2(bolusDist.totalAutoByBucket.far_from_meal)
      }
      , auto_hourly_total: autoHourlyTotal
    }
    , auto_classified: autoClassified
    , suspensions: suspensions
    , hotspots: hotspots
    , thresholds: {
      near_meal_minutes: opts.nearMealMinutes || AUTO_BOLUS_NEAR_MEAL_MIN_DEFAULT
      , far_from_meal_minutes: opts.farFromMealMinutes || AUTO_BOLUS_FAR_FROM_MEAL_MIN_DEFAULT
      , hotspot_min_days: opts.hotspotMinDays || HOTSPOT_MIN_DAYS_DEFAULT
      , delta_threshold_pct: opts.deltaThresholdPct || TEMP_BASAL_DELTA_THRESHOLD_PCT_DEFAULT
    }
  };
}

function emptyStats () {
  return {
    average: null
    , median: null
    , sd: null
    , cv: null
    , mage: null
    , tir_pct: 0
    , tbr_pct: 0
    , tar_pct: 0
    , hypo_episodes: []
    , hyper_episodes: []
    , time_blocks: []
    , total_readings: 0
    , valid_hours: 0
    , data_gaps: 0
    , total_carbs: 0
    , total_insulin: 0
    , bolus_count: 0
    , carb_entries: 0
    , user_bolus_count: 0
    , auto_bolus_count: 0
    , user_bolus_insulin: 0
    , auto_bolus_insulin: 0
  };
}

function round2 (n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  computeDayStats: computeDayStats
  , computePeriodStats: computePeriodStats
  // Pump-action pipeline (AI eval pattern-first redesign)
  , computePumpActionStats: computePumpActionStats
  , buildProfileBasalLookup: buildProfileBasalLookup
  , sumScheduledBasalByHour: sumScheduledBasalByHour
  , integrateActualBasalByHour: integrateActualBasalByHour
  , integrateTempBasalRawByHour: integrateTempBasalRawByHour
  , classifyAutoBoluses: classifyAutoBoluses
  , detectBasalSuspensions: detectBasalSuspensions
  , detectPumpCoverage: detectPumpCoverage
  , computeBolusDistribution: computeBolusDistribution
  , computeEpisodesWithHours: computeEpisodesWithHours
  , detectHotspots: detectHotspots
  , validateProfileForBasal: validateProfileForBasal
  // Treatment classification helpers (exported so callers can reuse the rule)
  , isBolusEvent: isBolusEvent
  , isAutoBolusEvent: isAutoBolusEvent
  , isUserBolusEvent: isUserBolusEvent
  , AUTO_BOLUS_KEYWORDS: AUTO_BOLUS_KEYWORDS
};
