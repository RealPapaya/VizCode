#!/usr/bin/env python3
"""
html_builder.py — VIZCODE HTML assembler
Owns the HTML_SKELETON template and build_html() / inject_data() helpers.
Extracted from analyze_viz.py to keep that file focused on graph analysis.
"""

import json
import os
import sys
from pathlib import Path

# Locate project root the same way analyze_viz.py does.
_CORE_DIR = Path(__file__).parent          # .../VizCode/src/core
_SRC_DIR  = _CORE_DIR.parent               # .../VizCode/src
_ROOT_DIR = _SRC_DIR.parent                # .../VizCode


# ─── HTML Skeleton (CSS/JS loaded from static/) ───────────────────────────────
HTML_SKELETON = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VIZCODE — {root_name}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2212%22 fill=%22%230b1220%22/%3E%3Ctext x=%2232%22 y=%2242%22 text-anchor=%22middle%22 font-family=%22Arial,sans-serif%22 font-size=%2230%22 font-weight=%22700%22 fill=%22%2360a5fa%22%3EV%3C/text%3E%3C/svg%3E">
<script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
<script src="https://cdn.jsdelivr.net/npm/layout-base@2.0.1/layout-base.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cose-base@2.2.0/cose-base.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-fcose@2.2.0/cytoscape-fcose.js"></script>
<script src="https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-elk@2.3.0/dist/cytoscape-elk.js"></script>
<script src="https://cdn.jsdelivr.net/npm/webcola@3.4.0/WebCola/cola.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-cola@2.5.1/cytoscape-cola.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/graphology@0.26.0/dist/graphology.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sigma@3.0.2/dist/sigma.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Fira+Code:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/c.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/cpp.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/x86asm.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/xml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/python.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/javascript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/go.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/yaml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/markdown.min.js"></script>
<style>{CSS}</style>
</head>
<body>

<script>window.JOB_ID = {JOB_ID_JSON}; window.PROJECT_TYPE = {PT_JSON};</script>

