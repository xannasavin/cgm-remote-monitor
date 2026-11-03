'use strict';

require('should');

describe('ai_eval plugin', function () {

  describe('module exports', function () {
    it('should export name, label, html, css, and report', function () {
      var aiEval = require('../lib/report_plugins/ai_eval')({});
      aiEval.should.have.property('name', 'ai_eval');
      aiEval.should.have.property('label', 'AI Evaluation');
      aiEval.should.have.property('html').which.is.a.Function();
      aiEval.should.have.property('css').which.is.a.String();
      aiEval.should.have.property('report').which.is.a.Function();
    });

    it('css relies on pump_analysis for shared styles', function () {
      var aiEval = require('../lib/report_plugins/ai_eval')({});
      aiEval.css.should.not.containEql('.cgm-wrap');
      aiEval.css.should.not.containEql('.ai-section-error {');
      aiEval.css.should.containEql('#aiUsageStats ul');
    });

    it('html has the KPI mount and no statistics mount', function () {
      var aiEval = require('../lib/report_plugins/ai_eval')({});
      var html = aiEval.html({ settings: {} });
      html.should.containEql('aiKpiArea');
      html.should.containEql('sendToAiButton');
      html.should.not.containEql('aiStatsArea');
      html.should.containEql('Pump Analysis');
    });

    it('ai_eval neither renders charts nor prepares data itself', function () {
      var fs = require('fs');
      var path = require('path');
      var src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'report_plugins', 'ai_eval.js'), 'utf8');
      src.should.not.containEql('charts.render');
      src.should.not.containEql('prepareCgmData(');
    });

    it('exceedsDayLimit is true above 14 days', function () {
      var aiEval = require('../lib/report_plugins/ai_eval')({});
      aiEval.exceedsDayLimit(14).should.be.false();
      aiEval.exceedsDayLimit(15).should.be.true();
    });
  });

  describe('schemas', function () {
    var schemas = require('../lib/report_plugins/ai_eval/schemas');

    it('should export unified_response_format', function () {
      schemas.should.have.property('unified_response_format');
      schemas.unified_response_format.should.have.property('type', 'json_schema');
      schemas.unified_response_format.json_schema.should.have.property('name', 'CgmAnalysisSchema');
      schemas.unified_response_format.json_schema.should.have.property('schema');
    });

    it('should require period, summary, trends, recommendations, per_day, treatment_insights in schema', function () {
      var required = schemas.unified_response_format.json_schema.schema.required;
      required.should.containDeep(['period', 'summary', 'trends', 'recommendations', 'per_day', 'treatment_insights']);
    });

    it('should define trends with label, evidence, severity', function () {
      var trends = schemas.unified_response_format.json_schema.schema.properties.trends;
      trends.items.properties.should.have.properties('label', 'evidence', 'severity');
      trends.items.required.should.containDeep(['label', 'evidence', 'severity']);
    });

    it('should define recommendations with therapy_settings, behavioral_timing, monitoring', function () {
      var rec = schemas.unified_response_format.json_schema.schema.properties.recommendations;
      rec.properties.should.have.properties('therapy_settings', 'behavioral_timing', 'monitoring');
    });

    it('should define per_day with date and notes', function () {
      var perDay = schemas.unified_response_format.json_schema.schema.properties.per_day;
      perDay.items.properties.should.have.properties('date', 'notes');
      perDay.items.required.should.containDeep(['date', 'notes']);
    });

    it('should not include statistics in LLM schema (client-side)', function () {
      var props = schemas.unified_response_format.json_schema.schema.properties;
      props.should.not.have.property('statistics');
      props.should.not.have.property('overall_statistics');
    });
  });

  describe('renderer', function () {
    var renderer = require('../lib/report_plugins/ai_eval/renderer');

    describe('renderAnalysis', function () {
      it('should render unified LLM analysis with trends and recommendations', function () {
        var analysis = {
          period: { from: '2026-03-01', to: '2026-03-07', days: 7 }
          , summary: ['Good control overall']
          , trends: [{ label: 'Improving TIR', evidence: 'TIR increased from 65% to 75%', severity: 'info' }]
          , recommendations: {
            therapy_settings: [{ action: 'Adjust basal rate', rationale: 'Dawn phenomenon detected' }]
            , behavioral_timing: [{ action: 'Pre-bolus 15 min', rationale: 'Post-meal spikes' }]
            , monitoring: ['Check BG before driving']
          }
          , per_day: [{ date: '2026-03-01', notes: ['stable day'] }]
          , data_quality_notes: ['Some gaps detected']
        };

        var html = renderer.renderAnalysis(analysis);
        html.should.containEql('AI Analysis');
        html.should.containEql('Good control overall');
        html.should.containEql('Improving TIR');
        html.should.containEql('Adjust basal rate');
        html.should.containEql('Dawn phenomenon');
        html.should.containEql('Pre-bolus 15 min');
        html.should.containEql('Check BG before driving');
        html.should.containEql('stable day');
        html.should.containEql('Some gaps detected');
      });

      it('should escape XSS in LLM analysis', function () {
        var analysis = {
          period: { from: '2026-03-01', to: '2026-03-07', days: 7 }
          , summary: ['<script>alert(1)</script>']
          , trends: [{ label: '<img onerror=alert(1)>', evidence: 'test', severity: 'info' }]
          , recommendations: {
            therapy_settings: [{ action: '<script>hack</script>', rationale: 'test' }]
            , behavioral_timing: []
            , monitoring: []
          }
          , per_day: []
        };

        var html = renderer.renderAnalysis(analysis);
        html.should.containEql('&lt;script&gt;alert(1)&lt;/script&gt;');
        html.should.not.containEql('<script>alert(1)</script>');
        html.should.containEql('&lt;img onerror=alert(1)&gt;');
        html.should.containEql('&lt;script&gt;hack&lt;/script&gt;');
      });

      it('should handle null analysis', function () {
        var html = renderer.renderAnalysis(null);
        html.should.containEql('No AI analysis available');
      });
    });

    describe('renderCgmReport', function () {
      it('should export renderAnalysis', function () {
        renderer.should.have.property('renderAnalysis').which.is.a.Function();
        renderer.should.have.property('renderCgmReport').which.is.a.Function();
      });
    });

    describe('sanitizeEvidenceText', function () {
      it('rewrites 13-digit epoch-ms runs to dd.mm.yyyy HH:MM', function () {
        var ms = Date.UTC(2026, 3, 5, 12, 30, 0); // 2026-04-05 12:30 UTC
        var local = new Date(ms);
        var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
        var expected = pad(local.getDate()) + '.' + pad(local.getMonth() + 1) + '.' + local.getFullYear()
          + ' ' + pad(local.getHours()) + ':' + pad(local.getMinutes());
        var out = renderer.sanitizeEvidenceText('episode at ' + ms + ' with peak 217');
        out.should.equal('episode at ' + expected + ' with peak 217');
      });

      it('leaves normal numbers (mg/dL, counts, percentages) untouched', function () {
        renderer.sanitizeEvidenceText('TIR 72%, peak 217 mg/dL, 8 episodes').should.equal('TIR 72%, peak 217 mg/dL, 8 episodes');
      });

      it('leaves numbers outside the epoch sanity window untouched', function () {
        // 9999999999999 would parse to year ~2286 — rejected
        renderer.sanitizeEvidenceText('big number 9999999999999').should.equal('big number 9999999999999');
      });

      it('returns non-strings unchanged', function () {
        (renderer.sanitizeEvidenceText(null) === null).should.be.true();
        (renderer.sanitizeEvidenceText(undefined) === undefined).should.be.true();
        renderer.sanitizeEvidenceText('').should.equal('');
      });
    });

    describe('sanitizeAnalysisStrings', function () {
      it('walks the full analysis object and rewrites epoch-ms everywhere', function () {
        var ms1 = Date.UTC(2026, 3, 5, 12, 30, 0);
        var ms2 = Date.UTC(2026, 3, 6, 14, 0, 0);
        var obj = {
          summary: ['peak at ' + ms1]
          , trends: [
            { label: 'High at ' + ms1, evidence: 'from ' + ms1 + ' to ' + ms2, severity: 'warning' }
          ]
          , recommendations: {
            therapy_settings: [ { action: 'a ' + ms1, rationale: 'r ' + ms2 } ]
            , behavioral_timing: []
            , monitoring: ['check ' + ms1]
          }
          , treatment_insights: {
            carb_patterns: [ { text: 'meal at ' + ms1 } ]
            , insulin_patterns: []
            , basal_observations: []
            , dosing_observations: []
          }
          , per_day: [ { date: '2026-04-05', notes: ['note ' + ms2] } ]
          , data_quality_notes: ['gap at ' + ms1]
        };
        renderer.sanitizeAnalysisStrings(obj);
        // After sanitization, no raw 13-digit run should remain anywhere.
        JSON.stringify(obj).should.not.match(/\b\d{13}\b/);
      });

      it('is a no-op for null/undefined', function () {
        renderer.sanitizeAnalysisStrings(null);
        renderer.sanitizeAnalysisStrings(undefined);
      });
    });
  });

  describe('llm_client', function () {
    var llmClient = require('../lib/report_plugins/ai_eval/llm_client');

    describe('stripJsonFences', function () {
      it('should strip markdown json fences', function () {
        llmClient.stripJsonFences('```json\n{"a":1}\n```').should.equal('{"a":1}');
      });

      it('should strip plain fences', function () {
        llmClient.stripJsonFences('```\n{"a":1}\n```').should.equal('{"a":1}');
      });

      it('should pass through valid JSON unchanged', function () {
        llmClient.stripJsonFences('{"a":1}').should.equal('{"a":1}');
      });

      it('should handle whitespace around fences', function () {
        llmClient.stripJsonFences('  ```json\n{"a":1}\n```  ').should.equal('{"a":1}');
      });
    });

    describe('tryParseJson', function () {
      it('should parse valid JSON', function () {
        var result = llmClient.tryParseJson('{"key":"value"}');
        result.should.have.property('key', 'value');
      });

      it('should strip fences and parse', function () {
        var result = llmClient.tryParseJson('```json\n{"key":"value"}\n```');
        result.should.have.property('key', 'value');
      });

      it('should return null for invalid JSON', function () {
        var result = llmClient.tryParseJson('not json at all');
        (result === null).should.be.true();
      });
    });
  });

  describe('prompts', function () {
    var prompts = require('../lib/report_plugins/ai_eval/prompts');

    describe('replacePlaceholders', function () {
      it('should replace all occurrences of a placeholder', function () {
        var result = prompts.replacePlaceholders('Hello {{NAME}}, welcome {{NAME}}!', { '{{NAME}}': 'World' });
        result.should.equal('Hello World, welcome World!');
      });

      it('should handle multiple different placeholders', function () {
        var result = prompts.replacePlaceholders('{{A}} and {{B}}', { '{{A}}': 'X', '{{B}}': 'Y' });
        result.should.equal('X and Y');
      });

      it('should leave unmatched placeholders unchanged', function () {
        var result = prompts.replacePlaceholders('Hello {{NAME}}', {});
        result.should.equal('Hello {{NAME}}');
      });
    });

    describe('formatProfileJSON', function () {
      it('should format a Nightscout profile as JSON', function () {
        var profile = {
          startDate: '2026-01-01T00:00:00Z'
          , units: 'mg/dL'
          , defaultProfile: 'Default'
          , store: {
            'Default': {
              basal: [{ time: '00:00', value: 0.8 }]
              , carbratio: [{ time: '00:00', value: 10 }]
              , sens: [{ time: '00:00', value: 40 }]
              , target_low: [{ time: '00:00', value: 70 }]
              , target_high: [{ time: '00:00', value: 180 }]
            }
          }
        };
        var result = prompts.formatProfileJSON(profile);
        result.should.have.property('units', 'mg/dL');
        result.should.have.property('basal').which.is.an.Array();
        result.basal[0].should.have.property('time', '00:00');
        result.basal[0].should.have.property('value', 0.8);
        result.should.have.property('sensitivity').which.is.an.Array();
        result.should.have.property('target_low').which.is.an.Array();
        result.should.have.property('target_high').which.is.an.Array();
      });

      it('should return null for missing profile', function () {
        var result = prompts.formatProfileJSON(null);
        (result === null).should.be.true();
      });

      it('should return null for missing store', function () {
        var result = prompts.formatProfileJSON({ defaultProfile: 'X', store: {} });
        (result === null).should.be.true();
      });
    });
  });

  describe('cost_tracker', function () {
    var costTracker = require('../lib/report_plugins/ai_eval/cost_tracker');

    describe('calculateCost', function () {
      it('should calculate OpenAI cost correctly', function () {
        var cost = costTracker.calculateCost({
          prompt_tokens: 1000,
          completion_tokens: 500
        }, { input_rate: 0.5, output_rate: 1.5 });
        cost.should.equal((1000 / 1000) * 0.5 + (500 / 1000) * 1.5);
      });

      it('should handle zero tokens', function () {
        var cost = costTracker.calculateCost({
          prompt_tokens: 0,
          completion_tokens: 0
        }, { input_rate: 0.5, output_rate: 1.5 });
        cost.should.equal(0);
      });

      it('should handle missing usage fields gracefully', function () {
        var cost = costTracker.calculateCost({}, { input_rate: 0.5, output_rate: 1.5 });
        cost.should.equal(0);
      });
    });
  });

  describe('data_processor', function () {
    var dataProcessor = require('../lib/report_plugins/ai_eval/data_processor');

    it('should export buildSinglePayload', function () {
      dataProcessor.should.have.property('buildSinglePayload').which.is.a.Function();
    });

    describe('buildSinglePayload', function () {
      function makeCgmData () {
        return {
          days: [
            {
              date: '2026-03-15'
              , sgv: [[1710460800000, 120]]
              , treatments: [[1710460800000, 30, 2, 'Meal']]
              , stats: {
                average: 120, median: 120, sd: 0, cv: 0, tir_pct: 100, tbr_pct: 0, tar_pct: 0
                , total_carbs: 30, total_insulin: 2
                , time_blocks: [{ hour: 8, avg: 120, sd: 0, count: 1 }]  // should be stripped
              }
            }
          ]
          , period_stats: {
            average: 120, median: 120, tir_pct: 100
            , treatment_summary: { total_carbs: 30, total_insulin: 2, avg_daily_carbs: 30, avg_daily_insulin: 2 }
          }
          , raw_profile: { defaultProfile: 'D', store: { D: { basal: [{ time: '00:00', value: 0.8 }] } } }
          , meta: { days: 1, from: '2026-03-15', to: '2026-03-15', units: 'mg/dl' }
        };
      }

      it('should strip time_blocks from per_day stats when building the LLM payload', function () {
        var payload = dataProcessor.buildSinglePayload(
          makeCgmData()
          , { system_prompt: 'sys {{STATS_JSON}}', user_prompt_template: 'usr {{STATS_JSON}}' }
          , {}
          , 'en'
        );
        var userContent = payload.messages[1].content;
        userContent.should.not.match(/time_blocks/);
        // But the main stats fields should still be present:
        userContent.should.match(/total_carbs/);
        userContent.should.match(/total_insulin/);
      });

      it('should format the profile from cgmData.raw_profile', function () {
        var prompts = require('../lib/report_plugins/ai_eval/prompts');
        var cgmData = makeCgmData();
        var payload = dataProcessor.buildSinglePayload(
          cgmData
          , { system_prompt: 'sys {{PROFILE_JSON}}', user_prompt_template: 'usr {{PROFILE_JSON}}' }
          , {}
          , 'en'
        );
        var expected = JSON.stringify(prompts.formatProfileJSON(cgmData.raw_profile));
        payload.messages[0].content.should.equal('sys ' + expected);
        payload.messages[1].content.should.equal('usr ' + expected);
      });

      it('should fall back to {} when raw_profile is missing', function () {
        var cgmData = makeCgmData();
        cgmData.raw_profile = null;
        var payload = dataProcessor.buildSinglePayload(
          cgmData
          , { system_prompt: 'sys', user_prompt_template: 'usr {{PROFILE_JSON}}' }
          , {}
          , 'en'
        );
        payload.messages[1].content.should.equal('usr {}');
      });

      it('should not embed the response schema in the prompts (structured output handles it)', function () {
        // Default prompts no longer reference {{RETURNFORMAT}}. Any remaining
        // prompt still gets the replacement for backwards compat, but a prompt
        // that omits the placeholder must NOT accidentally receive the schema.
        var payload = dataProcessor.buildSinglePayload(
          makeCgmData()
          , { system_prompt: 'Just analyze the data.', user_prompt_template: 'Data: {{CGMDATA_JSON}}' }
          , {}
          , 'en'
        );
        payload.messages[0].content.should.equal('Just analyze the data.');
        payload.messages[1].content.should.not.match(/CgmAnalysisSchema/);
        // But response_format on the payload itself MUST still carry the schema:
        payload.should.have.property('response_format');
        payload.response_format.should.have.property('type', 'json_schema');
        payload.response_format.json_schema.should.have.property('name', 'CgmAnalysisSchema');
      });

      it('should not leak pumpExtras from prepareCgmData into the prompts', function () {
        var prepare = require('../lib/report_plugins/pump_analysis/data_processor').prepareCgmData;
        var sgv = [];
        for (var i = 0; i < 288; i++) sgv.push({ mills: 1710460800000 + i * 300000, sgv: 120 });
        var result = prepare({
          '2026-03-15': { sgv: sgv, treatments: [{ mills: 1710470000000, eventType: 'Meal Bolus', insulin: 4, carbs: 40 }] }
          , profiles: []
          , alldays: 1
        }, {}, { targetLow: 70, targetHigh: 180 });
        result.should.have.property('pumpExtras');
        var payload = dataProcessor.buildSinglePayload(
          result.cgmData
          , {
            system_prompt: 'sys {{CGMDATA_JSON}} {{STATS_JSON}}'
            , user_prompt_template: 'usr {{CGMDATA_JSON}} {{STATS_JSON}} {{PROFILE_JSON}} {{TREATMENT_SUMMARY}}'
          }
          , {}
          , 'en'
        );
        var json = JSON.stringify(payload.messages);
        ['pumpExtras', 'recommendations', 'mealCases', 'readingsByDayMgdl', 'basisLine'].forEach(function (k) {
          json.should.not.containEql(k);
        });
      });

      it('should still replace {{RETURNFORMAT}} if a user-customised prompt uses it', function () {
        var payload = dataProcessor.buildSinglePayload(
          makeCgmData()
          , { system_prompt: 'sys', user_prompt_template: 'Schema:\n{{RETURNFORMAT}}' }
          , {}
          , 'en'
        );
        payload.messages[1].content.should.not.match(/\{\{RETURNFORMAT\}\}/);
        payload.messages[1].content.should.match(/period/);
      });
    });
  });

  describe('provider adapters (lib/ai/)', function () {
    var ai = require('../lib/ai/');

    describe('detectProvider', function () {
      it('should detect anthropic from URL', function () {
        ai.detectProvider('https://api.anthropic.com/v1/messages').should.equal('anthropic');
      });

      it('should detect openai_compat for OpenAI URL', function () {
        ai.detectProvider('https://api.openai.com/v1/chat/completions').should.equal('openai_compat');
      });

      it('should detect openai_compat for Gemini compat URL', function () {
        ai.detectProvider('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions').should.equal('openai_compat');
      });

      it('should default to openai_compat for unknown URLs', function () {
        ai.detectProvider('https://my-custom-llm.example.com/v1/chat').should.equal('openai_compat');
      });

      it('should default to openai_compat for null/undefined', function () {
        ai.detectProvider(null).should.equal('openai_compat');
        ai.detectProvider(undefined).should.equal('openai_compat');
      });
    });

    describe('createProvider', function () {
      it('should create openai_compat provider by default', function () {
        var provider = ai.createProvider({
          apiUrl: 'https://api.openai.com/v1/chat/completions'
          , apiKey: 'test-key'
        });
        provider.should.have.property('name', 'openai_compat');
        provider.should.have.property('chatCompletion').which.is.a.Function();
      });

      it('should create anthropic provider for anthropic URL', function () {
        var provider = ai.createProvider({
          apiUrl: 'https://api.anthropic.com/v1/messages'
          , apiKey: 'test-key'
        });
        provider.should.have.property('name', 'anthropic');
        provider.should.have.property('chatCompletion').which.is.a.Function();
      });

      it('should respect explicit provider override', function () {
        var provider = ai.createProvider({
          apiUrl: 'https://my-proxy.example.com/v1/messages'
          , apiKey: 'test-key'
          , provider: 'anthropic'
        });
        provider.should.have.property('name', 'anthropic');
      });

      it('should normalize "openai" to "openai_compat"', function () {
        var provider = ai.createProvider({
          apiUrl: 'https://api.openai.com/v1/chat/completions'
          , apiKey: 'test-key'
          , provider: 'openai'
        });
        provider.should.have.property('name', 'openai_compat');
      });
    });

    describe('openai_compat adapter', function () {
      var http = require('http');
      var server;
      var serverPort;

      before(function (done) {
        server = http.createServer(function (req, res) {
          var body = '';
          req.on('data', function (chunk) { body += chunk; });
          req.on('end', function () {
            var parsed = JSON.parse(body);

            // Check auth header
            if (req.headers['authorization'] !== 'Bearer test-openai-key') {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Unauthorized' }));
              return;
            }

            // Simulate error model
            if (parsed.model === 'error-model') {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'Internal error' } }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              choices: [{ message: { content: '{"result":"ok"}' } }]
              , usage: { prompt_tokens: 100, completion_tokens: 50 }
            }));
          });
        });
        server.listen(0, function () {
          serverPort = server.address().port;
          done();
        });
      });

      after(function (done) {
        server.close(done);
      });

      it('should send request and parse OpenAI-style response', function (done) {
        var provider = ai.createProvider({
          apiUrl: 'http://127.0.0.1:' + serverPort + '/v1/chat/completions'
          , apiKey: 'test-openai-key'
        });
        provider.chatCompletion({
          messages: [{ role: 'user', content: 'test' }]
          , model: 'gpt-test'
        }).then(function (result) {
          result.should.have.property('content', '{"result":"ok"}');
          result.usage.should.have.property('prompt_tokens', 100);
          result.usage.should.have.property('completion_tokens', 50);
          done();
        }).catch(done);
      });

      it('should reject on HTTP error status', function (done) {
        var provider = ai.createProvider({
          apiUrl: 'http://127.0.0.1:' + serverPort + '/v1/chat/completions'
          , apiKey: 'test-openai-key'
        });
        provider.chatCompletion({
          messages: [{ role: 'user', content: 'test' }]
          , model: 'error-model'
        }).then(function () {
          done(new Error('Should have rejected'));
        }).catch(function (err) {
          err.statusCode.should.equal(500);
          done();
        });
      });

      it('should reject on auth failure', function (done) {
        var provider = ai.createProvider({
          apiUrl: 'http://127.0.0.1:' + serverPort + '/v1/chat/completions'
          , apiKey: 'wrong-key'
        });
        provider.chatCompletion({
          messages: [{ role: 'user', content: 'test' }]
          , model: 'gpt-test'
        }).then(function () {
          done(new Error('Should have rejected'));
        }).catch(function (err) {
          err.statusCode.should.equal(401);
          done();
        });
      });
    });

    describe('anthropic adapter', function () {
      var http = require('http');
      var server;
      var serverPort;

      before(function (done) {
        server = http.createServer(function (req, res) {
          var body = '';
          req.on('data', function (chunk) { body += chunk; });
          req.on('end', function () {
            var parsed = JSON.parse(body);

            // Check Anthropic-specific auth
            if (req.headers['x-api-key'] !== 'test-anthropic-key') {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { type: 'authentication_error' } }));
              return;
            }

            // Verify anthropic-version header
            if (req.headers['anthropic-version'] !== '2023-06-01') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { type: 'invalid_request' } }));
              return;
            }

            // Verify system is extracted from messages
            if (parsed.model === 'check-system') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                content: [{ text: JSON.stringify({ system: parsed.system || null, messageCount: parsed.messages.length }) }]
                , usage: { input_tokens: 80, output_tokens: 40 }
              }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              content: [{ text: '{"result":"claude-ok"}' }]
              , usage: { input_tokens: 80, output_tokens: 40 }
            }));
          });
        });
        server.listen(0, function () {
          serverPort = server.address().port;
          done();
        });
      });

      after(function (done) {
        server.close(done);
      });

      it('should send request and normalize Anthropic response', function (done) {
        var provider = ai.createProvider({
          apiUrl: 'http://127.0.0.1:' + serverPort + '/v1/messages'
          , apiKey: 'test-anthropic-key'
          , provider: 'anthropic'
        });
        provider.chatCompletion({
          messages: [{ role: 'user', content: 'test' }]
          , model: 'claude-test'
        }).then(function (result) {
          result.should.have.property('content', '{"result":"claude-ok"}');
          // Anthropic input_tokens -> prompt_tokens
          result.usage.should.have.property('prompt_tokens', 80);
          // Anthropic output_tokens -> completion_tokens
          result.usage.should.have.property('completion_tokens', 40);
          done();
        }).catch(done);
      });

      it('should extract system message from messages array', function (done) {
        var provider = ai.createProvider({
          apiUrl: 'http://127.0.0.1:' + serverPort + '/v1/messages'
          , apiKey: 'test-anthropic-key'
          , provider: 'anthropic'
        });
        provider.chatCompletion({
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' }
            , { role: 'user', content: 'test' }
          ]
          , model: 'check-system'
        }).then(function (result) {
          var parsed = JSON.parse(result.content);
          parsed.system.should.equal('You are a helpful assistant.');
          parsed.messageCount.should.equal(1); // system removed from messages
          done();
        }).catch(done);
      });

      it('should reject on auth failure', function (done) {
        var provider = ai.createProvider({
          apiUrl: 'http://127.0.0.1:' + serverPort + '/v1/messages'
          , apiKey: 'wrong-key'
          , provider: 'anthropic'
        });
        provider.chatCompletion({
          messages: [{ role: 'user', content: 'test' }]
          , model: 'claude-test'
        }).then(function () {
          done(new Error('Should have rejected'));
        }).catch(function (err) {
          err.statusCode.should.equal(401);
          done();
        });
      });
    });

  });

  describe('formatDate', function () {
    var renderer = require('../lib/report_plugins/ai_eval/renderer');

    it('should convert YYYY-MM-DD to dd.mm.yyyy', function () {
      renderer.formatDate('2026-04-10').should.equal('10.04.2026');
    });

    it('should convert another date correctly', function () {
      renderer.formatDate('2026-01-05').should.equal('05.01.2026');
    });

    it('should return empty string for empty input', function () {
      renderer.formatDate('').should.equal('');
    });

    it('should return empty string for null', function () {
      renderer.formatDate(null).should.equal('');
    });

    it('should return empty string for undefined', function () {
      renderer.formatDate(undefined).should.equal('');
    });

    it('should pass through non-matching strings', function () {
      renderer.formatDate('not-a-date').should.equal('not-a-date');
    });

    it('should pass through partial dates', function () {
      renderer.formatDate('2026-04').should.equal('2026-04');
    });
  });

  describe('treatment statistics', function () {
    var statistics = require('../lib/statistics');

    describe('computeDayStats treatment fields', function () {
      it('should include treatment fields in day stats', function () {
        var sgv = [
          { mills: 1000, sgv: 120 }
          , { mills: 2000, sgv: 130 }
          , { mills: 3000, sgv: 140 }
        ];
        var treatments = [
          { carbs: 45, insulin: 3.5 }
          , { carbs: 30, insulin: 0 }
          , { insulin: 2.0 }
        ];
        var result = statistics.computeDayStats(sgv, treatments, { targetLow: 70, targetHigh: 180 });
        result.should.have.property('total_carbs', 75);
        result.should.have.property('total_insulin', 5.5);
        result.should.have.property('bolus_count', 2);
        result.should.have.property('carb_entries', 2);
      });

      it('should handle empty treatments', function () {
        var sgv = [{ mills: 1000, sgv: 120 }];
        var result = statistics.computeDayStats(sgv, [], { targetLow: 70, targetHigh: 180 });
        result.should.have.property('total_carbs', 0);
        result.should.have.property('total_insulin', 0);
        result.should.have.property('bolus_count', 0);
        result.should.have.property('carb_entries', 0);
      });

      it('should handle null treatments', function () {
        var sgv = [{ mills: 1000, sgv: 120 }];
        var result = statistics.computeDayStats(sgv, null, { targetLow: 70, targetHigh: 180 });
        result.should.have.property('total_carbs', 0);
        result.should.have.property('total_insulin', 0);
      });

      it('should skip treatments with missing fields', function () {
        var sgv = [{ mills: 1000, sgv: 120 }];
        var treatments = [{ carbs: 10 }, {}, null, { insulin: 2 }];
        var result = statistics.computeDayStats(sgv, treatments, { targetLow: 70, targetHigh: 180 });
        result.should.have.property('total_carbs', 10);
        result.should.have.property('total_insulin', 2);
        result.should.have.property('bolus_count', 1);
        result.should.have.property('carb_entries', 1);
      });

      it('should not count zero carbs as carb entry', function () {
        var sgv = [{ mills: 1000, sgv: 120 }];
        var treatments = [{ carbs: 0, insulin: 1 }];
        var result = statistics.computeDayStats(sgv, treatments, { targetLow: 70, targetHigh: 180 });
        result.should.have.property('carb_entries', 0);
        result.should.have.property('bolus_count', 1);
      });
    });

    describe('computePeriodStats treatment_summary', function () {
      it('should aggregate treatment summary across days', function () {
        var dayStats = [
          { average: 140, median: 135, sd: 28, cv: 20, mage: null
            , tir_pct: 72, tbr_pct: 5, tar_pct: 23
            , hypo_episodes: [], hyper_episodes: []
            , time_blocks: [], total_readings: 288, valid_hours: 22, data_gaps: 1
            , total_carbs: 120, total_insulin: 25, bolus_count: 5, carb_entries: 4 }
          , { average: 150, median: 145, sd: 30, cv: 20, mage: null
            , tir_pct: 65, tbr_pct: 3, tar_pct: 32
            , hypo_episodes: [], hyper_episodes: []
            , time_blocks: [], total_readings: 280, valid_hours: 21, data_gaps: 2
            , total_carbs: 100, total_insulin: 20, bolus_count: 4, carb_entries: 3 }
        ];
        var result = statistics.computePeriodStats(dayStats);
        result.should.have.property('treatment_summary');
        result.treatment_summary.total_carbs.should.equal(220);
        result.treatment_summary.total_insulin.should.equal(45);
        result.treatment_summary.avg_daily_carbs.should.equal(110);
        result.treatment_summary.avg_daily_insulin.should.equal(22.5);
        result.treatment_summary.avg_daily_boluses.should.equal(4.5);
      });
    });

    describe('emptyStats treatment fields', function () {
      it('should include treatment fields in empty stats', function () {
        var sgv = [];
        var result = statistics.computeDayStats(sgv, [], { targetLow: 70, targetHigh: 180 });
        result.should.have.property('total_carbs', 0);
        result.should.have.property('total_insulin', 0);
        result.should.have.property('bolus_count', 0);
        result.should.have.property('carb_entries', 0);
      });
    });
  });

  describe('renderAnalysis with treatment_insights', function () {
    var renderer = require('../lib/report_plugins/ai_eval/renderer');

    it('should render without error when treatment_insights is absent', function () {
      var analysis = {
        period: { from: '2026-03-01', to: '2026-03-07', days: 7 }
        , summary: ['Test']
        , trends: []
        , recommendations: { therapy_settings: [], behavioral_timing: [], monitoring: [] }
        , per_day: []
      };
      var html = renderer.renderAnalysis(analysis);
      html.should.containEql('AI Analysis');
      html.should.not.containEql('Treatment Insights');
    });

    it('should render treatment_insights with 4 sections', function () {
      var analysis = {
        period: { from: '2026-03-01', to: '2026-03-07', days: 7 }
        , summary: ['Test']
        , trends: []
        , recommendations: { therapy_settings: [], behavioral_timing: [], monitoring: [] }
        , per_day: []
        , treatment_insights: {
          carb_patterns: ['High carb dinners']
          , insulin_patterns: ['Consistent bolusing']
          , basal_observations: ['Overnight rate adequate']
          , dosing_observations: ['Good pre-bolus timing']
        }
      };
      var html = renderer.renderAnalysis(analysis);
      html.should.containEql('Treatment Insights');
      html.should.containEql('Carb Patterns');
      html.should.containEql('Insulin Patterns');
      html.should.containEql('Basal Observations');
      html.should.containEql('Dosing Observations');
      html.should.containEql('High carb dinners');
      html.should.containEql('Overnight rate adequate');
    });

    it('should escape XSS in treatment_insights', function () {
      var analysis = {
        period: { from: '2026-03-01', to: '2026-03-07', days: 7 }
        , summary: ['Test']
        , trends: []
        , recommendations: { therapy_settings: [], behavioral_timing: [], monitoring: [] }
        , per_day: []
        , treatment_insights: {
          carb_patterns: ['<script>alert(1)</script>']
          , insulin_patterns: []
          , basal_observations: []
          , dosing_observations: []
        }
      };
      var html = renderer.renderAnalysis(analysis);
      html.should.containEql('&lt;script&gt;alert(1)&lt;/script&gt;');
      html.should.not.containEql('<script>alert(1)</script>');
    });
  });

  describe('schemas treatment_insights', function () {
    var schemas = require('../lib/report_plugins/ai_eval/schemas');

    it('should define treatment_insights with carb_patterns, insulin_patterns, basal_observations, dosing_observations', function () {
      var props = schemas.unified_response_format.json_schema.schema.properties;
      props.should.have.property('treatment_insights');
      var ti = props.treatment_insights;
      ti.properties.should.have.properties('carb_patterns', 'insulin_patterns', 'basal_observations', 'dosing_observations');
    });

    it('should require treatment_insights in schema', function () {
      var required = schemas.unified_response_format.json_schema.schema.required;
      required.should.containEql('treatment_insights');
    });
  });
});

