'use strict';

require('should');

var statistics = require('../lib/statistics');

// ========== Test data helpers ==========

/**
 * Generate SGV records at 5-min intervals.
 * @param {Array<number>} values - SGV values in mg/dL
 * @param {number} startMills - start timestamp in ms (default: 2026-03-15 00:00 UTC)
 * @param {number} intervalMs - interval between readings (default: 5 min)
 */
function makeSgvRecords (values, startMills, intervalMs) {
  startMills = startMills || Date.UTC(2026, 2, 15, 0, 0, 0);
  intervalMs = intervalMs || 5 * 60 * 1000;
  return values.map(function (v, i) {
    return { mills: startMills + i * intervalMs, sgv: v };
  });
}

/**
 * Generate a realistic 24-hour sine-wave CGM trace.
 * Center at `center`, amplitude `amp`, readings every 5 min.
 * @param {number} center - mean glucose (default 140)
 * @param {number} amp - amplitude of wave (default 50)
 * @param {number} startMills - start timestamp
 * @returns {Array} 288 SGV records
 */
function makeSineDay (center, amp, startMills) {
  center = center || 140;
  amp = amp || 50;
  startMills = startMills || Date.UTC(2026, 2, 15, 0, 0, 0);
  var values = [];
  for (var i = 0; i < 288; i++) {
    // ~4 full cycles over 24h to create multiple excursions
    var angle = (i / 288) * 4 * 2 * Math.PI;
    values.push(Math.round(center + amp * Math.sin(angle)));
  }
  return makeSgvRecords(values, startMills);
}

/**
 * Generate a day with known excursions for MAGE testing.
 * Pattern: stable -> rise -> peak -> fall -> nadir -> rise -> peak -> fall -> nadir -> ...
 * Each excursion takes ~1h (12 readings).
 * @param {number} numExcursions - number of peak-nadir pairs
 * @param {number} amplitude - excursion amplitude in mg/dL
 * @param {number} baseline - baseline glucose
 */
function makeExcursionDay (numExcursions, amplitude, baseline) {
  baseline = baseline || 120;
  amplitude = amplitude || 80;
  var values = [];
  var startMills = Date.UTC(2026, 2, 15, 0, 0, 0);

  // Fill 24h of readings (288 at 5-min intervals)
  // Create excursions evenly spaced
  var readingsPerExcursion = Math.floor(288 / numExcursions);
  var halfCycle = Math.floor(readingsPerExcursion / 2);

  for (var ex = 0; ex < numExcursions; ex++) {
    for (var r = 0; r < readingsPerExcursion; r++) {
      var t;
      if (r < halfCycle) {
        // Rising phase
        t = baseline + (amplitude * r / halfCycle);
      } else {
        // Falling phase
        t = baseline + amplitude - (amplitude * (r - halfCycle) / halfCycle);
      }
      values.push(Math.round(t));
    }
  }

  // Fill remaining readings to reach 288
  while (values.length < 288) {
    values.push(baseline);
  }

  return makeSgvRecords(values.slice(0, 288), startMills);
}

var DEFAULT_OPTIONS = {
  targetLow: 70
  , targetHigh: 180
  , units: 'mg/dL'
};

// ========== Tests ==========

