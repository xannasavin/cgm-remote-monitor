# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nightscout (cgm-remote-monitor) is a Node.js/Express web application that displays CGM (Continuous Glucose Monitor) data in real time. It reads from MongoDB, renders BG values via D3/Flot charts in the browser, and generates alarms for high/low glucose values. Socket.io provides real-time updates to connected clients.

## Commands

### Development
```bash
# Install dependencies + build production bundle
npm install

# Start dev server (nodemon + webpack HMR, port 1337)
# Requires my.env file (copy from docs/example-template.env)
npm run dev

# Start production server (requires my.prod.env with NODE_ENV=production)
npm run prod
```

### Testing
```bash
# Run full test suite against a throwaway in-memory MongoDB (no local MongoDB needed)
npm run test-local

# Run selected test files the same way
npm run test-local -- ./tests/bgnow.test.js ./tests/pump_analysis.test.js

# Run full test suite against a real MongoDB at 127.0.0.1:27017
npm test

# CI tests with coverage
npm run test-ci
```

All runs need an env file: copy `tests/ci.test.env` to `my.test.env`. `npm run test-local` (`scripts/test-local.js`) starts MongoDB via `mongodb-memory-server-core` (version pinned in `package.json` under `config.mongodbMemoryServer`; the binary is downloaded once, ~370 MB, into a user-level cache such as `~/.cache/mongodb-binaries`) and overrides `CUSTOMCONNSTR_mongo` from the env file. Prefer it over `npm test` on machines without a MongoDB service.

On Windows `TEST=bgnow npm run test-single` does not work (npm runs scripts through cmd, so `$TEST` is never expanded, even from Git Bash). Use `npm run test-local -- ./tests/bgnow.test.js` instead.

### Build & Lint
```bash
npm run bundle          # Production webpack build
npm run bundle-dev      # Development webpack build
npm run lint            # ESLint on lib/
```

## Architecture

### Boot Sequence
`server.js` -> `lib/server/bootevent.js` -> sequential pipeline: check env -> connect MongoDB -> init auth -> wire plugins -> create indexes -> start listeners -> `lib/server/app.js` (Express) -> `lib/server/websocket.js` (Socket.io)

### Plugin System (core pattern)
All features live in plugins at `lib/plugins/`. A plugin exports an `init(ctx)` function returning an object with lifecycle methods:

- `setProperties(sbx)` - compute derived data into `sbx.properties`
- `checkNotifications(sbx)` - evaluate alarms
- `updateVisualisation(sbx)` - update DOM pills (client only)

Plugins are enabled via the `ENABLE` env var (space-separated names). The `pluginType` field (`pill-primary`, `pill-major`, `pill-minor`, `pill-status`) controls UI pill placement. The shared `sandbox` object (`lib/sandbox.js`) provides the context passed to all plugin methods, with separate init paths for server (`sbx.serverInit`) and client (`sbx.clientInit`).

### REST API Layers
- **v1** (`lib/api/`): Classic REST endpoints for entries, treatments, devicestatus, profile, food, notifications. Auth via `api-secret` header or Bearer JWT.
- **v2** (`lib/api2/`): Properties/computed data API for the client.
- **v3** (`lib/api3/`): Modern generic CRUD with OpenAPI/Swagger docs at `/api3-docs`. Bearer token only. Uses Apache Shiro-style permissions.

### Client Side
Entry point: `bundle/bundle.source.js` (webpack). The client (`lib/client/`) fetches status from `/api/v1/status.json`, initializes plugins, sets up Socket.io for live updates, and renders charts via `lib/client/renderer.js`. Views use EJS templates (`views/`). All dynamic content is client-rendered; the server sends static HTML shells.

### Data Layer
- `lib/storage/mongo-storage.js` - MongoDB driver wrapper (collections: entries, treatments, devicestatus, profile, food, activity)
- `lib/data/ddata.js` - in-memory data store (`ctx.ddata`)
- `lib/data/dataloader.js` - loads/merges data from MongoDB into `ctx.ddata`

### Authorization
`lib/authorization/` uses Apache Shiro-style permission strings (e.g., `api:entries:read`). Two modes: `API_SECRET` (admin, grants `*`) and JWT tokens (role-based, managed via `lib/server/enclave.js`).

### Environment Configuration
`lib/server/env.js` reads env vars with Azure `CUSTOMCONNSTR_` prefix compatibility. Plugin-specific settings follow the pattern `<PLUGIN_NAME>_<SETTING>` and are auto-collected into `env.extendedSettings[pluginName]`.

Required env vars: `MONGODB_URI` (or aliases: `MONGO_CONNECTION`, `MONGO`, `MONGOLAB_URI`), `API_SECRET` (min 12 chars).

## Code Style

- 2-space indentation
- Single quotes
- Space before function params: `function boom (name, cb) { }`
- Named callbacks: `function afterBoom (result) { }`
- Comma-first style for multi-line objects/arrays
- ESLint config: `eslint:recommended` + `plugin:security/recommended` via babel-eslint parser

## Branch & PR Conventions

This repo is a personal fork (`origin`); `upstream` is the Nightscout project.

- `master` = production and the default target: most work is developed on a feature branch and merged into `master`
- `staging` = stage system for trying out changes before they go to production, used when a change needs testing in a live-like environment first
- Branch naming: `wip/<feature-name>` (also `feat/`, `fix/`, `chore/` prefixes in use)
- Upstream conventions (PRs target `dev`) apply only when contributing back to `upstream`
- New features must live inside a Plugin
