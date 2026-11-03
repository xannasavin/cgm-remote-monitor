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
        find(cases, 0, 11).d.should.be.approximately(-1 / 0.8, 1e-6);
      });

      it('should count auto boluses in the hour into d', function () {
        var t = baseTreatments().concat([bolusAt(0, 3, 20, 0.3, { notes: 'Automatic Bolus' })]);
        var c = find(run({ treatments: t }), 0, 3);
        c.autoU.should.be.approximately(0.3, 1e-9);
        c.d.should.be.approximately((0.9 + 0.3) / 0.6 - 1, 1e-6);
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
});