<div id="app-shell">

  <!-- LEFT ICON RAIL ────────────────────────────────────────────────────── -->
  <aside id="app-rail">
    <div class="rail-logo">V</div>

    <button id="graph-btn" class="rail-btn topbar-mode-btn active" type="button" data-i18n-attr="data-tip" data-i18n="graphHomeTip" onclick="switchTopbarMode('graph')" title="Main Graph">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="6" r="2"></circle><circle cx="19" cy="12" r="2"></circle><circle cx="12" cy="18" r="2"></circle><line x1="6.8" y1="10.9" x2="10.2" y2="7.1"></line><line x1="13.8" y1="7.1" x2="17.2" y2="10.9"></line><line x1="17.2" y1="13.1" x2="13.8" y2="16.9"></line><line x1="10.2" y1="16.9" x2="6.8" y2="13.1"></line></svg>
      <span data-i18n="graphHome">Graph</span>
    </button>
    <button id="galaxy-btn" class="rail-btn topbar-mode-btn" type="button" data-i18n-attr="data-tip" data-i18n="galaxyTip" onclick="switchTopbarMode('galaxy')" title="Galaxy">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><line x1="6.7" y1="7.3" x2="9.6" y2="10"/><circle cx="19" cy="6" r="2"/><line x1="17.3" y1="7.3" x2="14.4" y2="10"/><circle cx="5" cy="18" r="2"/><line x1="6.7" y1="16.7" x2="9.6" y2="14"/><circle cx="19" cy="18" r="2"/><line x1="17.3" y1="16.7" x2="14.4" y2="14"/></svg>
      <span data-i18n="galaxy">Galaxy</span>
    </button>
    <button id="dashboard-btn" class="rail-btn topbar-mode-btn" type="button" data-i18n-attr="data-tip" data-i18n="dashboardTip" onclick="switchTopbarMode('dashboard')" title="Dashboard">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
      <span data-i18n="dashboard">Dashboard</span>
    </button>

    <div class="rail-divider"></div>

    <button id="rail-explorer-btn" class="rail-btn" type="button" title="Explorer" onclick="(function(){{var s=document.getElementById('sidebar');var isCollapsed=s&&s.classList.contains('sb-collapsed');var onExplorer=typeof _sbActiveTab!=='undefined'&&_sbActiveTab==='explorer';if(!isCollapsed&&onExplorer){{document.getElementById('sb-collapse-btn').click();return;}}if(typeof _sbActiveTab!=='undefined'){{_sbActiveTab='explorer';}}if(isCollapsed){{document.getElementById('sb-collapse-btn').click();}}else if(typeof _applySidebarTab==='function'){{_applySidebarTab();}}}})()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
    </button>
    <button id="rail-filter-btn" class="rail-btn" type="button" title="Filter" onclick="(function(){{var s=document.getElementById('sidebar');var isCollapsed=s&&s.classList.contains('sb-collapsed');var onFilters=typeof _sbActiveTab!=='undefined'&&_sbActiveTab==='filters';if(!isCollapsed&&onFilters){{document.getElementById('sb-collapse-btn').click();return;}}if(typeof _sbActiveTab!=='undefined'){{_sbActiveTab='filters';}}if(isCollapsed){{document.getElementById('sb-collapse-btn').click();}}else if(typeof _applySidebarTab==='function'){{_applySidebarTab();}}}})()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
    </button>

    <div class="rail-spacer"></div>
    <button id="pref-btn" class="rail-btn" type="button" data-i18n-attr="data-tip" data-i18n="settingsButton" title="Settings">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
  </aside>

  <!-- EXPLORER PANEL (slides in/out — same bg as rail, no inner border) ─── -->
  <div id="sidebar">
    <div id="sb-header">
      <div id="sb-tabs">
        <button class="sb-tab active" data-tab="explorer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
          <span class="sb-tab-label" data-i18n="explorer">Explorer</span>
        </button>
        <button class="sb-tab" data-tab="filters">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
          <span class="sb-tab-label" data-i18n="filters">Filters</span>
        </button>
      </div>
      <button id="sb-collapse-btn" title="Collapse sidebar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg></button>
    </div>
    <div id="sb-body-explorer" class="sb-body">
      <div id="sidebar-title"></div>
      <div id="module-list"></div>
    </div>
    <div id="sb-body-filters" class="sb-body" style="display:none">
      <div id="filters-title" data-i18n="filters">Filters</div>
      <div id="ft-filter"></div>
      <div id="node-legend"></div>
      <div id="edge-filter"></div>
    </div>
    <div id="sb-footer">
      <span id="sb-stat-nodes">&#x2013;</span>
      <span class="sb-stat-sep"> &middot; </span>
      <span id="sb-stat-edges">&#x2013;</span>
    </div>
  </div>
  <!-- MAIN AREA (topbar + breadcrumb + content) ───────────────────────── -->
  <div id="main-area">

    <div id="topbar">
      <div id="search-card">
      <div id="search-wrap">
        <div id="sr-input-row">
          <span id="sr-icon">⌕</span>
          <input id="search" type="text" data-i18n-attr="placeholder" data-i18n="searchPlaceholderFiles" placeholder="Search files…" autocomplete="off" spellcheck="false">
          <div id="sr-toggles">
            <button class="sr-toggle" id="srt-case" data-i18n-attr="data-tip" data-i18n="searchMatchCase">Aa</button>
            <button class="sr-toggle" id="srt-word" data-i18n-attr="data-tip" data-i18n="searchMatchWord">ab</button>
            <button class="sr-toggle" id="srt-regex" data-i18n-attr="data-tip" data-i18n="searchRegex">.*</button>
          </div>
          <span id="sr-count"></span>
          <span id="sr-sep"></span>
          <div id="sr-modes">
            <button class="sr-mode active" data-mode="files" id="srm-files" data-i18n-attr="data-tip" data-i18n="searchModeFilesTip" aria-label="Files">
              <svg class="sr-mode-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                <path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
              </svg>
            </button>
            <button class="sr-mode" data-mode="code" id="srm-code" data-i18n-attr="data-tip" data-i18n="searchModeCodeTip" aria-label="Code">
              <svg class="sr-mode-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                <path fill="currentColor" d="M9.5 7.5L6 12l3.5 4.5 1.3-1L8.1 12l2.7-3.5-1.3-1zM14.5 7.5l-1.3 1L15.9 12l-2.7 3.5 1.3 1L18 12l-3.5-4.5z"/>
              </svg>
            </button>
          </div>
        </div>
        <div id="sr-panel">
          <div id="sr-filters">
            <div class="sr-filter-row">
              <span class="sr-filter-label" data-i18n="searchIncludeLabel">files to include</span>
              <input class="sr-filter-input" id="sr-include" type="text" data-i18n-attr="placeholder" data-i18n="searchIncludePlaceholder" placeholder="e.g. *.c, *.h" autocomplete="off" spellcheck="false">
            </div>
            <div class="sr-filter-row">
              <span class="sr-filter-label" data-i18n="searchExcludeLabel">files to exclude</span>
              <input class="sr-filter-input" id="sr-exclude" type="text" data-i18n-attr="placeholder" data-i18n="searchExcludePlaceholder" placeholder="e.g. Build/*, *.obj" autocomplete="off" spellcheck="false">
            </div>
          </div>
          <div id="sr-results"></div>
        </div>
      </div>
      </div><!-- /#search-card -->
      <div id="topbar-spacer"></div>
      <div id="level-switcher-card" class="topbar-card">
      <div id="level-switcher" class="lsw-disabled">
        <div class="lsw-pill"></div>
        <button class="lsw-seg lsw-active" data-seg="0" title="File Graph"><svg class="lsw-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><line x1="7" y1="11" x2="17" y2="6.5"/><line x1="7" y1="13" x2="17" y2="17.5"/></svg><span class="lsw-label">File Graph</span></button>
        <div class="lsw-div"></div>
        <button class="lsw-seg" data-seg="1" title="Call Flow"><svg class="lsw-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/></svg><span class="lsw-label">Call Flow</span></button>
        <div class="lsw-div"></div>
        <button class="lsw-seg" data-seg="2" title="Structure"><svg class="lsw-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="8" height="6" rx="1"/><path d="M12 9v4"/><path d="M5 13h14"/><path d="M5 13v3"/><rect x="2" y="16" width="6" height="5" rx="1"/><path d="M19 13v3"/><rect x="16" y="16" width="6" height="5" rx="1"/></svg><span class="lsw-label">Structure</span></button>
      </div>
      </div><!-- /#level-switcher-card -->
      <div id="code-card" class="topbar-card">
      <button id="code-toggle-btn" disabled data-i18n-attr="data-tip" data-i18n="codePanelToggleTip"><span class="code-icon">&#60;&#92;&#62;</span> <span data-i18n="codePanelToggle">Code</span></button>
      </div><!-- /#code-card -->
      <div id="chat-card" class="topbar-card">
      <button id="chat-btn" title="VizCode AI (Alt+C)"></button>
      </div><!-- /#chat-card -->
    </div>

    <div id="content-card">
    <div id="sb-resize-handle"></div>
    <div id="breadcrumb">
      <span id="bc-items" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;overflow:hidden"></span>
      <button id="back-btn" onclick="goBack()" data-i18n="back" disabled>&#8592; Back</button>
    </div>

    <div id="layout">
      <div id="graph-wrap">
    <div id="l1-toolbar" class="l2-toolbar hidden">
      <div class="l2-left">
        <div class="l2-title"><span class="banner-lvl l1-clr">Level 1</span> · File Graph</div>
        <div class="banner-breadcrumb" id="l1-breadcrumb-items"></div>
        <div class="l2-sub l2-sub-fallback" id="l1-mod-label" data-i18n="noModule">No module</div>
      </div>
        <div class="l2-actions">
          <button id="l1-prev" class="l2-btn" disabled>&#x21A9;</button>
          <button id="l1-next" class="l2-btn" disabled>&#x21AA;</button>
          <button id="l1-expand-all-ext" class="l2-btn" style="display:none" data-i18n="searchExpandAll">Expand All</button>
          <button id="l1-collapse-all-ext" class="l2-btn" style="display:none" data-i18n="searchCollapseAll">Collapse All</button>
          <button id="l1-toggle-ext" class="l2-btn" data-i18n="extFilesOn">External Files: On</button>
          <span id="l1-stats" class="l2-stats"></span>
        </div>
    </div>
    <div id="l2-toolbar" class="l2-toolbar hidden">
      <div class="l2-left">
        <div class="l2-title"><span class="banner-lvl l2-clr">Level 2</span> · Call Flow</div>
        <div class="banner-breadcrumb" id="l2-breadcrumb-items"></div>
        <div class="l2-sub l2-sub-fallback" id="l2-file-label" data-i18n="noFile">No file</div>
      </div>
        <div class="l2-actions">
          <button id="l2-prev" class="l2-btn">&#x21A9;</button>
          <button id="l2-next" class="l2-btn">&#x21AA;</button>
          <button id="l2-expand-all" class="l2-btn" data-i18n="searchExpandAll">Expand All</button>
          <button id="l2-collapse-all" class="l2-btn" data-i18n="searchCollapseAll">Collapse All</button>
          <button id="l2-toggle-ext-funcs" class="l2-btn" data-i18n="extFuncsOff">External Functions: Off</button>
          <span id="l2-stats" class="l2-stats"></span>
        </div>
    </div>
    <button id="l2-toggle-ext-lines" class="l2-btn" style="position: absolute; bottom: 16px; left: 16px; z-index: 50; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.5); border: 1px solid var(--border); background: var(--panel2);" data-i18n="extLinesOn">External Lines: On</button>
    <div id="cy"></div>
    <div id="galaxy-container"></div>
    <div id="func-view"></div>
    <div id="sv-view"></div>
    <div id="sym-view"></div>
    <div id="loading"><div class="spinner"></div><span id="loading-msg" data-i18n="loading">Loading...</span><button id="loading-cancel-btn" onclick="cancelRender()" data-i18n="cancelRender">✕ Cancel</button></div>
  </div>
  <!-- Resizer handle -->
  <div id="resizer" style="display:none"></div>
  <!-- Code Panel (CodeViz-style) -->
  <div id="code-panel">
    <div id="cp-header">
      <div id="cp-file-bar">
        <span id="cp-ext-badge">.C</span>
        <span id="cp-filename" data-i18n="noFileSelected">No file selected</span>
        <div id="cp-view-toggle" style="display:none">
          <button class="cp-view-btn active" id="cp-view-code" type="button">Code</button>
          <button class="cp-view-btn" id="cp-view-rendered" type="button">Markdown</button>
        </div>
        <button id="cp-multisnip-btn" title="Multi-snippet mode (Structure View only)" style="display:none" onclick="cpToggleMultiSnip()">◫</button>
        <button id="cp-close" data-i18n-attr="data-tip" data-i18n="close">✕</button>
      </div>
      <div id="cp-func-bar">
        <span id="cp-func-name"></span>
        <span id="cp-func-badge" class="cp-func-badge cp-func-public">PUBLIC</span>
        <div id="cp-func-nav">
          <button class="cp-nav-btn" id="cp-prev-func" data-i18n-attr="data-tip" data-i18n="prevFunc">‹</button>
          <button class="cp-nav-btn" id="cp-next-func" data-i18n-attr="data-tip" data-i18n="nextFunc">›</button>
        </div>
      </div>
    </div>
    <div id="cp-body">
      <div id="cp-loading">
        <div class="spinner"></div>
        <span style="font-size:12px;color:var(--muted)" data-i18n="loadingSource">Loading source...</span>
      </div>
      <div id="cp-empty" style="display:none">
        <div class="cp-empty-icon">📁</div>
        <p data-i18n="clickFileToView">Click a file node to view source</p>
        <small data-i18n="clickFileHint">Single-click → preview · Double-click → drill in</small>
      </div>
      <div id="cp-code-wrap" style="display:none"></div>
    </div>
  </div>
    </div><!-- /#layout -->
    </div><!-- /#content-card -->
  </div><!-- /#main-area -->