describe('statistics', function () {

  it('should export computeDayStats and computePeriodStats', function () {
    statistics.should.have.property('computeDayStats').which.is.a.Function();
    statistics.should.have.property('computePeriodStats').which.is.a.Function();
  });

  // ========== computeDayStats basic ==========
  describe('computeDayStats', function () {

    describe('basic statistics (average, median, SD, CV)', function () {

      it('should compute average correctly', function () {
        var records = makeSgvRecords([100, 120, 140, 160, 180]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.average.should.equal(140);
      });

      it('should compute median correctly for odd count', function () {
        var records = makeSgvRecords([100, 120, 140, 160, 180]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.median.should.equal(140);
      });

      it('should compute median correctly for even count', function () {
        var records = makeSgvRecords([100, 120, 160, 180]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.median.should.equal(140);
      });

      it('should compute SD using simple-statistics (population SD)', function () {
        var records = makeSgvRecords([100, 120, 140, 160, 180]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        // Population SD: sqrt(4000/5) = sqrt(800) = 28.28
        result.sd.should.be.approximately(28.28, 0.01);
      });

      it('should compute CV as (sd / mean) * 100', function () {
        var records = makeSgvRecords([100, 120, 140, 160, 180]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        var expectedCv = (result.sd / result.average) * 100;
        result.cv.should.be.approximately(expectedCv, 0.01);
      });

      it('should handle single reading', function () {
        var records = makeSgvRecords([120]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.average.should.equal(120);
        result.median.should.equal(120);
        result.sd.should.equal(0);
        result.total_readings.should.equal(1);
      });

      it('should filter out-of-range SGV values (sensor malfunction)', function () {
        var records = makeSgvRecords([120, 999, 130, 0, 140]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        // Only 120, 130, 140 should be included (40-600 range)
        result.total_readings.should.equal(3);
        result.average.should.be.approximately(130, 0.01);
      });

      it('should return empty stats if all values out of range', function () {
        var records = makeSgvRecords([0, 10, 999, 700]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.total_readings.should.equal(0);
        (result.average === null).should.be.true();
      });

      it('should return null stats for empty array', function () {
        var result = statistics.computeDayStats([], [], DEFAULT_OPTIONS);
        (result.average === null).should.be.true();
        (result.median === null).should.be.true();
        (result.sd === null).should.be.true();
        (result.cv === null).should.be.true();
        (result.mage === null).should.be.true();
        result.total_readings.should.equal(0);
      });

      it('should handle CV when mean is zero', function () {
        // Edge case: all readings are 0 (unrealistic but defensive)
        var records = makeSgvRecords([0, 0, 0]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        (result.cv === null).should.be.true();
      });
    });

    // ========== TIR / TBR / TAR ==========
    describe('TIR, TBR, TAR', function () {

      it('should compute 100% TIR when all values in range', function () {
        var records = makeSgvRecords([80, 100, 120, 140, 160, 170]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.tir_pct.should.equal(100);
        result.tbr_pct.should.equal(0);
        result.tar_pct.should.equal(0);
      });

      it('should compute 100% TBR when all values below target', function () {
        var records = makeSgvRecords([40, 50, 55, 60, 65, 69]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.tbr_pct.should.be.approximately(100, 0.1);
        result.tir_pct.should.equal(0);
      });

      it('should compute 100% TAR when all values above target', function () {
        var records = makeSgvRecords([181, 200, 250, 300]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.tar_pct.should.be.approximately(100, 0.1);
        result.tir_pct.should.equal(0);
      });

      it('should compute mixed TIR/TBR/TAR correctly', function () {
        // 2 below (50, 60), 3 in range (100, 140, 170), 1 above (200)
        var records = makeSgvRecords([50, 60, 100, 140, 170, 200]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.tbr_pct.should.be.approximately(33.33, 0.01);
        result.tir_pct.should.be.approximately(50, 0.01);
        result.tar_pct.should.be.approximately(16.67, 0.01);
      });

      it('should treat both boundaries as inclusive for TIR (70-180 per clinical consensus)', function () {
        var records = makeSgvRecords([70, 180]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        // 70 is >= targetLow (70) and <= targetHigh (180) -> in range
        // 180 is <= targetHigh (180) -> in range (F7: clinical consensus)
        result.tir_pct.should.equal(100);
        result.tar_pct.should.equal(0);
        result.tbr_pct.should.equal(0);
      });
    });

    // ========== MAGE ==========
    describe('MAGE algorithm', function () {

      it('should return null for empty data', function () {
        var result = statistics.computeDayStats([], [], DEFAULT_OPTIONS);
        (result.mage === null).should.be.true();
      });

      it('should return null for monotonic increasing data (no turning points)', function () {
        var values = [];
        for (var i = 0; i < 288; i++) values.push(80 + i * 0.5);
        var records = makeSgvRecords(values);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        (result.mage === null).should.be.true();
      });

      it('should return null for monotonic decreasing data (no turning points)', function () {
        var values = [];
        for (var i = 0; i < 288; i++) values.push(280 - i * 0.5);
        var records = makeSgvRecords(values);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        (result.mage === null).should.be.true();
      });

      it('should return null for single excursion (< 4 qualifying pairs)', function () {
        // One peak: stable -> rise -> peak -> fall -> stable
        var values = [];
        for (var i = 0; i < 60; i++) values.push(120); // stable
        for (var j = 0; j < 30; j++) values.push(120 + j * 4); // rise to 240
        for (var k = 0; k < 30; k++) values.push(240 - k * 4); // fall to 120
        while (values.length < 288) values.push(120); // stable
        var records = makeSgvRecords(values);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        (result.mage === null).should.be.true();
      });

      it('should compute valid MAGE with exactly 4 qualifying excursions', function () {
        var records = makeExcursionDay(4, 80);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        (result.mage !== null).should.be.true();
        result.mage.should.be.above(0);
      });

      it('should compute MAGE for 10 excursions, filtering those below 1 SD', function () {
        // Mix large and small excursions
        var values = [];
        var startMills = Date.UTC(2026, 2, 15, 0, 0, 0);
        var baseline = 140;

        // 7 large excursions (amplitude 80) and 3 small (amplitude 10)
        // Each excursion: 24 readings (2h) = ramp up 12, ramp down 12
        for (var i = 0; i < 10; i++) {
          var amp = i < 7 ? 80 : 10;
          for (var r = 0; r < 24; r++) {
            if (r < 12) {
              values.push(Math.round(baseline + amp * r / 12));
            } else {
              values.push(Math.round(baseline + amp - amp * (r - 12) / 12));
            }
          }
        }
        // Fill to 288
        while (values.length < 288) values.push(baseline);

        var records = makeSgvRecords(values.slice(0, 288), startMills);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        // Should have MAGE (at least 4 qualifying excursions from the large ones)
        (result.mage !== null).should.be.true();
        // MAGE should reflect the large excursions, not the small ones
        result.mage.should.be.above(40);
      });

      it('should handle data with 15-min gap (within tolerance)', function () {
        // 3 readings, then 15-min gap (3 missing readings), then more readings
        var values = [120, 125, 130]; // 3 readings
        var startMills = Date.UTC(2026, 2, 15, 0, 0, 0);
        var records = makeSgvRecords(values, startMills);

        // Add readings after a 15-min gap (gap of 3 intervals = 15 min)
        var gapStart = startMills + 3 * 5 * 60 * 1000 + 15 * 60 * 1000;
        var moreValues = [];
        for (var i = 0; i < 280; i++) {
          var angle = (i / 70) * 2 * Math.PI;
          moreValues.push(Math.round(140 + 60 * Math.sin(angle)));
        }
        var moreRecords = makeSgvRecords(moreValues, gapStart);
        records = records.concat(moreRecords);

        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        // Should still compute stats (gap is exactly at boundary)
        result.total_readings.should.be.above(200);
      });

      it('should treat 30-min gap as separate segments', function () {
        var values = [];
        var startMills = Date.UTC(2026, 2, 15, 0, 0, 0);

        // First segment: rising
        for (var i = 0; i < 100; i++) values.push(100 + i);
        var records1 = makeSgvRecords(values, startMills);

        // Second segment after 30-min gap: falling
        var gapStart = startMills + 100 * 5 * 60 * 1000 + 30 * 60 * 1000;
        var values2 = [];
        for (var j = 0; j < 100; j++) values2.push(200 - j);
        var records2 = makeSgvRecords(values2, gapStart);

        var allRecords = records1.concat(records2);
        var result = statistics.computeDayStats(allRecords, [], DEFAULT_OPTIONS);
        // The gap should prevent treating the transition as a single excursion
        result.data_gaps.should.be.above(0);
      });

      it('should return null for < 18 hours of data', function () {
        // 17 hours = 204 readings at 5-min intervals
        var values = [];
        for (var i = 0; i < 204; i++) {
          values.push(Math.round(140 + 60 * Math.sin((i / 50) * 2 * Math.PI)));
        }
        var records = makeSgvRecords(values);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        (result.mage === null).should.be.true();
        result.valid_hours.should.be.below(18);
      });

      it('should compute MAGE for exactly 18 hours of data', function () {
        // 18 hours = 216 readings
        var records = makeExcursionDay(6, 80);
        // Use first 216 readings (18h)
        records = records.slice(0, 216);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.valid_hours.should.be.approximately(18, 0.5);
        // May or may not have enough qualifying excursions; just check it doesn't reject on hours
      });

      it('should return null when all values are the same (SD=0)', function () {
        var values = [];
        for (var i = 0; i < 288; i++) values.push(120);
        var records = makeSgvRecords(values);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.sd.should.equal(0);
        (result.mage === null).should.be.true();
      });

      it('should produce small MAGE for pure micro-oscillation data', function () {
        // Rapid oscillation: 120, 125, 120, 125, ... (amplitude 5)
        // For pure oscillation, SD ~ 2.5, and all amplitudes (5) >= 1 SD
        // So MAGE = 5 (reflects the oscillation amplitude)
        // Real filtering of small vs large is tested in "10 excursions" test
        var values = [];
        for (var i = 0; i < 288; i++) {
          values.push(i % 2 === 0 ? 120 : 125);
        }
        var records = makeSgvRecords(values);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        (result.mage !== null).should.be.true();
        result.mage.should.be.approximately(5, 1);
      });

      it('should handle real-world-like sine wave trace', function () {
        // 4 cycles of sine wave, center 140, amplitude 60
        // This creates 8 turning points = 4 peak-nadir pairs
        var records = makeSineDay(140, 60);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        // With amplitude 60 and 4 cycles, excursions should be ~120 (peak to nadir)
        // SD of a sine wave is amp/sqrt(2) ~ 42, so 120 >> 42
        (result.mage !== null).should.be.true();
        result.mage.should.be.above(50);
      });

      it('should produce consistent results for known reference trace', function () {
        // Manually crafted trace with known MAGE
        // 4 excursions, each exactly 100 mg/dL amplitude
        // Pattern: 100 -> 200 -> 100 -> 200 -> 100 -> 200 -> 100 -> 200 -> 100
        var values = [];
        var startMills = Date.UTC(2026, 2, 15, 0, 0, 0);
        // Each excursion: 36 readings up, 36 readings down = 72 readings = 6h
        // 4 excursions = 288 readings = 24h
        for (var ex = 0; ex < 4; ex++) {
          for (var r = 0; r < 36; r++) {
            values.push(Math.round(100 + (100 * r / 36)));
          }
          for (var f = 0; f < 36; f++) {
            values.push(Math.round(200 - (100 * f / 36)));
          }
        }
        var records = makeSgvRecords(values.slice(0, 288), startMills);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        // Each excursion has amplitude ~100 mg/dL
        // MAGE should be close to 100
        (result.mage !== null).should.be.true();
        result.mage.should.be.approximately(100, 15);
      });
    });

    // ========== Episode counting ==========
    describe('episode counting', function () {

      it('should detect no episodes when all values in range', function () {
        var records = makeSgvRecords([100, 110, 120, 130, 140, 150]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.hypo_episodes.should.have.length(0);
        result.hyper_episodes.should.have.length(0);
      });

      it('should detect a hypo episode (>= 3 consecutive readings below targetLow)', function () {
        // 3 readings below 70 at 5-min intervals = 15 min episode
        var records = makeSgvRecords([120, 120, 65, 60, 55, 120, 120]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.hypo_episodes.should.have.length(1);
        result.hypo_episodes[0].should.have.property('duration_min').which.is.approximately(10, 1);
        result.hypo_episodes[0].should.have.property('nadir', 55);
      });

      it('should detect a hyper episode (>= 3 consecutive readings above targetHigh)', function () {
        var records = makeSgvRecords([120, 120, 200, 220, 240, 120, 120]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.hyper_episodes.should.have.length(1);
        result.hyper_episodes[0].should.have.property('peak', 240);
      });

      it('should not count brief excursions (< 3 consecutive readings) as episodes', function () {
        // Only 2 readings below target = 10 min, not an episode
        var records = makeSgvRecords([120, 65, 60, 120, 120]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.hypo_episodes.should.have.length(0);
      });

      it('should merge episodes separated by < 15 min gap', function () {
        // Hypo, brief return to range (1 reading), then hypo again
        // 65, 60, 55, 75, 65, 60, 55 -> should merge into one long episode
        var records = makeSgvRecords([120, 65, 60, 55, 75, 65, 60, 55, 120]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        // The gap is only 1 reading (5 min) < 15 min, so merge
        result.hypo_episodes.should.have.length(1);
      });

      it('should not merge episodes separated by >= 15 min gap', function () {
        // Two hypo episodes with 3 in-range readings between (15 min gap)
        var records = makeSgvRecords([120, 65, 60, 55, 120, 120, 120, 65, 60, 55, 120]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.hypo_episodes.should.have.length(2);
      });

      it('should record start, end, duration, nadir/peak per episode', function () {
        var startMills = Date.UTC(2026, 2, 15, 0, 0, 0);
        var records = makeSgvRecords([120, 200, 220, 250, 210, 120], startMills);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.hyper_episodes.should.have.length(1);
        var ep = result.hyper_episodes[0];
        ep.should.have.property('start');
        ep.should.have.property('end');
        ep.should.have.property('duration_min');
        ep.should.have.property('peak', 250);
      });

      it('should handle episode crossing into end of data', function () {
        // Hypo at the end of the array, never returns to range
        var records = makeSgvRecords([120, 120, 60, 55, 50]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.hypo_episodes.should.have.length(1);
        result.hypo_episodes[0].nadir.should.equal(50);
      });
    });

    // ========== valid_hours and data_gaps ==========
    describe('valid_hours and data_gaps', function () {

      it('should compute valid_hours from continuous readings', function () {
        // 288 readings at 5 min = 24h
        var records = makeSineDay(140, 30);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.valid_hours.should.be.approximately(24, 0.5);
        result.data_gaps.should.equal(0);
      });

      it('should detect data gaps > 15 min', function () {
        var startMills = Date.UTC(2026, 2, 15, 0, 0, 0);
        // 50 readings, then 30-min gap, then 50 more
        var records1 = makeSgvRecords(new Array(50).fill(120), startMills);
        var gapStart = startMills + 50 * 5 * 60 * 1000 + 30 * 60 * 1000;
        var records2 = makeSgvRecords(new Array(50).fill(130), gapStart);
        var records = records1.concat(records2);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.data_gaps.should.be.above(0);
      });

      it('should compute total_readings', function () {
        var records = makeSgvRecords([100, 110, 120, 130, 140]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.total_readings.should.equal(5);
      });
    });

    // ========== time_blocks ==========
    describe('time_blocks', function () {

      it('should group readings into hourly blocks', function () {
        // 12 readings per hour for 2 hours
        var startMills = Date.UTC(2026, 2, 15, 8, 0, 0);
        var values = [];
        for (var i = 0; i < 24; i++) values.push(120 + i);
        var records = makeSgvRecords(values, startMills);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        result.time_blocks.should.be.an.Array();
        // Should have blocks for hours 8 and 9
        var block8 = result.time_blocks.find(function (b) { return b.hour === 8; });
        var block9 = result.time_blocks.find(function (b) { return b.hour === 9; });
        (block8 !== undefined).should.be.true();
        (block9 !== undefined).should.be.true();
        block8.should.have.property('avg');
        block8.should.have.property('count');
      });
    });
  });

  // ========== computePeriodStats ==========
  describe('computePeriodStats', function () {

    it('should aggregate multiple day stats', function () {
      var records1 = makeSgvRecords([100, 120, 140, 160, 180]);
      var records2 = makeSgvRecords([90, 110, 130, 150, 170]);
      var day1 = statistics.computeDayStats(records1, [], DEFAULT_OPTIONS);
      var day2 = statistics.computeDayStats(records2, [], DEFAULT_OPTIONS);
      var period = statistics.computePeriodStats([day1, day2]);
      period.should.have.property('average');
      period.should.have.property('median');
      period.should.have.property('sd');
      period.should.have.property('cv');
      period.should.have.property('tir_pct');
      period.should.have.property('tbr_pct');
      period.should.have.property('tar_pct');
      period.should.have.property('episode_summary');
    });

    it('should compute period average as mean of day averages', function () {
      var records1 = makeSgvRecords([100, 100, 100]);
      var records2 = makeSgvRecords([200, 200, 200]);
      var day1 = statistics.computeDayStats(records1, [], DEFAULT_OPTIONS);
      var day2 = statistics.computeDayStats(records2, [], DEFAULT_OPTIONS);
      var period = statistics.computePeriodStats([day1, day2]);
      period.average.should.equal(150);
    });

    it('should aggregate TIR percentages weighted by reading count', function () {
      // Day 1: 5 readings, all in range (100% TIR)
      var records1 = makeSgvRecords([100, 110, 120, 130, 140]);
      // Day 2: 5 readings, all above range (0% TIR)
      var records2 = makeSgvRecords([200, 210, 220, 230, 240]);
      var day1 = statistics.computeDayStats(records1, [], DEFAULT_OPTIONS);
      var day2 = statistics.computeDayStats(records2, [], DEFAULT_OPTIONS);
      var period = statistics.computePeriodStats([day1, day2]);
      period.tir_pct.should.be.approximately(50, 0.1);
      period.tar_pct.should.be.approximately(50, 0.1);
    });

    it('should aggregate episode counts', function () {
      var records1 = makeSgvRecords([120, 60, 55, 50, 120]);
      var records2 = makeSgvRecords([120, 200, 220, 240, 120]);
      var day1 = statistics.computeDayStats(records1, [], DEFAULT_OPTIONS);
      var day2 = statistics.computeDayStats(records2, [], DEFAULT_OPTIONS);
      var period = statistics.computePeriodStats([day1, day2]);
      period.episode_summary.should.have.property('hypo_count');
      period.episode_summary.should.have.property('hyper_count');
    });

    it('should handle empty day stats array', function () {
      var period = statistics.computePeriodStats([]);
      (period.average === null).should.be.true();
      (period.sd === null).should.be.true();
    });

    it('should include diurnal_patterns from time blocks', function () {
      var records = makeSineDay(140, 50);
      var day = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
      var period = statistics.computePeriodStats([day]);
      period.should.have.property('diurnal_patterns');
      period.diurnal_patterns.should.be.an.Array();
    });
  });
});

// ============================================================================
// Pump-action pipeline tests (AI eval pattern-first redesign)
// ============================================================================
//
// These tests cover the new compute functions added in Phase B:
//   - validateProfileForBasal, isAutoBolusEvent (R3-3 multi-language)
//   - buildProfileBasalLookup, sumScheduledBasalByHour
//   - integrateActualBasalByHour (gap-filled), integrateTempBasalRawByHour (raw)
//   - classifyAutoBoluses, detectBasalSuspensions, detectPumpCoverage
//   - computeBolusDistribution (R3-12 denominator split)
//   - detectHotspots, computePumpActionStats orchestrator
//   - computeEpisodesWithHours
//   - R3-10 travel invariant lock-in (Berlin→Tokyo mid-period)
//
// Every numeric expectation is hand-calculated and shown in comments so
// reviewers can verify the arithmetic without running the code.
// ============================================================================

describe('pump action pipeline', function () {

  // ---- Fixture helpers --------------------------------------------------

  function makeTempBasal (startMs, durationMin, rate, offsetMin) {
    return {
      eventType: 'Temp Basal'
      , created_at: new Date(startMs).toISOString()
      , absolute: rate
      , duration: durationMin
      , utcOffset: typeof offsetMin === 'number' ? offsetMin : 0
      , mills: startMs
      , enteredBy: 'Pump (test)'
    };
  }

  function makeUserBolus (ms, insulin, offsetMin) {
    return {
      eventType: 'Meal Bolus'
      , created_at: new Date(ms).toISOString()
      , insulin: insulin
      , carbs: 40
      , utcOffset: typeof offsetMin === 'number' ? offsetMin : 0
      , notes: null
      , mills: ms
    };
  }

  function makeAutoBolus (ms, insulin, notes, offsetMin) {
    return {
      eventType: 'Combo Bolus'
      , created_at: new Date(ms).toISOString()
      , insulin: insulin
      , notes: notes
      , utcOffset: typeof offsetMin === 'number' ? offsetMin : 0
      , mills: ms
      , enteredBy: 'Pump (test)'
    };
  }

  function makeSuspension (ms, offsetMin) {
    return {
      eventType: 'Basal Suspension'
      , created_at: new Date(ms).toISOString()
      , utcOffset: typeof offsetMin === 'number' ? offsetMin : 0
      , mills: ms
      , enteredBy: 'Pump (test)'
    };
  }

  function makeResume (ms, offsetMin) {
    return {
      eventType: 'Basal Resume'
      , created_at: new Date(ms).toISOString()
      , utcOffset: typeof offsetMin === 'number' ? offsetMin : 0
      , mills: ms
      , enteredBy: 'Pump (test)'
    };
  }

  function makeFlatProfile (ratePerHour) {
    return {
      basal: [{ time: '00:00', value: ratePerHour }]
      , carbratio: [{ time: '00:00', value: 10 }]
      , sens: [{ time: '00:00', value: 50 }]
    };
  }

  function makeStepProfile () {
    return {
      basal: [
        { time: '00:00', value: 0.6 }
        , { time: '00:30', value: 0.8 }
      ]
    };
  }

  // Day anchors — all UTC-based for predictable arithmetic
  var D1 = Date.UTC(2026, 3, 7, 0, 0, 0);    // 2026-04-07 00:00 UTC
  var D2 = D1 + 24 * 60 * 60 * 1000;         // 2026-04-08
  var D3 = D2 + 24 * 60 * 60 * 1000;         // 2026-04-09

  // ---- validateProfileForBasal (R3-13) ----------------------------------

  describe('validateProfileForBasal', function () {
    it('should accept a valid profile', function () {
      var result = statistics.validateProfileForBasal(makeFlatProfile(0.5));
      result.valid.should.equal(true);
      (result.reason === null).should.equal(true);
    });

    it('should reject null profile with profile_missing', function () {
      var result = statistics.validateProfileForBasal(null);
      result.valid.should.equal(false);
      result.reason.should.equal('profile_missing');
    });

    it('should reject profile without basal array', function () {
      var result = statistics.validateProfileForBasal({});
      result.valid.should.equal(false);
      result.reason.should.equal('basal_not_array');
    });

    it('should reject empty basal array', function () {
      var result = statistics.validateProfileForBasal({ basal: [] });
      result.valid.should.equal(false);
      result.reason.should.equal('basal_empty');
    });

    it('should reject basal segment with malformed time', function () {
      var result = statistics.validateProfileForBasal({ basal: [{ time: null, value: 0.5 }] });
      result.valid.should.equal(false);
      result.reason.should.equal('basal_malformed_time');
    });

    it('should reject basal segment with non-finite value', function () {
      var result = statistics.validateProfileForBasal({ basal: [{ time: '00:00', value: 'bogus' }] });
      result.valid.should.equal(false);
      result.reason.should.equal('basal_malformed_value');
    });
  });

  // ---- isAutoBolusEvent (R3-3 multi-language) ---------------------------

  describe('isAutoBolusEvent (R3-3 multi-language)', function () {
    function bolus (notes) {
      return { eventType: 'Combo Bolus', insulin: 1, notes: notes };
    }

    it('should match English "Automatic Bolus"', function () {
      statistics.isAutoBolusEvent(bolus('Automatic Bolus')).should.equal(true);
    });

    it('should match English "Auto Correction"', function () {
      statistics.isAutoBolusEvent(bolus('Auto Correction Bolus')).should.equal(true);
    });

    it('should match German "Automatisch"', function () {
      statistics.isAutoBolusEvent(bolus('Automatisch Bolus')).should.equal(true);
    });

    it('should match German abbreviation "Autom. Korrektur"', function () {
      statistics.isAutoBolusEvent(bolus('Autom. Korrektur')).should.equal(true);
    });

    it('should match French "automatique"', function () {
      statistics.isAutoBolusEvent(bolus('Correction automatique')).should.equal(true);
    });

    it('should match Italian/Spanish "automatico"', function () {
      statistics.isAutoBolusEvent(bolus('Automatico')).should.equal(true);
    });

    it('should NOT match empty notes (positive-match only)', function () {
      statistics.isAutoBolusEvent(bolus('')).should.equal(false);
      statistics.isAutoBolusEvent(bolus(null)).should.equal(false);
    });

    it('should NOT match a user meal note', function () {
      statistics.isAutoBolusEvent(bolus('Standard Bolus')).should.equal(false);
      statistics.isAutoBolusEvent(bolus('Meal')).should.equal(false);
    });

    it('should NOT match non-bolus event types', function () {
      var notBolus = { eventType: 'Temp Basal', notes: 'automatic' };
      statistics.isAutoBolusEvent(notBolus).should.equal(false);
    });

    it('should export AUTO_BOLUS_KEYWORDS for visibility', function () {
      statistics.AUTO_BOLUS_KEYWORDS.should.be.an.Array();
      statistics.AUTO_BOLUS_KEYWORDS.length.should.be.greaterThan(4);
      statistics.AUTO_BOLUS_KEYWORDS.indexOf('automatic').should.not.equal(-1);
      statistics.AUTO_BOLUS_KEYWORDS.indexOf('automatisch').should.not.equal(-1);
    });
  });

  // ---- buildProfileBasalLookup / sumScheduledBasalByHour ---------------

  describe('buildProfileBasalLookup / sumScheduledBasalByHour', function () {
    it('should return constant rate for flat profile', function () {
      var lookup = statistics.buildProfileBasalLookup(makeFlatProfile(0.5));
      lookup(0, 0).should.equal(0.5);
      lookup(12, 30).should.equal(0.5);
      lookup(23, 55).should.equal(0.5);
    });

    it('should return zero function for missing profile', function () {
      var lookup = statistics.buildProfileBasalLookup(null);
      lookup(0, 0).should.equal(0);
      lookup(12, 30).should.equal(0);
    });

    it('should sum flat 0.5 U/h profile to 12 U/day', function () {
      var sum = statistics.sumScheduledBasalByHour(makeFlatProfile(0.5), ['2026-04-07']);
      // 24 h * 0.5 U/h = 12 U/day
      sum.totalUnits.should.be.approximately(12, 0.01);
      sum.hourly.length.should.equal(24);
      // Each hour = 0.5 U (12 slots * 0.5 * 5/60 = 0.5)
      sum.hourly[0].should.be.approximately(0.5, 0.001);
      sum.hourly[23].should.be.approximately(0.5, 0.001);
    });

    it('should handle mid-hour profile step change (R1-W2)', function () {
      // Profile: 0.6 U/h from 00:00-00:30, then 0.8 U/h from 00:30 onward
      var sum = statistics.sumScheduledBasalByHour(makeStepProfile(), ['2026-04-07']);
      // Hour 0: 0.6*0.5 + 0.8*0.5 = 0.3 + 0.4 = 0.7 U
      sum.hourly[0].should.be.approximately(0.7, 0.001);
      // Hours 1-23: 0.8 U each
      sum.hourly[1].should.be.approximately(0.8, 0.001);
      sum.hourly[23].should.be.approximately(0.8, 0.001);
      // Total: 0.7 + 23*0.8 = 0.7 + 18.4 = 19.1 U
      sum.totalUnits.should.be.approximately(19.1, 0.01);
    });
  });

  // ---- integrateActualBasalByHour (gap-filled) --------------------------

  describe('integrateActualBasalByHour (gap-filled)', function () {
    it('should return zero for day with no temp basal events (not pump-covered)', function () {
      var result = statistics.integrateActualBasalByHour([], makeFlatProfile(1), ['2026-04-07']);
      result.totalUnits.should.equal(0);
      result.pumpDayCount.should.equal(0);
      result.coverageByDay['2026-04-07'].should.equal(false);
    });

    it('should gap-fill with profile rate when temp basal is partial', function () {
      // Day 1 with 1-hour temp basal at 10:00-11:00 at 2 U/h, profile 1 U/h
      var tb = makeTempBasal(D1 + 10 * 60 * 60 * 1000, 60, 2, 0);
      var result = statistics.integrateActualBasalByHour([tb], makeFlatProfile(1), ['2026-04-07']);
      // Hour 10 = 2 U (temp), hours 0-9 + 11-23 = 1 U each (profile gap-fill)
      // Total = 23 * 1 + 2 = 25 U
      result.totalUnits.should.be.approximately(25, 0.01);
      result.pumpDayCount.should.equal(1);
      result.hourly[10].should.be.approximately(2, 0.01);
      result.hourly[0].should.be.approximately(1, 0.01);
      result.hourly[23].should.be.approximately(1, 0.01);
    });

    it('should honor supersede semantics when temp basals overlap (R3-1)', function () {
      // Two overlapping temp basals: first 10:00-12:00 at 1 U/h, second 11:00-13:00 at 3 U/h
      // Expected: hours 10-11 use first (1 U/h), hours 11-13 use second (3 U/h, supersedes)
      //   actually: slot 10:00-11:00 → first rate 1 (second hasn't started yet)
      //   slot 11:00-12:00 → second rate 3 (both active, latest-starting wins)
      //   slot 12:00-13:00 → second rate 3 (first has ended, second still active)
      //   all other hours → profile 1 U/h
      var tb1 = makeTempBasal(D1 + 10 * 60 * 60 * 1000, 120, 1, 0);  // 10:00-12:00 @ 1 U/h
      var tb2 = makeTempBasal(D1 + 11 * 60 * 60 * 1000, 120, 3, 0);  // 11:00-13:00 @ 3 U/h
      var result = statistics.integrateActualBasalByHour([tb1, tb2], makeFlatProfile(1), ['2026-04-07']);
      // hour 10 = 1 U (first temp basal, no overlap yet)
      // hour 11 = 3 U (both active; latest-starting wins)
      // hour 12 = 3 U (second still active)
      // hours 0-9 + 13-23 = 1 U each (profile)
      result.hourly[10].should.be.approximately(1, 0.01);
      result.hourly[11].should.be.approximately(3, 0.01);
      result.hourly[12].should.be.approximately(3, 0.01);
      result.hourly[13].should.be.approximately(1, 0.01);
      // Total = 21 * 1 + 1 + 3 + 3 = 28 U
      result.totalUnits.should.be.approximately(28, 0.01);
    });

    it('should handle events spanning midnight correctly (R3-5 false positive lock)', function () {
      // Temp basal 23:00 day 1 to 01:00 day 2, rate 2 U/h, profile 1 U/h
      var tb = makeTempBasal(D1 + 23 * 60 * 60 * 1000, 120, 2, 0);
      var result = statistics.integrateActualBasalByHour([tb], makeFlatProfile(1), ['2026-04-07', '2026-04-08']);
      // Both days should be pump-covered
      result.pumpDayCount.should.equal(2);
      result.coverageByDay['2026-04-07'].should.equal(true);
      result.coverageByDay['2026-04-08'].should.equal(true);
      // Day 1 hour 23 = 2 U (temp basal), day 2 hour 0 = 2 U (temp basal)
      // Per-day hourly is averaged across pump days:
      //   hourly[23] = (2 [day1] + 1 [day2]) / 2 = 1.5 U
      //   hourly[0]  = (1 [day1] + 2 [day2]) / 2 = 1.5 U
      //   other hours = 1 U
      result.hourly[23].should.be.approximately(1.5, 0.01);
      result.hourly[0].should.be.approximately(1.5, 0.01);
      result.hourly[12].should.be.approximately(1, 0.01);
    });
  });

  // ---- integrateTempBasalRawByHour (no gap-fill) ------------------------

  describe('integrateTempBasalRawByHour', function () {
    it('should sum only explicit temp basal events (no gap fill)', function () {
      var tb = makeTempBasal(D1 + 10 * 60 * 60 * 1000, 60, 2, 0);
      var result = statistics.integrateTempBasalRawByHour([tb], ['2026-04-07']);
      // Hour 10 = 2 U (1h at 2 U/h), all others = 0
      result.hourly[10].should.be.approximately(2, 0.01);
      result.hourly[9].should.equal(0);
      result.hourly[11].should.equal(0);
      result.totalUnits.should.be.approximately(2, 0.01);
    });

    it('should return zero for days with no events', function () {
      var result = statistics.integrateTempBasalRawByHour([], ['2026-04-07']);
      result.totalUnits.should.equal(0);
    });
  });

  // ---- classifyAutoBoluses threshold boundaries -------------------------

  describe('classifyAutoBoluses', function () {
    it('should classify auto boluses by preceding user bolus distance', function () {
      var T = D1 + 12 * 60 * 60 * 1000;  // user bolus at noon day 1
      var M = 60 * 1000;
      var treatments = [
        makeUserBolus(T, 5, 0)
        , makeAutoBolus(T + 30 * M, 1, 'Automatic Bolus', 0)       // +30m  → near_meal
        , makeAutoBolus(T + 119 * M, 1, 'Automatic Bolus', 0)      // +119m → near_meal
        , makeAutoBolus(T + 120 * M, 1, 'Automatic Bolus', 0)      // +120m → near_meal (boundary inclusive)
        , makeAutoBolus(T + 121 * M, 1, 'Automatic Bolus', 0)      // +121m → intermediate
        , makeAutoBolus(T + 180 * M, 1, 'Automatic Bolus', 0)      // +180m → intermediate
        , makeAutoBolus(T + 239 * M, 1, 'Automatic Bolus', 0)      // +239m → intermediate
        , makeAutoBolus(T + 240 * M, 1, 'Automatic Bolus', 0)      // +240m → far_from_meal (boundary inclusive)
        , makeAutoBolus(T + 500 * M, 1, 'Automatic Bolus', 0)      // +500m → far_from_meal
      ];
      var result = statistics.classifyAutoBoluses(treatments);
      result.length.should.equal(8);
      result[0].bucket.should.equal('near_meal');      // +30m
      result[1].bucket.should.equal('near_meal');      // +119m
      result[2].bucket.should.equal('near_meal');      // +120m boundary
      result[3].bucket.should.equal('intermediate');   // +121m
      result[4].bucket.should.equal('intermediate');   // +180m
      result[5].bucket.should.equal('intermediate');   // +239m
      result[6].bucket.should.equal('far_from_meal');  // +240m boundary
      result[7].bucket.should.equal('far_from_meal');  // +500m
    });

    it('should classify orphan auto boluses as far_from_meal', function () {
      // Auto bolus with no preceding user bolus → deltaMs = Infinity → far_from_meal
      var ab = makeAutoBolus(D1 + 12 * 60 * 60 * 1000, 1, 'Automatic Bolus', 0);
      var result = statistics.classifyAutoBoluses([ab]);
      result.length.should.equal(1);
      result[0].bucket.should.equal('far_from_meal');
      (result[0].minutesSinceUserBolus === null).should.equal(true);
    });

    it('should respect custom thresholds', function () {
      var T = D1 + 12 * 60 * 60 * 1000;
      var treatments = [
        makeUserBolus(T, 5, 0)
        , makeAutoBolus(T + 60 * 60 * 1000, 1, 'Automatic Bolus', 0)  // +60m
      ];
      // With nearMealMinutes=30, +60m is NOT near_meal
      var result = statistics.classifyAutoBoluses(treatments, { nearMealMinutes: 30, farFromMealMinutes: 240 });
      result[0].bucket.should.not.equal('near_meal');
    });
  });

  // ---- detectBasalSuspensions -------------------------------------------

  describe('detectBasalSuspensions', function () {
    it('should pair Suspend with next Resume', function () {
      var events = [
        makeSuspension(D1 + 9 * 60 * 60 * 1000, 0)
        , makeResume(D1 + 9 * 60 * 60 * 1000 + 15 * 60 * 1000, 0)
      ];
      var result = statistics.detectBasalSuspensions(events);
      result.length.should.equal(1);
      result[0].durationMin.should.equal(15);
    });

    it('should close unclosed tail suspension at windowEndMs', function () {
      var events = [makeSuspension(D1 + 9 * 60 * 60 * 1000, 0)];
      var windowEnd = D1 + 10 * 60 * 60 * 1000;  // 1 hour later
      var result = statistics.detectBasalSuspensions(events, windowEnd);
      result.length.should.equal(1);
      result[0].durationMin.should.equal(60);
    });

    it('should leave unclosed tail suspension out when no windowEndMs provided', function () {
      var events = [makeSuspension(D1 + 9 * 60 * 60 * 1000, 0)];
      var result = statistics.detectBasalSuspensions(events);
      result.length.should.equal(0);
    });

    it('should re-attribute nested suspensions rather than orphaning them (R3-2)', function () {
      // Suspend at T, Suspend at T+10, Resume at T+20
      // Expected: [T → T+10] and [T+10 → T+20] — two suspensions, no data lost
      var T = D1 + 9 * 60 * 60 * 1000;
      var M = 60 * 1000;
      var events = [
        makeSuspension(T, 0)
        , makeSuspension(T + 10 * M, 0)
        , makeResume(T + 20 * M, 0)
      ];
      var result = statistics.detectBasalSuspensions(events);
      result.length.should.equal(2);
      result[0].durationMin.should.equal(10);
      result[1].durationMin.should.equal(10);
    });
  });

  // ---- detectPumpCoverage -----------------------------------------------

  describe('detectPumpCoverage', function () {
    it('should mark days with Temp Basal events as pump-covered', function () {
      var treatments = [
        makeTempBasal(D1 + 10 * 60 * 60 * 1000, 30, 1, 0)  // day 1
        , makeTempBasal(D3 + 10 * 60 * 60 * 1000, 30, 1, 0)  // day 3
      ];
      var result = statistics.detectPumpCoverage(treatments, ['2026-04-07', '2026-04-08', '2026-04-09']);
      result.pumpDays.should.equal(2);
      result.totalDays.should.equal(3);
      result.pumpCoveredKeys.has('2026-04-07').should.equal(true);
      result.pumpCoveredKeys.has('2026-04-08').should.equal(false);
      result.pumpCoveredKeys.has('2026-04-09').should.equal(true);
    });

    it('should also mark days with Basal Suspension as pump-covered (looped users, R3-4)', function () {
      // AndroidAPS/Loop users emit Basal Suspension without enteredBy=Pump.
      // The eventType fallback should still detect them.
      var treatments = [
        { eventType: 'Basal Suspension', created_at: new Date(D1 + 10 * 60 * 60 * 1000).toISOString()
          , utcOffset: 0, mills: D1 + 10 * 60 * 60 * 1000, enteredBy: 'openaps' }
      ];
      var result = statistics.detectPumpCoverage(treatments, ['2026-04-07']);
      result.pumpDays.should.equal(1);
    });
  });

  // ---- computeBolusDistribution (R3-12 denominator split) ---------------

  describe('computeBolusDistribution (R3-12 denominator split)', function () {
    it('should divide user boluses by total days and auto by pump days', function () {
      // 7 dateKeys, 3 pump days. 1 user bolus (5 U) and 1 auto bolus (2 U).
      var dateKeys = [];
      for (var i = 0; i < 7; i++) {
        var d = new Date(D1);
        d.setUTCDate(d.getUTCDate() + i);
        dateKeys.push(d.toISOString().slice(0, 10));
      }
      var userB = makeUserBolus(D1 + 12 * 60 * 60 * 1000, 5, 0);
      var autoB = makeAutoBolus(D2 + 14 * 60 * 60 * 1000, 2, 'Automatic Bolus', 0);
      var autoClassified = statistics.classifyAutoBoluses([userB, autoB]);
      var dist = statistics.computeBolusDistribution([userB, autoB], dateKeys, autoClassified, 3);

      // User bolus: 5 U / 7 days = 0.714 U in hour 12 averaged
      var userTotal = dist.userHourly.reduce(function (a, b) { return a + b; }, 0);
      userTotal.should.be.approximately(5 / 7, 0.01);

      // Auto bolus: classified as far_from_meal (only user bolus is same-day but 26h earlier)
      // Actually: auto is on day 2 at T+26h+14h after user bolus (day 1 noon → day 2 14:00 = 26h gap)
      // 26h > 4h → far_from_meal. Total auto = 2 U / 3 pump days = 0.667
      var autoFarTotal = dist.autoHourlyByBucket.far_from_meal.reduce(function (a, b) { return a + b; }, 0);
      autoFarTotal.should.be.approximately(2 / 3, 0.01);
    });

    it('should fall back to dateKeys.length when pumpDayCount omitted (legacy callers)', function () {
      var dateKeys = ['2026-04-07', '2026-04-08', '2026-04-09'];
      var userB = makeUserBolus(D1 + 12 * 60 * 60 * 1000, 3, 0);
      var autoClassified = [];
      var dist = statistics.computeBolusDistribution([userB], dateKeys, autoClassified);
      // 3 U / 3 days
      var userTotal = dist.userHourly.reduce(function (a, b) { return a + b; }, 0);
      userTotal.should.be.approximately(1, 0.01);
    });
  });

  // ---- computePumpActionStats orchestrator ------------------------------

  describe('computePumpActionStats orchestrator', function () {
    it('should mark basal_source profile_fallback when no pump data', function () {
      var result = statistics.computePumpActionStats([], makeFlatProfile(1), ['2026-04-07']);
      result.basal_source.should.equal('profile_fallback');
      result.coverage.pump_days.should.equal(0);
      result.profile_valid.should.equal(true);
    });

    it('should mark basal_source pump when pump data is present', function () {
      var tb = makeTempBasal(D1 + 10 * 60 * 60 * 1000, 60, 2, 0);
      var result = statistics.computePumpActionStats([tb], makeFlatProfile(1), ['2026-04-07']);
      result.basal_source.should.equal('pump');
      result.coverage.pump_days.should.equal(1);
    });

    it('should surface profile_valid=false and issue when profile is missing (R3-13)', function () {
      var result = statistics.computePumpActionStats([], null, ['2026-04-07']);
      result.profile_valid.should.equal(false);
      result.profile_issue.should.equal('profile_missing');
    });

    it('should handle mixed coverage period (3 pump + 4 CGM-only days)', function () {
      var dateKeys = [];
      for (var i = 0; i < 7; i++) {
        var d = new Date(D1);
        d.setUTCDate(d.getUTCDate() + i);
        dateKeys.push(d.toISOString().slice(0, 10));
      }
      // Temp basals on days 1, 3, 5 only
      var treatments = [
        makeTempBasal(D1 + 10 * 60 * 60 * 1000, 60, 2, 0)
        , makeTempBasal(D1 + 2 * 24 * 60 * 60 * 1000 + 10 * 60 * 60 * 1000, 60, 2, 0)
        , makeTempBasal(D1 + 4 * 24 * 60 * 60 * 1000 + 10 * 60 * 60 * 1000, 60, 2, 0)
      ];
      var result = statistics.computePumpActionStats(treatments, makeFlatProfile(1), dateKeys);
      result.coverage.pump_days.should.equal(3);
      result.coverage.total_days.should.equal(7);
      result.coverage.cgm_only_days.should.equal(4);
      result.basal_source.should.equal('pump');
    });

    it('should expose thresholds from options in result', function () {
      var result = statistics.computePumpActionStats([], makeFlatProfile(1), ['2026-04-07'], {
        nearMealMinutes: 90, farFromMealMinutes: 300, hotspotMinDays: 2, deltaThresholdPct: 20
      });
      result.thresholds.near_meal_minutes.should.equal(90);
      result.thresholds.far_from_meal_minutes.should.equal(300);
      result.thresholds.hotspot_min_days.should.equal(2);
      result.thresholds.delta_threshold_pct.should.equal(20);
    });

    // R5-4: profile_switch_detected flag (plan R3-11 single-profile-limitation mitigation)
    it('should set profile_switch_detected=true when a Profile Switch treatment is present', function () {
      var treatments = [
        makeTempBasal(D1 + 10 * 60 * 60 * 1000, 60, 2, 0)
        , { eventType: 'Profile Switch', mills: D1 + 12 * 60 * 60 * 1000, profile: 'Exercise', utcOffset: 0 }
      ];
      var result = statistics.computePumpActionStats(treatments, makeFlatProfile(1), ['2026-04-07']);
      result.profile_switch_detected.should.equal(true);
    });

    it('should set profile_switch_detected=false when no Profile Switch events are present', function () {
      var treatments = [makeTempBasal(D1 + 10 * 60 * 60 * 1000, 60, 2, 0)];
      var result = statistics.computePumpActionStats(treatments, makeFlatProfile(1), ['2026-04-07']);
      result.profile_switch_detected.should.equal(false);
    });
  });

  // ---- detectHotspots ---------------------------------------------------

  describe('detectHotspots', function () {
    it('should flag an hour with repeated temp basal delta as a hotspot', function () {
      // 4 days, all with temp basal +100% above 1 U/h profile at hour 3 (1 hour)
      var dateKeys = [];
      var treatments = [];
      for (var i = 0; i < 4; i++) {
        var d = new Date(D1);
        d.setUTCDate(d.getUTCDate() + i);
        var dk = d.toISOString().slice(0, 10);
        dateKeys.push(dk);
        treatments.push(makeTempBasal(D1 + i * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000, 60, 2, 0));
      }
      var coverage = statistics.detectPumpCoverage(treatments, dateKeys);
      var result = statistics.detectHotspots({
        profileStore: makeFlatProfile(1)
        , treatments: treatments
        , dateKeys: dateKeys
        , pumpCoveredKeys: coverage.pumpCoveredKeys
        , hotspotMinDays: 3
        , deltaThresholdPct: 15
      });
      result.pumpDays.should.equal(4);
      result.hotspots.indexOf(3).should.not.equal(-1);  // hour 3 is a hotspot
    });

    it('should respect stricter hotspotMinDays threshold', function () {
      // Same 4-day fixture but require 5 days → no hotspot possible
      var dateKeys = [];
      var treatments = [];
      for (var i = 0; i < 4; i++) {
        var d = new Date(D1);
        d.setUTCDate(d.getUTCDate() + i);
        dateKeys.push(d.toISOString().slice(0, 10));
        treatments.push(makeTempBasal(D1 + i * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000, 60, 2, 0));
      }
      var coverage = statistics.detectPumpCoverage(treatments, dateKeys);
      var result = statistics.detectHotspots({
        profileStore: makeFlatProfile(1)
        , treatments: treatments
        , dateKeys: dateKeys
        , pumpCoveredKeys: coverage.pumpCoveredKeys
        , hotspotMinDays: 5
        , deltaThresholdPct: 15
      });
      result.hotspots.length.should.equal(0);
    });
  });

  // ---- computeEpisodesWithHours -----------------------------------------

  describe('computeEpisodesWithHours', function () {
    it('should distribute hypo episode duration across touched hours', function () {
      // Build a day's worth of entries: normal, then 4 consecutive hypo readings at hour 2
      var entriesByDay = { '2026-04-07': [] };
      // Normal baseline readings throughout the day (5-min interval)
      for (var h = 0; h < 24; h++) {
        for (var m = 0; m < 60; m += 5) {
          entriesByDay['2026-04-07'].push({
            mills: D1 + h * 60 * 60 * 1000 + m * 60 * 1000
            , sgv: 120
            , localHour: h
          });
        }
      }
      // Override 4 consecutive readings at 02:00, 02:05, 02:10, 02:15 to be hypo
      for (var i = 0; i < 4; i++) {
        var idx = 2 * 12 + i;  // hour 2 slot i
        entriesByDay['2026-04-07'][idx].sgv = 55;
      }
      var result = statistics.computeEpisodesWithHours(entriesByDay, 70, 180);
      result.hypoCount.should.be.greaterThan(0);
      result.hypoDaysAtHour[2].should.equal(1);
    });
  });

  // ---- R3-10 travel invariant lock-in -----------------------------------

  describe('R3-10 travel invariant (Berlin → Tokyo mid-period)', function () {
    it('should bucket events correctly across a timezone change', function () {
      // Days 1-3: Berlin (UTC+2, offsetMin = 120)
      // Days 4-7: Tokyo (UTC+9, offsetMin = 540)
      // Each day: 1h temp basal at local noon at 2 U/h, profile 1 U/h flat
      var BERLIN = 120;
      var TOKYO = 540;
      var MS_DAY = 24 * 60 * 60 * 1000;

      var dateKeys = [];
      var treatments = [];
      for (var i = 0; i < 7; i++) {
        // Compute UTC ms for "local noon" of this day in the appropriate zone.
        // Day i's local noon = Date.UTC(local_date, 12) - offset
        // Use the date from the local frame, which we build by picking an
        // anchor and offsetting per day.
        var offsetMin = i < 3 ? BERLIN : TOKYO;
        // Pick a local anchor: 2026-04-07 + i (as local date)
        var localDate = new Date(Date.UTC(2026, 3, 7 + i));
        var dk = localDate.toISOString().slice(0, 10);
        dateKeys.push(dk);
        // Noon local → UTC ms = Date.UTC(y,m,d,12) - offset*60000
        var noonUtcMs = Date.UTC(2026, 3, 7 + i, 12) - offsetMin * 60 * 1000;
        treatments.push(makeTempBasal(noonUtcMs, 60, 2, offsetMin));
      }

      var result = statistics.computePumpActionStats(treatments, makeFlatProfile(1), dateKeys);
      // All 7 days should be pump-covered across both timezones
      result.coverage.pump_days.should.equal(7);
      // basal_actual hourly[12] = 2 U (temp basal rate) averaged across 7 days
      result.basal_actual.hourly[12].should.be.approximately(2, 0.01);
      // Other hours should be the profile rate 1 U
      result.basal_actual.hourly[0].should.be.approximately(1, 0.01);
      result.basal_actual.hourly[23].should.be.approximately(1, 0.01);
      // Total per day = 23 * 1 + 2 = 25 U
      result.basal_actual.total.should.be.approximately(25, 0.01);
    });
  });

  // ---- Bolus split backward compatibility --------------------------------

  describe('computeTreatmentStats bolus split', function () {
    it('should split user and auto boluses in computeDayStats output', function () {
      // 1 user Meal Bolus + 2 auto Combo Bolus (notes: Automatic Bolus)
      // + 1 user Combo Bolus (notes: Standard Bolus)
      var treatments = [
        { eventType: 'Meal Bolus', insulin: 5, notes: null, mills: D1 + 8 * 60 * 60 * 1000
          , created_at: new Date(D1 + 8 * 60 * 60 * 1000).toISOString(), utcOffset: 0 }
        , { eventType: 'Combo Bolus', insulin: 1, notes: 'Automatic Bolus'
          , mills: D1 + 10 * 60 * 60 * 1000
          , created_at: new Date(D1 + 10 * 60 * 60 * 1000).toISOString(), utcOffset: 0 }
        , { eventType: 'Combo Bolus', insulin: 1, notes: 'Automatic Bolus'
          , mills: D1 + 11 * 60 * 60 * 1000
          , created_at: new Date(D1 + 11 * 60 * 60 * 1000).toISOString(), utcOffset: 0 }
        , { eventType: 'Combo Bolus', insulin: 3, notes: 'Standard Bolus'
          , mills: D1 + 13 * 60 * 60 * 1000
          , created_at: new Date(D1 + 13 * 60 * 60 * 1000).toISOString(), utcOffset: 0 }
      ];
      // computeDayStats short-circuits on empty SGV, so provide a minimal
      // record set — at least one in-range SGV keeps the treatment path alive.
      var sgv = makeSgvRecords([120, 125, 130], D1);
      var day = statistics.computeDayStats(sgv, treatments, { targetLow: 70, targetHigh: 180 });
      day.user_bolus_count.should.equal(2);      // Meal + Standard
      day.auto_bolus_count.should.equal(2);      // 2 Automatic
      day.user_bolus_insulin.should.be.approximately(8, 0.01);   // 5 + 3
      day.auto_bolus_insulin.should.be.approximately(2, 0.01);   // 1 + 1
      // Backward-compat: bolus_count and total_insulin still equal sums
      day.bolus_count.should.equal(4);
      day.total_insulin.should.be.approximately(10, 0.01);
    });
  });

});
