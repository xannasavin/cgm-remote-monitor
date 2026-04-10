'use strict';

/**
 * Unified response schema for single-call LLM architecture.
 *
 * Statistics (TIR, SD, CV, MAGE, episodes) are computed client-side
 * by lib/statistics.js. The LLM focuses on interpretation, pattern
 * analysis, and recommendations.
 */
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
            'carb_patterns': {
              'type': 'array'
              , 'items': { 'type': 'string' }
            }
            , 'insulin_patterns': {
              'type': 'array'
              , 'items': { 'type': 'string' }
            }
            , 'basal_observations': {
              'type': 'array'
              , 'items': { 'type': 'string' }
            }
            , 'dosing_observations': {
              'type': 'array'
              , 'items': { 'type': 'string' }
            }
          }
          , 'required': ['carb_patterns', 'insulin_patterns', 'basal_observations', 'dosing_observations']
        }
        , 'data_quality_notes': {
          'type': 'array'
          , 'items': { 'type': 'string' }
        }
      }
      , 'required': ['period', 'summary', 'trends', 'recommendations', 'per_day']
    }
  }
};

module.exports = {
  unified_response_format: unified_response_format
};
