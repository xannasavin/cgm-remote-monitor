'use strict';

/**
 * Unified response schema for single-call LLM architecture.
 *
 * Statistics (TIR, SD, CV, MAGE, episodes, pump-action hotspots) are computed
 * client-side by lib/statistics.js. The LLM focuses on interpretation, pattern
 * analysis, and recommendations.
 *
 * Soft grounding (v1): trend items and treatment_insights items MAY include a
 * `refers_to_hotspot` object citing the computed pump-action hotspot being
 * interpreted. The renderer visually links the AI claim back to the hotspot
 * chart. The field is optional — the LLM is not required to cite, but
 * uncited basal-language claims get an "AI inference" badge in the renderer
 * so the user can distinguish grounded from ungrounded claims. If >30% of
 * basal-language trends ship ungrounded in practice, v1.1 will tighten to
 * required.
 *
 * R3-2 shape stability: `treatment_insights.*` items are strict
 * { text, refers_to_hotspot? } OBJECTS. The renderer in renderer.js also
 * tolerates legacy string items for defense-in-depth when a cached or
 * older response slips through, but the LLM contract (schema + prompt) is
 * always objects. If this schema ever regresses to mixing strings and
 * objects in the same list, `response_format` will reject the response —
 * keep items uniform.
 */

// Shared hotspot-citation fragment so carb/insulin/basal/dosing lists all
// share the exact same shape. Schemas.js originally inlined this four times.
var refersToHotspotSchema = {
  'type': 'object'
  , 'description': 'Optional citation linking this insight to a computed pump-action hotspot at a specific hour and signal.'
  , 'properties': {
    'hour': { 'type': 'integer', 'minimum': 0, 'maximum': 23 }
    , 'signal': { 'type': 'string', 'enum': ['temp_basal_delta', 'auto_bolus', 'basal_suspension'] }
  }
  , 'required': ['hour', 'signal']
};

// Treatment-insight list element: object with required text plus optional
// hotspot citation. Exported as a shared fragment so the four list types
// don't drift out of sync.
var insightItemSchema = {
  'type': 'object'
  , 'properties': {
    'text': { 'type': 'string', 'description': 'Human-readable insight text in the requested language. Must be a non-empty string; never a plain-string list item.' }
    , 'refers_to_hotspot': refersToHotspotSchema
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
              , 'refers_to_hotspot': refersToHotspotSchema
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
          // All four insight arrays share `insightItemSchema` (object with
          // required `text` and optional `refers_to_hotspot`). Keeping the
          // shape identical across lists is load-bearing — see the R3-2
          // note at the top of this file.
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
