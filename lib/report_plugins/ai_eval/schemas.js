'use strict';

var interim_response_format = {
  'type': 'json_schema',
  'json_schema': {
    'name': 'DailyAnalysisSchema',
    'schema': {
      'type': 'object',
      'properties': {
        'date': {
          'type': 'string',
          'format': 'date',
          'pattern': '^\\d{4}-\\d{2}-\\d{2}$'
        },
        'summary': {
          'type': 'array',
          'items': { 'type': 'string' }
        },
        'statistics': {
          'type': 'object',
          'properties': {
            'average_glucose_mgdl': { 'type': ['number', 'null'] },
            'median_glucose_mgdl': { 'type': ['number', 'null'] },
            'standard_deviation_mgdl': { 'type': ['number', 'null'] },
            'cv_percent': { 'type': ['number', 'null'] },
            'mage_mgdl': { 'type': ['number', 'null'] },
            'time_in_range_percent': { 'type': ['number', 'null'] },
            'time_below_range_percent': { 'type': ['number', 'null'] },
            'time_above_range_percent': { 'type': ['number', 'null'] },
            'total_readings': { 'type': ['integer', 'null'] },
            'valid_hours': { 'type': ['number', 'null'] },
            'number_of_hypo_episodes': { 'type': ['integer', 'null'] },
            'number_of_hyper_episodes': { 'type': ['integer', 'null'] },
            'longest_hypo_min': { 'type': ['integer', 'null'] },
            'longest_hyper_min': { 'type': ['integer', 'null'] }
          },
          'required': [
            'average_glucose_mgdl',
            'median_glucose_mgdl',
            'standard_deviation_mgdl',
            'cv_percent',
            'time_in_range_percent',
            'time_below_range_percent',
            'time_above_range_percent'
          ]
        },
        'anomalies': {
          'type': 'array',
          'items': {
            'type': 'object',
            'properties': {
              'type': { 'type': 'string' },
              'start_local': { 'type': 'string', 'pattern': '^[0-2]\\d:[0-5]\\d$' },
              'end_local': { 'type': 'string', 'pattern': '^[0-2]\\d:[0-5]\\d$' },
              'duration_min': { 'type': ['integer', 'null'] },
              'nadir_mgdl': { 'type': ['number', 'null'] },
              'peak_mgdl': { 'type': ['number', 'null'] }
            },
            'required': ['type', 'start_local', 'end_local']
          }
        },
        'dailyPatterns': {
          'type': 'object',
          'properties': {
            '00-06': { '$ref': '#/definitions/timeBlock' },
            '06-12': { '$ref': '#/definitions/timeBlock' },
            '12-18': { '$ref': '#/definitions/timeBlock' },
            '18-24': { '$ref': '#/definitions/timeBlock' }
          }
        },
        'recommendations': { 'type': 'array', 'items': { 'type': 'string' } },
        'notes': { 'type': 'array', 'items': { 'type': 'string' } },
        'rawAnalysis': { 'type': 'array', 'items': { 'type': 'string' } },
        'meta': {
          'type': 'object',
          'properties': {
            'units': { 'type': 'string' },
            'target_low_mgdl': { 'type': 'integer' },
            'target_high_mgdl': { 'type': 'integer' },
            'profile_snapshot_used': { 'type': 'boolean' }
          }
        }
      },
      'required': ['date', 'summary', 'statistics'],
      'definitions': {
        'timeBlock': {
          'type': 'object',
          'properties': {
            'avg': { 'type': ['number', 'null'] },
            'sd': { 'type': ['number', 'null'] },
            'below_pct': { 'type': ['number', 'null'] },
            'in_range_pct': { 'type': ['number', 'null'] },
            'above_pct': { 'type': ['number', 'null'] }
          }
        }
      }
    }
  }
};