</div><!-- /#app-shell -->

<!-- Old info-panel (hidden, kept for JS compat) -->
<div id="info-panel" style="display:none">
  <div id="info-inner"><div id="info-title"></div><div id="info-sub"></div></div>
</div>

<div id="ctx-menu">
  <div class="ctx-item" id="ctx-copy"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span> <span data-i18n="copyPath">Copy path</span></div>
  <div class="ctx-item" id="ctx-open-code"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span> <span data-i18n="viewSource">View source</span></div>
  <div class="ctx-item" id="ctx-vscode"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span> <span data-i18n="openInVSCode">Open in VS Code</span></div>
  <div class="ctx-item" id="ctx-reveal-explorer"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg></span> <span data-i18n="revealInExplorer">Reveal in Explorer</span></div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" id="ctx-pin"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg></span> <span data-i18n="pinNode">Pin node</span></div>
</div>
<div id="tooltip"></div>

<!-- VizBridge Chat Panel -->
<div id="chat-panel">
  <div id="chat-header">
    <span id="chat-header-title">VizCode AI</span>
    <div style="display:flex;gap:6px;align-items:center">
      <button id="chat-mode-toggle-btn" title="Switch to side panel mode" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 5px;border-radius:4px;display:flex;align-items:center" aria-label="Toggle panel mode"></button>
      <button id="chat-hist-btn" title="Conversation history" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 5px;border-radius:4px;display:flex;align-items:center" aria-expanded="false"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="10" cy="10" r="8"/><polyline points="10 6 10 10 13 12"/></svg></button>
      <button id="chat-new-btn" title="New conversation" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 5px;border-radius:4px;display:flex;align-items:center"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M10 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/><path d="M17 3a1.5 1.5 0 0 1 0 2.12L10.06 12H8v-2.06L14.88 3A1.5 1.5 0 0 1 17 3z"/></svg></button>
      <button id="chat-cfg-btn" title="Settings" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:2px 5px;border-radius:4px">⚙</button>
      <button id="chat-close">✕</button>
    </div>
  </div>
  <div id="chat-sessions-panel" aria-label="Conversation history"></div>
  <div id="chat-messages"></div>
  <div id="chat-input-area">
    <div id="chat-depth-picker">
      <input type="range" id="chat-depth-range" min="0" max="2" step="1">
      <span id="chat-depth-info-label"></span>
      <span id="chat-depth-info-desc"></span>
    </div>
    <div id="chat-output-picker"></div>
    <textarea id="chat-input" rows="2" placeholder="Ask about this codebase…"></textarea>
    <div id="chat-input-toolbar">
      <button id="chat-depth-btn" aria-expanded="false" aria-controls="chat-depth-picker"></button>
      <button id="chat-mode-btn" title="切換輸出模式" data-i18n="chatModePickerTitle" data-i18n-attr="title" aria-expanded="false" aria-haspopup="listbox" aria-controls="chat-output-picker"></button>
      <div id="chat-toolbar-spacer"></div>
      <button id="chat-send" title="Send"></button>
    </div>
  </div>
