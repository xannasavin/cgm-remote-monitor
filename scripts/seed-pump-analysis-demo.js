#!/usr/bin/env node

'use strict';

// Seeds 21 days of synthetic CGM and pump data (ending today) so the
// "pump_analysis" report can be checked in a browser: dawn rise with a weaker
// basal, a lunch carb ratio stronger than the profile, correction boluses,
// automatic boluses and a few late-evening hypos.
//
// Usage:
//   node scripts/dev-memory-server.js           # in-memory MongoDB + server
//   node scripts/seed-pump-analysis-demo.js     # seed it (second terminal)
//
// The target database is taken from MONGODB_URI or CUSTOMCONNSTR_mongo,
// default mongodb://127.0.0.1:27099/nightscout (the dev-memory-server one).
// Deterministic (seeded PRNG) and idempotent: every document carries
// enteredBy 'pump-analysis-demo' and previous demo documents are deleted first.

const moment = require('moment-timezone');
const { MongoClient } = require('mongodb');

const MARKER = 'pump-analysis-demo';
const TIMEZONE = 'Europe/Berlin';
const DAYS = 21;
const STEP_MIN = 5;
const DEFAULT_URI = 'mongodb://127.0.0.1:27099/nightscout';

// Profile values (mg/dl)
const CARB_RATIO = 10;
const SENS = 45;
const BASAL_NIGHT = 0.6;
const BASAL_DAY = 0.8;
const TEMP_BASAL = 0.9;
const TEMP_BASAL_DAY_SHARE = 0.8;