var final_response_format = {
  'type': 'json_schema',
  'json_schema': {
    'name': 'MultiDayAnalysisSchema',
    'schema': {
      'type': 'object',
      'properties': {
        'period': {
          'type': 'object',
          'properties': {
            'from': { 'type': 'string', 'format': 'date' },
            'to': { 'type': 'string', 'format': 'date' },
            'days': { 'type': 'integer' }
          },
          'required': ['from', 'to', 'days']
        },
        'summary': { 'type': 'array', 'items': { 'type': 'string' } },
        'overall_statistics': {
          'type': 'object',
          'properties': {
            'average_glucose_mgdl': { 'type': ['number', 'null'] },
            'median_glucose_mgdl': { 'type': ['number', 'null'] },
            'standard_deviation_mgdl': { 'type': ['number', 'null'] },
            'cv_percent': { 'type': ['number', 'null'] },
            'mage_overall_mgdl': { 'type': ['number', 'null'] },
            'time_in_range_percent': { 'type': ['number', 'null'] },
            'time_below_range_percent': { 'type': ['number', 'null'] },
            'time_above_range_percent': { 'type': ['number', 'null'] },
            'total_readings': { 'type': ['integer', 'null'] },
            'valid_hours': { 'type': ['number', 'null'] }
          }
        },
        'diurnal_patterns': {
          'type': 'object',
          'properties': {
            '00-06': { '$ref': '#/definitions/timeBlock' },
            '06-12': { '$ref': '#/definitions/timeBlock' },
            '12-18': { '$ref': '#/definitions/timeBlock' },
            '18-24': { '$ref': '#/definitions/timeBlock' }
          }
        },
        'episodes': {
          'type': 'object',
          'properties': {
            'hypoglycemia': { '$ref': '#/definitions/episodeStats' },
            'hyperglycemia': { '$ref': '#/definitions/episodeStats' }
          }
        },
        'trends': {
          'type': 'array',
          'items': {
            'type': 'object',
            'properties': {
              'label': { 'type': 'string' },
              'evidence': { 'type': 'string' }
            },
            'required': ['label', 'evidence']
          }
        },
        'recommendations': {
          'type': 'object',
          'properties': {
            'therapy_settings': { 'type': 'array', 'items': { 'type': 'string' } },
            'behavioral_timing': { 'type': 'array', 'items': { 'type': 'string' } },
            'monitoring': { 'type': 'array', 'items': { 'type': 'string' } }
          }
        },
        'data_quality_notes': { 'type': 'array', 'items': { 'type': 'string' } },
        'per_day': {
          'type': 'array',
          'items': {
            'type': 'object',
            'properties': {
              'date': { 'type': 'string', 'format': 'date' },
              'average_glucose_mgdl': { 'type': ['number', 'null'] },
              'cv_percent': { 'type': ['number', 'null'] },
              'tir_percent': { 'type': ['number', 'null'] },
              'tbr_percent': { 'type': ['number', 'null'] },
              'tar_percent': { 'type': ['number', 'null'] },
              'hypo_episodes': { 'type': ['integer', 'null'] },
              'hyper_episodes': { 'type': ['integer', 'null'] },
              'notes': { 'type': 'array', 'items': { 'type': 'string' } }
            },
            'required': ['date']
          }
        },
        'meta': {
          'type': 'object',
          'properties': {
            'aggregation': { 'type': 'string' },
            'gap_threshold_minutes': { 'type': 'integer' },
            'units': { 'type': 'string' },
            'target_low_mgdl': { 'type': 'integer' },
            'target_high_mgdl': { 'type': 'integer' },
            'profile_snapshot_used': { 'type': 'boolean' }
          }
        }
      },
      'required': ['period', 'summary', 'overall_statistics'],
      'definitions': {
        'timeBlock': {
          'type': 'object',
          'properties': {
            'avg': { 'type': ['number', 'null'] },
            'sd': { 'type': ['number', 'null'] },
            'below_pct': { 'type': ['number', 'null'] },
            'in_range_pct': { 'type': ['number', 'null'] },
            'above_pct': { 'type': ['number', 'null'] }
          }
        },
        'episodeStats': {
          'type': 'object',
          'properties': {
            'count': { 'type': ['integer', 'null'] },
            'total_minutes': { 'type': ['integer', 'null'] },
            'longest_min': { 'type': ['integer', 'null'] },
            'by_block': {
              'type': 'object',
              'properties': {
                '00-06': { 'type': ['integer', 'null'] },
                '06-12': { 'type': ['integer', 'null'] },
                '12-18': { 'type': ['integer', 'null'] },
                '18-24': { 'type': ['integer', 'null'] }
              }
            }
          }
        }
      }
    }
  }
};

module.exports = {
  interim_response_format: interim_response_format
  , final_response_format: final_response_format
};
