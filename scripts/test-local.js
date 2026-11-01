#!/usr/bin/env node

'use strict';

// Runs the mocha suite against a throwaway in-memory MongoDB, so local runs
// need neither a MongoDB service nor Docker. The binary version comes from
// "config.mongodbMemoryServer" in package.json and is downloaded once.
//
// Usage:
//   npm run test-local                                # whole suite
//   npm run test-local -- ./tests/bgnow.test.js       # selected files
//
// The env file (default ./my.test.env, override with TEST_ENV_FILE) is loaded
// with --no-override, so the connection string set here wins over the
// CUSTOMCONNSTR_mongo in the file.

const { spawn } = require('child_process');
// The -core package has no postinstall download, so `npm ci` (CI, Docker
// builds) does not fetch a MongoDB binary; the first test-local run does.
const { MongoMemoryServer } = require('mongodb-memory-server-core');

const ENV_FILE = process.env.TEST_ENV_FILE || './my.test.env';
const DB_NAME = 'testdb';
const DEFAULT_FILES = ['./tests/*.test.js'];

async function main () {
  const mongod = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1', dbName: DB_NAME } });
  const uri = mongod.getUri(DB_NAME);
  console.log('[test-local] in-memory MongoDB at ' + uri);

  const files = process.argv.slice(2);
  const args = [
    require.resolve('env-cmd/bin/env-cmd.js')
    , '--no-override'
    , '-f', ENV_FILE
    , process.execPath, require.resolve('mocha/bin/mocha.js')
    , '--timeout', '5000'
    , '--require', './tests/hooks.js'
    , '--exit'
  ].concat(files.length ? files : DEFAULT_FILES);

  const child = spawn(process.execPath, args, {
    stdio: 'inherit'
    , env: Object.assign({}, process.env, { CUSTOMCONNSTR_mongo: uri })
  });

  async function stop (code) {
    await mongod.stop();
    process.exit(code);
  }

  process.on('SIGINT', function onSigint () { child.kill('SIGINT'); });
  child.on('exit', function onExit (code, signal) { stop(signal ? 1 : code); });
}

main().catch(function onError (err) {
  console.error('[test-local] ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
