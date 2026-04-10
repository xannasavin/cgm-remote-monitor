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
  for (var ts = 0; ts < validDays.length; ts++) {
    sumCarbs += validDays[ts].total_carbs || 0;
    sumInsulin += validDays[ts].total_insulin || 0;
    sumBoluses += validDays[ts].bolus_count || 0;
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
 */
function computeTreatmentStats (treatments) {
  if (!treatments || !Array.isArray(treatments) || treatments.length === 0) {
    return { total_carbs: 0, total_insulin: 0, bolus_count: 0, carb_entries: 0 };
  }
  var totalCarbs = 0;
  var totalInsulin = 0;
  var bolusCount = 0;
  var carbEntries = 0;
  for (var i = 0; i < treatments.length; i++) {
    var t = treatments[i];
    if (!t) continue;
    var carbs = parseFloat(t.carbs) || 0;
    var insulin = parseFloat(t.insulin) || 0;
    if (carbs > 0) { totalCarbs += carbs; carbEntries++; }
    if (insulin > 0) { totalInsulin += insulin; bolusCount++; }
  }
  return {
    total_carbs: round2(totalCarbs)
    , total_insulin: round2(totalInsulin)
    , bolus_count: bolusCount
    , carb_entries: carbEntries
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
  };
}

function round2 (n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  computeDayStats: computeDayStats
  , computePeriodStats: computePeriodStats
};
