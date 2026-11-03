'use strict';

// Stylesheet of the Pump Analysis report tab (no <style> wrapper: the report
// plugin loader puts it into a head <style> element).
var REPORT_CSS = ''
  // R1-8: dropped min-width which conflicted with narrow mobile viewports.
  // Readability pass: bumped max-width from 1024px to min(1440px, 95vw) so the
  // charts get real estate on wide monitors while still leaving breathing room
  // on anything smaller. Charts use viewBox + preserveAspectRatio, so they
  // scale up cleanly without any per-chart code changes.
  + '.cgm-wrap { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: min(1440px, 95vw); margin: auto; line-height: 1.45; }'
  + '.cgm-wrap h1 { font-size: 1.6rem; margin: 0 0 .5rem; }'
  + '.cgm-wrap h2 { font-size: 1.2rem; margin: 1.2rem 0 .6rem; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }'
  + '.cgm-wrap h3 { font-size: 1rem; margin: 1rem 0 .5rem; color: #333; }'
  + '.cgm-wrap p { margin: .3rem 0; }'
  + '.cgm-table { width: 100%; border-collapse: collapse; font-size: .95rem; }'
  + '.cgm-table th, .cgm-table td { border: 1px solid #e5e7eb; padding: .5rem .6rem; text-align: left; vertical-align: top; }'
  + '.cgm-table thead th { background: #f8fafc; font-weight: 600; }'
  + '.cgm-table td.cgm-ok { background: #e6f4ea; color: #14532d; font-weight: 600; }'
  + '.cgm-table td.cgm-warn { background: #fef3c7; color: #7c2d12; font-weight: 600; }'
  + '.cgm-wrap ul { padding-left: 1.2rem; margin: .2rem 0; }'
  + '.cgm-meta { color: #555; font-size: .9rem; }'
  + '.cgm-section-subtitle { color: #555; font-size: .85rem; margin: -.4rem 0 .6rem; font-style: italic; }'
  + '.cgm-grid-2col, .cgm-grid-3col { display: grid; grid-template-columns: 1fr; gap: 1rem; }'
  + '@media (min-width: 900px) { .cgm-grid-2col { grid-template-columns: repeat(2, 1fr); } .cgm-grid-3col { grid-template-columns: repeat(3, 1fr); } }'
  + '.ai-section { border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin-top: 16px; }'
  + '.ai-section-stats { background: #f8fffe; }'
  + '.ai-section-analysis { background: #fffff8; }'
  + '.ai-section-error { background: #fff5f5; color: #c53030; padding: 12px; border-radius: 4px; border: 1px solid #fca5a5; margin-top: 10px; }'
  + '.cgm-chart-section { margin-top: 24px; }'
  + '.cgm-chart-section > h2 { margin-bottom: 8px; }'
  // R1-1: collapsible <details> styling so summary has a clear affordance
  + '.cgm-details { margin: 1rem 0; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }'
  + '.cgm-details > summary { cursor: pointer; padding: .7rem 1rem; font-weight: 600; background: #f8fafc; user-select: none; list-style: revert; }'
  + '.cgm-details > summary:hover { background: #f0f3f8; }'
  + '.cgm-details > summary:focus-visible { outline: 2px solid #1d4ed8; outline-offset: -2px; }'
  + '.cgm-details[open] > summary { border-bottom: 1px solid #e5e7eb; }'
  + '.cgm-details > *:not(summary) { padding: .8rem 1rem; }'
  // R1-2: insulin legend styling
  + '.cgm-insulin-legend { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: .6rem; font-size: .85rem; color: #374151; }'
  + '.cgm-legend-item { display: inline-flex; align-items: center; gap: .4rem; }'
  + '.cgm-legend-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }'
  // R1-2: coverage badge next to pump-section headings
  + '.cgm-coverage-badge { display: inline-block; background: #dbeafe; color: #1e3a8a; padding: 3px 10px; border-radius: 12px; font-size: .78rem; font-weight: 500; letter-spacing: .01em; }'
  // R1-2 + R4-4: data-quality callout
  + '.cgm-data-quality-note { background: #fef3c7; border-left: 4px solid #f59e0b; padding: .7rem .9rem; margin: .8rem 0 0; border-radius: 4px; font-size: .88rem; color: #78350f; }'
  // R1-2: no-pump fallback notice
  + '.cgm-pump-notice { background: #eff6ff; border-left: 4px solid #3b82f6; padding: .8rem 1rem; margin: 1rem 0; border-radius: 4px; color: #1e3a8a; }'
  + '.cgm-pump-notice p { margin: 0; }'
  + '.cgm-pump-section { margin-top: 1.2rem; }'
  // R4-10: intro callout for the pump automation analysis region
  + '.cgm-analysis-intro { background: #f0f9ff; border-left: 4px solid #0284c7; padding: .7rem 1rem; margin: 1rem 0 .4rem; border-radius: 4px; color: #0c4a6e; font-size: .9rem; }'
  + '.cgm-analysis-intro strong { color: #0c4a6e; }'
  // Info hint shown when no AI key is configured (same look as the intro callout)
  + '.pump-analysis-hint { background: #f0f9ff; border-left: 4px solid #0284c7; padding: .7rem 1rem; margin: 1rem 0 .4rem; border-radius: 4px; color: #0c4a6e; font-size: .9rem; }'
  // R4-5: skeleton loader so the "Loading chart…" text doesn't visually flash
  + '.cgm-chart-skeleton { height: 140px; background: linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%); background-size: 200% 100%; animation: cgm-shimmer 1.4s infinite ease-in-out; border-radius: 6px; }'
  + '@keyframes cgm-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }'
  + '.cgm-chart-skeleton.cgm-chart-skeleton-tall { height: 220px; }'
  // R1-3: responsive chart text scaling — at narrow widths bump axis text up so it stays legible
  + '@media (max-width: 640px) { .cgm-wrap svg text { font-size: 14px !important; } .cgm-wrap svg .axis text { font-size: 14px !important; } .cgm-table { font-size: .85rem; } .cgm-table th, .cgm-table td { padding: .35rem .4rem; } }';

module.exports = {
  REPORT_CSS: REPORT_CSS
};
