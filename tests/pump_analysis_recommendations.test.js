'use strict';

require('should');

describe('pump_analysis recommendations', function () {

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
});
