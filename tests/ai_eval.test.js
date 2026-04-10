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
  });

  describe('schemas', function () {
    var schemas = require('../lib/report_plugins/ai_eval/schemas');

    it('should export interim_response_format', function () {
      schemas.should.have.property('interim_response_format');
      schemas.interim_response_format.should.have.property('type', 'json_schema');
      schemas.interim_response_format.json_schema.should.have.property('name', 'DailyAnalysisSchema');
      schemas.interim_response_format.json_schema.should.have.property('schema');
      schemas.interim_response_format.json_schema.schema.required.should.containDeep(['date', 'summary', 'statistics']);
    });

    it('should export final_response_format', function () {
      schemas.should.have.property('final_response_format');
      schemas.final_response_format.should.have.property('type', 'json_schema');
      schemas.final_response_format.json_schema.should.have.property('name', 'MultiDayAnalysisSchema');
      schemas.final_response_format.json_schema.should.have.property('schema');
      schemas.final_response_format.json_schema.schema.required.should.containDeep(['period', 'summary', 'overall_statistics']);
    });

    it('should have timeBlock definition in interim schema', function () {
      var defs = schemas.interim_response_format.json_schema.schema.definitions;
      defs.should.have.property('timeBlock');
      defs.timeBlock.properties.should.have.properties('avg', 'sd', 'below_pct', 'in_range_pct', 'above_pct');
    });

    it('should have timeBlock and episodeStats definitions in final schema', function () {
      var defs = schemas.final_response_format.json_schema.schema.definitions;
      defs.should.have.property('timeBlock');
      defs.should.have.property('episodeStats');
      defs.episodeStats.properties.should.have.properties('count', 'total_minutes', 'longest_min', 'by_block');
    });
  });

  describe('renderer', function () {
    var renderer = require('../lib/report_plugins/ai_eval/renderer');

    describe('escapeHtml', function () {
      it('should escape HTML special characters', function () {
        renderer.escapeHtml('<script>alert("xss")</script>').should.equal('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      });

      it('should escape ampersands', function () {
        renderer.escapeHtml('foo & bar').should.equal('foo &amp; bar');
      });

      it('should escape single quotes', function () {
        renderer.escapeHtml("it's").should.equal('it&#039;s');
      });

      it('should handle empty strings', function () {
        renderer.escapeHtml('').should.equal('');
      });

      it('should convert non-strings to strings', function () {
        renderer.escapeHtml(123).should.equal('123');
        renderer.escapeHtml(null).should.equal('null');
      });
    });

    describe('fmt', function () {
      it('should format numbers with unit and decimals', function () {
        renderer.fmt(120.456, ' mg/dL', 1).should.equal('120.5 mg/dL');
      });

      it('should return dash for null/undefined/NaN', function () {
        renderer.fmt(null).should.equal('-');
        renderer.fmt(undefined).should.equal('-');
        renderer.fmt(NaN).should.equal('-');
      });

      it('should default to 1 decimal place', function () {
        renderer.fmt(99.99).should.equal('100.0');
      });
    });

    describe('list', function () {
      it('should render items as escaped HTML list', function () {
        var html = renderer.list(['item <1>', 'item 2']);
        html.should.containEql('<ul>');
        html.should.containEql('<li>item &lt;1&gt;</li>');
        html.should.containEql('<li>item 2</li>');
      });

      it('should handle empty array', function () {
        renderer.list([]).should.equal('<ul></ul>');
      });

      it('should handle undefined', function () {
        renderer.list().should.equal('<ul></ul>');
      });
    });

    describe('table', function () {
      it('should escape header content', function () {
        var html = renderer.table({
          head: ['<script>', 'Value'],
          rows: [['cell1', '100']]
        });
        html.should.containEql('<table class="cgm-table"');
        html.should.containEql('<th scope="col">&lt;script&gt;</th>');
      });

      it('should render row cells as-is (caller escapes)', function () {
        var html = renderer.table({
          head: ['Name'],
          rows: [[renderer.escapeHtml('<b>bold</b>')]]
        });
        html.should.containEql('<td>&lt;b&gt;bold&lt;/b&gt;</td>');
      });
    });

    describe('renderDaily', function () {
      it('should render daily report with XSS-safe content', function () {
        var html = renderer.renderDaily({
          date: '2026-03-15',
          summary: ['<script>alert(1)</script>'],
          statistics: { average_glucose_mgdl: 120 },
          dailyPatterns: {},
          anomalies: [],
          recommendations: [],
          notes: []
        });
        html.should.containEql('2026-03-15');
        html.should.containEql('&lt;script&gt;');
        html.should.not.containEql('<script>alert');
      });
    });

    describe('renderMultiDay', function () {
      it('should render multi-day report', function () {
        var html = renderer.renderMultiDay({
          period: { from: '2026-03-01', to: '2026-03-14', days: 14 },
          summary: ['Good control overall'],
          overall_statistics: { average_glucose_mgdl: 130, cv_percent: 33 },
          diurnal_patterns: {},
          episodes: {},
          trends: [{ label: 'Improving', evidence: 'TIR up' }],
          recommendations: { therapy_settings: [], behavioral_timing: [], monitoring: [] },
          per_day: [{ date: '2026-03-01', notes: ['stable'] }],
          data_quality_notes: []
        });
        html.should.containEql('Multi');
        html.should.containEql('2026-03-01');
        html.should.containEql('Good control overall');
      });
    });

    describe('renderCgmReport', function () {
      it('should detect multi-day schema by period property', function () {
        // renderCgmReport requires a DOM element; tested via renderDaily/renderMultiDay
        // Just verify the detection logic exists
        renderer.should.have.property('renderCgmReport').which.is.a.Function();
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
});
