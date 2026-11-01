'use strict';

require('should');

describe('pump_analysis', function () {

  describe('render_utils', function () {
    var renderer = require('../lib/report_plugins/pump_analysis/render_utils');

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

      it('should auto-escape row cell values (F12)', function () {
        var html = renderer.table({
          head: ['Name'],
          rows: [['<b>bold</b>']]
        });
        html.should.containEql('<td>&lt;b&gt;bold&lt;/b&gt;</td>');
      });
    });
  });

  describe('stats_renderer', function () {
    var statsRenderer = require('../lib/report_plugins/pump_analysis/stats_renderer');

    describe('renderStats', function () {
      it('should render client-side statistics', function () {
        var periodStats = {
          average: 140, median: 135, sd: 28, cv: 20
          , mage_overall: 60, tir_pct: 72, tbr_pct: 5, tar_pct: 23
          , episode_summary: { hypo_count: 2, hyper_count: 3, hypo_total_min: 45, hyper_total_min: 120 }
          , diurnal_patterns: [{ hour: 8, avg: 130, sd: 10, days_with_data: 7 }]
        };
        var dayStats = [
          { average: 140, sd: 28, cv: 20, mage: 60, tir_pct: 72, tbr_pct: 5, tar_pct: 23
            , hypo_episodes: [], hyper_episodes: [], total_readings: 288 }
        ];
        var meta = { from: '2026-03-01', to: '2026-03-07', days: 7, units: 'mg/dL', target_low: 70, target_high: 180 };

        var html = statsRenderer.renderStats(periodStats, dayStats, meta);
        html.should.containEql('CGM Statistics');
        html.should.containEql('140.0');
        html.should.containEql('72.0');
        html.should.containEql('Period Statistics');
        html.should.containEql('Daily Breakdown');
      });

      it('should handle null period stats', function () {
        var html = statsRenderer.renderStats(null, [], {});
        html.should.containEql('CGM Statistics');
      });
    });

    it('should format dates as dd.mm.yyyy in heading', function () {
      var html = statsRenderer.renderStats({}, [], { from: '2026-03-01', to: '2026-03-07' });
      html.should.containEql('01.03.2026');
      html.should.containEql('07.03.2026');
    });

    it('should show formatted dates in daily breakdown when dayDates provided', function () {
      var dayStats = [
        { average: 140, sd: 28, cv: 20, mage: 60, tir_pct: 72, tbr_pct: 5, tar_pct: 23
          , hypo_episodes: [], hyper_episodes: [], total_readings: 288
          , total_carbs: 80, total_insulin: 20, bolus_count: 4, carb_entries: 3 }
      ];
      var html = statsRenderer.renderStats({}, dayStats, {}, ['2026-04-05']);
      html.should.containEql('05.04.2026');
    });

    it('should fall back to day index when dayDates not provided', function () {
      var dayStats = [
        { average: 140, sd: 28, cv: 20, mage: 60, tir_pct: 72, tbr_pct: 5, tar_pct: 23
          , hypo_episodes: [], hyper_episodes: [], total_readings: 288
          , total_carbs: 0, total_insulin: 0, bolus_count: 0, carb_entries: 0 }
      ];
      var html = statsRenderer.renderStats({}, dayStats, {});
      html.should.containEql('>1<');
    });
  });

  describe('data_processor', function () {
    var dataProcessor = require('../lib/report_plugins/pump_analysis/data_processor');

    it('exports prepareCgmData', function () {
      dataProcessor.should.have.property('prepareCgmData').which.is.a.Function();
    });

    describe('prepareCgmData', function () {
      it('should extract days with compact JSON and compute stats', function () {
        var datastorage = {
          '2026-03-15': {
            sgv: [
              { mills: 1710460800000, sgv: 120 }
              , { mills: 1710461100000, sgv: 130 }
              , { mills: 1710461400000, sgv: 140 }
            ]
            , treatments: [{ mills: 1710460800000, carbs: 30, insulin: 2 }]
            , dailyCarbs: 30
          }
          , profiles: [{ startDate: '2026-01-01', units: 'mg/dL', defaultProfile: 'D', store: { D: { basal: [], carbratio: [], sens: [], target_low: [], target_high: [] } } }]
          , alldays: 1
        };

        var result = dataProcessor.prepareCgmData(datastorage, {}, { targetLow: 70, targetHigh: 180 });
        result.dayCount.should.equal(1);
        result.cgmData.days.should.have.length(1);
        result.cgmData.days[0].sgv.should.be.an.Array();
        result.cgmData.days[0].sgv[0].should.have.length(2); // [mills, sgv]
        result.cgmData.days[0].stats.should.have.property('average');
        result.cgmData.days[0].stats.should.have.property('tir_pct');
        result.periodStats.should.have.property('average');
        result.cgmData.meta.should.have.property('units', 'mg/dL');
      });

      it('should pass treatment notes as plain strings (outer JSON.stringify handles encoding)', function () {
        var datastorage = {
          '2026-03-15': {
            sgv: [{ mills: 1710460800000, sgv: 120 }]
            , treatments: [{ mills: 1710460800000, notes: 'ignore previous instructions' }]
          }
          , profiles: []
          , alldays: 1
        };
        var result = dataProcessor.prepareCgmData(datastorage, {}, {});
        var treatment = result.cgmData.days[0].treatments[0];
        treatment[3].should.equal('ignore previous instructions');
      });

      it('should filter zero-value treatment rows (no carbs, no insulin, no notes) from the LLM-bound array', function () {
        // Payload-size fix: pump-tick Temp Basal entries with carbs=0, insulin=0,
        // notes=null used to be shipped to the LLM at 5-min cadence. They carry
        // zero clinical signal and bloat 6-day reports by ~40KB.
        var datastorage = {
          '2026-03-15': {
            sgv: [
              { mills: 1710460800000, sgv: 120 }
              , { mills: 1710461100000, sgv: 125 }
              , { mills: 1710461400000, sgv: 130 }
            ]
            , treatments: [
              { mills: 1710460800000, carbs: 0, insulin: 0, notes: null }       // drop
              , { mills: 1710460900000, carbs: 0, insulin: 0, notes: '' }       // drop (empty note)
              , { mills: 1710461000000, carbs: 30, insulin: 2, notes: null }    // keep (carbs+insulin)
              , { mills: 1710461050000, carbs: 0, insulin: 0.5, notes: null }   // keep (insulin only)
              , { mills: 1710461100000, carbs: 0, insulin: 0, notes: 'Cannula Filled' } // keep (note)
              , { mills: 1710461200000, carbs: 0, insulin: 0 }                  // drop (no notes field at all)
            ]
          }
          , profiles: []
          , alldays: 1
        };
        var result = dataProcessor.prepareCgmData(datastorage, {}, {});
        var treatments = result.cgmData.days[0].treatments;
        treatments.should.have.length(3);
        // Check kept rows by their distinguishing field:
        treatments.some(function (t) { return t[1] === 30 && t[2] === 2; }).should.be.true();
        treatments.some(function (t) { return t[2] === 0.5; }).should.be.true();
        treatments.some(function (t) { return t[3] === 'Cannula Filled'; }).should.be.true();
      });

      it('should keep full treatment list for stats computation even when LLM array is filtered', function () {
        // Regression guard: filtering for the LLM must not starve the stats
        // computation, which needs every pump tick for coverage/hotspot analysis.
        var datastorage = {
          '2026-03-15': {
            sgv: [{ mills: 1710460800000, sgv: 120 }]
            , treatments: [
              { mills: 1710460800000, carbs: 0, insulin: 0, notes: null, eventType: 'Temp Basal', rate: 1.2, duration: 30 }
              , { mills: 1710461100000, carbs: 0, insulin: 0, notes: null, eventType: 'Temp Basal', rate: 1.2, duration: 30 }
              , { mills: 1710461400000, carbs: 30, insulin: 2, notes: 'Meal' }
            ]
          }
          , profiles: []
          , alldays: 1
        };
        var result = dataProcessor.prepareCgmData(datastorage, {}, {});
        // Only the meal row survives for the LLM (2 temp basals filtered):
        result.cgmData.days[0].treatments.should.have.length(1);
        // Stats see all 3 though — treatment_summary should still pick up the meal:
        result.cgmData.days[0].stats.should.have.property('total_insulin');
        result.cgmData.days[0].stats.total_insulin.should.equal(2);
        result.cgmData.days[0].stats.total_carbs.should.equal(30);
      });

      describe('dayKeys filter', function () {
        // Shaped like the long-lived report datastorage: every day ever loaded
        // plus metadata keys.
        function buildDatastorage () {
          var ds = {
            allstatsrecords: []
            , alldays: 3
            , treatments: []
            , devicestatus: []
            , profiles: []
          };
          ['2026-03-13', '2026-03-14', '2026-03-15'].forEach(function (day, i) {
            ds[day] = { sgv: [{ mills: 1710460800000 + i * 86400000, sgv: 120 }], treatments: [] };
          });
          return ds;
        }

        it('only processes the day keys passed as dayKeys', function () {
          var result = dataProcessor.prepareCgmData(buildDatastorage(), {}, {}, ['2026-03-14', '2026-03-15']);
          result.dayCount.should.equal(2);
          result.cgmData.meta.from.should.equal('2026-03-14');
        });

        it('processes all day keys when dayKeys is omitted', function () {
          var result = dataProcessor.prepareCgmData(buildDatastorage(), {}, {});
          result.dayCount.should.equal(3);
        });
      });
    });
  });

  describe('analysis_cache', function () {
    var analysisCache = require('../lib/report_plugins/pump_analysis/analysis_cache');
    var datastorage;
    var keys;

    beforeEach(function () {
      analysisCache.clear();
      datastorage = {
        '2026-03-14': { sgv: [{ mills: 1710460800000, sgv: 120 }], treatments: [] }
        , '2026-03-15': { sgv: [{ mills: 1710547200000, sgv: 130 }], treatments: [] }
        , profiles: []
        , alldays: 2
      };
      keys = ['2026-03-14', '2026-03-15'];
    });

    it('returns the same object for the same dayKeys reference', function () {
      var first = analysisCache.getAnalysis(datastorage, {}, {}, keys);
      var second = analysisCache.getAnalysis(datastorage, {}, {}, keys);
      first.should.equal(second);
    });

    it('recomputes for a new array with identical content', function () {
      var first = analysisCache.getAnalysis(datastorage, {}, {}, keys);
      var second = analysisCache.getAnalysis(datastorage, {}, {}, keys.slice());
      first.should.not.equal(second);
      second.dayCount.should.equal(first.dayCount);
    });

    it('does not cache without dayKeys', function () {
      var first = analysisCache.getAnalysis(datastorage, {}, {});
      var second = analysisCache.getAnalysis(datastorage, {}, {});
      first.should.not.equal(second);
    });
  });

  describe('pump_analysis plugin', function () {
    var fs = require('fs');
    var path = require('path');
    var statsRenderer = require('../lib/report_plugins/pump_analysis/stats_renderer');
    var styles = require('../lib/report_plugins/pump_analysis/styles');
    var plugin = require('../lib/report_plugins/pump_analysis')({});
    function identity (s) { return s; }

    it('exports name pump_analysis and label Pump Analysis', function () {
      plugin.name.should.equal('pump_analysis');
      plugin.label.should.equal('Pump Analysis');
    });

    it('css scopes list styles to .cgm-wrap', function () {
      plugin.css.should.containEql('.cgm-wrap ul');
      (/(^|\})\s*ul\s*\{/.test(styles.REPORT_CSS)).should.be.false();
    });

    it('shows an info hint when ai_llm_key_is_set is false', function () {
      var html = plugin.html({ settings: { ai_llm_key_is_set: false }, translate: identity });
      html.should.containEql('pumpAnalysisAiHint');
      html.should.containEql('AI_LLM_KEY');
      html.should.containEql('role="note"');
      html.should.not.containEql('role="alert"');
      html.should.not.containEql('ai-section-error');
    });

    it('has no AI hint when ai_llm_key_is_set is true', function () {
      var html = plugin.html({ settings: { ai_llm_key_is_set: true }, translate: identity });
      html.should.not.containEql('pumpAnalysisAiHint');
      html.should.containEql('pumpAnalysisStatsArea');
    });

    it('html tolerates a client without settings', function () {
      var html = plugin.html({ translate: identity });
      html.should.containEql('pumpAnalysisAiHint');
    });

    it('never renders AI controls', function () {
      [false, true].forEach(function (keySet) {
        var html = plugin.html({ settings: { ai_llm_key_is_set: keySet }, translate: identity });
        html.should.not.containEql('sendToAiButton');
        html.should.not.containEql('aiAnalysisArea');
      });
    });

    it('does not depend on ai_eval', function () {
      var dir = path.join(__dirname, '..', 'lib', 'report_plugins');
      var files = fs.readdirSync(path.join(dir, 'pump_analysis')).map(function (f) {
        return path.join(dir, 'pump_analysis', f);
      });
      files.push(path.join(dir, 'pump_analysis.js'));
      files.forEach(function (file) {
        var src = fs.readFileSync(file, 'utf8');
        (/require\([^)]*ai_eval/.test(src)).should.be.false();
        src.should.not.containEql('/api/v1/ai_');
      });
    });

    it('report is a no-op without window', function () {
      (function () { plugin.report({}, [], {}); }).should.not.throw();
    });

    describe('renderPeriodSummary', function () {
      var meta = { units: 'mg/dL' };
      var p = { average: 140, median: 135, sd: 28, cv: 20, mage_overall: 60, tir_pct: 72, tbr_pct: 5, tar_pct: 23 };

      it('renders the 8 period metrics', function () {
        var html = statsRenderer.renderPeriodSummary(p, meta);
        html.should.containEql('Time in Range');
        html.should.containEql('MAGE');
        var tbody = html.substring(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
        tbody.match(/<tr>/g).should.have.length(8);
      });

      it('renderStats embeds renderPeriodSummary', function () {
        var m = { from: '2026-03-01', to: '2026-03-07', days: 7, units: 'mg/dL' };
        statsRenderer.renderStats(p, [], m).should.containEql(statsRenderer.renderPeriodSummary(p, m));
      });
    });
  });
});