</div>
<div id="chat-config-modal" class="hidden">
  <div id="chat-config-box">
    <h3>AI Chat Setup</h3>
    <p>Choose a provider and enter your credentials to enable VizCode AI.</p>
    <div class="chat-cfg-row">
      <label>Provider</label>
      <select id="chat-cfg-provider">
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI / Azure</option>
        <option value="grok">xAI Grok</option>
        <option value="gemini">Google Gemini</option>
        <option value="ollama">Ollama (local)</option>
        <option value="custom">Custom (OpenAI-compatible)</option>
      </select>
    </div>
    <!-- Anthropic fields -->
    <div class="chat-cfg-section" data-provider="anthropic">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-anthropic-key-status"></div>
        <input type="password" id="chat-cfg-anthropic-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-anthropic-model" placeholder="claude-sonnet-4-6" />
      </div>
    </div>
    <!-- OpenAI fields -->
    <div class="chat-cfg-section" data-provider="openai" style="display:none">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-openai-key-status"></div>
        <input type="password" id="chat-cfg-openai-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-openai-model" placeholder="gpt-4o" />
      </div>
      <div class="chat-cfg-row">
        <label>Base URL <span style="font-weight:400;opacity:.6">(Azure / proxy)</span></label>
        <input type="text" id="chat-cfg-openai-base-url" placeholder="https://api.openai.com/v1/chat/completions" />
      </div>
    </div>
    <!-- Grok fields -->
    <div class="chat-cfg-section" data-provider="grok" style="display:none">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-grok-key-status"></div>
        <input type="password" id="chat-cfg-grok-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-grok-model" placeholder="grok-4.20" />
      </div>
    </div>
    <!-- Gemini fields -->
    <div class="chat-cfg-section" data-provider="gemini" style="display:none">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-gemini-key-status"></div>
        <input type="password" id="chat-cfg-gemini-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-gemini-model" placeholder="gemini-2.0-flash" />
      </div>
    </div>
    <!-- Ollama fields -->
    <div class="chat-cfg-section" data-provider="ollama" style="display:none">
      <div class="chat-cfg-row">
        <label>Ollama URL</label>
        <input type="text" id="chat-cfg-ollama-url" placeholder="http://localhost:11434" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-ollama-model" placeholder="llama3.1" />
      </div>
    </div>
    <!-- Custom (OpenAI-compatible) fields -->
    <div class="chat-cfg-section" data-provider="custom" style="display:none">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-custom-key-status"></div>
        <input type="password" id="chat-cfg-custom-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Base URL</label>
        <input type="text" id="chat-cfg-custom-base-url" placeholder="https://openrouter.ai/api/v1" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-custom-model" placeholder="meta-llama/llama-3.1-8b-instruct:free" />
      </div>
    </div>
    <button id="chat-config-save">Save</button>
    <button id="chat-config-cancel">Cancel</button>
  </div>
