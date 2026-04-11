module.exports = {
    'plugins': [
      'security',
      'no-unsanitized'
    ],
    'extends': [
      'eslint:recommended',
      'plugin:security/recommended',
      'plugin:no-unsanitized/DOM'
    ],
    'parser': 'babel-eslint',
    'env': {
      'browser': true,
      'commonjs': true,
      'es6': true,
      'node': true,
      'mocha': true,
      'jquery': true
    },
    'globals': {
      'globalThis': 'readonly'
    },
    'rules': {
      'security/detect-object-injection' : 0,
      'no-unused-vars': [
        'error',
        {
          'varsIgnorePattern': 'should|expect',
          'argsIgnorePattern': '^_',
          'caughtErrorsIgnorePattern': '^_'
        }
      ]
    },
    'overrides': [
      {
        'files': ['lib/client/*.js'],
        'rules': {
          'security/detect-object-injection': 0
        }
      }
    ],
  };