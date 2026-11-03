'use strict';

// Shared glucose helpers. Everything is computed internally in mg/dl;
// conversion happens only at the edges (input and display).

// Same factor as lib/constants.json (used by glucosedistribution.js).
var MGDL_PER_MMOL = 18.01559;

function isMmol (units) {
  return units === 'mmol' || units === 'mmol/L';
}

function toMgdl (value, units) {
  return isMmol(units) ? value * MGDL_PER_MMOL : value;
}

function fromMgdl (value, units) {
  return isMmol(units) ? value / MGDL_PER_MMOL : value;
}

// Glucose Management Indicator (%) from the mean glucose in mg/dl.
function computeGmi (meanMgdl) {
  if (meanMgdl === null || meanMgdl === undefined || Number.isNaN(meanMgdl)) return null;
  return Math.round((3.31 + 0.02392 * meanMgdl) * 10) / 10;
}

module.exports = {
  MGDL_PER_MMOL: MGDL_PER_MMOL
  , toMgdl: toMgdl
  , fromMgdl: fromMgdl
  , computeGmi: computeGmi
};