describe('ai_eval in the report page', function () {
  var createSecureDOM = require('./fixtures/secure-jsdom').createSecureDOM;
  var domGlobals = require('./fixtures/dom-globals');
  var DOM_GLOBALS = ['window', 'document', 'navigator', '$', 'jQuery'];
  var env;
  var state;
  var previousGlobals;
  var aiEval;
  var pumpAnalysis;
  var analysisCache;
  var ajaxCalls;

  function identity (s) { return s; }

  function clearPluginModules () {
    Object.keys(require.cache).forEach(function (modulePath) {
      if (modulePath.replace(/\\/g, '/').includes('/lib/report_plugins/')) {
        delete require.cache[modulePath];
      }
    });
  }

  function wait (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function buildStorage (dayCount) {
    var ds = { profiles: [], alldays: dayCount };
    var keys = [];
    for (var i = 1; i <= dayCount; i++) {
      var key = '2026-03-' + String(i).padStart(2, '0');
      var base = Date.UTC(2026, 2, i, 8, 0, 0);
      ds[key] = {
        sgv: [
          { mills: base, sgv: 120 }
          , { mills: base + 300000, sgv: 60 }
          , { mills: base + 600000, sgv: 250 }
        ]
        , treatments: []
      };
      keys.push(key);
    }
    return { ds: ds, days: keys };
  }

  beforeEach(function () {
    previousGlobals = Object.fromEntries(DOM_GLOBALS.map(function (name) {
      return [name, Object.getOwnPropertyDescriptor(global, name)];
    }));
    clearPluginModules();
    env = createSecureDOM('<!DOCTYPE html><html><head></head><body><div id="host"></div></body></html>');
    state = domGlobals.installDomGlobals(env);
    analysisCache = require('../lib/report_plugins/pump_analysis/analysis_cache');
    analysisCache.clear();
    aiEval = require('../lib/report_plugins/ai_eval')({});
    pumpAnalysis = require('../lib/report_plugins/pump_analysis')({});

    ajaxCalls = [];
    env.window.$.ajax = function (opts) {
      ajaxCalls.push(opts.url);
      if (/ai_settings\/prompts/.test(opts.url)) {
        opts.success({ system_prompt: 'system', user_prompt_template: 'user' });
      } else if (/check_limit/.test(opts.url)) {
        opts.success({ limitExceeded: false });
      }
    };
  });

  afterEach(function () {
    clearPluginModules();
    domGlobals.restoreDomGlobals(state);
    DOM_GLOBALS.forEach(function (name) {
      if (previousGlobals[name]) {
        Object.defineProperty(global, name, previousGlobals[name]);
      } else {
        delete global[name];
      }
    });
  });

  function mount () {
    var client = { settings: { ai_llm_key_is_set: true }, translate: identity };
    env.window.document.getElementById('host').innerHTML = aiEval.html(client);
    env.window.initializeAiEvalTab(client);
    return client;
  }

  it('reuses the pump analysis result and fills the KPI table', function () {
    var client = mount();
    pumpAnalysis.html(client);
    var dataProcessor = require('../lib/report_plugins/pump_analysis/data_processor');
    var original = dataProcessor.prepareCgmData;
    var count = 0;
    dataProcessor.prepareCgmData = function () {
      count++;
      return original.apply(this, arguments);
    };
    var fixture = buildStorage(3);
    var opts = { targetLow: 70, targetHigh: 180 };
    try {
      pumpAnalysis.report(fixture.ds, fixture.days, opts);
      env.window.tempAiEvalReportData = { datastorage: fixture.ds, options: opts, sorteddaystoshow: fixture.days };
      env.window.processAiEvaluationData();
    } finally {
      dataProcessor.prepareCgmData = original;
    }
    count.should.equal(1);
    env.window.document.getElementById('aiKpiArea').innerHTML.should.containEql('Time in Range');
  });

  it('report() clears the previous KPI table', function () {
    mount();
    var fixture = buildStorage(2);
    var area = env.window.document.getElementById('aiKpiArea');
    area.textContent = 'old table';
    aiEval.report(fixture.ds, fixture.days, {});
    area.textContent.should.equal('');
  });

  it('shows an error box and skips AI requests when the analysis throws', function () {
    mount();
    var fixture = buildStorage(2);
    var original = analysisCache.getAnalysis;
    var originalError = console.error;
    var logged = [];
    analysisCache.getAnalysis = function () { throw new Error('boom'); };
    console.error = function () { logged.push(Array.prototype.slice.call(arguments)); };
    try {
      env.window.tempAiEvalReportData = { datastorage: fixture.ds, options: {}, sorteddaystoshow: fixture.days };
      (function () { env.window.processAiEvaluationData(); }).should.not.throw();
    } finally {
      analysisCache.getAnalysis = original;
      console.error = originalError;
    }
    var doc = env.window.document;
    var area = doc.getElementById('aiAnalysisArea');
    area.innerHTML.should.containEql('ai-section-error');
    area.textContent.should.containEql('Pump analysis could not be computed for this period.');
    doc.getElementById('sendToAiButton').disabled.should.be.true();
    doc.getElementById('ai-system-prompt-status').textContent.should.equal('Skipped');
    doc.getElementById('ai-user-prompt-status').textContent.should.equal('Skipped');
    ajaxCalls.should.have.length(0);
    logged.should.have.length(1);
  });

  it('shows the 14-day warning and a neutral prompt status for long ranges', async function () {
    mount();
    var fixture = buildStorage(15);
    aiEval.report(fixture.ds, fixture.days, {});
    await wait(30);

    var doc = env.window.document;
    doc.getElementById('aiAnalysisArea').innerHTML.should.containEql('role="alert"');
    doc.getElementById('sendToAiButton').disabled.should.be.true();
    doc.getElementById('ai-system-prompt-status').textContent.should.equal('Skipped');
    doc.getElementById('ai-user-prompt-status').textContent.should.equal('Skipped');
    doc.getElementById('aiKpiArea').innerHTML.should.containEql('Time in Range');
    ajaxCalls.should.have.length(0);
  });
});
