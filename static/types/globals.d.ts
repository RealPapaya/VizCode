// globals.d.ts — ambient stubs for third-party CDN globals and the window.* surface.
//
// The frontend loads its libraries as UMD <script> tags from a CDN, so they appear
// as bare globals. We type them as `any` (rather than pulling @types) to keep the
// dependency footprint minimal; tighten individually later if a view needs it.
//
// Ambient (no import/export) so these are visible to every script-style .ts file.

declare const cytoscape: any;
declare const d3: any;
declare const Sigma: any;
declare const graphology: any;
declare const forceAtlas2: any;
declare const ForceAtlas2: any;
declare const XLSX: any;
declare const mammoth: any;
declare const pdfjsLib: any;
declare const marked: any;
declare const hljs: any;
declare const JSZip: any;
declare const Chart: any;
declare const dagre: any;

// Cross-module functions defined inside another file's IIFE and exposed via
// `window.x = x` (so a bare reference resolves at runtime as a global property,
// but tsc can't see the declaration). Declared ambient here during migration;
// remove once the defining files stop wrapping these in IIFEs.
declare const _buildDashboardDOM: any;
declare const _DASH_ALL_WIDGETS: any;
declare const _dashAiPromptEnhanceDetail: any;
declare const _dashAiPromptSyncIndicators: any;
declare const clearSidebarGalaxyExplorerHighlight: any;
declare const svAfterRenderCode: any;
declare const svHideStructureBtn: any;
declare const svHideSvView: any;
declare const svHighlightBadgeByName: any;
declare const svUpdateStructureBtn: any;
declare const symShowCurrentSnippets: any;

// ── DOM migration aid (incremental JS→TS) ───────────────────────────────────
// The legacy frontend pervasively does `getElementById('x').value`, querySelector
// chains, `.dataset`, etc. with known-correct element assumptions. To avoid
// hundreds of casts during the bulk conversion, the query methods are loosened to
// `any` (a merged overload, declared here so it resolves before lib.dom's). The
// backend DATA contract stays fully typed — this only relaxes DOM element typing.
// Tighten per-file later by removing this block and adding explicit casts.
interface Document {
  getElementById(elementId: string): any;
  querySelector(selectors: string): any;
  querySelectorAll(selectors: string): any;
}
interface Element {
  querySelector(selectors: string): any;
  querySelectorAll(selectors: string): any;
  closest(selectors: string): any;
}

// window.* surface. DATA/cy/JOB_ID are typed; the index signature keeps the many
// other window.* APIs assigned across the 74 files from erroring during the
// incremental migration (drop it once the surface is fully typed).
interface Window {
  DATA: VizData;
  JOB_ID: string;
  cy: any;
  [key: string]: any;
}
