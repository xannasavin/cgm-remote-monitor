'use strict';

var dataProcessor = require('./data_processor');

// Single-slot memo so the Pump Analysis and AI Evaluation tabs share one
// computation per report. Keyed on the identity of the dayKeys array, which
// the report client rebuilds on every "Show" click.
var slot = null;

/**
 * @param {object} datastorage - The Nightscout datastorage object from a report
 * @param {object} settings - Plugin settings
 * @param {object} options - Report options
 * @param {string[]} dayKeys - The report's day keys; without an array nothing is cached
 * @returns {object} The prepareCgmData result
 */
function getAnalysis (datastorage, settings, options, dayKeys) {
  if (!Array.isArray(dayKeys)) {
    return dataProcessor.prepareCgmData(datastorage, settings, options, dayKeys);
  }
  if (slot && slot.dayKeys === dayKeys) {
    return slot.result;
  }
  var result = dataProcessor.prepareCgmData(datastorage, settings, options, dayKeys);
  slot = { dayKeys: dayKeys, result: result };
  return result;
}

function clear () {
  slot = null;
}

module.exports = {
  getAnalysis: getAnalysis
  , clear: clear
};
