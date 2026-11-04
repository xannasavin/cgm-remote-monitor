'use strict';

var statistics = require('../../statistics');
var rules = require('./recommendation_rules');
var glucoseUnits = require('./glucose_units');

var MIN_MS = 60 * 1000;
var BG_MAX_AGE_MIN = 10;

/**
 * Local wall-clock time of a treatment. Mirrors parseTreatmentLocal in
 * lib/statistics.js, but falls back to t.mills when created_at is missing.
 *
 * @param {object} t - Nightscout treatment
 * @returns {{mills: number, localHour: number, localMinute: number, dateKey: string}|null}
 */
function localTime (t) {
  if (!t) return null;
  var mills = null;
  if (t.created_at) {
    mills = new Date(t.created_at).getTime();
  }
  if (mills === null || !isFinite(mills)) {
    mills = (typeof t.mills === 'number' && isFinite(t.mills)) ? t.mills : null;
  }
  if (mills === null) return null;
  var offsetMin = typeof t.utcOffset === 'number' ? t.utcOffset : 0;
  var d = new Date(mills + offsetMin * MIN_MS);
  var dateKey = d.getUTCFullYear() + '-'
    + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(d.getUTCDate()).padStart(2, '0');
  return {
    mills: mills
    , localHour: d.getUTCHours()
    , localMinute: d.getUTCMinutes()
    , dateKey: dateKey
  };
}

function isUserBolus (t) {
  return !!t && statistics.isUserBolusEvent(t) && t.insulin > 0;
}

function carbsOf (t) {
  var c = t ? Number(t.carbs) : 0;
  return isFinite(c) && c > 0 ? c : 0;
}

// Collect user boluses and carb entries; assign separate carb entries to the
// nearest user bolus within CARB_MATCH_MIN.
function collect (treatments) {
  var boluses = [];
  var entries = [];
  var list = Array.isArray(treatments) ? treatments : [];
  var i;

  for (i = 0; i < list.length; i++) {
    var t = list[i];
    var lt = localTime(t);
    if (!lt) continue;
    if (isUserBolus(t)) {
      boluses.push({ lt: lt, insulin: Number(t.insulin), ownCarbs: carbsOf(t), carbMills: [], carbs: 0 });
    }
  }
  boluses.sort(function byMills (a, b) { return a.lt.mills - b.lt.mills; });

  var matchMs = rules.CARB_MATCH_MIN * MIN_MS;
  for (i = 0; i < list.length; i++) {
    var c = list[i];
    var carbs = carbsOf(c);
    if (carbs <= 0) continue;
    var clt = localTime(c);
    if (!clt) continue;
    var entry = { mills: clt.mills, carbs: carbs, consumedBy: null };
    entries.push(entry);

    if (isUserBolus(c)) {
      // The carbs travel with the bolus itself.
      entry.consumedBy = clt.mills;
      for (var k = 0; k < boluses.length; k++) {
        if (boluses[k].lt.mills === clt.mills && boluses[k].ownCarbs === carbs && boluses[k].carbMills.indexOf(clt.mills) === -1) {
          boluses[k].carbs += carbs;
          boluses[k].carbMills.push(clt.mills);
          break;
        }
      }
      continue;
    }

    var best = null;
    var bestDist = Infinity;
    for (var j = 0; j < boluses.length; j++) {
      var dist = Math.abs(boluses[j].lt.mills - clt.mills);
      if (dist <= matchMs && dist < bestDist) {
        best = boluses[j];
        bestDist = dist;
      }
    }
    if (best) {
      entry.consumedBy = best.lt.mills;
      best.carbs += carbs;
      best.carbMills.push(clt.mills);
    }
  }
  entries.sort(function byMills (a, b) { return a.mills - b.mills; });
  return { boluses: boluses, entries: entries };
}

/**
 * Carb entries (treatments with carbs > 0) with the bolus they were assigned to.
 *
 * @param {object[]} treatments
 * @returns {Array<{mills: number, carbs: number, consumedBy: number|null}>}
 */
function carbEntries (treatments) {
  return collect(treatments).entries;
}

// Last reading at or before mills, no older than BG_MAX_AGE_MIN. Returns index or -1.
function lastReadingIndex (readings, mills) {
  var lo = 0;
  var hi = readings.length - 1;
  var found = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (readings[mid].mills <= mills) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (found === -1) return -1;
  if (mills - readings[found].mills > BG_MAX_AGE_MIN * MIN_MS) return -1;
  return found;
}

function bgContext (readings, mills) {
  var idx = lastReadingIndex(readings, mills);
  if (idx === -1) return { bg: null, fastRise: false };
  var bg = readings[idx].sgv;
  var fastRise = false;
  if (idx > 0) {
    var dt = readings[idx].mills - readings[idx - 1].mills;
    if (dt > 0 && dt <= BG_MAX_AGE_MIN * MIN_MS) {
      var per5 = (readings[idx].sgv - readings[idx - 1].sgv) / (dt / (5 * MIN_MS));
      fastRise = per5 >= rules.FAST_RISE_MGDL_PER_5MIN;
    }
  }
  return { bg: typeof bg === 'number' ? bg : null, fastRise: fastRise };
}

/**
 * Classify every user bolus as dawn, meal, correction or unclear (spec 4).
 *
 * @param {object[]} treatments
 * @param {Array<{mills: number, sgv: number}>} readings - mg/dl, ascending
 * @returns {Array<{mills: number, localHour: number, dateKey: string, insulin: number, carbs: number, cls: string, bgAtBolus: number|null, fastRise: boolean, carbMills: number[]}>}
 */
function classifyUserBoluses (treatments, readings) {
  var data = collect(treatments);
  var rs = Array.isArray(readings) ? readings : [];

  return data.boluses.map(function classifyOne (b) {
    var ctx = bgContext(rs, b.lt.mills);
    var inDawn = b.lt.localHour >= rules.DAWN_WINDOW.startHour && b.lt.localHour < rules.DAWN_WINDOW.endHour;
    var cls;
    if (inDawn && b.insulin <= rules.DAWN_MAX_U && b.carbs <= rules.DAWN_MAX_CARBS_G) {
      cls = 'dawn';
    } else if (b.carbs > 0) {
      cls = 'meal';
    } else if ((ctx.bg !== null && ctx.bg > rules.CORRECTION_BG_MGDL) || ctx.fastRise) {
      cls = 'correction';
    } else {
      cls = 'unclear';
    }
    return {
      mills: b.lt.mills
      , localHour: b.lt.localHour
      , dateKey: b.lt.dateKey
      , insulin: b.insulin
      , carbs: b.carbs
      , cls: cls
      , bgAtBolus: ctx.bg
      , fastRise: ctx.fastRise
      , carbMills: b.carbMills
    };
  });
}

/**
 * Insulin sensitivity schedule lookup in mg/dl per U. Units come from the
 * profile store entry, falling back to the profile document.
 *
 * @param {object} profile - profile document (may carry units)
 * @param {object} profileStore - profile store entry with a sens schedule
 * @returns {function(number, number): (number|null)}
 */
function profileSensMgdl (profile, profileStore) {
  var units = (profileStore && profileStore.units) || (profile && profile.units);
  var lookup = statistics.buildProfileScheduleLookup(profileStore, 'sens');
  return function sensAt (hour, minute) {
    var v = lookup(hour, minute);
    return v === null ? null : glucoseUnits.toMgdl(v, units);
  };
}

module.exports = {
  profileSensMgdl: profileSensMgdl
  , localTime: localTime
  , classifyUserBoluses: classifyUserBoluses
  , carbEntries: carbEntries
};
