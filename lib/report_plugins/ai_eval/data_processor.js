'use strict';

var prompts = require('./prompts');

/**
 * Build a single API payload for the unified single-call LLM architecture.
 *
 * @param {object} cgmData - Prepared CGM data from pump_analysis/data_processor prepareCgmData
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

  var formattedProfile = prompts.formatProfileJSON(cgmData.raw_profile);
  var profileJson = formattedProfile ? JSON.stringify(formattedProfile) : '{}';

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
  buildSinglePayload: buildSinglePayload
};