function mulberry32 (seed) {
  let a = seed >>> 0;
  return function next () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round (v, digits) {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

// Gamma-like bump: peaks with value amp at hoursAfter == tau
function bump (hoursAfter, tau, amp) {
  if (hoursAfter <= 0) return 0;
  const x = hoursAfter / tau;
  return amp * x * Math.exp(1 - x);
}

function gauss (h, center, sigma, amp) {
  const d = (h - center) / sigma;
  return amp * Math.exp(-0.5 * d * d);
}

function smoothstep (x) {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

function main () {
  const uri = process.env.MONGODB_URI || process.env.CUSTOMCONNSTR_mongo || DEFAULT_URI;
  const rand = mulberry32(20261103);

  const today = moment.tz(TIMEZONE).startOf('day');
  const firstDay = today.clone().subtract(DAYS - 1, 'days');
  const now = moment.tz(TIMEZONE);

  // Day plan: which days have the temp basal, a hypo evening, a big dinner
  const dayPlan = [];
  for (let d = 0; d < DAYS; d++) {
    dayPlan.push({
      tempBasal: rand() < TEMP_BASAL_DAY_SHARE
      , hypo: false
      , bigDinner: false
    });
  }
  [3, 8, 13, 18].forEach(function markHypo (d) { dayPlan[d].hypo = true; });
  [1, 5, 10, 15, 19].forEach(function markBig (d) { dayPlan[d].bigDinner = true; });

  const entries = [];
  const treatments = [];

  function treatment (time, props) {
    const doc = Object.assign({
      created_at: time.clone().utc().toISOString()
      , utcOffset: time.utcOffset()
      , enteredBy: MARKER
    }, props);
    treatments.push(doc);
    return doc;
  }

  let noise = 0;
  for (let d = 0; d < DAYS; d++) {
    const dayStart = firstDay.clone().add(d, 'days').startOf('day');
    const plan = dayPlan[d];

    const lunchCarbs = 40 + Math.round(rand() * 20);
    const dinnerCarbs = plan.bigDinner ? 100 + Math.round(rand() * 10) : 55 + Math.round(rand() * 20);
    // lunch insulin is 1:6.5 while the profile says 1:10 (stronger than profile)
    const lunchInsulin = round(lunchCarbs / 6.5, 1);
    const dinnerInsulin = round(dinnerCarbs / CARB_RATIO, 1);
    const lunchAt = 12.5 + (rand() - 0.5) * 0.5;
    const dinnerAt = 19 + (rand() - 0.5) * 0.5;

    // CGM
    for (let m = 0; m < 24 * 60; m += STEP_MIN) {
      const time = dayStart.clone().add(m, 'minutes');
      if (time.isAfter(now)) break;
      const h = m / 60;
      let bg = 112;
      // dawn rise 02-06 (a bit weaker on days with the temp basal), dropped by the 06:00 bolus
      const dawnAmp = plan.tempBasal ? 55 : 75;
      if (h < 6) bg += dawnAmp * smoothstep((h - 1.5) / 4.5);
      else bg += dawnAmp * Math.exp(-(h - 6) / 1.4);
      // 06:00 bolus (6 g) only softens the morning
      bg += bump(h - 6, 1, 8);
      // lunch: smaller rise, then an undershoot because the insulin is stronger than the profile
      bg += bump(h - lunchAt, 0.9, lunchCarbs * 1.0);
      bg -= bump(h - lunchAt, 2.2, 38);
      // dinner
      bg += bump(h - dinnerAt, 1, dinnerCarbs * (plan.bigDinner ? 2.0 : 1.15));
      bg -= bump(h - dinnerAt, 3, plan.bigDinner ? 48 : 18);
      // hypo evening
      if (plan.hypo) bg += gauss(h, 22.8, 0.45, -78);
      // smooth noise
      noise = noise * 0.85 + (rand() - 0.5) * 7;
      bg += noise;
      bg = Math.max(40, Math.min(400, Math.round(bg)));
      entries.push({
        type: 'sgv'
        , sgv: bg
        , direction: 'Flat'
        , device: MARKER
        , enteredBy: MARKER
        , date: time.valueOf()
        , dateString: time.clone().utc().toISOString()
        , sysTime: time.clone().utc().toISOString()
        , utcOffset: time.utcOffset()
        , mills: time.valueOf()
      });
    }

    // Temp basal 02-06
    if (plan.tempBasal) {
      treatment(dayStart.clone().hour(2), {
        eventType: 'Temp Basal'
        , absolute: TEMP_BASAL
        , rate: TEMP_BASAL
        , duration: 240
        , notes: 'Temp Rate Start'
      });
    }

    // Dawn bolus 06:00, 1.2 U with 6 g carbs
    treatment(dayStart.clone().hour(6), {
      eventType: 'Meal Bolus', insulin: 1.2, carbs: 6, notes: 'Dawn bolus'
    });
    // Lunch / dinner
    treatment(dayStart.clone().add(Math.round(lunchAt * 60), 'minutes'), {
      eventType: 'Meal Bolus', insulin: lunchInsulin, carbs: lunchCarbs
    });
    treatment(dayStart.clone().add(Math.round(dinnerAt * 60), 'minutes'), {
      eventType: d % 3 === 0 ? 'Combo Bolus' : 'Meal Bolus', insulin: dinnerInsulin, carbs: dinnerCarbs
    });

    // Corrections once BG > 240, at most one per two hours
    let lastCorrection = null;
    entries.filter(function ofDay (e) { return e.date >= dayStart.valueOf() && e.date < dayStart.valueOf() + 864e5; })
      .forEach(function maybeCorrect (e) {
        if (e.sgv <= 240) return;
        if (lastCorrection !== null && e.date - lastCorrection < 2 * 3600e3) return;
        lastCorrection = e.date;
        treatment(moment.tz(e.date, TIMEZONE), {
          eventType: 'Correction Bolus', insulin: round((e.sgv - 120) / SENS, 1)
        });
      });

    // Automatic boluses (3 to 5 per day)
    const autoCount = 3 + Math.floor(rand() * 3);
    for (let a = 0; a < autoCount; a++) {
      const minute = Math.floor(rand() * 24 * 12) * 5;
      treatment(dayStart.clone().add(minute, 'minutes'), {
        eventType: 'Correction Bolus', insulin: round(0.1 + rand() * 0.3, 2), notes: 'Automatic Bolus'
      });
    }
  }

  const futureCut = now.valueOf();
  const validTreatments = treatments.filter(function notFuture (t) { return new Date(t.created_at).getTime() <= futureCut; });

  const profile = {
    defaultProfile: 'Default'
    , startDate: firstDay.clone().subtract(30, 'days').utc().toISOString()
    , mills: firstDay.clone().subtract(30, 'days').valueOf()
    , units: 'mg/dl'
    , enteredBy: MARKER
    , created_at: firstDay.clone().subtract(30, 'days').utc().toISOString()
    , store: {
      Default: {
        dia: 4
        , carbratio: [{ time: '00:00', value: CARB_RATIO, timeAsSeconds: 0 }]
        , carbs_hr: 20
        , delay: 20
        , sens: [{ time: '00:00', value: SENS, timeAsSeconds: 0 }]
        , timezone: TIMEZONE
        , basal: [
          { time: '00:00', value: BASAL_DAY, timeAsSeconds: 0 }
          , { time: '02:00', value: BASAL_NIGHT, timeAsSeconds: 7200 }
          , { time: '06:00', value: BASAL_DAY, timeAsSeconds: 21600 }
        ]
        , target_low: [{ time: '00:00', value: 70, timeAsSeconds: 0 }]
        , target_high: [{ time: '00:00', value: 180, timeAsSeconds: 0 }]
        , startDate: firstDay.clone().subtract(30, 'days').utc().toISOString()
        , units: 'mg/dl'
      }
    }
  };

  return { uri: uri, entries: entries, treatments: validTreatments, profile: profile };
}

async function run () {
  const data = main();
  const client = new MongoClient(data.uri);
  await client.connect();
  const db = client.db();
  const filter = { enteredBy: MARKER };
  const removed = {
    entries: (await db.collection('entries').deleteMany(filter)).deletedCount
    , treatments: (await db.collection('treatments').deleteMany(filter)).deletedCount
    , profile: (await db.collection('profile').deleteMany(filter)).deletedCount
  };
  await db.collection('entries').insertMany(data.entries);
  await db.collection('treatments').insertMany(data.treatments);
  await db.collection('profile').insertOne(data.profile);
  console.log('[seed] db ' + db.databaseName + ': removed ' + JSON.stringify(removed));
  console.log('[seed] inserted ' + data.entries.length + ' entries, ' + data.treatments.length + ' treatments, 1 profile');
  const low = data.entries.filter(function isLow (e) { return e.sgv < 70; }).length;
  const high = data.entries.filter(function isHigh (e) { return e.sgv > 240; }).length;
  const kinds = {};
  data.treatments.forEach(function count (t) {
    const k = t.eventType + (t.notes === 'Automatic Bolus' ? ' (auto)' : '');
    kinds[k] = (kinds[k] || 0) + 1;
  });
  console.log('[seed] CGM readings < 70: ' + low + ', > 240: ' + high);
  console.log('[seed] treatments: ' + JSON.stringify(kinds));
  await client.close();
}

run().catch(function onError (err) {
  console.error('[seed] ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
