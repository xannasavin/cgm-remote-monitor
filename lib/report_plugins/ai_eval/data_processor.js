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

  // Prepare Profile Data
  var profile = null;
  if (datastorage.profiles && datastorage.profiles[0]) {
    profile = prompts.formatProfileJSON(datastorage.profiles[0]);
  }

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

  // Extract day-by-day data in compact format
  var days = [];
  var allDayStats = [];
  var dayKeys = Object.keys(datastorageAltered);

  for (var dk = 0; dk < dayKeys.length; dk++) {
    var key = dayKeys[dk];
    var value = datastorageAltered[key];

    // F14: Skip non-object day entries (guard against null/primitive values)
    if (!value || typeof value !== 'object') continue;

    // Compact SGV: [[mills, sgv], ...]
    var sgv = [];
    var sgvRecords = [];
    if (Array.isArray(value.sgv) && value.sgv.length > 0) {
      for (var e = 0; e < value.sgv.length; e++) {
        if (value.sgv[e].mills && value.sgv[e].sgv != null) {
          sgv.push([value.sgv[e].mills, value.sgv[e].sgv]);
          sgvRecords.push({ mills: value.sgv[e].mills, sgv: value.sgv[e].sgv });
        }
      }
    }

    // Compact treatments: [[mills, carbs, insulin, notes], ...]
    // Notes are JSON-encoded strings (Finding #8: prompt injection mitigation)
    var treatments = [];
    var treatmentObjs = [];
    if (Array.isArray(value.treatments) && value.treatments.length > 0) {
      for (var t = 0; t < value.treatments.length; t++) {
        var src = value.treatments[t];
        var tr = [
          src.mills || 0
          , src.carbs || 0
          , src.insulin || 0
          , src.notes ? String(src.notes) : null
        ];
        treatments.push(tr);
        treatmentObjs.push(src);
      }
    }

    // Compute client-side statistics for this day
    // F9: Pass UTC offset so time blocks use local time in the browser
    var utcOffset = typeof window !== 'undefined' ? -(new Date().getTimezoneOffset() / 60) : 0;
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

  // Period statistics
  var periodStats = statistics.computePeriodStats(allDayStats);

  // Date range
  var dateFrom = days.length > 0 ? days[0].date : null;
  var dateTill = days.length > 0 ? days[days.length - 1].date : null;

  // Build compact JSON for LLM
  var cgmData = {
    days: days
    , period_stats: periodStats
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
  var responseFormatToken = JSON.stringify(responseFormat.json_schema, null, 2);

  var systemPrompt = promptData.system_prompt || '';
  var userPrompt = promptData.user_prompt_template || '';

  // Build compact data representations for prompt
  var cgmDataJson = JSON.stringify({
    days: cgmData.days.map(function (d) {
      return { date: d.date, sgv: d.sgv, treatments: d.treatments };
    })
    , meta: cgmData.meta
  });

  var statsJson = JSON.stringify({
    period: cgmData.period_stats
    , per_day: cgmData.days.map(function (d) {
      return { date: d.date, stats: d.stats };
    })
  });

  var profileJson = cgmData.profile ? JSON.stringify(cgmData.profile) : '{}';

  // Validate language against whitelist
  var validLanguages = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'sl', 'el', 'tr', 'ru', 'uk', 'ja', 'ko', 'zh_cn', 'zh_tw', 'he', 'ar'];
  var safeLanguage = validLanguages.indexOf(language) !== -1 ? language : 'en';

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