</div>

<!-- Data embedded as JSON text — parsed by JSON.parse(), not JS engine (10x faster) -->
<script type="application/json" id="viz-data">{DATA}</script>
<script>(function(){{
  var l=document.getElementById('loading');
  var m=document.getElementById('loading-msg');
  if(l){{l.className='show';}}
  if(m){{m.textContent='⏳ Parsing graph data...';}}
  document.getElementById('cp-loading').classList.add('hidden');
  document.getElementById('cp-empty').style.display='';
}})();</script>
<script>{JS}</script>
</body>
</html>"""

# Backward-compat alias (server.py uses HTML_TEMPLATE)
HTML_TEMPLATE = HTML_SKELETON


# ─── build_html ───────────────────────────────────────────────────────────────
def build_html(data: dict, job_id: str = None) -> str:
    """Read shared static assets and embed them inline into the HTML skeleton."""
    base = _ROOT_DIR / 'static'
    css_assets = [
        base / 'styles' / 'themes.css',
        base / 'styles' / 'viz_base.css',
        base / 'styles' / 'viz_panels.css',
        base / 'styles' / 'viz_code.css',
        base / 'styles' / 'viz_overlays.css',
        base / 'styles' / 'viz_features.css',
        base / 'features' / 'symbol_view' / 'symbol_view.css',
        base / 'styles' / 'viz_chat.css',
    ]
    js_assets = [
        # ── core ──────────────────────────────────────────────────────────────
        base / 'core' / 'i18n.js',
        base / 'core' / 'viz_utils.js',
        base / 'core' / 'viz_state.js',
        base / 'core' / 'viz_nav_history.js',
        base / 'core' / 'viz_constants.js',
        # ── ui ────────────────────────────────────────────────────────────────
        base / 'ui' / 'viz_preferences.js',
        base / 'ui' / 'viz_code_panel.js',
        # ── file_viewers ──────────────────────────────────────────────────────
        base / 'file_viewers' / 'viz_office.js',
        base / 'file_viewers' / 'viz_pdf.js',
        base / 'file_viewers' / 'viz_markdown.js',
        # ── ui (continued) ────────────────────────────────────────────────────
        base / 'ui' / 'viz_toolbar.js',
        base / 'ui' / 'viz_sidebar.js',
        # ── features/graph (split from viz_graph.js) ──────────────────────────
        base / 'features' / 'graph' / 'graph_style.js',
        base / 'features' / 'graph' / 'graph_core.js',
        base / 'features' / 'graph' / 'graph_l2.js',
        base / 'features' / 'graph' / 'graph_l1.js',
        base / 'features' / 'graph' / 'graph_interact.js',
        base / 'features' / 'graph' / 'graph_multiselect.js',
        # ── features ──────────────────────────────────────────────────────────
        base / 'features' / 'viz_search.js',
        # ── features/Dashboard_view (multi-file dashboard) ───────────────────
        # Order: consts (config, charts, utils) → widgets → orchestration.
        base / 'features' / 'Dashboard_view' / 'dashboard_health_config.js',
        base / 'features' / 'Dashboard_view' / 'dashboard_charts.js',
        base / 'features' / 'Dashboard_view' / 'dashboard_utils.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_kpi_strip.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_code_health.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_tech_debt.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_complexity.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_duplication.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_coupling.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_issues.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_structure.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_graph_intelligence.js',
        # ── Phase 2: Temporal sub-widgets must precede the orchestrator ─────
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_temporal_hotspot.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_temporal_coupling.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_temporal_timeline.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_temporal_heatmap.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_temporal_authors.js',
        base / 'features' / 'Dashboard_view' / 'widgets' / 'widget_temporal.js',
        base / 'features' / 'Dashboard_view' / 'dashboard_config.js',
        base / 'features' / 'Dashboard_view' / 'dashboard_dom.js',
        base / 'features' / 'Dashboard_view' / 'dashboard_settings.js',
        base / 'features' / 'Dashboard_view' / 'dashboard_lifecycle.js',
        base / 'features' / 'Dashboard_view' / 'dashboard_drilldown.js',
        base / 'features' / 'Dashboard_view' / 'dashboard_render.js',
        base / 'features' / 'Dashboard_view' / 'dashboard_index.js',
        # ── features/galaxy_view ──────────────────────────────────────────────
        base / 'features' / 'galaxy_view' / 'viz_galaxy.js',          # state, constants, UI, Sigma, reducers
        base / 'features' / 'galaxy_view' / 'viz_galaxy_physics.js',  # FA2 physics (BH, FA2, Noverlap)
        base / 'features' / 'galaxy_view' / 'viz_galaxy_graph.js',    # graph building + initial positions
        # ── ui (layout — must come after graph initCy) ────────────────────────
        base / 'ui' / 'viz_layout.js',
        # ── features (continued) ──────────────────────────────────────────────
        base / 'features' / 'viz_chat.js',
        base / 'features' / 'viz_help.js',                      # ? help panel + shortcuts
        # ── boot (must be last) ───────────────────────────────────────────────
        base / 'viz.js',
        # ── features/symbol_view ──────────────────────────────────────────────
        base / 'features' / 'symbol_view' / 'sv_core.js',    # state, DOM lifecycle, public API
        base / 'features' / 'symbol_view' / 'sv_search.js',  # fuzzy search dropdown
        base / 'features' / 'symbol_view' / 'sv_graph.js',   # SVG renderer + animation
    ]
    missing = [p for p in css_assets + js_assets if not p.exists()]

    if missing:
        missing_str = '\n  '.join(str(p) for p in missing)
        raise FileNotFoundError(f'Missing static files. Expected:\n  {missing_str}')

    css = '\n\n'.join(p.read_text(encoding='utf-8') for p in css_assets)
    js = '\n\n'.join(p.read_text(encoding='utf-8') for p in js_assets)

    def _json_default(o):
        if isinstance(o, (set, frozenset)): return sorted(o)
        raise TypeError(f'Not serialisable: {type(o)}')
    json_str     = json.dumps(data, ensure_ascii=False, separators=(',', ':'), default=_json_default)
    root_name    = Path(data['stats']['root']).name or 'VIZCODE'
    job_id_json  = json.dumps(job_id)   # "null" or '"abc1234"'
    pt           = data.get('project_type', {})
    pt_json      = json.dumps(pt, default=_json_default)

    return HTML_SKELETON.format(
        CSS=css, JS=js,
        DATA=json_str,
        root_name=root_name,
        JOB_ID_JSON=job_id_json,
        PT_JSON=pt_json,
    )


# ─── inject_data (legacy) ─────────────────────────────────────────────────────
def inject_data(html: str, data: dict) -> str:
    """Legacy helper — now calls build_html() directly."""
    return build_html(data, job_id=None)
