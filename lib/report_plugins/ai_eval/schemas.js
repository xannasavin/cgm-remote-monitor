'use strict';

/**
 * Unified response schema for single-call LLM architecture.
 *
 * Statistics (TIR, SD, CV, MAGE, episodes, pump-action hotspots) are computed
 * client-side by lib/statistics.js. The LLM focuses on interpretation, pattern
 * analysis, and recommendations.
 *
 * Shape stability: `treatment_insights.*` items are strict `{ text }` OBJECTS
 * (not bare strings). The renderer in renderer.js tolerates legacy string
 * items for defense-in-depth, but the LLM contract is always objects. If this
 * schema ever regresses to mixing strings and objects in the same list,
 * `response_format` will reject the response — keep items uniform.
 *
 * Historical note: an earlier revision of this schema carried an optional
 * `refers_to_hotspot: { hour, signal }` citation field on `trends[]` and on
 * every `treatment_insights.*` item. The idea was "let the LLM link an
 * insight to a specific computed pump-action hotspot so the renderer can draw
 * a visual line from the claim to the chart". In practice the LLM never used
 * it (the prompt didn't teach it how, the list of valid hotspots was never
 * passed in, and CGM-only users had no hotspots to cite) while it cost ~1,400
 * chars of schema bloat per call and forced a confusing `?` "AI inference"
 * badge in the renderer. Removed. If this is rebuilt later, pass a
 * COMPUTED_HOTSPOTS list in the user prompt and instruct the LLM to cite only
 * from that list — otherwise the feature will silently no-op again.
 */

// Treatment-insight list element: object with required text. Exported as a
// shared fragment so the four list types don't drift out of sync.
var insightItemSchema = {
  'type': 'object'
  , 'properties': {
    'text': { 'type': 'string', 'description': 'Human-readable insight text in the requested language. Must be a non-empty string; never a plain-string list item.' }
  }
  , 'required': ['text']
};

var unified_response_format = {
  'type': 'json_schema'
  , 'json_schema': {
    'name': 'CgmAnalysisSchema'
    , 'schema': {
      'type': 'object'
      , 'properties': {
        'period': {
          'type': 'object'
          , 'properties': {
            'from': { 'type': 'string', 'format': 'date' }
            , 'to': { 'type': 'string', 'format': 'date' }
            , 'days': { 'type': 'integer' }
          }
          , 'required': ['from', 'to', 'days']
        }
        , 'summary': {
          'type': 'array'
          , 'items': { 'type': 'string' }
        }
        , 'trends': {
          'type': 'array'
          , 'items': {
            'type': 'object'
            , 'properties': {
              'label': { 'type': 'string' }
              , 'evidence': { 'type': 'string' }
              , 'severity': { 'type': 'string', 'enum': ['info', 'warning', 'critical'] }
            }
            , 'required': ['label', 'evidence', 'severity']
          }
        }
        , 'recommendations': {
          'type': 'object'
          , 'properties': {
            'therapy_settings': {
              'type': 'array'
              , 'items': {
                'type': 'object'
                , 'properties': {
                  'action': { 'type': 'string' }
                  , 'rationale': { 'type': 'string' }
                }
                , 'required': ['action', 'rationale']
              }
            }
            , 'behavioral_timing': {
              'type': 'array'
              , 'items': {
                'type': 'object'
                , 'properties': {
                  'action': { 'type': 'string' }
                  , 'rationale': { 'type': 'string' }
                }
                , 'required': ['action', 'rationale']
              }
            }
            , 'monitoring': {
              'type': 'array'
              , 'items': { 'type': 'string' }
            }
          }
          , 'required': ['therapy_settings', 'behavioral_timing', 'monitoring']
        }
        , 'per_day': {
          'type': 'array'
          , 'items': {
            'type': 'object'
            , 'properties': {
              'date': { 'type': 'string', 'format': 'date' }
              , 'notes': { 'type': 'array', 'items': { 'type': 'string' } }
            }
            , 'required': ['date', 'notes']
          }
        }
        , 'treatment_insights': {
          'type': 'object'
          , 'properties': {
            'carb_patterns': { 'type': 'array', 'items': insightItemSchema }
            , 'insulin_patterns': { 'type': 'array', 'items': insightItemSchema }
            , 'basal_observations': { 'type': 'array', 'items': insightItemSchema }
            , 'dosing_observations': { 'type': 'array', 'items': insightItemSchema }
          }
          , 'required': ['carb_patterns', 'insulin_patterns', 'basal_observations', 'dosing_observations']
        }
        , 'data_quality_notes': {
          'type': 'array'
          , 'items': { 'type': 'string' }
        }
      }
      , 'required': ['period', 'summary', 'trends', 'recommendations', 'per_day', 'treatment_insights']
    }
  }
};

module.exports = {
  unified_response_format: unified_response_format
};
