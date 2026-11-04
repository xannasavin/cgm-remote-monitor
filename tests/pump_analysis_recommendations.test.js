'use strict';

require('should');

describe('pump_analysis recommendations', function () {

  describe('profileSensMgdl', function () {
    var bc = require('../lib/report_plugins/pump_analysis/bolus_classifier');

    it('should convert mmol sens to mg/dl', function () {
      var store = { units: 'mmol', sens: [{ time: '00:00', value: 2.5 }] };
      bc.profileSensMgdl({}, store)(12, 0).should.be.approximately(45, 0.1);
    });

    it('should read units from the profile document', function () {
      var store = { sens: [{ time: '00:00', value: 2.5 }] };
      bc.profileSensMgdl({ units: 'mmol/L' }, store)(3, 0).should.be.approximately(45, 0.1);
    });

    it('should keep mg/dl sens unchanged and step by time', function () {
      var store = { units: 'mg/dl', sens: [{ time: '00:00', value: 40 }, { time: '12:00', value: 50 }] };
      var lookup = bc.profileSensMgdl({}, store);
      lookup(6, 0).should.equal(40);
      lookup(13, 0).should.equal(50);
    });

    it('should return null without a sens schedule', function () {
      (bc.profileSensMgdl({}, { basal: [] })(1, 0) === null).should.equal(true);
    });
  });

  describe('profile schedule lookup', function () {
    var statistics = require('../lib/statistics');

    it('should return null for an empty carbratio schedule', function () {
      (statistics.buildProfileScheduleLookup({ carbratio: [] }, 'carbratio')(12, 0) === null).should.equal(true);
    });

    it('should carry the last segment over midnight when the schedule starts after 00:00', function () {
      var lookup = statistics.buildProfileScheduleLookup({ carbratio: [{ time: '22:00', value: 8 }, { time: '06:00', value: 12 }] }, 'carbratio');
      lookup(0, 0).should.equal(8);
      lookup(5, 59).should.equal(8);
      lookup(6, 0).should.equal(12);
      lookup(21, 59).should.equal(12);
      lookup(22, 0).should.equal(8);
      lookup(23, 59).should.equal(8);
    });
  });

  describe('bolus_classifier', function () {
    var bc = require('../lib/report_plugins/pump_analysis/bolus_classifier');

    // utcOffset 60 => local = UTC + 1h
    function utcFor (localHour, localMin) {
      var h = localHour - 1;
      return '2026-10-10T' + String(h).padStart(2, '0') + ':' + String(localMin || 0).padStart(2, '0') + ':00.000Z';
    }
    function bolus (localHour, localMin, insulin, extra) {
      return Object.assign({
        eventType: 'Correction Bolus'
        , created_at: utcFor(localHour, localMin)
        , utcOffset: 60
        , insulin: insulin
      }, extra || {});
    }
    function carbEntry (localHour, localMin, carbs) {
      return { eventType: 'Carb Correction', created_at: utcFor(localHour, localMin), utcOffset: 60, carbs: carbs };
    }
    function reading (localHour, localMin, sgv) {
      return { mills: new Date(utcFor(localHour, localMin)).getTime(), sgv: sgv };
    }
    function classify (treatments, readings) {
      return bc.classifyUserBoluses(treatments, readings || []);
    }

    describe('localTime', function () {
      it('should use created_at and utcOffset', function () {
        var r = bc.localTime(bolus(6, 30, 1));
        r.localHour.should.equal(6);
        r.localMinute.should.equal(30);
        r.dateKey.should.equal('2026-10-10');
      });

      it('should fall back to mills and utcOffset', function () {
        var r = bc.localTime({ mills: new Date(utcFor(6, 30)).getTime(), utcOffset: 60 });
        r.localHour.should.equal(6);
        r.localMinute.should.equal(30);
      });

      it('should return null without any time', function () {
        (bc.localTime({ insulin: 1 }) === null).should.equal(true);
        (bc.localTime(null) === null).should.equal(true);
      });
    });

    describe('dawn', function () {
      it('should classify 1.2 U without carbs at 06:30 as dawn', function () {
        classify([bolus(6, 30, 1.2)])[0].cls.should.equal('dawn');
      });

      it('should classify 1.2 U with 6 g at 06:30 as dawn', function () {
        classify([bolus(6, 30, 1.2, { carbs: 6 })])[0].cls.should.equal('dawn');
      });

      it('should classify exactly 1.5 U with exactly 10 g at 06:30 as dawn', function () {
        classify([bolus(6, 30, 1.5, { carbs: 10 })])[0].cls.should.equal('dawn');
      });

      it('should not classify 11 g at 06:30 as dawn', function () {
        classify([bolus(6, 30, 1.2, { carbs: 11 })])[0].cls.should.equal('meal');
      });

      it('should classify 1.6 U without carbs at 06:30 and BG 150 as unclear', function () {
        classify([bolus(6, 30, 1.6)], [reading(6, 28, 150)])[0].cls.should.equal('unclear');
      });

      it('should classify 1.2 U without carbs at 10:00 and BG 150 as unclear', function () {
        classify([bolus(10, 0, 1.2)], [reading(9, 58, 150)])[0].cls.should.equal('unclear');
      });
    });

    describe('meal', function () {
      it('should match a carb entry 20 min later', function () {
        var list = classify([bolus(12, 0, 4), carbEntry(12, 20, 48)]);
        list.length.should.equal(1);
        list[0].cls.should.equal('meal');
        list[0].carbs.should.equal(48);
        list[0].carbMills.length.should.equal(1);
      });

      it('should not match a carb entry 40 min later', function () {
        var list = classify([bolus(12, 0, 4), carbEntry(12, 40, 48)], [reading(11, 58, 150)]);
        list[0].cls.should.not.equal('meal');
        list[0].carbs.should.equal(0);
      });

      it('should use carbs carried by the bolus itself', function () {
        var list = classify([bolus(12, 0, 4, { eventType: 'Meal Bolus', carbs: 40 })]);
        list[0].cls.should.equal('meal');
        list[0].carbs.should.equal(40);
      });

      it('should report consumedBy in carbEntries', function () {
        var t = [carbEntry(18, 0, 30), carbEntry(12, 20, 48), bolus(12, 0, 4)];
        var entries = bc.carbEntries(t);
        var boluses = classify(t);
        entries.length.should.equal(2);
        entries[0].mills.should.be.below(entries[1].mills);
        entries[0].mills.should.equal(new Date(utcFor(12, 20)).getTime());
        entries[0].consumedBy.should.equal(boluses[0].mills);
        (entries[1].consumedBy === null).should.equal(true);
      });

      it('should set consumedBy to its own mills for a carb-carrying bolus', function () {
        var b = bolus(12, 0, 4, { eventType: 'Meal Bolus', carbs: 40 });
        var entries = bc.carbEntries([b]);
        entries.length.should.equal(1);
        entries[0].carbs.should.equal(40);
        entries[0].consumedBy.should.equal(new Date(utcFor(12, 0)).getTime());
        entries[0].consumedBy.should.equal(entries[0].mills);
      });

      it('should give an equidistant carb entry to the earlier bolus', function () {
        var t = [bolus(12, 40, 4), carbEntry(12, 20, 48), bolus(12, 0, 4)];
        var list = classify(t, [reading(11, 58, 150), reading(12, 38, 150)]);
        list.length.should.equal(2);
        list[0].mills.should.equal(new Date(utcFor(12, 0)).getTime());
        list[0].cls.should.equal('meal');
        list[0].carbs.should.equal(48);
        list[1].carbs.should.equal(0);
        list[1].cls.should.not.equal('meal');
      });

      it('should keep a dawn bolus with a separate small carb entry as dawn', function () {
        var t = [bolus(6, 30, 1.2), carbEntry(6, 40, 6)];
        var list = classify(t);
        list.length.should.equal(1);
        list[0].cls.should.equal('dawn');
        list[0].carbs.should.equal(6);
        bc.carbEntries(t)[0].consumedBy.should.equal(list[0].mills);
      });
    });

    describe('correction', function () {
      it('should classify BG 250 without carbs as correction', function () {
        var r = classify([bolus(14, 0, 2)], [reading(13, 58, 250)])[0];
        r.cls.should.equal('correction');
        r.bgAtBolus.should.equal(250);
      });

      it('should not classify BG exactly 240 as correction', function () {
        classify([bolus(14, 0, 2)], [reading(13, 58, 240)])[0].cls.should.equal('unclear');
      });

      it('should classify BG 241 as correction', function () {
        classify([bolus(14, 0, 2)], [reading(13, 58, 241)])[0].cls.should.equal('correction');
      });

      it('should flag exactly +8 per 5 min as fastRise', function () {
        var r = classify([bolus(14, 0, 2)], [reading(13, 50, 170), reading(13, 55, 178)])[0];
        r.fastRise.should.equal(true);
        r.cls.should.equal('correction');
      });

      it('should classify fast rise 170 to 180 as correction', function () {
        var r = classify([bolus(14, 0, 2)], [reading(13, 50, 170), reading(13, 55, 180)])[0];
        r.cls.should.equal('correction');
        r.fastRise.should.equal(true);
      });

      it('should classify 170 to 176 as unclear', function () {
        var r = classify([bolus(14, 0, 2)], [reading(13, 50, 170), reading(13, 55, 176)])[0];
        r.cls.should.equal('unclear');
        r.fastRise.should.equal(false);
      });

      it('should leave bgAtBolus null when the last reading is older than 10 min', function () {
        var r = classify([bolus(14, 0, 2)], [reading(13, 40, 250)])[0];
        (r.bgAtBolus === null).should.equal(true);
        r.cls.should.equal('unclear');
      });
    });

    describe('exclusions', function () {
      it('should skip automatic boluses', function () {
        classify([bolus(14, 0, 1, { notes: 'Automatic Bolus' })]).length.should.equal(0);
      });

      it('should skip cannula filled notes', function () {
        classify([{ eventType: 'Note', notes: 'Cannula Filled (0.7u primed)', insulin: 0.7, created_at: utcFor(14, 0), utcOffset: 60 }]).length.should.equal(0);
      });

      it('should skip a Cannula Filled event type', function () {
        classify([{ eventType: 'Cannula Filled', insulin: 0.7, created_at: utcFor(14, 0), utcOffset: 60 }]).length.should.equal(0);
      });

      it('should skip UserAborted with zero insulin', function () {
        classify([bolus(14, 0, 0, { notes: 'UserAborted' })]).length.should.equal(0);
      });
    });

    describe('mills only', function () {
      it('should classify a treatment without created_at', function () {
        var t = { eventType: 'Correction Bolus', mills: new Date(utcFor(6, 30)).getTime(), utcOffset: 60, insulin: 1.2 };
        var list = classify([t]);
        list.length.should.equal(1);
        list[0].cls.should.equal('dawn');
        list[0].localHour.should.equal(6);
      });
    });
  });

  describe('basal_recommendations', function () {
    var bc = require('../lib/report_plugins/pump_analysis/bolus_classifier');
    var br = require('../lib/report_plugins/pump_analysis/basal_recommendations');
    var u = require('../lib/report_plugins/pump_analysis/recommendation_utils');

    var MIN = 60 * 1000;
    var HOUR = 60 * MIN;
    var OFFSET_MIN = 60; // local = UTC + 1h
    var DAYS = 14;
    var PUMP_DAYS = 12;

    var store = {
      units: 'mg/dl'
      , basal: [
        { time: '00:00', value: 0.8 }
        , { time: '02:00', value: 0.6 }
        , { time: '06:00', value: 0.8 }
      ]
      , sens: [{ time: '00:00', value: 30 }]
    };

    function dayKey (dayIdx) {
      var d = new Date(Date.UTC(2026, 9, 1 + dayIdx));
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    // Absolute ms for a local wall-clock time.
    function at (dayIdx, hour, minute) {
      return Date.UTC(2026, 9, 1 + dayIdx, hour, minute || 0) - OFFSET_MIN * MIN;
    }
    function tempBasal (dayIdx, hour, durationMin, rate) {
      var ms = at(dayIdx, hour, 0);
      return { eventType: 'Temp Basal', created_at: new Date(ms).toISOString(), mills: ms, absolute: rate, duration: durationMin, utcOffset: OFFSET_MIN };
    }
    function bolusAt (dayIdx, hour, minute, insulin, extra) {
      var ms = at(dayIdx, hour, minute);
      return Object.assign({ eventType: 'Correction Bolus', created_at: new Date(ms).toISOString(), mills: ms, utcOffset: OFFSET_MIN, insulin: insulin }, extra || {});
    }
    function carbsAt (dayIdx, hour, minute, carbs) {
      var ms = at(dayIdx, hour, minute);
      return { eventType: 'Carb Correction', created_at: new Date(ms).toISOString(), mills: ms, utcOffset: OFFSET_MIN, carbs: carbs };
    }

    // Flat BG 130 every 5 min, from the day before the first day to the day after the last.
    // bgFn(dayIdx, hour, minute) may override the value or return null to drop a reading.
    function readings (bgFn) {
      var byDay = {};
      for (var di = -1; di <= DAYS; di++) {
        var key = dayKey(di);
        byDay[key] = [];
        for (var m = 0; m < 24 * 60; m += 5) {
          var h = Math.floor(m / 60);
          var v = bgFn ? bgFn(di, h, m % 60) : 130;
          if (v === null) continue;
          byDay[key].push({ mills: at(di, h, m % 60), sgv: v === undefined ? 130 : v });
        }
      }
      return byDay;
    }

    function baseTreatments () {
      var list = [];
      for (var di = 0; di < PUMP_DAYS; di++) list.push(tempBasal(di, 2, 240, 0.9));
      return list;
    }
    function allKeys (n) {
      var keys = [];
      for (var i = 0; i < (n || DAYS); i++) keys.push(dayKey(i));
      return keys;
    }
    function flatten (byDay) {
      var all = [];
      Object.keys(byDay).forEach(function eachDay (k) { all = all.concat(byDay[k]); });
      return all.sort(function byMills (a, b) { return a.mills - b.mills; });
    }
    function run (opts) {
      opts = opts || {};
      var treatments = opts.treatments || baseTreatments();
      var byDay = opts.readingsByDay || readings();
      var classified = bc.classifyUserBoluses(treatments, flatten(byDay)).concat(opts.extraClassified || []);
      return br.computeBasalCases({
        treatments: treatments
        , readingsByDay: byDay
        , pumpDayKeys: opts.pumpDayKeys || allKeys(PUMP_DAYS)
        , profile: {}
        , profileStore: opts.profileStore || store
        , classified: classified
      });
    }
    function find (cases, dayIdx, hour) {
      var key = dayKey(dayIdx);
      return cases.filter(function match (c) { return c.dateKey === key && c.hour === hour; })[0];
    }

    describe('computeBasalCases', function () {
      it('should compute d of +0.5 at 03:00 with temp basal 0.9 over profile 0.6', function () {
        var cases = run();
        var c = find(cases, 0, 3);
        c.d.should.be.approximately(0.5, 1e-6);
        c.deliveredU.should.be.approximately(0.9, 1e-6);
        c.scheduledU.should.be.approximately(0.6, 1e-6);
        c.autoU.should.equal(0);
        find(cases, 0, 10).d.should.be.approximately(0, 1e-6);
        cases.length.should.equal(PUMP_DAYS * 24);
      });

      it('should drop hours with a meal bolus in the 4 h before', function () {
        var t = baseTreatments().concat([bolusAt(0, 12, 0, 4, { eventType: 'Meal Bolus', carbs: 40 })]);
        var cases = run({ treatments: t });
        (find(cases, 0, 11) !== undefined).should.equal(true);
        [12, 13, 14, 15].forEach(function gone (h) { (find(cases, 0, h) === undefined).should.equal(true); });
        (find(cases, 0, 16) !== undefined).should.equal(true);
        (find(cases, 1, 12) !== undefined).should.equal(true);
      });

      it('should drop hours with a correction in the 4 h before', function () {
        var corr = { mills: at(1, 20, 30), localHour: 20, dateKey: dayKey(1), insulin: 2, carbs: 0, cls: 'correction', bgAtBolus: 250, fastRise: false, carbMills: [] };
        var cases = run({ extraClassified: [corr] });
        (find(cases, 1, 19) !== undefined).should.equal(true);
        [20, 21, 22, 23].forEach(function gone (h) { (find(cases, 1, h) === undefined).should.equal(true); });
        (find(cases, 2, 0) === undefined).should.equal(true);
        (find(cases, 2, 1) !== undefined).should.equal(true);
      });

      it('should not drop any case for a dawn bolus with its carbs at 06:00', function () {
        var t = baseTreatments().concat([bolusAt(0, 6, 0, 1.2, { carbs: 6 })]);
        var cases = run({ treatments: t });
        cases.length.should.equal(PUMP_DAYS * 24);
        find(cases, 0, 6).d.should.be.approximately(0, 1e-6);
      });

      it('should drop hours 15 to 18 for an unclear bolus at 15:00', function () {
        var t = baseTreatments().concat([bolusAt(0, 15, 0, 1.2)]);
        var cases = run({ treatments: t });
        (find(cases, 0, 14) !== undefined).should.equal(true);
        [15, 16, 17, 18].forEach(function gone (h) { (find(cases, 0, h) === undefined).should.equal(true); });
        (find(cases, 0, 19) !== undefined).should.equal(true);
      });

      it('should drop hours after a separate carb entry without bolus', function () {
        var t = baseTreatments().concat([carbsAt(0, 10, 0, 20)]);
        var cases = run({ treatments: t });
        [10, 11, 12, 13].forEach(function gone (h) { (find(cases, 0, h) === undefined).should.equal(true); });
        (find(cases, 0, 14) !== undefined).should.equal(true);
      });

      it('should drop an hour with only 9 of 12 readings', function () {
        var byDay = readings(function bg (di, h, m) {
          return (di === 0 && h === 8 && (m === 5 || m === 10 || m === 15)) ? null : 130;
        });
        var cases = run({ readingsByDay: byDay });
        (find(cases, 0, 8) === undefined).should.equal(true);
        (find(cases, 0, 9) !== undefined).should.equal(true);
        cases.skipped.lowCoverage.should.equal(1);
      });

      it('should keep an hour with 10 of 12 readings', function () {
        var byDay = readings(function bg (di, h, m) {
          return (di === 0 && h === 8 && (m === 5 || m === 10)) ? null : 130;
        });
        (find(run({ readingsByDay: byDay }), 0, 8) !== undefined).should.equal(true);
      });

      it('should yield no cases for days without pump data', function () {
        var cases = run({ pumpDayKeys: allKeys(DAYS) });
        cases.length.should.equal(PUMP_DAYS * 24);
        (find(cases, 12, 3) === undefined).should.equal(true);
        (find(cases, 13, 10) === undefined).should.equal(true);
      });

      it('should yield no cases for days not listed as pump days', function () {
        var cases = run({ pumpDayKeys: allKeys(5) });
        cases.length.should.equal(5 * 24);
        (find(cases, 6, 3) === undefined).should.equal(true);
      });

      it('should add BG drift over sens: +30 mg/dl with sens 30 adds 1 U / scheduledU', function () {
        var byDay = readings(function bg (di, h, m) {
          if (di !== 0) return 130;
          if (h === 10) return 130 + m / 2; // 10:00 130 -> 11:00 160
          if (h === 11) return 160 - m / 2; // 11:00 160 -> 12:00 130
          return 130;
        });
        var cases = run({ readingsByDay: byDay });
        var c = find(cases, 0, 10);
        c.d.should.be.approximately(1 / 0.8, 1e-6);
        c.drift.should.be.approximately(30, 1e-6);
        find(cases, 0, 11).d.should.be.approximately(-1 / 0.8, 1e-6);
      });

      it('should spread an auto bolus at 03:50 pro rata over hours 3 to 7 into d', function () {
        var t = baseTreatments().concat([bolusAt(0, 3, 50, 0.48, { notes: 'Automatic Bolus' })]);
        var cases = run({ treatments: t });
        // 0.48 U over 240 min = 0.002 U/min: 10 min in hour 3, 60 in 4-6, 50 in 7.
        find(cases, 0, 3).autoU.should.be.approximately(0.02, 1e-9);
        [4, 5, 6].forEach(function full (h) { find(cases, 0, h).autoU.should.be.approximately(0.12, 1e-9); });
        find(cases, 0, 7).autoU.should.be.approximately(0.1, 1e-9);
        find(cases, 0, 8).autoU.should.equal(0);
        find(cases, 0, 2).autoU.should.equal(0);
        find(cases, 0, 3).d.should.be.approximately((0.9 + 0.02) / 0.6 - 1, 1e-6);
        // Auto insulin is no dawn range: hour 7 (profile 0.8, no temp basal) keeps d = +0.1 / 0.8.
        find(cases, 0, 7).d.should.be.approximately(0.1 / 0.8, 1e-6);
      });

      it('should not drop any case for a dawn bolus with a separate small carb entry', function () {
        var t = baseTreatments().concat([bolusAt(0, 6, 0, 1.2), carbsAt(0, 6, 10, 6)]);
        run({ treatments: t }).length.should.equal(PUMP_DAYS * 24);
      });

      it('should place each day by the offset of its chronologically first treatment', function () {
        // Day 0 is a travel day: the first treatment (01:00 local) has +60, a
        // later one +120. The later one comes first in the array.
        var late = bolusAt(0, 20, 0, 0.3, { notes: 'Automatic Bolus', utcOffset: 120 });
        var map = u.offsetsByDay([late].concat(baseTreatments(), [bolusAt(0, 1, 0, 0.2, { notes: 'Automatic Bolus' })]));
        map[dayKey(0)].should.equal(60);
        u.offsetsByDay([
          { created_at: new Date(at(1, 22, 0)).toISOString(), utcOffset: 120 }
          , { created_at: new Date(at(1, 1, 0)).toISOString(), utcOffset: 60 }
        ])[dayKey(1)].should.equal(60);
      });

      it('should give the same per-day basal as integrateActualBasalByHour', function () {
        var statistics = require('../lib/statistics');
        // An event spanning midnight, an overlapping later event and one without created_at.
        var t = baseTreatments().concat([
          tempBasal(3, 22, 180, 1.4)
          , tempBasal(3, 23, 30, 0.2)
          , { eventType: 'Temp Basal', mills: at(5, 4, 0), absolute: 2, duration: 60, utcOffset: OFFSET_MIN }
          , bolusAt(4, 12, 0, 2)
        ]);
        var dayBasal = u.dayBasalLookup(t, store);
        allKeys(DAYS).forEach(function same (dk) {
          dayBasal(dk).should.eql(statistics.integrateActualBasalByHour(t, store, [dk]));
        });
      });

      describe('dawn insulin (R22)', function () {
        // Day 0: BG falls 9 mg/dl/h from 06:00 to 10:00, which is exactly the
        // effect of 1.2 U spread over 4 h (0.3 U/h x sens 30).
        function dawnDrop (di, h, m) {
          var t = h * 60 + m;
          if (di !== 0 || t < 360 || t > 600) return 130;
          return 130 - (t - 360) * 9 / 60;
        }
        // Day 0: BG rises 9 mg/dl/h from 06:00 to 08:00.
        function dawnRise (di, h, m) {
          var t = h * 60 + m;
          if (di !== 0 || t < 360 || t > 480) return 130;
          return 130 + (t - 360) * 9 / 60;
        }
        var dawn = bolusAt(0, 6, 0, 1.2);

        it('should give |d| < 10 % when BG falls by exactly the dawn insulin effect', function () {
          var cases = run({ treatments: baseTreatments().concat([dawn]), readingsByDay: readings(dawnDrop) });
          [6, 7, 8, 9].forEach(function eachHour (h) {
            Math.abs(find(cases, 0, h).d).should.be.below(0.1);
          });
        });

        it('should still give down for the same drop without a dawn bolus', function () {
          var cases = run({ readingsByDay: readings(dawnDrop) });
          [6, 7, 8, 9].forEach(function eachHour (h) {
            find(cases, 0, h).d.should.be.approximately(-0.3 / 0.8, 1e-6);
          });
        });

        it('should keep d ignoring the dawn insulin when that d is already positive', function () {
          var cases = run({ treatments: baseTreatments().concat([dawn]), readingsByDay: readings(dawnRise) });
          find(cases, 0, 6).d.should.be.approximately(0.3 / 0.8, 1e-6);
        });

        it('should spread the dawn insulin pro rata over the 4 h after the bolus', function () {
          // Bolus at 06:30: hour 6 and hour 10 get 0.15 U, hours 7 to 9 get 0.3 U.
          var late = bolusAt(0, 6, 30, 1.2);
          var drop = function dropFrom630 (di, h, m) {
            var t = h * 60 + m;
            if (di !== 0 || t < 360 || t > 660) return 130;
            return 130 - (t - 360) * 9 / 60;
          };
          var cases = run({ treatments: baseTreatments().concat([late]), readingsByDay: readings(drop) });
          // hour 6: dLo -0.375, dHi -0.375 + 0.15/0.8 = -0.1875
          find(cases, 0, 6).d.should.be.approximately(-0.1875, 1e-6);
          Math.abs(find(cases, 0, 8).d).should.be.below(1e-6);
          find(cases, 0, 10).d.should.be.approximately(-0.1875, 1e-6);
          // hour 11 is outside the dawn spread and stays unchanged
          var without = run({ readingsByDay: readings(drop) });
          find(cases, 0, 11).d.should.be.approximately(find(without, 0, 11).d, 1e-9);
        });
      });

      it('should drop all cases without a valid sens and report it', function () {
        var noSens = { units: 'mg/dl', basal: store.basal };
        var cases = run({ profileStore: noSens });
        cases.length.should.equal(0);
        cases.skipped.noSens.should.equal(PUMP_DAYS * 24);
      });
    });

    describe('buildBasalBlocks', function () {
      function mk (hour, ds) {
        return ds.map(function toCase (d, i) {
          return { dateKey: dayKey(i), hour: hour, d: d, deliveredU: 0, scheduledU: 1, autoU: 0 };
        });
      }
      function repeat (v, n) {
        var a = [];
        for (var i = 0; i < n; i++) a.push(v);
        return a;
      }
      function blockAt (blocks, hour) {
        return blocks.filter(function contains (b) {
          var len = ((b.endHour - b.startHour) + 24) % 24 || 24;
          return ((hour - b.startHour) + 24) % 24 < len;
        });
      }
      function byState (blocks, state) {
        return blocks.filter(function match (b) { return b.state === state; });
      }

      it('should extend the 02-06 up block to 01-06 with capped new rates per profile segment', function () {
        var blocks = br.buildBasalBlocks(run(), store);
        var up = byState(blocks, 'up');
        up.length.should.equal(1);
        up[0].startHour.should.equal(1);
        up[0].endHour.should.equal(6);
        up[0].extendedFrom.should.equal(1);
        up[0].caseCount.should.equal(PUMP_DAYS);
        up[0].sameDirShare.should.equal(1);
        up[0].medianD.should.be.approximately(0.5, 1e-6);
        up[0].rows.should.eql([
          { from: '01:00', to: '02:00', oldRate: 0.8, newRate: 0.95 }
          , { from: '02:00', to: '06:00', oldRate: 0.6, newRate: 0.7 }
        ]);
        var ok = byState(blocks, 'ok');
        ok.length.should.equal(1);
        ok[0].startHour.should.equal(6);
        ok[0].endHour.should.equal(1);
      });

      it('should not extend when the hour before is down', function () {
        var cases = mk(1, repeat(-0.3, 5));
        [2, 3, 4, 5].forEach(function add (h) { cases = cases.concat(mk(h, repeat(0.5, 5))); });
        var up = byState(br.buildBasalBlocks(cases, store), 'up')[0];
        up.startHour.should.equal(2);
        (up.extendedFrom === null).should.equal(true);
      });

      it('should not extend when the hour before has too little data', function () {
        var cases = mk(1, repeat(0, 4));
        [2, 3, 4, 5].forEach(function add (h) { cases = cases.concat(mk(h, repeat(0.5, 5))); });
        var blocks = br.buildBasalBlocks(cases, store);
        var up = byState(blocks, 'up')[0];
        up.startHour.should.equal(2);
        (up.extendedFrom === null).should.equal(true);
        blockAt(blocks, 1)[0].state.should.equal('insufficient');
      });

      it('should extend a block starting at 00:00 to 23:00', function () {
        var cases = mk(23, repeat(0, 5));
        [0, 1, 2, 3].forEach(function add (h) { cases = cases.concat(mk(h, repeat(0.5, 5))); });
        var blocks = br.buildBasalBlocks(cases, store);
        var up = byState(blocks, 'up')[0];
        up.startHour.should.equal(23);
        up.endHour.should.equal(4);
        up.extendedFrom.should.equal(23);
        up.rows.should.eql([
          { from: '23:00', to: '02:00', oldRate: 0.8, newRate: 0.95 }
          , { from: '02:00', to: '04:00', oldRate: 0.6, newRate: 0.7 }
        ]);
        // the single ok hour 23 is absorbed by the extension
        byState(blocks, 'ok').length.should.equal(0);
      });

      it('should merge up hours across midnight', function () {
        var cases = [];
        [22, 23, 0, 1].forEach(function add (h) { cases = cases.concat(mk(h, repeat(0.5, 5))); });
        var up = byState(br.buildBasalBlocks(cases, store), 'up');
        up.length.should.equal(1);
        up[0].startHour.should.equal(22);
        up[0].endHour.should.equal(2);
      });

      it('should rate a median of 9 % as ok', function () {
        var blocks = br.buildBasalBlocks(mk(10, repeat(0.09, 5)), store);
        blockAt(blocks, 10)[0].state.should.equal('ok');
      });

      it('should rate a median of 10 % as up', function () {
        var blocks = br.buildBasalBlocks(mk(10, repeat(0.1, 5)), store);
        blockAt(blocks, 10)[0].state.should.equal('up');
      });

      it('should rate a median of -10 % as down', function () {
        var blocks = br.buildBasalBlocks(mk(10, repeat(-0.1, 5)), store);
        blockAt(blocks, 10)[0].state.should.equal('down');
      });

      it('should lower sameDirShare with neutral cases', function () {
        var blocks = br.buildBasalBlocks(mk(10, [0.2, 0.2, 0.2, 0.05, 0]), store);
        var b = blockAt(blocks, 10)[0];
        b.state.should.equal('up');
        b.sameDirShare.should.be.approximately(0.6, 1e-9);
      });

      it('should mark an hour with 4 cases as insufficient', function () {
        var blocks = br.buildBasalBlocks(mk(10, repeat(0.5, 4)), store);
        blockAt(blocks, 10)[0].state.should.equal('insufficient');
      });

      it('should use the minimum case count over the block hours', function () {
        var cases = mk(2, repeat(0.5, 5)).concat(mk(3, repeat(0.5, 7)), mk(4, repeat(0.5, 8)), mk(5, repeat(0.5, 6)));
        var up = byState(br.buildBasalBlocks(cases, store), 'up')[0];
        up.startHour.should.equal(2);
        up.caseCount.should.equal(5);
      });

      it('should never exceed the max step after rounding', function () {
        var flat = { basal: [{ time: '00:00', value: 0.65 }] };
        var cases = mk(23, repeat(0, 5)).concat(mk(10, repeat(0.5, 5)));
        var up = byState(br.buildBasalBlocks(cases, flat), 'up')[0];
        // 0.65 * 1.2 = 0.78 would round to 0.80 (+23 %); stays at 0.75
        up.rows.should.eql([{ from: '10:00', to: '11:00', oldRate: 0.65, newRate: 0.75 }]);
      });

      it('should lower the rate for a down block', function () {
        var cases = mk(10, repeat(-0.15, 5));
        var down = byState(br.buildBasalBlocks(cases, store), 'down')[0];
        // 0.8 * 0.85 = 0.68 -> 0.70
        down.rows.should.eql([{ from: '10:00', to: '11:00', oldRate: 0.8, newRate: 0.7 }]);
      });

      it('should partition the day into one insufficient block without cases', function () {
        var blocks = br.buildBasalBlocks([], store);
        blocks.length.should.equal(1);
        blocks[0].state.should.equal('insufficient');
        blocks[0].caseCount.should.equal(0);
        (blocks[0].sameDirShare === null).should.equal(true);
      });

      it('should set sameDirShare null for an insufficient block with cases', function () {
        var b = blockAt(br.buildBasalBlocks(mk(10, repeat(0.5, 4)), store), 10)[0];
        b.state.should.equal('insufficient');
        (b.sameDirShare === null).should.equal(true);
      });

      describe('direction guard on rounding', function () {
        function rowFor (rate, d) {
          var flat = { basal: [{ time: '00:00', value: rate }] };
          var blocks = br.buildBasalBlocks(mk(10, repeat(d, 5)), flat);
          var b = blockAt(blocks, 10)[0];
          b.state.should.equal(d > 0 ? 'up' : 'down');
          b.rows.length.should.equal(1);
          return b.rows[0];
        }

        it('should keep 0.11 unchanged for up 10 % (0.10 is lower, 0.15 is +36 %)', function () {
          var r = rowFor(0.11, 0.1);
          r.newRate.should.equal(0.11);
          r.unchanged.should.equal(true);
        });

        it('should keep 0.2 unchanged for up 10 % (0.25 is +25 %)', function () {
          var r = rowFor(0.2, 0.1);
          r.newRate.should.equal(0.2);
          r.unchanged.should.equal(true);
        });

        it('should raise 0.5 to 0.55 for up 10 % without unchanged key', function () {
          var r = rowFor(0.5, 0.1);
          r.newRate.should.equal(0.55);
          r.should.not.have.property('unchanged');
        });

        it('should step 0.11 down to 0.10 for down 10 %', function () {
          var r = rowFor(0.11, -0.1);
          r.newRate.should.equal(0.1);
          r.should.not.have.property('unchanged');
        });

        it('should take the next grid step 0.20 when 0.25 x 0.9 rounds back to 0.25', function () {
          // 0.225 rounds to 0.25 (no move); the next step down 0.20 is exactly -20 %.
          var r = rowFor(0.25, -0.1);
          r.newRate.should.equal(0.2);
          r.should.not.have.property('unchanged');
        });

        it('should keep 0.2 unchanged for down 10 % (0.15 is -25 %)', function () {
          var r = rowFor(0.2, -0.1);
          r.newRate.should.equal(0.2);
          r.unchanged.should.equal(true);
        });

        it('should keep 0.02 unchanged for down 20 % (never round up or reach 0)', function () {
          var r = rowFor(0.02, -0.2);
          r.newRate.should.equal(0.02);
          r.unchanged.should.equal(true);
        });
      });

      it('should count duplicate readings only once for coverage', function () {
        var byDay = readings(function bg (di, h, m) {
          return (di === 0 && h === 8 && (m === 5 || m === 10 || m === 15)) ? null : 130;
        });
        var key = dayKey(0);
        var hour8 = byDay[key].filter(function inHour (r) { return r.mills >= at(0, 8, 0) && r.mills < at(0, 9, 0); });
        byDay[key] = byDay[key].concat(hour8.slice(0, 3).map(function copy (r) { return { mills: r.mills, sgv: r.sgv }; }));
        (find(run({ readingsByDay: byDay }), 0, 8) === undefined).should.equal(true);
      });
    });
  });
  describe('factor_recommendations', function () {
    var bc = require('../lib/report_plugins/pump_analysis/bolus_classifier');
    var fr = require('../lib/report_plugins/pump_analysis/factor_recommendations');
    var rules = require('../lib/report_plugins/pump_analysis/recommendation_rules');
    var glucoseUnits = require('../lib/report_plugins/pump_analysis/glucose_units');

    var MIN = 60 * 1000;
    var HOUR = 60 * MIN;
    var OFFSET_MIN = 60; // local = UTC + 1h
    var DAYS = 8;

    function storeWith (extra) {
      return Object.assign({
        units: 'mg/dl'
        , basal: [{ time: '00:00', value: 0.8 }]
        , carbratio: [{ time: '00:00', value: 10 }]
        , sens: [{ time: '00:00', value: 45 }]
      }, extra || {});
    }

    function dayKey (dayIdx) {
      var d = new Date(Date.UTC(2026, 9, 1 + dayIdx));
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    function at (dayIdx, hour, minute) {
      return Date.UTC(2026, 9, 1 + dayIdx, hour, minute || 0) - OFFSET_MIN * MIN;
    }
    function iso (ms) { return new Date(ms).toISOString(); }
    function tempBasal (dayIdx, hour, minute, durationMin, rate) {
      var ms = at(dayIdx, hour, minute);
      return { eventType: 'Temp Basal', created_at: iso(ms), mills: ms, absolute: rate, duration: durationMin, utcOffset: OFFSET_MIN };
    }
    function bolusAt (dayIdx, hour, minute, insulin, extra) {
      var ms = at(dayIdx, hour, minute);
      return Object.assign({ eventType: 'Correction Bolus', created_at: iso(ms), mills: ms, utcOffset: OFFSET_MIN, insulin: insulin }, extra || {});
    }
    function mealAt (dayIdx, hour, minute, insulin, carbs) {
      return bolusAt(dayIdx, hour, minute, insulin, { eventType: 'Meal Bolus', carbs: carbs });
    }
    function carbsAt (dayIdx, hour, minute, carbs) {
      var ms = at(dayIdx, hour, minute);
      return { eventType: 'Carb Correction', created_at: iso(ms), mills: ms, utcOffset: OFFSET_MIN, carbs: carbs };
    }
    function autoAt (dayIdx, hour, minute, insulin) {
      return bolusAt(dayIdx, hour, minute, insulin, { notes: 'Automatic Bolus' });
    }

    // Piecewise-linear BG over [ms, sgv] points; flat before the first and after the last.
    function ramp (points) {
      return function bgAt (ms) {
        if (ms <= points[0][0]) return points[0][1];
        for (var i = 1; i < points.length; i++) {
          if (ms <= points[i][0]) {
            var a = points[i - 1];
            var b = points[i];
            return a[1] + (b[1] - a[1]) * (ms - a[0]) / (b[0] - a[0]);
          }
        }
        return points[points.length - 1][1];
      };
    }

    // Readings every 5 min; bgFn(ms) returns the value or null to drop it. Default flat 120.
    function readings (bgFn) {
      var byDay = {};
      for (var di = -1; di <= DAYS; di++) {
        var key = dayKey(di);
        byDay[key] = [];
        for (var m = 0; m < 24 * 60; m += 5) {
          var ms = at(di, Math.floor(m / 60), m % 60);
          var v = bgFn ? bgFn(ms) : 120;
          if (v === null) continue;
          byDay[key].push({ mills: ms, sgv: v === undefined ? 120 : v });
        }
      }
      return byDay;
    }
    function flatten (byDay) {
      var all = [];
      Object.keys(byDay).forEach(function eachDay (k) { all = all.concat(byDay[k]); });
      return all.sort(function byMills (a, b) { return a.mills - b.mills; });
    }
    // Temp basal at the profile rate on every day so each day is pump-covered without deviation.
    function pumpDays () {
      var list = [];
      for (var di = -1; di <= DAYS; di++) list.push(tempBasal(di, 0, 0, 30, 0.8));
      return list;
    }
    function pumpKeys () {
      var keys = [];
      for (var di = 0; di < DAYS; di++) keys.push(dayKey(di));
      return keys;
    }
    function input (opts) {
      var treatments = pumpDays().concat(opts.treatments || []);
      var byDay = opts.readingsByDay || readings(opts.bg);
      return {
        treatments: treatments
        , readingsByDay: byDay
        , pumpDayKeys: opts.pumpDayKeys || pumpKeys()
        , profile: {}
        , profileStore: opts.profileStore || storeWith()
        , classified: bc.classifyUserBoluses(treatments, flatten(byDay))
        , slots: rules.MEAL_SLOTS
      };
    }
    function meals (opts) { return fr.computeMealCases(input(opts)); }
    function corrections (opts) { return fr.computeCorrectionCases(input(opts)); }

    describe('computeMealCases', function () {
      it('should give effectiveRatio 10 and d 0 for 60 g, 6 U, profile 10 and flat BG', function () {
        var cases = meals({ treatments: [mealAt(0, 12, 0, 6, 60)] });
        cases.length.should.equal(1);
        var c = cases[0];
        c.slot.should.equal('lunch');
        c.dateKey.should.equal(dayKey(0));
        c.mills.should.equal(at(0, 12, 0));
        c.carbs.should.equal(60);
        c.bolusU.should.equal(6);
        c.startBg.should.equal(120);
        c.bg2h.should.equal(120);
        c.bg4h.should.equal(120);
        c.profileRatio.should.equal(10);
        c.effectiveRatio.should.be.approximately(10, 1e-6);
        c.d.should.be.approximately(0, 1e-6);
        c.curve.length.should.equal(49);
        c.curve[0].should.eql({ min: 0, sgv: 120 });
        c.curve[48].min.should.equal(240);
      });

      it('should add a residual correction of +2 U for 120 to 210 with sens 45', function () {
        var bg = ramp([[at(0, 12, 0), 120], [at(0, 16, 0), 210]]);
        var c = meals({ treatments: [mealAt(0, 12, 0, 6, 60)], bg: bg })[0];
        c.bg4h.should.be.approximately(210, 1e-6);
        c.effectiveRatio.should.be.approximately(7.5, 1e-6);
        c.d.should.be.approximately(1 / 3, 1e-6);
      });

      it('should report peak, peak minute and the 2 h value', function () {
        var bg = ramp([[at(0, 12, 0), 120], [at(0, 13, 0), 210], [at(0, 16, 0), 120]]);
        var c = meals({ treatments: [mealAt(0, 12, 0, 6, 60)], bg: bg })[0];
        c.peakBg.should.be.approximately(210, 1e-6);
        c.peakMin.should.equal(60);
        c.bg2h.should.be.approximately(180, 1e-6);
        c.curve[12].should.eql({ min: 60, sgv: 210 });
      });

      it('should count the net basal deviation pro rata per touched hour', function () {
        // 1.8 U/h over profile 0.8 in hour 12 (+1 U); the window covers half of it.
        var t = [mealAt(0, 12, 30, 6, 60), tempBasal(0, 12, 0, 60, 1.8)];
        var c = meals({ treatments: t })[0];
        c.effectiveRatio.should.be.approximately(60 / 6.5, 1e-6);
      });

      it('should count auto boluses and other user boluses in the window', function () {
        var t = [mealAt(0, 12, 0, 6, 60), autoAt(0, 13, 0, 0.5), bolusAt(0, 14, 0, 1)];
        var c = meals({ treatments: t })[0];
        c.bolusU.should.equal(6);
        c.effectiveRatio.should.be.approximately(60 / 7.5, 1e-6);
      });

      it('should keep a case whose denominator is not positive as d = -1 without a ratio', function () {
        // 1 U, BG 200 to 110 with sens 45: residual -2 U, denominator -1.
        // The true d tends to -1 (far too much insulin); dropping it would bias
        // the median toward more insulin.
        var bg = ramp([[at(0, 12, 0), 200], [at(0, 16, 0), 110]]);
        var cases = meals({ treatments: [mealAt(0, 12, 0, 1, 20)], bg: bg });
        cases.length.should.equal(1);
        cases[0].d.should.equal(-1);
        cases[0].nonPositive.should.equal(true);
        (cases[0].effectiveRatio === null).should.equal(true);
        cases.should.have.property('skipped');
        cases.skipped.should.not.have.property('nonPositive');
      });

      it('should not mark a normal case as nonPositive', function () {
        meals({ treatments: [mealAt(0, 12, 0, 6, 60)] })[0].should.not.have.property('nonPositive');
      });

      it('should count dawn insulin overlapping the meal window pro rata over 4 h', function () {
        // 1.2 U dawn bolus at 06:00, breakfast at 07:00: 07:00-10:00 holds 0.9 U.
        var t = [bolusAt(0, 6, 0, 1.2), mealAt(0, 7, 0, 3, 39)];
        var cases = meals({ treatments: t });
        cases.length.should.equal(1);
        cases[0].dawnU.should.be.approximately(0.9, 1e-9);
        cases[0].effectiveRatio.should.be.approximately(39 / 3.9, 1e-6);
      });

      it('should count the basal deviation after midnight for a dinner window', function () {
        // Dinner at 21:00, window until 01:00; +1 U temp basal 00:00-01:00 on the next day.
        var t = [mealAt(0, 21, 0, 6, 60), tempBasal(1, 0, 0, 60, 1.8)];
        var c = meals({ treatments: t })[0];
        c.slot.should.equal('dinner');
        c.effectiveRatio.should.be.approximately(60 / 7, 1e-6);
      });

      it('should drop both meals when a second meal follows within 4 h', function () {
        var t = [mealAt(0, 12, 0, 6, 60), mealAt(0, 14, 0, 3, 30), mealAt(1, 12, 0, 6, 60)];
        var cases = meals({ treatments: t });
        cases.length.should.equal(1);
        cases[0].dateKey.should.equal(dayKey(1));
        cases.skipped.otherMeal.should.equal(2);
      });

      it('should keep a meal whose neighbour is exactly 4 h away', function () {
        var t = [mealAt(0, 12, 0, 6, 60), mealAt(0, 16, 0, 3, 30)];
        meals({ treatments: t }).length.should.equal(1);
      });

      it('should drop a meal followed by a separate carb entry within 4 h', function () {
        var t = [mealAt(0, 12, 0, 6, 60), carbsAt(0, 14, 0, 15)];
        meals({ treatments: t }).length.should.equal(0);
      });

      it('should drop a meal with less than 80 % CGM coverage', function () {
        // 10 of 48 readings missing -> 79 %.
        var bg = function drop (ms) { return ms >= at(0, 13, 0) && ms < at(0, 13, 50) ? null : 120; };
        var cases = meals({ treatments: [mealAt(0, 12, 0, 6, 60)], bg: bg });
        cases.length.should.equal(0);
        cases.skipped.lowCoverage.should.equal(1);
      });

      it('should keep a meal with 39 of 48 readings', function () {
        var bg = function drop (ms) { return ms >= at(0, 13, 0) && ms < at(0, 13, 45) ? null : 120; };
        meals({ treatments: [mealAt(0, 12, 0, 6, 60)], bg: bg }).length.should.equal(1);
      });

      it('should never treat a dawn bolus as a meal', function () {
        var cases = meals({ treatments: [bolusAt(0, 6, 30, 1.2, { carbs: 6 })] });
        cases.length.should.equal(0);
      });

      it('should ignore the carbs of a dawn bolus inside a meal window but count its insulin', function () {
        // Dawn bolus 1 U at 07:30: 2.5 of its 4 h fall into the 06:00-10:00 window.
        var t = [mealAt(0, 6, 0, 3, 30), bolusAt(0, 7, 30, 1, { carbs: 6 })];
        var cases = meals({ treatments: t });
        cases.length.should.equal(1);
        cases[0].slot.should.equal('breakfast');
        cases[0].carbs.should.equal(30);
        cases[0].effectiveRatio.should.be.approximately(30 / 3.625, 1e-6);
      });

      it('should yield no case for a meal outside the slots', function () {
        meals({ treatments: [mealAt(0, 15, 30, 6, 60)] }).length.should.equal(0);
      });

      it('should drop the case when the carb ratio is missing or not positive', function () {
        var t = [mealAt(0, 12, 0, 6, 60)];
        meals({ treatments: t, profileStore: storeWith({ carbratio: [{ time: '00:00', value: 0 }] }) }).length.should.equal(0);
        var noCr = storeWith();
        delete noCr.carbratio;
        var cases = meals({ treatments: t, profileStore: noCr });
        cases.length.should.equal(0);
        cases.skipped.noRatio.should.equal(1);
        var empty = meals({ treatments: t, profileStore: storeWith({ carbratio: [] }) });
        empty.length.should.equal(0);
        empty.skipped.noRatio.should.equal(1);
      });

      it('should count a missing start BG and a missing BG after 4 h separately', function () {
        // No reading within 10 min of 16:00, coverage stays above 80 %.
        var noEnd = function gap (ms) { return ms >= at(0, 15, 50) && ms < at(0, 16, 15) ? null : 120; };
        var cases = meals({ treatments: [mealAt(0, 12, 0, 6, 60)], bg: noEnd });
        cases.length.should.equal(0);
        cases.skipped.noEndBg.should.equal(1);
        cases.skipped.noStartBg.should.equal(0);
        cases.skipped.should.not.have.property('noBg');
      });

      it('should drop the case when sens is missing', function () {
        var noSens = storeWith();
        delete noSens.sens;
        var cases = meals({ treatments: [mealAt(0, 12, 0, 6, 60)], profileStore: noSens });
        cases.length.should.equal(0);
        cases.skipped.noSens.should.equal(1);
      });

      it('should drop the case when a pump user has no basal data for the window day', function () {
        var t = [mealAt(0, 12, 0, 6, 60)];
        var inp = input({ treatments: t });
        inp.treatments = inp.treatments.filter(function notDay0 (x) { return !(x.eventType === 'Temp Basal' && x.mills === at(0, 0, 0)); });
        var cases = fr.computeMealCases(inp);
        cases.length.should.equal(0);
        cases.skipped.noPumpBasal.should.equal(1);
      });

      it('should assume scheduled basal without any pump days', function () {
        var inp = input({ treatments: [mealAt(0, 12, 0, 6, 60)], pumpDayKeys: [] });
        fr.computeMealCases(inp)[0].effectiveRatio.should.be.approximately(10, 1e-6);
      });
    });

    describe('summarizeMealSlot', function () {
      function mkCase (d, opts) {
        opts = opts || {};
        var start = 120;
        var curve = [];
        for (var m = 0; m <= 240; m += 5) curve.push({ min: m, sgv: start });
        if (opts.late) {
          curve[12].sgv = start + rules.LATE_BOLUS_RISE_MGDL + 10;
          curve[48].sgv = start - 10;
        }
        if (opts.lateAt) curve[opts.lateAt / 5].sgv = start + rules.LATE_BOLUS_RISE_MGDL + 10;
        return {
          slot: 'lunch'
          , dateKey: '2026-10-01'
          , mills: 0
          , carbs: 60
          , bolusU: 6
          , startBg: start
          , peakBg: start
          , peakMin: 0
          , bg2h: start
          , bg4h: curve[48].sgv
          , effectiveRatio: (opts.ratio || 10) / (1 + d)
          , profileRatio: opts.ratio || 10
          , d: d
          , curve: curve
        };
      }
      function repeat (n, fn) {
        var list = [];
        for (var i = 0; i < n; i++) list.push(fn(i));
        return list;
      }

      it('should raise insulin for 6 cases with median +0.33: 10 / 1.2 = 8.33 -> 8.5', function () {
        var s = fr.summarizeMealSlot(repeat(6, function c () { return mkCase(0.33); }));
        s.slot.should.equal('lunch');
        s.state.should.equal('up');
        s.caseCount.should.equal(6);
        s.sameDirShare.should.equal(1);
        s.medianD.should.be.approximately(0.33, 1e-9);
        s.oldRatio.should.equal(10);
        s.newRatio.should.equal(8.5);
        s.latePattern.should.eql({ share: 0, count: 0 });
        (s.unchanged === undefined).should.equal(true);
      });

      it('should be insufficient with 4 cases', function () {
        var s = fr.summarizeMealSlot(repeat(4, function c () { return mkCase(0.33); }));
        s.state.should.equal('insufficient');
        (s.newRatio === null).should.equal(true);
        (s.sameDirShare === null).should.equal(true);
      });

      it('should be insufficient without cases and keep the given slot key', function () {
        var s = fr.summarizeMealSlot([], 'dinner');
        s.slot.should.equal('dinner');
        s.state.should.equal('insufficient');
        s.caseCount.should.equal(0);
      });

      it('should report timing for 4 of 6 late-bolus cases instead of a ratio change', function () {
        var cases = repeat(6, function c (i) { return mkCase(0.33, { late: i < 4 }); });
        var s = fr.summarizeMealSlot(cases);
        s.state.should.equal('timing');
        s.latePattern.count.should.equal(4);
        s.latePattern.share.should.be.approximately(4 / 6, 1e-9);
        (s.newRatio === null).should.equal(true);
      });

      it('should not report timing for 3 of 6 late-bolus cases', function () {
        var cases = repeat(6, function c (i) { return mkCase(0.33, { late: i < 3 }); });
        fr.summarizeMealSlot(cases).state.should.equal('up');
      });

      it('should not count a +90 peak after 90 min as late', function () {
        var cases = repeat(6, function c () {
          var k = mkCase(0.33, { lateAt: 95 });
          k.curve[48].sgv = 110;
          k.bg4h = 110;
          return k;
        });
        var s = fr.summarizeMealSlot(cases);
        s.latePattern.count.should.equal(0);
        s.state.should.equal('up');
      });

      it('should lower insulin for median -0.3 within 20 % of the old ratio: 10 -> 12', function () {
        var s = fr.summarizeMealSlot(repeat(6, function c () { return mkCase(-0.3); }));
        s.state.should.equal('down');
        s.newRatio.should.equal(12);
      });

      it('should keep the ratio for a median of 5 %', function () {
        var s = fr.summarizeMealSlot(repeat(6, function c () { return mkCase(0.05); }));
        s.state.should.equal('ok');
        s.newRatio.should.equal(10);
      });

      it('should keep ratio 2 unchanged when no 0.5 step fits the direction', function () {
        // 2 / 1.1 = 1.82 rounds to 2.0; 1.5 would be +33 % insulin.
        var s = fr.summarizeMealSlot(repeat(6, function c () { return mkCase(0.1, { ratio: 2 }); }));
        s.state.should.equal('up');
        s.newRatio.should.equal(2);
        s.unchanged.should.equal(true);
      });

      it('should lower sameDirShare with neutral cases', function () {
        var cases = repeat(4, function c () { return mkCase(0.3); }).concat(repeat(2, function c () { return mkCase(0); }));
        fr.summarizeMealSlot(cases).sameDirShare.should.be.approximately(4 / 6, 1e-9);
      });

      it('should break a tie of profile ratios toward the earliest case', function () {
        var ratios = [12, 10, 10, 12, 11];
        var s = fr.summarizeMealSlot(ratios.map(function c (r) { return mkCase(0.3, { ratio: r }); }));
        s.oldRatio.should.equal(12);
        s.mixedProfile.should.equal(true);
      });
    });

    describe('computeCorrectionCases', function () {
      var sens60 = storeWith({ sens: [{ time: '00:00', value: 60 }] });
      function corrBg (dayIdx) {
        return ramp([[at(dayIdx, 13, 0), 120], [at(dayIdx, 13, 5), 260], [at(dayIdx, 14, 0), 260], [at(dayIdx, 17, 0), 170], [at(dayIdx, 17, 5), 120]]);
      }

      it('should measure ISF 45 for 260 to 170 with 2 U against sens 60', function () {
        var cases = corrections({ treatments: [bolusAt(0, 14, 0, 2)], bg: corrBg(0), profileStore: sens60 });
        cases.length.should.equal(1);
        var c = cases[0];
        c.dateKey.should.equal(dayKey(0));
        c.mills.should.equal(at(0, 14, 0));
        c.bolusU.should.equal(2);
        c.startBg.should.equal(260);
        c.bg3h.should.equal(170);
        c.measuredIsf.should.be.approximately(45, 1e-6);
        c.profileIsf.should.equal(60);
        c.d.should.be.approximately(1 / 3, 1e-6);
      });

      it('should count auto boluses in the window', function () {
        var t = [bolusAt(0, 14, 0, 2), autoAt(0, 15, 0, 0.5)];
        corrections({ treatments: t, bg: corrBg(0), profileStore: sens60 })[0].measuredIsf.should.be.approximately(36, 1e-6);
      });

      it('should not measure a fast-rise correction', function () {
        var bg = ramp([[at(0, 13, 55), 248], [at(0, 14, 0), 260], [at(0, 17, 0), 170]]);
        var cases = corrections({ treatments: [bolusAt(0, 14, 0, 2)], bg: bg, profileStore: sens60 });
        cases.length.should.equal(0);
        cases.skipped.fastRise.should.equal(1);
      });

      it('should not measure a correction with carbs within 3 h after or before', function () {
        corrections({ treatments: [bolusAt(0, 14, 0, 2), carbsAt(0, 16, 0, 15)], bg: corrBg(0), profileStore: sens60 }).length.should.equal(0);
        corrections({ treatments: [bolusAt(0, 14, 0, 2), carbsAt(0, 12, 0, 15)], bg: corrBg(0), profileStore: sens60 }).length.should.equal(0);
      });

      it('should not measure a correction with another bolus within 3 h', function () {
        var cases = corrections({ treatments: [bolusAt(0, 14, 0, 2), bolusAt(0, 15, 0, 1)], bg: corrBg(0), profileStore: sens60 });
        cases.length.should.equal(0);
        cases.skipped.disturbed.should.be.above(0);
      });

      it('should not measure a correction with less than 80 % CGM coverage', function () {
        var base = corrBg(0);
        var bg = function drop (ms) { return ms >= at(0, 15, 0) && ms < at(0, 15, 40) ? null : base(ms); };
        var cases = corrections({ treatments: [bolusAt(0, 14, 0, 2)], bg: bg, profileStore: sens60 });
        cases.length.should.equal(0);
        cases.skipped.lowCoverage.should.equal(1);
      });

      it('should drop a correction without a BG drop', function () {
        var bg = ramp([[at(0, 13, 0), 260], [at(0, 17, 0), 260]]);
        var cases = corrections({ treatments: [bolusAt(0, 14, 0, 2)], bg: bg, profileStore: sens60 });
        cases.length.should.equal(0);
        cases.skipped.noDrop.should.equal(1);
        cases.skipped.should.not.have.property('nonPositive');
      });

      it('should keep a correction with a BG drop but no positive insulin as d = -1', function () {
        // 0.5 U, basal suspended 14:00-17:00 (-2.4 U against profile 0.8): total -1.9 U.
        var t = [bolusAt(0, 14, 0, 0.5), tempBasal(0, 14, 0, 180, 0)];
        var cases = corrections({ treatments: t, bg: corrBg(0), profileStore: sens60 });
        cases.length.should.equal(1);
        cases[0].d.should.equal(-1);
        cases[0].nonPositive.should.equal(true);
        (cases[0].measuredIsf === null).should.equal(true);
      });

      it('should count dawn insulin overlapping the correction window', function () {
        // Dawn bolus 1.2 U at 06:00, correction 2 U at 08:00: 08:00-10:00 holds 0.6 U.
        var bg = ramp([[at(0, 7, 0), 120], [at(0, 7, 5), 260], [at(0, 8, 0), 260], [at(0, 11, 0), 170], [at(0, 11, 5), 120]]);
        var t = [bolusAt(0, 6, 0, 1.2), bolusAt(0, 8, 0, 2)];
        var cases = corrections({ treatments: t, bg: bg, profileStore: sens60 });
        cases.length.should.equal(1);
        cases[0].dawnU.should.be.approximately(0.6, 1e-9);
        cases[0].measuredIsf.should.be.approximately(90 / 2.6, 1e-6);
      });

      it('should not measure a correction with a hypo treatment within 3 h', function () {
        var hypo = { eventType: 'Hypo Treatment', created_at: iso(at(0, 16, 0)), mills: at(0, 16, 0), utcOffset: OFFSET_MIN };
        var cases = corrections({ treatments: [bolusAt(0, 14, 0, 2), hypo], bg: corrBg(0), profileStore: sens60 });
        cases.length.should.equal(0);
        cases.skipped.disturbed.should.equal(1);
      });

      it('should drop a correction when a pump user has no basal data for the window day', function () {
        var inp = input({ treatments: [bolusAt(0, 14, 0, 2)], bg: corrBg(0), profileStore: sens60 });
        inp.treatments = inp.treatments.filter(function notDay0 (x) { return !(x.eventType === 'Temp Basal' && x.mills === at(0, 0, 0)); });
        var cases = fr.computeCorrectionCases(inp);
        cases.length.should.equal(0);
        cases.skipped.noPumpBasal.should.equal(1);
      });

      it('should count a missing BG after 3 h as noEndBg', function () {
        var base = corrBg(0);
        var bg = function gap (ms) { return ms >= at(0, 16, 50) && ms < at(0, 17, 15) ? null : base(ms); };
        var cases = corrections({ treatments: [bolusAt(0, 14, 0, 2)], bg: bg, profileStore: sens60 });
        cases.length.should.equal(0);
        cases.skipped.noEndBg.should.equal(1);
        cases.skipped.noStartBg.should.equal(0);
        cases.skipped.should.not.have.property('noBg');
      });
    });

    describe('summarizeCorrections', function () {
      function sixDays (store) {
        var t = [];
        var fns = [];
        for (var di = 0; di < 6; di++) {
          t.push(bolusAt(di, 14, 0, 2));
          fns.push(ramp([[at(di, 13, 0), 120], [at(di, 13, 5), 260], [at(di, 14, 0), 260], [at(di, 17, 0), 170], [at(di, 17, 5), 120]]));
        }
        var bg = function multi (ms) {
          for (var i = 0; i < fns.length; i++) {
            if (ms >= at(i, 12, 0) && ms <= at(i, 18, 0)) return fns[i](ms);
          }
          return 120;
        };
        return corrections({ treatments: t, bg: bg, profileStore: store });
      }

      it('should recommend a stronger factor in mg/dl: 60 -> 50', function () {
        var s = fr.summarizeCorrections(sixDays(storeWith({ sens: [{ time: '00:00', value: 60 }] })));
        s.state.should.equal('up');
        s.caseCount.should.equal(6);
        s.sameDirShare.should.equal(1);
        s.medianD.should.be.approximately(1 / 3, 1e-6);
        s.oldIsf.should.equal(60);
        s.newIsf.should.equal(50);
      });

      it('should report oldIsf and newIsf in mmol for a mmol profile', function () {
        var s = fr.summarizeCorrections(sixDays(storeWith({ units: 'mmol', sens: [{ time: '00:00', value: 3.33 }] })));
        s.state.should.equal('up');
        s.oldIsf.should.be.approximately(3.33, 1e-9);
        // 3.33 mmol = 59.99 mg/dl; / 1.2 = 49.99 -> 50 mg/dl.
        s.newIsf.should.be.approximately(glucoseUnits.fromMgdl(50, 'mmol'), 1e-9);
        s.units.should.equal('mmol');
      });

      it('should be insufficient with fewer than 5 cases', function () {
        var s = fr.summarizeCorrections([]);
        s.state.should.equal('insufficient');
        s.caseCount.should.equal(0);
        (s.newIsf === null).should.equal(true);
      });
    });
  });

  describe('recommendation_engine', function () {
    var fs = require('fs');
    var path = require('path');
    var engine = require('../lib/report_plugins/pump_analysis/recommendation_engine');

    var MIN = 60 * 1000;
    var OFFSET_MIN = 60; // local = UTC + 1h
    var DAYS = 14;
    var store = {
      units: 'mg/dl'
      , basal: [
        { time: '00:00', value: 0.8 }
        , { time: '02:00', value: 0.6 }
        , { time: '06:00', value: 0.8 }
      ]
      , carbratio: [{ time: '00:00', value: 10 }]
      , sens: [{ time: '00:00', value: 30 }]
    };
    var RAISE_WARNING = 'Pump often raises basal here, but hypo on %1/%2 days, clarify the cause first';
    var DAWN = 'Dawn bolus on %1/%2 days taken into account as a range, avg %3 U';
    var DRIFT = 'BG in fasting windows changes by %1 per hour (median)';

    function dayKey (dayIdx) {
      var d = new Date(Date.UTC(2026, 9, 1 + dayIdx));
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    function at (dayIdx, hour, minute) {
      return Date.UTC(2026, 9, 1 + dayIdx, hour, minute || 0) - OFFSET_MIN * MIN;
    }
    function tempBasal (dayIdx, hour, durationMin, rate) {
      var ms = at(dayIdx, hour, 0);
      return { eventType: 'Temp Basal', created_at: new Date(ms).toISOString(), mills: ms, absolute: rate, duration: durationMin, utcOffset: OFFSET_MIN };
    }
    function bolusAt (dayIdx, hour, minute, insulin, extra) {
      var ms = at(dayIdx, hour, minute);
      return Object.assign({ eventType: 'Correction Bolus', created_at: new Date(ms).toISOString(), mills: ms, utcOffset: OFFSET_MIN, insulin: insulin }, extra || {});
    }
    // Flat 130 every 5 min over the report days plus one day on each side;
    // bgFn(dayIdx, hour, minute) may override a value.
    function readings (bgFn) {
      var byDay = {};
      for (var di = -1; di <= DAYS; di++) {
        var key = dayKey(di);
        byDay[key] = [];
        for (var m = 0; m < 24 * 60; m += 5) {
          var h = Math.floor(m / 60);
          var v = bgFn ? bgFn(di, h, m % 60) : undefined;
          if (v === null) continue;
          byDay[key].push({ mills: at(di, h, m % 60), sgv: v === undefined ? 130 : v });
        }
      }
      return byDay;
    }
    function keys () {
      var list = [];
      for (var i = 0; i < DAYS; i++) list.push(dayKey(i));
      return list;
    }
    function basalTreatments (rate) {
      var list = [];
      for (var di = 0; di < DAYS; di++) list.push(tempBasal(di, 2, 240, rate));
      return list;
    }
    function input (opts) {
      opts = opts || {};
      return {
        treatments: opts.treatments || basalTreatments(0.9)
        , readingsByDay: opts.readingsByDay || readings()
        , units: opts.units || 'mg/dl'
        , dayKeys: keys()
        , pumpDayKeys: opts.pumpDayKeys || keys()
        , profile: {}
        , profileStore: opts.profileStore || store
        , dayStats: opts.dayStats || []
        , targetLow: 70
        , targetHigh: 180
        , utcOffsetMin: OFFSET_MIN
        , profileSwitch: !!opts.profileSwitch
      };
    }
    function basalCards (result) {
      return result.cards.filter(function isBasal (c) { return c.kind === 'basal'; });
    }
    function cardAt (result, label) {
      return result.cards.filter(function match (c) { return c.timeLabel === label; })[0];
    }
    function reasonOf (card, key) {
      return card.reasons.filter(function match (r) { return r.key === key; })[0];
    }
    // Readings with a 20 min hypo (60 mg/dl at :20-:35) at `hour` on the first
    // n days; other values come from base (or the flat default). Mid-hour, so
    // the fasting-window drift of that hour stays unchanged.
    function hypoOnDays (n, hour, base, value) {
      return readings(function withHypo (di, h, m) {
        if (di >= 0 && di < n && h === hour && m >= 20 && m <= 35) return value === undefined ? 60 : value;
        return base ? base(di, h, m) : undefined;
      });
    }

    describe('rateConfidence', function () {
      [
        [4, 1.0, 0, 'insufficient']
        , [7, 0.75, 0, 'high']
        , [7, 0.74, 0, 'medium']
        , [5, 0.60, 0, 'medium']
        , [5, 0.59, 0, 'low']
        , [7, 0.9, 1, 'medium']
        , [5, 0.5, 2, 'low']
        , [9, 0.9, 3, 'warning']
      ].forEach(function eachCase (c) {
        it('should rate ' + c[0] + ' cases, share ' + c[1] + ', ' + c[2] + ' counter days as ' + c[3], function () {
          engine.rateConfidence({ caseCount: c[0], sameDirShare: c[1], counterDays: c[2] }).should.equal(c[3]);
        });
      });

      it('should downgrade medium to low with 2 counter days', function () {
        engine.rateConfidence({ caseCount: 6, sameDirShare: 0.7, counterDays: 2 }).should.equal('low');
      });
    });

    describe('findHighEpisodes', function () {
      function series (values) {
        return values.map(function toReading (v, i) { return { mills: at(0, 3, 0) + i * 5 * MIN, sgv: v }; });
      }

      it('should find a run above 250 lasting 20 min', function () {
        var eps = engine.findHighEpisodes(series([200, 260, 262, 270, 265, 255, 200]), 250, 15);
        eps.length.should.equal(1);
        eps[0].start.should.equal(at(0, 3, 5));
        eps[0].end.should.equal(at(0, 3, 25));
      });

      it('should count 3 readings (10 min first to last plus one 5 min sample) as 15 min, like hypo episodes', function () {
        var eps = engine.findHighEpisodes(series([200, 260, 262, 270, 200]), 250, 15);
        eps.length.should.equal(1);
        eps[0].start.should.equal(at(0, 3, 5));
        eps[0].end.should.equal(at(0, 3, 15));
      });

      it('should ignore a run of 2 readings (10 min with the sample)', function () {
        engine.findHighEpisodes(series([200, 260, 262, 200]), 250, 15).length.should.equal(0);
      });

      it('should split a run at a gap over 15 min', function () {
        // Two 15-min runs 25 min apart; without the split they would form one run.
        var r = series([260, 260, 260]).concat(
          [{ mills: at(0, 3, 35), sgv: 260 }, { mills: at(0, 3, 40), sgv: 260 }, { mills: at(0, 3, 45), sgv: 260 }]);
        var eps = engine.findHighEpisodes(r, 250, 15);
        eps.length.should.equal(2);
        eps[0].should.eql({ start: at(0, 3, 0), end: at(0, 3, 10) });
        eps[1].should.eql({ start: at(0, 3, 35), end: at(0, 3, 45) });
      });

      it('should not split a run at a gap of exactly 15 min', function () {
        var r = series([260, 260]).concat([{ mills: at(0, 3, 20), sgv: 260 }]);
        engine.findHighEpisodes(r, 250, 15).should.eql([{ start: at(0, 3, 0), end: at(0, 3, 20) }]);
      });
    });

    describe('buildRecommendations', function () {
      it('should warn on basal up 01-06 with hypo on 4/14 days at 03:00', function () {
        var res = engine.buildRecommendations(input({ readingsByDay: hypoOnDays(4, 3) }));
        var card = cardAt(res, '01:00-06:00');
        card.kind.should.equal('basal');
        card.state.should.equal('warning');
        card.confidence.should.equal('warning');
        reasonOf(card, RAISE_WARNING).args.should.eql(['4', '14']);
        card.rows.forEach(function noNew (r) { (r.newValue === null).should.equal(true); });
      });

      it('should recommend basal up with high confidence without counter-signal', function () {
        var res = engine.buildRecommendations(input());
        var card = cardAt(res, '01:00-06:00');
        card.state.should.equal('up');
        card.confidence.should.equal('high');
        card.rows.map(function vals (r) { return [r.from, r.to, r.oldValue, r.newValue]; }).should.eql([
          ['01:00', '02:00', '0.80', '0.95']
          , ['02:00', '06:00', '0.60', '0.70']
        ]);
        reasonOf(card, 'No hypo in this period').args.should.eql([]);
        var pump = reasonOf(card, 'On %1/%2 days Control-IQ raised basal in this period, avg %3 U/h (%4 %)');
        pump.args.should.eql(['14', '14', '+0.30', '+50']);
        card.basisLine.key.should.equal('Data: %1 pump days, %2 clean fasting windows; %3 unclear boluses not evaluated');
        // %2 = distinct days with a clean fasting window in the block's own hours
        card.basisLine.args.should.eql(['14', '14', '0']);
      });

      it('should count a hypo only below 70, not below the lower target of the report', function () {
        var report = function (over) { return Object.assign(input(over), { targetLow: 80 }); };
        var at75 = cardAt(engine.buildRecommendations(report({ readingsByDay: hypoOnDays(4, 3, null, 75) })), '01:00-06:00');
        at75.state.should.equal('up');
        at75.confidence.should.equal('high');
        reasonOf(at75, 'No hypo in this period').should.be.ok();
        var at65 = cardAt(engine.buildRecommendations(report({ readingsByDay: hypoOnDays(4, 3, null, 65) })), '01:00-06:00');
        at65.state.should.equal('warning');
      });

      it('should explain the confidence level with the share and the thresholds', function () {
        var card = cardAt(engine.buildRecommendations(input()), '01:00-06:00');
        card.confidenceNote.key.should.equal('Confidence: %1 % of the cases point in this direction (medium from %2 %, high from %3 % with at least %4 cases)');
        card.confidenceNote.args.should.eql(['100', '60', '75', '7']);
      });

      it('should name the downgrade by a weak counter-signal in the confidence note', function () {
        var card = cardAt(engine.buildRecommendations(input({ readingsByDay: hypoOnDays(1, 3) })), '01:00-06:00');
        card.confidence.should.equal('medium');
        card.confidenceNote.key.should.match(/counter-signal on %5 days lowers it by one level$/);
        card.confidenceNote.args[4].should.equal('1');
      });

      it('should give no confidence note for warning and insufficient cards', function () {
        var res = engine.buildRecommendations(input({ readingsByDay: hypoOnDays(4, 3) }));
        res.cards.forEach(function eachCard (c) {
          if (c.state === 'warning' || c.state === 'insufficient') (c.confidenceNote === null || c.confidenceNote === undefined).should.equal(true);
        });
      });

      it('should omit the pump reason when the pump did not move basal', function () {
        // Pump runs the profile rate; BG rises 9 mg/dl/h from 02 to 06 (d +0.5
        // with sens 30) and falls back from 06 to 10.
        var bg = function drift (di, h, m) {
          var t = h * 60 + m;
          if (t >= 120 && t < 360) return 130 + (t - 120) * 9 / 60;
          if (t >= 360 && t < 600) return 166 - (t - 360) * 9 / 60;
          return 130;
        };
        var res = engine.buildRecommendations(input({ treatments: basalTreatments(0.6), readingsByDay: readings(bg) }));
        var card = cardAt(res, '01:00-06:00');
        card.state.should.equal('up');
        card.reasons.forEach(function noPump (r) { r.key.should.not.match(/Control-IQ/); });
      });

      it('should lead an up card with the median BG drift when the pump did not move basal', function () {
        var bg = function drift (di, h, m) {
          var t = h * 60 + m;
          if (t >= 120 && t < 360) return 130 + (t - 120) * 9 / 60;
          if (t >= 360 && t < 600) return 166 - (t - 360) * 9 / 60;
          return 130;
        };
        var res = engine.buildRecommendations(input({ treatments: basalTreatments(0.6), readingsByDay: readings(bg) }));
        var card = cardAt(res, '01:00-06:00');
        card.reasons[0].should.eql({ key: DRIFT, args: ['+9 mg/dl'] });
        var down = basalCards(res).filter(function isDown (c) { return c.state === 'down'; })[0];
        reasonOf(down, DRIFT).args.should.eql(['-9 mg/dl']);
      });

      it('should put the drift reason after the pump reason and omit it when the drift rounds to 0', function () {
        var bg = function drift (di, h, m) {
          var t = h * 60 + m;
          if (t >= 120 && t < 360) return 130 + (t - 120) * 3 / 60;
          if (t >= 360 && t < 600) return 142 - (t - 360) * 3 / 60;
          return 130;
        };
        var card = cardAt(engine.buildRecommendations(input({ readingsByDay: readings(bg) })), '01:00-06:00');
        card.state.should.equal('up');
        card.reasons[0].key.should.match(/Control-IQ raised/);
        card.reasons[1].should.eql({ key: DRIFT, args: ['+3 mg/dl'] });
        var flat = cardAt(engine.buildRecommendations(input()), '01:00-06:00');
        (reasonOf(flat, DRIFT) === undefined).should.equal(true);
      });

      it('should keep the 1 h earlier hint when the reasons exceed the cap', function () {
        // Fast-rise corrections at 01:30 on two days add a correction reason:
        // pump, no hypo, dawn, correction and extension would be 5 reasons.
        var t = basalTreatments(0.9);
        for (var di = 0; di < 9; di++) t.push(bolusAt(di, 6, 30, 1.2));
        t.push(bolusAt(0, 1, 30, 1));
        t.push(bolusAt(1, 1, 30, 1));
        var bg = function rise (d, h, m) { return d <= 1 && h === 1 && m === 30 ? 140 : undefined; };
        var res = engine.buildRecommendations(input({ treatments: t, readingsByDay: readings(bg) }));
        var card = cardAt(res, '01:00-06:00');
        card.state.should.equal('up');
        card.reasons.length.should.equal(4);
        reasonOf(card, 'Suggestion starts 1 h earlier because insulin acts with a delay').should.be.ok();
        (reasonOf(card, 'On %1/%2 days correction in this period, avg %3 U') === undefined).should.equal(true);
        reasonOf(card, DAWN).should.be.ok();
        reasonOf(card, 'No hypo in this period').should.be.ok();
      });

      it('should keep the dawn reason and the 1 h earlier hint over "no hypo" on a pump + drift card', function () {
        // pump, drift, no hypo, dawn and extension would be 5 reasons.
        var t = basalTreatments(0.9);
        for (var di = 0; di < 9; di++) t.push(bolusAt(di, 6, 30, 1.2));
        var bg = function drift (d, h, m) {
          var tm = h * 60 + m;
          if (tm >= 120 && tm < 360) return 130 + (tm - 120) * 3 / 60;
          if (tm >= 360 && tm < 600) return 142 - (tm - 360) * 3 / 60;
          return 130;
        };
        var card = cardAt(engine.buildRecommendations(input({ treatments: t, readingsByDay: readings(bg) })), '01:00-06:00');
        card.state.should.equal('up');
        card.reasons.map(function k (r) { return r.key; }).should.eql([
          'On %1/%2 days Control-IQ raised basal in this period, avg %3 U/h (%4 %)'
          , DRIFT
          , DAWN
          , 'Suggestion starts 1 h earlier because insulin acts with a delay'
        ]);
      });

      it('should keep an actual hypo counter-signal over the pump and drift reasons', function () {
        var t = basalTreatments(0.9);
        for (var di = 0; di < 9; di++) t.push(bolusAt(di, 6, 30, 1.2));
        var bg = function drift (d, h, m) {
          var tm = h * 60 + m;
          if (tm >= 120 && tm < 360) return 130 + (tm - 120) * 3 / 60;
          if (tm >= 360 && tm < 600) return 142 - (tm - 360) * 3 / 60;
          return 130;
        };
        var card = cardAt(engine.buildRecommendations(input({ treatments: t, readingsByDay: hypoOnDays(1, 3, bg) })), '01:00-06:00');
        card.state.should.equal('up');
        card.reasons.length.should.equal(4);
        reasonOf(card, 'Hypo on %1/%2 days').args.should.eql(['1', '14']);
        reasonOf(card, DAWN).should.be.ok();
        reasonOf(card, 'Suggestion starts 1 h earlier because insulin acts with a delay').should.be.ok();
      });

      it('should never put Infinity or NaN into reasons when all corrections have no positive insulin', function () {
        // 6 corrections of 0.5 U at BG 250 with basal suspended for 3 h: every
        // case has a BG drop but total insulin below 0 (d = -1).
        var t = [];
        for (var di = 0; di < 6; di++) {
          t.push(tempBasal(di, 14, 180, 0));
          t.push(bolusAt(di, 14, 0, 0.5));
        }
        var bg = function corr (d, h, m) {
          var tm = h * 60 + m;
          if (d < 0 || d >= 6 || tm < 780 || tm > 1020) return undefined;
          if (tm <= 840) return 250;
          return 250 - (tm - 840) * 40 / 180;
        };
        var res = engine.buildRecommendations(input({ treatments: t, readingsByDay: readings(bg) }));
        var isf = res.cards.filter(function isIsf (c) { return c.kind === 'isf'; })[0];
        isf.state.should.equal('down');
        isf.caseCount.should.equal(6);
        res.cards.forEach(function eachCard (c) {
          c.reasons.concat([c.basisLine]).forEach(function eachReason (r) {
            r.args.forEach(function finite (a) { a.should.not.match(/Infinity|NaN/); });
          });
          c.rows.forEach(function eachRow (r) {
            [r.oldValue, r.newValue].forEach(function finite (v) { if (v !== null) String(v).should.not.match(/Infinity|NaN/); });
          });
        });
      });

      it('should downgrade a basal down card one level with values above 250 for 20 min on 1 day', function () {
        var bg = function hyper (di, h, m) { return di === 0 && h === 3 && m >= 20 && m <= 40 ? 260 : undefined; };
        var res = engine.buildRecommendations(input({ treatments: basalTreatments(0.3), readingsByDay: readings(bg) }));
        var card = cardAt(res, '01:00-06:00');
        card.state.should.equal('down');
        card.confidence.should.equal('medium');
        reasonOf(card, 'Values above %1 on %2/%3 days').args.should.eql(['250', '1', '14']);
      });

      it('should not count values above 190 but never above 250 as counter-signal', function () {
        var bg = function high (di, h, m) { return di === 0 && h === 3 && m >= 20 && m <= 40 ? 200 : undefined; };
        var res = engine.buildRecommendations(input({ treatments: basalTreatments(0.3), readingsByDay: readings(bg) }));
        var card = cardAt(res, '01:00-06:00');
        card.state.should.equal('down');
        card.confidence.should.equal('high');
        reasonOf(card, 'No values above %1 in this period').args.should.eql(['250']);
      });

      it('should add the dawn reason to a basal card in the morning window', function () {
        var t = basalTreatments(0.9);
        for (var di = 0; di < 9; di++) t.push(bolusAt(di, 6, 30, 1.2));
        var res = engine.buildRecommendations(input({ treatments: t }));
        res.basis.dawnBoluses.should.equal(9);
        reasonOf(cardAt(res, '01:00-06:00'), DAWN).args.should.eql(['9', '14', '1.2']);
        basalCards(res).forEach(function eachCard (c) {
          if (c.timeLabel !== '01:00-06:00') reasonOf(c, DAWN).args.should.eql(['9', '14', '1.2']);
        });
      });

      it('should count dawn and unclear boluses only on report days', function () {
        var t = basalTreatments(0.9);
        for (var di = 0; di < 9; di++) t.push(bolusAt(di, 6, 30, 1.2));
        t.push(bolusAt(-1, 6, 30, 1.2));
        t.push(bolusAt(DAYS, 6, 30, 1.2));
        t.push(bolusAt(-1, 13, 0, 3));
        var res = engine.buildRecommendations(input({ treatments: t }));
        reasonOf(cardAt(res, '01:00-06:00'), DAWN).args.should.eql(['9', '14', '1.2']);
        res.basis.dawnBoluses.should.equal(9);
        res.basis.unclearBoluses.should.equal(0);
      });

      it('should sort warnings and suggestions first, then ok, then insufficient', function () {
        var res = engine.buildRecommendations(input({ readingsByDay: hypoOnDays(4, 3) }));
        var groups = res.cards.map(function group (c) {
          if (c.state === 'ok') return 1;
          if (c.state === 'insufficient') return 2;
          return 0;
        });
        groups.should.eql(groups.slice().sort());
        res.cards[0].state.should.equal('warning');
        res.cards[1].state.should.equal('ok');
        res.cards[res.cards.length - 1].state.should.equal('insufficient');
      });

      it('should give 1 to 4 reasons with string args and a basis line on every card', function () {
        var res = engine.buildRecommendations(input({ readingsByDay: hypoOnDays(1, 3) }));
        res.cards.length.should.be.above(4);
        res.cards.forEach(function eachCard (c) {
          c.reasons.length.should.be.within(1, 4);
          c.reasons.concat([c.basisLine]).forEach(function eachReason (r) {
            r.key.should.be.a.String();
            r.args.forEach(function str (a) { a.should.be.a.String(); });
          });
        });
      });

      it('should report the data basis and the profile switch flag', function () {
        var res = engine.buildRecommendations(input({ profileSwitch: true }));
        res.basis.days.should.equal(14);
        res.basis.pumpDays.should.equal(14);
        res.basis.fastingWindows.should.be.above(0);
        res.basis.mealsWithCarbs.should.equal(0);
        res.basis.unclearBoluses.should.equal(0);
        res.profileSwitch.should.equal(true);
      });

      it('should give one insufficient basal card without pump data', function () {
        var res = engine.buildRecommendations(input({ treatments: [], pumpDayKeys: [] }));
        var basal = basalCards(res);
        basal.length.should.equal(1);
        basal[0].state.should.equal('insufficient');
        basal[0].reasons[0].key.should.equal('No pump basal data, basal recommendations are not available');
        res.cards.forEach(function eachCard (c) { c.state.should.equal('insufficient'); });
      });

      it('should convert mmol readings to mg/dl at the entry (13.9 mmol counts as above 240)', function () {
        var bg = function mmol () { return 13.9; };
        var byDay = readings(bg);
        var t = [bolusAt(0, 14, 0, 2)];
        var extras = engine.computePumpExtras(Object.assign(input({ treatments: t, pumpDayKeys: [], readingsByDay: byDay }), { units: 'mmol' }));
        extras.readingsByDayMgdl[dayKey(0)][0].sgv.should.be.above(240);
        byDay[dayKey(0)][0].sgv.should.equal(13.9);
        extras.recommendations.basis.unclearBoluses.should.equal(0);
        var mgdl = engine.computePumpExtras(input({ treatments: t, pumpDayKeys: [], readingsByDay: readings(bg) }));
        mgdl.recommendations.basis.unclearBoluses.should.equal(1);
      });

      it('should never throw on empty input', function () {
        var res = engine.buildRecommendations({});
        res.cards.length.should.be.above(0);
        res.cards.forEach(function eachCard (c) { c.state.should.equal('insufficient'); });
      });

      it('should only use reason keys that exist in en, de_DE and lt_LT', function () {
        var root = path.join(__dirname, '..');
        var dicts = ['translations/en/en.json', 'translations/de_DE.json', 'translations/lt_LT.json'].map(function load (rel) {
          return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
        });
        var t = basalTreatments(0.9);
        for (var di = 0; di < 9; di++) t.push(bolusAt(di, 6, 30, 1.2));
        var drift = function drift (di, h, m) {
          var tm = h * 60 + m;
          if (tm >= 120 && tm < 360) return 130 + (tm - 120) * 9 / 60;
          if (tm >= 360 && tm < 600) return 166 - (tm - 360) * 9 / 60;
          return 130;
        };
        var results = [
          engine.buildRecommendations(input({ treatments: t, readingsByDay: hypoOnDays(4, 3) }))
          , engine.buildRecommendations(input({ treatments: t, readingsByDay: hypoOnDays(1, 3) }))
          , engine.buildRecommendations(input({ treatments: [], pumpDayKeys: [] }))
          , engine.buildRecommendations(input({ readingsByDay: readings(drift) }))
        ];
        var used = [engine.PROFILE_SWITCH_KEY];
        results.forEach(function eachResult (res) {
          res.cards.forEach(function eachCard (c) {
            c.reasons.concat([c.basisLine], c.confidenceNote ? [c.confidenceNote] : []).forEach(function eachReason (r) { used.push(r.key); });
          });
        });
        used.forEach(function present (k) {
          dicts.forEach(function inDict (d) { d.should.have.property(k); });
        });
      });
    });

    describe('counter-signal over all meals and corrections (R21)', function () {
      var MORE_WARNING = 'More insulin would fit here, but hypo on %1/%2 days, clarify the cause first';

      function carbsAt (dayIdx, hour, minute, carbs) {
        var ms = at(dayIdx, hour, minute);
        return { eventType: 'Carb Correction', created_at: new Date(ms).toISOString(), mills: ms, utcOffset: OFFSET_MIN, carbs: carbs };
      }
      function slotCard (res, kind, slot) {
        return res.cards.filter(function match (c) { return c.kind === kind && (!slot || c.slot === slot); })[0];
      }

      // 8 lunches at 12:00 (50 g / 5 U, CR 10, ISF 30, no pump). On normal days
      // BG ends 30 mg/dl high (d +0.2). On hypoDays BG falls to 55 for 30 min
      // and a 15 g hypo treatment at 14:15 drops the meal as "other meal".
      function lunchInput (hypoDays) {
        var t = [];
        for (var di = 0; di < DAYS; di++) {
          var hypo = hypoDays.indexOf(di) !== -1;
          if (di < 8) t.push(bolusAt(di, 12, 0, 5, { eventType: 'Meal Bolus', carbs: 50 }));
          if (hypo) t.push(carbsAt(di, 14, 15, 15));
        }
        var bg = function lunch (di, h, m) {
          var t2 = h * 60 + m;
          if (di < 0 || di >= 8 || t2 < 720 || t2 > 990) return undefined;
          if (hypoDays.indexOf(di) !== -1) {
            if (t2 < 840) return 130 - (t2 - 720) * 75 / 120;
            if (t2 < 870) return 55;
            return 55 + (t2 - 870) * 75 / 120;
          }
          if (t2 <= 780) return 130 + (t2 - 720);
          return 190 - (t2 - 780) * 30 / 180;
        };
        return input({ treatments: t, pumpDayKeys: [], readingsByDay: readings(bg) });
      }

      // 10 corrections of 2 U at 14:00 with BG 250 (ISF 30, no pump). On normal
      // days BG falls only 40 mg/dl in 3 h (measured 20 per U, d +0.5). On
      // hypoDays BG falls to 60 and a hypo treatment at 15:40 disturbs the case.
      function correctionInput (hypoDays) {
        var t = [];
        for (var di = 0; di < DAYS; di++) {
          var hypo = hypoDays.indexOf(di) !== -1;
          if (di < 10) t.push(bolusAt(di, 14, 0, 2));
          if (hypo) t.push(carbsAt(di, 15, 40, 15));
        }
        var bg = function corr (di, h, m) {
          var t2 = h * 60 + m;
          if (di < 0 || di >= 10 || t2 < 780 || t2 > 1020) return undefined;
          if (t2 <= 840) return 250;
          if (hypoDays.indexOf(di) !== -1) {
            if (t2 < 930) return 250 - (t2 - 840) * 190 / 90;
            if (t2 < 950) return 60;
            return undefined;
          }
          return 250 - (t2 - 840) * 40 / 180;
        };
        return input({ treatments: t, pumpDayKeys: [], readingsByDay: readings(bg) });
      }

      it('should warn instead of suggesting a stronger carb ratio when 3 of 8 lunches end in a hypo', function () {
        var card = slotCard(engine.buildRecommendations(lunchInput([5, 6, 7])), 'carbratio', 'lunch');
        card.state.should.equal('warning');
        card.direction.should.equal('up');
        reasonOf(card, MORE_WARNING).args.should.eql(['3', '8']);
        (reasonOf(card, 'No hypo in this period') === undefined).should.equal(true);
        card.rows.forEach(function noNew (r) { (r.newValue === null).should.equal(true); });
      });

      it('should downgrade the lunch card and name the hypo when 1 of 8 lunches ends in a hypo', function () {
        var card = slotCard(engine.buildRecommendations(lunchInput([7])), 'carbratio', 'lunch');
        card.state.should.equal('up');
        card.caseCount.should.equal(7);
        card.confidence.should.equal('medium');
        reasonOf(card, 'Hypo on %1/%2 days').args.should.eql(['1', '8']);
      });

      it('should warn instead of suggesting a stronger ISF when 3 corrections end in a treated hypo', function () {
        var card = slotCard(engine.buildRecommendations(correctionInput([7, 8, 9])), 'isf');
        card.state.should.equal('warning');
        card.direction.should.equal('up');
        reasonOf(card, MORE_WARNING).args.should.eql(['3', '10']);
        (reasonOf(card, 'No hypo in this period') === undefined).should.equal(true);
      });

      it('should keep the ISF suggestion with high confidence without any hypo', function () {
        var card = slotCard(engine.buildRecommendations(correctionInput([])), 'isf');
        card.state.should.equal('up');
        card.confidence.should.equal('high');
        reasonOf(card, 'No hypo in this period').should.be.ok();
      });
    });
  });
});

describe('pump_analysis medianCurve', function () {
  var fr = require('../lib/report_plugins/pump_analysis/factor_recommendations');

  function curve (values) {
    return values.map(function toPoint (v, i) { return { min: i * 5, sgv: v }; });
  }

  it('returns the median per minute over three curves', function () {
    var m = fr.medianCurve([
      { curve: curve([100, 150, 200]) }
      , { curve: curve([120, 130, 220]) }
      , { curve: curve([110, 170, 180]) }
    ]);
    m.should.eql([{ min: 0, sgv: 110 }, { min: 5, sgv: 150 }, { min: 10, sgv: 200 }]);
  });

  it('uses the available values where curves have gaps and omits minutes without values', function () {
    var m = fr.medianCurve([
      { curve: [{ min: 0, sgv: 100 }, { min: 10, sgv: 200 }] }
      , { curve: [{ min: 0, sgv: 120 }, { min: 5, sgv: 150 }, { min: 10, sgv: 220 }] }
      , { curve: [{ min: 20, sgv: 90 }] }
    ]);
    m.should.eql([{ min: 0, sgv: 110 }, { min: 5, sgv: 150 }, { min: 10, sgv: 210 }, { min: 20, sgv: 90 }]);
  });

  it('returns an empty array for no cases, missing curves or non-finite values', function () {
    fr.medianCurve([]).should.eql([]);
    fr.medianCurve(null).should.eql([]);
    fr.medianCurve([{}, { curve: [{ min: 0, sgv: NaN }, { min: 5, sgv: null }] }]).should.eql([]);
  });
});
