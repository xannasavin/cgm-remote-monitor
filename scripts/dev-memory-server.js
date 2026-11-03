#!/usr/bin/env node

'use strict';

// Starts Nightscout against a throwaway in-memory MongoDB on fixed ports, for
// browser checks (e.g. the pump_analysis report with demo data).
//
//   node scripts/dev-memory-server.js              # Nightscout on http://localhost:1337
//   node scripts/seed-pump-analysis-demo.js        # fill it with demo data
//
// MongoDB: mongodb://127.0.0.1:27099/nightscout (override with MEMORY_MONGO_PORT).
// Nightscout port: PORT (default 1337). API_SECRET: abcdefghij123 unless set.
// The default role is "readable", so no login is needed to open reports.
// Stop with Ctrl+C (or kill the process); the data is gone afterwards.

const { MongoMemoryServer } = require('mongodb-memory-server-core');

const MONGO_PORT = parseInt(process.env.MEMORY_MONGO_PORT || '27099', 10);
const DB_NAME = 'nightscout';

async function main () {
  const mongod = await MongoMemoryServer.create({
    instance: { ip: '127.0.0.1', port: MONGO_PORT, dbName: DB_NAME }
  });
  const uri = mongod.getUri(DB_NAME);
  console.log('[dev-memory-server] in-memory MongoDB at ' + uri);

  const defaults = {
    CUSTOMCONNSTR_mongo: uri
    , API_SECRET: 'abcdefghij123'
    , HOSTNAME: '127.0.0.1'
    , PORT: '1337'
    , INSECURE_USE_HTTP: 'true'
    , NODE_ENV: 'development'
    , AUTH_DEFAULT_ROLES: 'readable'
    , DISPLAY_UNITS: 'mg/dl'
    , TIME_FORMAT: '24'
    , ENABLE: 'careportal basal iob cob bwp'
  };
  Object.keys(defaults).forEach(function setDefault (key) {
    if (key === 'CUSTOMCONNSTR_mongo' || process.env[key] === undefined) process.env[key] = defaults[key];
  });

  async function stop () {
    try { await mongod.stop(); } catch (e) { /* ignore */ }
    process.exit(0);
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  require('../server.js');
}

main().catch(function onError (err) {
  console.error('[dev-memory-server] ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
