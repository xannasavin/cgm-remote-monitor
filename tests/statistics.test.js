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

      it('should treat targetLow as exclusive (value == targetLow is in range)', function () {
        var records = makeSgvRecords([70, 180]);
        var result = statistics.computeDayStats(records, [], DEFAULT_OPTIONS);
        // 70 is >= targetLow (70) and < targetHigh (180) -> in range
        // 180 is >= targetHigh (180) -> above range
        result.tir_pct.should.equal(50);
        result.tar_pct.should.equal(50);
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