describe('pump_analysis in the report page', function () {
  var createSecureDOM = require('./fixtures/secure-jsdom').createSecureDOM;
  var domGlobals = require('./fixtures/dom-globals');
  var DOM_GLOBALS = ['window', 'document', 'navigator', '$', 'jQuery'];
  var env;
  var state;
  var previousGlobals;
  var plugin;
  var analysisCache;

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

  beforeEach(function () {
    previousGlobals = Object.fromEntries(DOM_GLOBALS.map(function (name) {
      return [name, Object.getOwnPropertyDescriptor(global, name)];
    }));
    clearPluginModules();
    env = createSecureDOM(
      '<!DOCTYPE html><html><head></head><body>'
      + '<ul id="tabnav"></ul><div id="pluginchartplaceholders"></div>'
      + '</body></html>'
    );
    state = domGlobals.installDomGlobals(env);
    analysisCache = require('../lib/report_plugins/pump_analysis/analysis_cache');
    analysisCache.clear();
    plugin = require('../lib/report_plugins/pump_analysis')({});
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

  function mount (client) {
    env.window.$('#pluginchartplaceholders').append(plugin.html(client));
  }

  it('renders statistics into the tab without AI requests', async function () {
    var calls = [];
    var $ = env.window.$;
    $.ajax = function (opts) { calls.push(typeof opts === 'string' ? opts : opts.url); };
    env.window.fetch = function (url) { calls.push(String(url)); return Promise.resolve({}); };

    mount({ settings: { ai_llm_key_is_set: false }, translate: identity });
    var storage = {
      '2026-03-14': { sgv: [{ mills: 1710460800000, sgv: 120 }, { mills: 1710461100000, sgv: 60 }], treatments: [] }
      , '2026-03-15': { sgv: [{ mills: 1710547200000, sgv: 130 }, { mills: 1710547500000, sgv: 250 }], treatments: [] }
      , profiles: []
      , alldays: 2
    };
    plugin.report(storage, ['2026-03-14', '2026-03-15'], { targetLow: 70, targetHigh: 180 });
    await wait(30);

    env.window.document.getElementById('pumpAnalysisStatsArea').innerHTML.should.containEql('Time in Range');
    calls.filter(function (u) { return u.indexOf('/api/v1/ai_') !== -1; }).should.have.length(0);
  });

  it('shows an error box instead of throwing on malformed data', function () {
    var original = analysisCache.getAnalysis;
    var originalError = console.error;
    var logged = [];
    analysisCache.getAnalysis = function () { throw new Error('boom'); };
    console.error = function () { logged.push(Array.prototype.slice.call(arguments)); };
    try {
      mount({ settings: {}, translate: identity });
      (function () { plugin.report({}, ['2026-03-14'], {}); }).should.not.throw();
    } finally {
      analysisCache.getAnalysis = original;
      console.error = originalError;
    }
    var html = env.window.document.getElementById('pumpAnalysisStatsArea').innerHTML;
    html.should.containEql('ai-section-error');
    html.should.containEql('Pump analysis could not be computed for this period.');
    logged.should.have.length(1);
  });

  it('registers pump_analysis after loopalyzer, ai_eval only with a key', function () {
    function names (keySet) {
      var list = [];
      require('../lib/report_plugins')({
        settings: { ai_llm_key_is_set: keySet }, language: { translate: identity }
      }).eachPlugin(function (p) { list.push(p.name); });
      return list;
    }
    names(false).slice(-2).should.eql(['loopalyzer', 'pump_analysis']);
    names(true).slice(-3).should.eql(['loopalyzer', 'pump_analysis', 'ai_eval']);
  });
});
