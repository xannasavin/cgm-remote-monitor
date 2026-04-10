'use strict';

var prompts = require('./prompts');
var schemas = require('./schemas');

/**
 * Extract and format CGM data from Nightscout datastorage for AI evaluation.
 * Pure data transformation — no DOM, no window references.
 *
 * @param {object} datastorage - The Nightscout datastorage object from a report
 * @param {object} settings - Plugin settings (ai_llm_model, ai_llm_temperature, etc.)
 * @returns {object} { cgmData, interimPayloads, payload, schemas }
 */
function prepareCgmData (datastorage, settings) {
  var cgmData = {};

  // Move relevant metadata
  cgmData.numberOfDays = datastorage.alldays;

  // Prepare Profile Data
  if (datastorage.profiles && datastorage.profiles[0]) {
    cgmData.profile = prompts.formatProfileMarkdown(datastorage.profiles[0]);
  } else {
    cgmData.profile = '_no profile available_';
  }
  var cgmProfile = cgmData.profile;

  // Remove unnecessary keys from the datastorage to isolate day entries
  var keysToDelete = [
    'devicestatus'
    , 'combobolusTreatments'
    , 'tempbasalTreatments'
    , 'profileSwitchTreatments'
    , 'profiles'
    , 'allstatsrecords'
    , 'alldays'
    , 'treatments'
  ];

  // Work on a shallow copy to avoid mutating the original
  var datastorageAltered = Object.assign({}, datastorage);
  for (var d = 0; d < keysToDelete.length; d++) {
    delete datastorageAltered[keysToDelete[d]];
  }

  // Extract day-by-day data
  cgmData.days = [];
  var dates = [];
  var dayKeys = Object.keys(datastorageAltered);

  for (var dk = 0; dk < dayKeys.length; dk++) {
    var key = dayKeys[dk];
    var value = datastorageAltered[key];
    var day = {};

    day.date = key;
    dates.push(new Date(key).getTime());

    day.totalCarbs = value.dailyCarbs;
    day.totalBolus = 0;
    day.treatments = [];

    if (Array.isArray(value.treatments) && value.treatments.length > 0) {
      for (var t = 0; t < value.treatments.length; t++) {
        var treatment = {};
        var treatmentKeys = ['mills', 'carbs', 'insulin', 'notes'];
        var source = value.treatments[t];

        for (var tk = 0; tk < treatmentKeys.length; tk++) {
          var k = treatmentKeys[tk];
          if (source[k] != null) {
            treatment[k] = source[k];
            if (k === 'insulin') {
              day.totalBolus = day.totalBolus + source[k];
            }
          }
        }

        day.treatments.push(treatment);
      }
    }

    day.entries = [];

    if (Array.isArray(value.sgv) && value.sgv.length > 0) {
      for (var e = 0; e < value.sgv.length; e++) {
        var entry = {};
        var entryKeys = ['mills', 'sgv'];
        var sgvSource = value.sgv[e];

        for (var ek = 0; ek < entryKeys.length; ek++) {
          var ek2 = entryKeys[ek];
          if (sgvSource[ek2] != null) {
            entry[ek2] = sgvSource[ek2];
          }
        }

        if (entry.mills) {
          day.entries.push(entry);
        }
      }
    }

    cgmData.days.push(day);
  }

  // Date range
  if (dates.length > 0) {
    cgmData.dateFrom = dateToDDMMYYYY(new Date(Math.min.apply(null, dates)));
    cgmData.dateTill = dateToDDMMYYYY(new Date(Math.max.apply(null, dates)));
  }

  return {
    cgmData: cgmData
    , cgmProfile: cgmProfile
    , dayCount: cgmData.days.length
    , exceedsLimit: cgmData.days.length > 14
  };
}

/**
 * Build interim payloads for the two-phase LLM call pattern.
 *
 * @param {object} cgmData - Prepared CGM data from prepareCgmData
 * @param {string} cgmProfile - Formatted profile string
 * @param {object} promptData - { system_interim_prompt, user_interim_prompt_template }
 * @param {object} settings - Plugin settings
 * @returns {Array} Array of payload objects for interim API calls
 */
function buildInterimPayloads (cgmData, cgmProfile, promptData, settings) {
  var interim_response_format = schemas.interim_response_format;
  var interim_response_format_token = JSON.stringify(interim_response_format.json_schema, null, 2);

  var basePayload = {
    model: settings.ai_llm_model || 'gpt-4o'
    , temperature: typeof settings.ai_llm_temperature === 'number' ? settings.ai_llm_temperature : 0
    , top_p: 0.1
    , max_tokens: typeof settings.ai_llm_max_tokens === 'number' ? settings.ai_llm_max_tokens : 4096
    , response_format: interim_response_format
  };

  var userInterimTemplate = promptData.user_interim_prompt_template || '';
  var systemInterimContent = promptData.system_interim_prompt || '';

  // Replace profile and format placeholders in templates
  userInterimTemplate = prompts.replacePlaceholders(userInterimTemplate, {
    '{{PROFILE}}': cgmProfile
    , '{{INTERIMRETURNFORMAT}}': interim_response_format_token
  });
  systemInterimContent = prompts.replacePlaceholders(systemInterimContent, {
    '{{PROFILE}}': cgmProfile
    , '{{INTERIMRETURNFORMAT}}': interim_response_format_token
  });

  var interimPayloads = [];

  for (var i = 0; i < cgmData.days.length; i++) {
    var dayPayload = Object.assign({}, basePayload);
    dayPayload.messages = [];

    var tempUserContent = prompts.replacePlaceholders(userInterimTemplate, {
      '{{CGMDATA}}': prompts.generateMarkdownFromDay(cgmData.days[i])
      , '{{DATE}}': cgmData.days[i].date
    });

    dayPayload.messages = [
      { role: 'system', content: systemInterimContent }
      , { role: 'user', content: tempUserContent }
    ];

    interimPayloads.push(dayPayload);
  }

  return interimPayloads;
}

function dateToDDMMYYYY (date) {
  var dd = String(date.getDate()).padStart(2, '0');
  var mm = String(date.getMonth() + 1).padStart(2, '0');
  var yyyy = date.getFullYear();
  return dd + '.' + mm + '.' + yyyy;
}

module.exports = {
  prepareCgmData: prepareCgmData
  , buildInterimPayloads: buildInterimPayloads
  , dateToDDMMYYYY: dateToDDMMYYYY
};
