'use strict';

/**
 * Constants for the pump analysis recommendations (spec section 3).
 * All glucose values are mg/dl; conversion happens only at the edges.
 */
module.exports = {
  DAWN_WINDOW: { startHour: 4, endHour: 9 }
  , DAWN_MAX_U: 1.5
  , DAWN_MAX_CARBS_G: 10
  , CORRECTION_BG_MGDL: 240
  , FAST_RISE_MGDL_PER_5MIN: 8
  , CARB_MATCH_MIN: 30
  , MEAL_SLOTS: [
    { key: 'breakfast', startHour: 5, endHour: 10 }
    , { key: 'lunch', startHour: 10, endHour: 15 }
    , { key: 'dinner', startHour: 17, endHour: 22 }
  ]
  , HYPER_COUNTER_MGDL: 250
  , COUNTER_MIN_DURATION_MIN: 15
  , DIRECTION_THRESHOLD: 0.10
  , MAX_STEP: 0.20
  , ROUND_BASAL: 0.05
  , ROUND_CARB_RATIO: 0.5
  , ROUND_ISF: 1
  , MIN_CGM_COVERAGE: 0.8
  , FASTING_LOOKBACK_H: 4
  , MEAL_WINDOW_H: 4
  , CORRECTION_WINDOW_H: 3
  , MIN_CASES: 5
  , HIGH_CASES: 7
  , HIGH_SHARE: 0.75
  , MEDIUM_SHARE: 0.60
  , STRONG_COUNTER_DAYS: 3
  , LATE_BOLUS_RISE_MGDL: 80
  , LATE_BOLUS_PEAK_MIN: 90
  , LATE_BOLUS_SHARE: 0.60
};
