'use strict';

/**
 * Prompt utilities: placeholder replacement and data formatting.
 * Phase 2: JSON-based formatting replaces markdown tables.
 */

function replacePlaceholders (template, replacements) {
  var result = template;
  var keys = Object.keys(replacements);
  for (var i = 0; i < keys.length; i++) {
    result = result.replaceAll(keys[i], replacements[keys[i]]);
  }
  return result;
}

/**
 * Format Nightscout profile as structured JSON object.
 * Replaces formatProfileMarkdown from Phase 1.
 *
 * @param {object} profile - Nightscout profile object
 * @returns {object} Structured profile data
 */
function formatProfileJSON (profile) {
  if (!profile || !profile.store || !profile.defaultProfile) {
    return null;
  }

  var store = profile.store[profile.defaultProfile];
  if (!store) return null;

  return {
    start_date: profile.startDate || null
    , units: profile.units || 'mg/dL'
    , basal: (store.basal || []).map(function (entry) {
      return { time: entry.time, value: entry.value };
    })
    , carbratio: (store.carbratio || []).map(function (entry) {
      return { time: entry.time, value: entry.value };
    })
    , sensitivity: (store.sens || []).map(function (entry) {
      return { time: entry.time, value: entry.value };
    })
    , target_low: (store.target_low || []).map(function (entry) {
      return { time: entry.time, value: entry.value };
    })
    , target_high: (store.target_high || []).map(function (entry) {
      return { time: entry.time, value: entry.value };
    })
  };
}

module.exports = {
  replacePlaceholders: replacePlaceholders
  , formatProfileJSON: formatProfileJSON
};
