'use strict';

var statistics = require('../../statistics');
var prompts = require('./prompts');

/**
 * Extract and format CGM data from Nightscout datastorage for AI evaluation.
 * Single-call architecture: returns compact JSON + client-computed statistics.
 *
 * @param {object} datastorage - The Nightscout datastorage object from a report
 * @param {object} settings - Plugin settings
 * @param {object} options - Report options { targetLow, targetHigh, units }
 * @returns {object} { cgmData, cgmProfile, dayCount, exceedsLimit, dayStats, periodStats }
 */
function prepareCgmData (datastorage, settings, options) {
  var targetLow = (options && options.targetLow) || 70;
  var targetHigh = (options && options.targetHigh) || 180;
  var units = (options && options.units) || 'mg/dL';
  var pumpActionOptions = (options && options.pumpAction) || {};

  // Prepare Profile Data. We keep the raw profile store alongside the
  // LLM-formatted version because the pump-action pipeline needs the
  // raw { basal, carbratio, sens } arrays that formatProfileJSON flattens.
  var profile = null;
  var rawProfileStore = null;
  if (datastorage.profiles && datastorage.profiles[0]) {
    var rawProfile = datastorage.profiles[0];
    profile = prompts.formatProfileJSON(rawProfile);
    if (rawProfile.store && rawProfile.defaultProfile) {
      rawProfileStore = rawProfile.store[rawProfile.defaultProfile] || null;
    }
  }

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
  var dayKeys = Object.keys(datastorageAltered);
  var entriesByDay = {};

  for (var dk = 0; dk < dayKeys.length; dk++) {
    var key = dayKeys[dk];
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
    , profile: profile
    , meta: {
      days: days.length
      , from: dateFrom
      , to: dateTill
      , units: units
      , target_low: targetLow
      , target_high: targetHigh
    }
  };

  return {
    cgmData: cgmData
    , cgmProfile: profile
    , dayCount: days.length
    , exceedsLimit: days.length > 14
    , dayStats: allDayStats
    , periodStats: periodStats
    , pumpActionStats: pumpActionStats
    , episodeTiming: episodeTiming
  };
}

/**
 * Build a single API payload for the unified single-call LLM architecture.
 *
 * @param {object} cgmData - Prepared CGM data from prepareCgmData
 * @param {object} promptData - { system_prompt, user_prompt_template }
 * @param {object} settings - Plugin settings
 * @param {string} language - Nightscout LANGUAGE setting
 * @returns {object} Single API payload object
 */
function buildSinglePayload (cgmData, promptData, settings, language) {
  var schemas = require('./schemas');
  var responseFormat = schemas.unified_response_format;
  // Show only the inner schema to the LLM (not the {name, schema} wrapper)
  // to prevent the model from mirroring the envelope structure in its response.
  var responseFormatToken = JSON.stringify(responseFormat.json_schema.schema, null, 2);

  var systemPrompt = promptData.system_prompt || '';
  var userPrompt = promptData.user_prompt_template || '';

  // Build compact data representations for prompt
  var cgmDataJson = JSON.stringify({
    days: cgmData.days.map(function (d) {
      return { date: d.date, sgv: d.sgv, treatments: d.treatments };
    })
    , meta: cgmData.meta
  });

  // Per-day stats are sent to the LLM without the `time_blocks` array (24
  // hourly entries × N days bloats the payload for zero clinical value — the
  // same hourly view is available period-wide in `period.diurnal_patterns`).
  var statsJson = JSON.stringify({
    period: cgmData.period_stats
    , per_day: cgmData.days.map(function (d) {
      var stats = d.stats || {};
      var slim = {};
      for (var k in stats) {
        if (Object.prototype.hasOwnProperty.call(stats, k) && k !== 'time_blocks') {
          slim[k] = stats[k];
        }
      }
      return { date: d.date, stats: slim };
    })
  });

  var profileJson = cgmData.profile ? JSON.stringify(cgmData.profile) : '{}';

  // Validate language and map to full name so the LLM reliably follows it
  var languageNames = {
    en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian'
    , pt: 'Portuguese', nl: 'Dutch', sv: 'Swedish', da: 'Danish', nb: 'Norwegian'
    , fi: 'Finnish', pl: 'Polish', cs: 'Czech', sk: 'Slovak', hu: 'Hungarian'
    , ro: 'Romanian', bg: 'Bulgarian', hr: 'Croatian', sl: 'Slovenian', el: 'Greek'
    , tr: 'Turkish', ru: 'Russian', uk: 'Ukrainian', ja: 'Japanese', ko: 'Korean'
    , zh_cn: 'Chinese (Simplified)', zh_tw: 'Chinese (Traditional)', he: 'Hebrew', ar: 'Arabic'
  };
  var safeLanguage = languageNames[language] || 'English';

  // Treatment summary for prompt context
  var treatmentSummaryJson = cgmData.period_stats && cgmData.period_stats.treatment_summary
    ? JSON.stringify(cgmData.period_stats.treatment_summary)
    : '{}';

  // Replace placeholders
  var replacements = {
    '{{CGMDATA_JSON}}': cgmDataJson
    , '{{STATS_JSON}}': statsJson
    , '{{PROFILE_JSON}}': profileJson
    , '{{TREATMENT_SUMMARY}}': treatmentSummaryJson
    , '{{LANGUAGE}}': safeLanguage
    , '{{DATEFORMAT}}': 'dd.mm.yyyy'
    , '{{RETURNFORMAT}}': responseFormatToken
    , '{{TIMEFROM}}': cgmData.meta.from || ''
    , '{{TIMETILL}}': cgmData.meta.to || ''
    , '{{DAYS}}': String(cgmData.meta.days || 0)
  };

  var prompts = require('./prompts');
  userPrompt = prompts.replacePlaceholders(userPrompt, replacements);
  systemPrompt = prompts.replacePlaceholders(systemPrompt, replacements);

  return {
    model: settings.ai_llm_model || 'gpt-4o'
    , temperature: typeof settings.ai_llm_temperature === 'number' ? settings.ai_llm_temperature : 0
    , top_p: 0.1
    , max_tokens: typeof settings.ai_llm_max_tokens === 'number' ? settings.ai_llm_max_tokens : 4096
    , messages: [
      { role: 'system', content: systemPrompt }
      , { role: 'user', content: userPrompt }
    ]
    , response_format: responseFormat
  };
}

module.exports = {
  prepareCgmData: prepareCgmData
  , buildSinglePayload: buildSinglePayload
};
