// @module viz_preferences — User preferences, theme, font, language
// Owns: _PREFS, CY_THEME_OVERRIDES, applyFont, applyCyFont, applyCyTheme,
//       applyTheme, _applyLang, initPreferences, withFont, _refresh*Chrome

// ─── Preferences ──────────────────────────────────────────────────────────────
const _PREFS = {
    KEYS: {
        font: 'biosviz_code_font', lang: 'biosviz_lang',
        extFiles: 'biosviz_ext_files', extFuncs: 'biosviz_ext_funcs',
        theme: 'biosviz_theme',
        layoutL0: 'biosviz_layout_l0',    // default layout for L0 module overview
        layoutL1: 'biosviz_layout_l1',    // default layout for L1 dep-map
        layoutL2: 'biosviz_layout_l2',    // default layout for L2 call-flow
        shapeMode: 'vc_shape_mode',
        edgeTypeLabels: 'biosviz_edge_type_labels',
        svEdgeStyle: 'vc_sv_edge_style',  // Symbol View edge routing: 'bezier' | 'orthogonal'
    },
    DEFAULTS: {
        font: "'JetBrains Mono', monospace", lang: 'en',
        extFiles: false, extFuncs: false, theme: 'dark',
        layoutL0: 'cose',      // Force-directed — best for module overview
        layoutL1: 'dagre-lr',  // Hierarchy LR — best for dep-map
        layoutL2: 'dagre-lr',  // Hierarchy LR — best for call-flow
        shapeMode: 'simple',
        edgeTypeLabels: false,
        svEdgeStyle: 'bezier',
    },
    get(k) {
        try {
            const v = localStorage.getItem(this.KEYS[k]);
            if (v === null) return this.DEFAULTS[k];
            if (v === 'true') return true; if (v === 'false') return false;
            return v;
        } catch (_) { return this.DEFAULTS[k]; }
    },
    set(k, v) { try { localStorage.setItem(this.KEYS[k], String(v)); } catch (_) { } },
    load() {
        depMapState.showExternalFiles = this.get('extFiles');
        depMapState.showEdgeTypeLabels = this.get('edgeTypeLabels');
        l2State.showExternalFuncs = this.get('extFuncs');
        l2State.showExternalEdges = l2State.showExternalFuncs;
        _shapeMode = this.get('shapeMode');
    },
};

function _refreshTopbarStatsLabels() {
    const stats = document.querySelectorAll('#topbar .stats-bar .stat');
    const files = document.getElementById('st-files')?.textContent || '0';
    const mods = document.getElementById('st-mods')?.textContent || '0';
    const funcs = document.getElementById('st-funcs')?.textContent || '0';
    if (stats[0]) stats[0].innerHTML = `${T('topbarFiles')} <strong id="st-files">${files}</strong>`;
    if (stats[1]) stats[1].innerHTML = `${T('topbarModules')} <strong id="st-mods">${mods}</strong>`;
    if (stats[2]) stats[2].innerHTML = `${T('topbarFunctions')} <strong id="st-funcs">${funcs}</strong>`;
}

function _refreshSearchChrome() {
    const filesBtn = document.getElementById('srm-files');
    const codeBtn = document.getElementById('srm-code');
    const caseBtn = document.getElementById('srt-case');
    const wordBtn = document.getElementById('srt-word');
    const regexBtn = document.getElementById('srt-regex');
    const search = document.getElementById('search');
    const filterLabels = document.querySelectorAll('#sr-filters .sr-filter-label');
    const include = document.getElementById('sr-include');
    const exclude = document.getElementById('sr-exclude');
    if (filesBtn) { filesBtn.setAttribute('data-tip', T('searchModeFilesTip')); filesBtn.setAttribute('aria-label', T('searchModeFiles')); }
    if (codeBtn) { codeBtn.setAttribute('data-tip', T('searchModeCodeTip')); codeBtn.setAttribute('aria-label', T('searchModeCode')); }
    if (caseBtn) caseBtn.setAttribute('data-tip', T('searchMatchCase'));
    if (wordBtn) wordBtn.setAttribute('data-tip', T('searchMatchWord'));
    if (regexBtn) regexBtn.setAttribute('data-tip', T('searchRegex'));
    if (search) search.placeholder = (typeof _srState !== 'undefined' && _srState.mode === 'code') ? T('searchPlaceholderCode') : T('searchPlaceholderFiles');
    if (filterLabels[0]) filterLabels[0].textContent = T('searchIncludeLabel');
    if (filterLabels[1]) filterLabels[1].textContent = T('searchExcludeLabel');
    if (include) include.placeholder = T('searchIncludePlaceholder');
    if (exclude) exclude.placeholder = T('searchExcludePlaceholder');
}

function _refreshPreferenceCopy() {
    const hint = document.querySelector('.pref-hint');
    if (hint) hint.innerHTML = T('langHint');
}

function _refreshCodePanelChrome() {
    const loading = document.querySelector('#cp-loading span');
    const empty = document.getElementById('cp-empty');
    const filename = document.getElementById('cp-filename');
    const prev = document.getElementById('cp-prev-func');
    const next = document.getElementById('cp-next-func');
    if (loading) loading.textContent = T('loadingSource');
    if (filename && !codeState.currentFile) filename.textContent = T('noFileSelected');
    if (prev) prev.setAttribute('data-tip', T('prevFunc'));
    if (next) next.setAttribute('data-tip', T('nextFunc'));
    if (empty && !codeState.currentFile) {
        empty.innerHTML = `<div class="cp-empty-icon">??</div><p>${T('clickFileToView')}</p><small>${T('clickFileHint')}</small>`;
    }
}

function _refreshContextMenuChrome() {
    const items = {
        'ctx-copy': 'copyPath',
        'ctx-open-code': 'viewSource',
        'ctx-vscode': 'openInVSCode',
        'ctx-reveal-explorer': 'revealInExplorer',
        'ctx-pin': 'pinNode',
    };
    Object.entries(items).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = T(key);
    });
}

function _refreshVisualChrome() {
    if (!window._i18n) return;
    document.documentElement.lang = _PREFS.get('lang');
    document.title = T('visualizerPageTitle', { root: _currentRootName() });
    _refreshTopbarStatsLabels();
    _refreshSearchChrome();
    _refreshPreferenceCopy();
    _refreshCodePanelChrome();
    _refreshContextMenuChrome();

    // Global pass for any data-i18n tags
    window._i18n.apply(document);
    _syncAllPrefDropdowns();

    const dashboardBtn = document.getElementById('dashboard-btn');
    if (dashboardBtn) {
        dashboardBtn.setAttribute('data-tip', T('dashboardTip'));
    }
    const topGraphBtn = document.getElementById('graph-btn');
    if (topGraphBtn) {
        topGraphBtn.setAttribute('data-tip', T('graphHomeTip'));
    }
    const galaxyBtn = document.getElementById('galaxy-btn');
    if (galaxyBtn) {
        if (galaxyBtn.classList.contains('computing')) {
            galaxyBtn.setAttribute('data-tip', typeof T === 'function' ? T('galaxyCalculatingTip', { dots: '...' }) : 'Calculating...');
        } else {
            galaxyBtn.setAttribute('data-tip', typeof T === 'function' ? T('galaxyTip') : 'Galaxy View');
        }
    }
    const prefBtn = document.getElementById('pref-btn');
    if (prefBtn) prefBtn.setAttribute('data-tip', T('settingsButton'));
    const cancelBtn = document.getElementById('loading-cancel-btn');
    if (cancelBtn) cancelBtn.innerHTML = `✕ ${T('cancelRender')}`;
    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.innerHTML = `&#8592; ${T('back')}`;
    const codeBtn = document.getElementById('code-toggle-btn');
    if (codeBtn) {
        codeBtn.innerHTML = `<span class="code-icon">&#60;&#92;&#62;</span> ${T('codePanelToggle')}`;
        codeBtn.setAttribute('data-tip', T('codePanelToggleTip'));
    }
    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();

    const sbTitle = document.querySelector('#sidebar-title span[data-i18n="fileSystem"]');
    if (sbTitle) sbTitle.textContent = T('sidebarFileSystem');

    // Banner titles are fixed — not overridden by i18n
    const l1Expand = document.getElementById('l1-expand-all-ext');
    const l1Collapse = document.getElementById('l1-collapse-all-ext');
    const l2Expand = document.getElementById('l2-expand-all');
    const l2Collapse = document.getElementById('l2-collapse-all');
    if (l1Expand) l1Expand.textContent = T('searchExpandAll');
    if (l1Collapse) l1Collapse.textContent = T('searchCollapseAll');
    if (l2Expand) l2Expand.textContent = T('searchExpandAll');
    if (l2Collapse) l2Collapse.textContent = T('searchCollapseAll');
    const extLines = document.getElementById('l2-toggle-ext-lines');
    if (extLines) extLines.textContent = l2State.showExternalEdges ? T('extLinesOn') : T('extLinesOff');

}

function _layoutKeyMap(id) {
    return ({
        'dagre-lr': ['layoutDagreLR', 'layoutDagreLR_Tip'],
        'dagre-tb': ['layoutDagreTB', 'layoutDagreTB_Tip'],
        'cose': ['layoutCose', 'layoutCose_Tip'],
        'fcose': ['layoutFcose', 'layoutFcose_Tip'],
        'cola': ['layoutCola', 'layoutCola_Tip'],
        'elk-layered': ['layoutElkLayered', 'layoutElkLayered_Tip'],
        'elk-stress': ['layoutElkStress', 'layoutElkStress_Tip'],
    })[id] || [];
}

function _layoutLabel(preset) {
    const [labelKey] = _layoutKeyMap(preset.id);
    return labelKey ? T(labelKey) : preset.label;
}

function _layoutTip(preset) {
    const [, tipKey] = _layoutKeyMap(preset.id);
    return tipKey ? T(tipKey) : preset.tip;
}

function _refreshDashboardLocale() {
    const overlay = document.getElementById('dashboard-overlay');
    if (!overlay) return;
    const open = overlay.style.display !== 'none';
    overlay.remove();
    _dashBuilt = false;
    _buildDashboardDOM();
    if (open) {
        document.getElementById('dashboard-overlay').style.display = 'block';
        _renderDashboard();
        _dashBuilt = true;
    }
}

function withFont(styleList, font) {
    return styleList.map(s => {
        if (!s || !s.selector || !s.style) return s;
        const sel = s.selector;
        if (sel === 'node' || sel.startsWith('node') || sel === 'edge' || sel.startsWith('edge')) {
            return { ...s, style: { ...s.style, 'font-family': font } };
        }
        return s;
    });
}

const DEFAULT_UI_FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";
const ZH_TW_UI_FONT = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', 'Heiti TC', sans-serif";

function _uiFontForLang(font, lang) {
    return (lang || '').toLowerCase() === 'zh-tw'
        ? `${ZH_TW_UI_FONT}, ${DEFAULT_UI_FONT}`
        : `${font}, ${DEFAULT_UI_FONT}`;
}

function applyCyFont(font) {
    if (!cy || typeof cy.style !== 'function') return;
    try {
        const cyFont = (font || '').replace(/["']/g, '');
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        const overrides = CY_THEME_OVERRIDES[theme] || [];
        cy.style([...withFont(CY_STYLE, cyFont), ...overrides]);
        // Ensure existing elements are updated immediately
        cy.nodes().style('font-family', cyFont);
        cy.edges().style('font-family', cyFont);
        // Force a repaint for canvas labels
        cy.resize();
    } catch (e) {
        console.warn('Failed to update cytoscape font', e);
    }
}

// ─── Preferences ─────────────────────────────────────────────────────────────
function applyFont(font, lang) {
    const uiFont = _uiFontForLang(font, lang || _PREFS.get('lang'));
    document.documentElement.style.setProperty('--code-font', font);
    document.documentElement.style.setProperty('--ui-font', uiFont);
    document.body.style.fontFamily = uiFont;

    applyCyFont(uiFont);
}

// ─── Theme ────────────────────────────────────────────────────────────────────
const CY_THEME_OVERRIDES = {
    dark: [
        {
            selector: 'node[simple=0][lvl=1]', style: {
                'background-color': '#1e1f1c', // --card-bg
            }
        },
        {
            selector: 'node[simple=0][lvl=0]', style: {
                'background-color': '#161715', // --panel
            }
        }
    ],
        claude: [
        {
            selector: 'node', style: {
                'color': '#111827',
            }
        },
                {
            selector: 'node[simple=0][lvl=1]', style: {
                'background-color': '#f5f2f2', // --card-bg
            }
        },
        {
            selector: 'node[simple=0][lvl=0]', style: {
                'background-color': '#fcfbfc', // --panel
            }
        },
        {
            selector: 'node:selected', style: {
                'border-color': '#e8194b',
            }
        },
        {
            selector: 'node[simple=1]:selected', style: {
                'border-color': '#e8194b',
            }
        },
        {
            selector: 'node.selected-label', style: {
                'color': '#111827',
            }
        },
        {
            selector: 'node.neighbor-label', style: {
                'color': '#6b7280',
            }
        },
        {
            selector: 'node.node-hovered', style: {
                'text-background-color': '#ffffff',
                'color': '#111827',
            }
        },
        {
            selector: 'edge', style: {
                'text-background-color': '#f4f5f7',
                'text-background-opacity': 0.92,
            }
        },
        {
            selector: '.hl', style: {
                'border-color': 'data(bc)', 'outline-color': 'data(bc)', 'outline-width': 1, 'outline-opacity': 1, 'outline-offset': 4,
            }
        },
        {
            selector: 'node[_t="drill_group"]', style: {
                'background-color': '#e8eaed',
                'background-opacity': 0.88,
            }
        },
    ],
    parchment: [
        {
            selector: 'node', style: {
                'color': '#020826',
            }
        },
        {
            selector: 'node[simple=0][lvl=1]', style: {
                'background-color': '#ede8e0',
            }
        },
        {
            selector: 'node[simple=0][lvl=0]', style: {
                'background-color': '#f5efe8',
            }
        },
        {
            selector: 'node:selected', style: {
                'border-color': '#8c7851',
            }
        },
        {
            selector: 'node[simple=1]:selected', style: {
                'border-color': '#8c7851',
            }
        },
        {
            selector: 'node.selected-label', style: {
                'color': '#020826',
            }
        },
        {
            selector: 'node.neighbor-label', style: {
                'color': '#716040',
            }
        },
        {
            selector: 'node.node-hovered', style: {
                'text-background-color': '#eaddcf',
                'color': '#020826',
            }
        },
        {
            selector: 'edge', style: {
                'text-background-color': '#f0ebe3',
                'text-background-opacity': 0.92,
            }
        },
        {
            selector: '.hl', style: {
                'border-color': 'data(bc)', 'outline-color': 'data(bc)', 'outline-width': 1, 'outline-opacity': 1, 'outline-offset': 4,
            }
        },
        {
            selector: 'node[_t="drill_group"]', style: {
                'background-color': '#e8e0d4',
                'background-opacity': 0.88,
            }
        },
    ],
};

function applyCyTheme(theme) {
    if (!cy || typeof cy.style !== 'function') return;
    try {
        const savedFont = (_PREFS && typeof _PREFS.get === 'function') ? _PREFS.get('font') : "'JetBrains Mono', monospace";
        const uiFont = getComputedStyle(document.body).fontFamily || _uiFontForLang(savedFont, (_PREFS && typeof _PREFS.get === 'function') ? _PREFS.get('lang') : 'en');
        const base = withFont(CY_STYLE, uiFont.replace(/["']/g, ''));
        const overrides = CY_THEME_OVERRIDES[theme] || [];
        cy.style([...base, ...overrides]);
        cy.resize();
    } catch (e) {
        console.warn('Failed to apply cytoscape theme', e);
    }
}

function _applyThemeModuleColors(th) {
    if (!window.DATA || !Array.isArray(window.DATA.modules)) return;

    // 0. Read the 10 module colors from the currently applied CSS theme, with fallback for aggressive browsers caching themes.css
    const DEFAULT_PALETTES = {
        dark: ['#dfa745', '#849646', '#d16d6a', '#5f8b9e', '#9d7e79', '#c28b5e', '#7b947c', '#8c6e8f', '#b8a663', '#a76a5c'],
        claude: ['#e8194b', '#2563eb', '#16a34a', '#7c3aed', '#0891b2', '#d97706', '#059669', '#9333ea', '#dc2626', '#0284c7'],
        parchment: ['#8c7851', '#5a7d66', '#a8504a', '#4a687d', '#7a597a', '#9c855a', '#6b9177', '#a16561', '#56758c', '#8a658a']
    };
    const style = getComputedStyle(document.documentElement);
    const pal = [];
    const fallback = DEFAULT_PALETTES[th] || DEFAULT_PALETTES.dark;

    for (let i = 1; i <= 10; i++) {
        const c = style.getPropertyValue(`--m${i}`).trim();
        pal.push(c || fallback[i - 1]);
    }

    // 1. Update global data wrapper
    window.DATA.modules.forEach((m, idx) => {
        if (m.id !== '_root') {
            m.color = pal[idx % pal.length];
        }
    });

    // 2. Update active graph nodes if currently viewing modules (L0)
    if (window.cy && typeof window.cy.nodes === 'function' && typeof state !== 'undefined' && state.level === 0) {
        window.cy.nodes('[lvl=0]').forEach(n => {
            const mData = n.data('_m');
            if (mData) {
                const isSimple = n.data('simple') === 1;
                n.data('bc', mData.color);
                n.data('bg', isSimple ? mData.color : mData.color + '18');
            }
        });
    }

    // 3. Refresh corresponding UI components
    if (typeof buildSidebar === 'function') buildSidebar();
    if (typeof _galaxyRefreshThemeColors === 'function') _galaxyRefreshThemeColors();
    const dashOverlay = document.getElementById('dashboard-overlay');
    if (typeof _renderDashboard === 'function' && dashOverlay && dashOverlay.style.display === 'block') {
        _renderDashboard();
    }
}

function applyTheme(theme) {
    const th = theme || 'dark';
    document.documentElement.setAttribute('data-theme', th);
    _applyThemeModuleColors(th);
    applyCyTheme(th);
}

// Returns `light` value when a light theme (parchment or claude/Light) is active, otherwise `dark`.
function _tC(dark, light) {
    const t = document.documentElement.getAttribute('data-theme') || 'dark';
    return (t === 'parchment' || t === 'claude') ? light : dark;
}

function _applyLang(lang) {
    if (!window._i18n) return;
    const active = window._i18n.init(lang || _PREFS.get('lang'));
    document.documentElement.lang = active;
    applyFont(_PREFS.get('font'), active);
    if (window._i18n.apply) window._i18n.apply(document);
    _refreshVisualChrome();
    updateDepMapExtToggle();
    updateExternalFuncsToggle();
    const l1Stats = document.getElementById('l1-stats');
    if (l1Stats && l1Stats.dataset.count) l1Stats.textContent = T('countFiles', { count: l1Stats.dataset.count });
    const l2Stats = document.getElementById('l2-stats');
    if (l2Stats && l2Stats.dataset.stats) l2Stats.textContent = _formatL2Stats(JSON.parse(l2Stats.dataset.stats));
    updateBreadcrumb();
    if (typeof _srRenderActionBar === 'function') _srRenderActionBar();
    if (typeof _srRenderResults === 'function') _srRenderResults();
    refreshLayoutSwitcher();
    _refreshDashboardLocale();
}

// ─── Preferences Modal Builder ────────────────────────────────────────────────

function _updateCodevizPref(key, value) {
    try {
        const p = JSON.parse(localStorage.getItem('codeviz_prefs') || '{}');
        p[key] = value;
        localStorage.setItem('codeviz_prefs', JSON.stringify(p));
    } catch (_) { }
}

const _PREF_THEME_PALETTES = {
        dark: { bg: '#0f110e', panel: '#161715', accent: '#dfa745', text: '#eae8e3', muted: '#6a6860', card: '#1e1f1c', name: 'Dark' },
    claude: { bg: '#f3efee', panel: '#fcfbfc', accent: '#e8194b', text: '#111827', muted: '#6b7280', card: '#f5f2f2', name: 'Light' },
    parchment: { bg: '#f9f4ef', panel: '#eaddcf', accent: '#8c7851', text: '#020826', muted: '#9c8c78', card: '#ede8e0', name: 'Parchment' },
};

function _buildPrefModalHTML() {
    const SS = 'background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:13px;outline:none;cursor:pointer;font-family:inherit;width:100%;';
    const LS = 'font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;';
    return `<div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;width:640px;max-width:96vw;max-height:90vh;box-shadow:0 10px 30px rgba(0,0,0,0.7);display:flex;flex-direction:column;overflow:hidden;animation:flip-in-x 0.2s ease-out;">
      <div style="background:var(--panel2);padding:12px 16px;border-bottom:1px solid var(--border);font-weight:600;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <span data-i18n="settingsTitle">Settings</span>
        <button id="pref-close-x" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;padding:0 2px;">&#10005;</button>
      </div>
      <div style="display:flex;flex-direction:row;flex:1;min-height:0;">
        <div style="width:290px;flex-shrink:0;padding:16px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;border-right:1px solid var(--border);">
          <div style="${LS}color:var(--accent);" data-i18n="sectionAppearance">Appearance</div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="font-select" style="${LS}" data-i18n="fontLabel">Code Editor Font</label>
            <select id="font-select" style="${SS}">
              <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
              <option value="'Fira Code', monospace">Fira Code</option>
              <option value="'Cascadia Code', monospace">Cascadia Code</option>
              <option value="Consolas, monospace">Consolas</option>
              <option value="'Space Mono', monospace">Space Mono</option>
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="pref-theme-select" style="${LS}" data-i18n="themeLabel">Theme</label>
            <select id="pref-theme-select" style="${SS}">
              <option value="dark" data-i18n="themeOptDark">Dark</option>
              <option value="claude" data-i18n="themeOptClaude">Light</option>
              <option value="parchment" data-i18n="themeOptParchment">Parchment</option>
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="pref-lang-select" style="${LS}" data-i18n="langLabel">Interface Language</label>
            <select id="pref-lang-select" style="${SS}">
              <option value="en">English</option>
              <option value="zh-tw">&#32321;&#39636;&#20013;&#25991;</option>
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <label for="pref-node-style" style="${LS}" data-i18n="nodeStyleLabel">Node Style</label>
            <select id="pref-node-style" style="${SS}">
              <option value="detailed" data-i18n="nodeStyleDetailed">Detailed</option>
              <option value="simple" data-i18n="nodeStyleSimple">Simple</option>
            </select>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:12px;">
            <div style="${LS}color:var(--accent);" data-i18n="sectionBehaviour">Default Behaviour</div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <label for="pref-ext-files" style="${LS}" data-i18n="extFilesAlways">External Files always ON</label>
              <select id="pref-ext-files" style="${SS}">
                <option value="false" data-i18n="behaviourOff">Off</option>
                <option value="true" data-i18n="behaviourOn">Always On</option>
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <label for="pref-ext-funcs" style="${LS}" data-i18n="extFuncsAlways">External Functions always ON</label>
              <select id="pref-ext-funcs" style="${SS}">
                <option value="false" data-i18n="behaviourOff">Off</option>
                <option value="true" data-i18n="behaviourOn">Always On</option>
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <label for="pref-edge-type-labels" style="${LS}" data-i18n="edgeTypeLabelsDefault">Show edge types on edges by default</label>
              <select id="pref-edge-type-labels" style="${SS}">
                <option value="false" data-i18n="behaviourOff">Off</option>
                <option value="true" data-i18n="behaviourOn">Always On</option>
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <label for="pref-ext-expand" style="${LS}" data-i18n="extExpandDefault">Expand external groups by default</label>
              <select id="pref-ext-expand" style="${SS}">
                <option value="true" data-i18n="behaviourOnDefault">On</option>
                <option value="false" data-i18n="behaviourOffToggle">Off</option>
              </select>
            </div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:12px;">
            <div style="${LS}color:var(--accent);">Symbol View</div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <label for="pref-sv-edge-style" style="${LS}">Edge Routing Style</label>
              <select id="pref-sv-edge-style" style="${SS}">
                <option value="bezier">Bezier Curves</option>
                <option value="orthogonal">Orthogonal</option>
              </select>
            </div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:12px;">
            <div style="${LS}color:var(--accent);" data-i18n="sectionLayout">Default Layout</div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <label for="pref-layout-l0" style="${LS}" data-i18n="layoutL0Label">Module (L0)</label>
              <select id="pref-layout-l0" style="${SS}">
                <option value="dagre-lr">Hierarchy LR</option>
                <option value="dagre-tb">Hierarchy TB</option>
                <option value="cose">Force</option>
                <option value="fcose">Smart Cluster</option>
                <option value="elk-stress">ELK Stress</option>
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <label for="pref-layout-l1" style="${LS}" data-i18n="layoutL1Label">Dependency Map (L1)</label>
              <select id="pref-layout-l1" style="${SS}">
                <option value="dagre-lr">Hierarchy LR</option>
                <option value="dagre-tb">Hierarchy TB</option>
                <option value="cose">Force</option>
                <option value="fcose">Smart Cluster</option>
                <option value="cola">Smooth Physics</option>
                <option value="elk-layered">ELK Flow</option>
                <option value="elk-stress">ELK Stress</option>
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <label for="pref-layout-l2" style="${LS}" data-i18n="layoutL2Label">Call Flow (L2)</label>
              <select id="pref-layout-l2" style="${SS}">
                <option value="dagre-lr">Hierarchy LR</option>
                <option value="dagre-tb">Hierarchy TB</option>
                <option value="cose">Force</option>
                <option value="fcose">Smart Cluster</option>
                <option value="cola">Smooth Physics</option>
                <option value="elk-layered">ELK Flow</option>
                <option value="elk-stress">ELK Stress</option>
              </select>
            </div>
          </div>
        </div>
        <div id="pref-preview-panel" style="flex:1;padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0;overflow-y:auto;">
          <div id="pref-preview-label" style="${LS}color:var(--accent);min-height:14px;"></div>
          <div id="pref-preview-area" style="flex:1;display:flex;align-items:center;justify-content:center;"></div>
          <div id="pref-preview-hint" style="font-size:11px;color:var(--muted);line-height:1.5;min-height:32px;"></div>
        </div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;flex-shrink:0;">
        <button id="pref-close-btn" style="background:var(--accent);color:#000;border:none;padding:6px 16px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;" data-i18n="settingsDone">Done</button>
      </div>
    </div>`;
}

// ─── Layout Preview ───────────────────────────────────────────────────────────

const _LAYOUT_INFO_KEYS = {
    'dagre-lr': { algo: 'layoutInfo_dagreLR_algo', best: 'layoutInfo_dagreLR_best', pros: 'layoutInfo_dagreLR_pros', cons: 'layoutInfo_dagreLR_cons' },
    'dagre-tb': { algo: 'layoutInfo_dagreTB_algo', best: 'layoutInfo_dagreTB_best', pros: 'layoutInfo_dagreTB_pros', cons: 'layoutInfo_dagreTB_cons' },
    'cose': { algo: 'layoutInfo_cose_algo', best: 'layoutInfo_cose_best', pros: 'layoutInfo_cose_pros', cons: 'layoutInfo_cose_cons' },
    'fcose': { algo: 'layoutInfo_fcose_algo', best: 'layoutInfo_fcose_best', pros: 'layoutInfo_fcose_pros', cons: 'layoutInfo_fcose_cons' },
    'cola': { algo: 'layoutInfo_cola_algo', best: 'layoutInfo_cola_best', pros: 'layoutInfo_cola_pros', cons: 'layoutInfo_cola_cons' },
    'elk-layered': { algo: 'layoutInfo_elkLayered_algo', best: 'layoutInfo_elkLayered_best', pros: 'layoutInfo_elkLayered_pros', cons: 'layoutInfo_elkLayered_cons' },
    'elk-stress': { algo: 'layoutInfo_elkStress_algo', best: 'layoutInfo_elkStress_best', pros: 'layoutInfo_elkStress_pros', cons: 'layoutInfo_elkStress_cons' },
};

function _previewLayout(id) {
    const keys = _LAYOUT_INFO_KEYS[id];
    if (!keys) return '';
    const t = k => (typeof T === 'function') ? T(k) : k;
    const row = (labelKey, textKey) =>
        `<div style="display:grid;grid-template-columns:80px 1fr;gap:6px 10px;align-items:baseline;">
           <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);text-align:right;">${escapeHtml(t(labelKey))}</span>
           <span style="font-size:12px;color:var(--text);line-height:1.6;">${escapeHtml(t(textKey))}</span>
         </div>`;
    return `<div style="width:100%;display:flex;flex-direction:column;gap:8px;padding:2px 0;">
      ${row('layoutInfoAlgorithm', keys.algo)}
      <div style="border-top:1px solid var(--border);margin:2px 0;"></div>
      ${row('layoutInfoBestFor', keys.best)}
      ${row('layoutInfoPros', keys.pros)}
      ${row('layoutInfoCons', keys.cons)}
    </div>`;
}

// ─── Setting Previews ─────────────────────────────────────────────────────────

// ─── Setting Previews ─────────────────────────────────────────────────────────

function _previewSvEdgeStyle(value) {
    // Mini SVG showing two nodes connected with either bezier or orthogonal routing.
    const isBezier = value === 'bezier';
    const color = 'var(--accent)';
    // Two pairs of nodes. Top pair: left→right. Bottom pair: right→left crossing.
    const nodes = [
        { x: 20, y: 40, w: 70, h: 24, label: 'A' },
        { x: 180, y: 20, w: 70, h: 24, label: 'B' },
        { x: 20, y: 100, w: 70, h: 24, label: 'C' },
        { x: 180, y: 80, w: 70, h: 24, label: 'D' },
    ];
    function nodeSvg(n) {
        return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="5" fill="var(--panel2)" stroke="var(--border)" stroke-width="1"/>
                <text x="${n.x + n.w / 2}" y="${n.y + 15}" text-anchor="middle" font-size="10" fill="var(--muted)">${n.label}</text>`;
    }
    // Edge A→B and C→D
    function edgePath(from, to) {
        const sx = from.x + from.w, sy = from.y + from.h / 2;
        const ex = to.x, ey = to.y + to.h / 2;
        if (isBezier) {
            const dist = ex - sx;
            const c = Math.min(80, Math.max(20, dist * 0.4));
            return `M ${sx} ${sy} C ${sx + c} ${sy}, ${ex - c} ${ey}, ${ex} ${ey}`;
        } else {
            // Orthogonal: right → mid → down → right
            const mx = (sx + ex) / 2;
            const r = 5;
            const goDown = ey > sy;
            const vs = goDown ? r : -r;
            return `M ${sx} ${sy} H ${mx - r} Q ${mx} ${sy} ${mx} ${sy + vs} V ${ey - vs} Q ${mx} ${ey} ${mx + r} ${ey} H ${ex}`;
        }
    }
    const arrow = `<defs><marker id="pv-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker></defs>`;
    const edgeStyle = `stroke="${color}" stroke-width="1.5" fill="none" marker-end="url(#pv-arr)"`;
    return `<svg viewBox="0 0 270 136" width="270" height="136" style="display:block;overflow:visible;">
        ${arrow}
        ${nodes.map(nodeSvg).join('')}
        <path d="${edgePath(nodes[0], nodes[1])}" ${edgeStyle}/>
        <path d="${edgePath(nodes[2], nodes[3])}" ${edgeStyle}/>
        <text x="135" y="128" text-anchor="middle" font-size="10" fill="var(--muted)">${isBezier ? 'Bezier Curves' : 'Orthogonal'}</text>
    </svg>`;
}

function _showPrefPreview(id, value) {
    const area = document.getElementById('pref-preview-area');
    const label = document.getElementById('pref-preview-label');
    const hint = document.getElementById('pref-preview-hint');
    if (!area) return;
    const PREVIEWS = {
        'font-select': { fn: _previewFont, lk: 'fontLabel', hk: 'fontPreviewHint' },
        'pref-theme-select': { fn: _previewTheme, lk: 'themeLabel', hk: 'themePreviewHint' },
        'pref-lang-select': { fn: _previewLang, lk: 'langLabel', hk: 'langPreviewHint' },
        'pref-node-style': { fn: _previewNodeStyle, lk: 'nodeStyleLabel', hk: 'nodeStylePreviewHint' },
        'pref-ext-files': { fn: _previewExtFiles, lk: 'extFilesAlways', hk: 'extFilesAlwaysDesc' },
        'pref-ext-funcs': { fn: _previewExtFuncs, lk: 'extFuncsAlways', hk: 'extFuncsAlwaysDesc' },
        'pref-edge-type-labels': { fn: _previewEdgeTypeLabels, lk: 'edgeTypeLabelsDefault', hk: 'edgeTypeLabelsDefaultDesc' },
        'pref-ext-expand': { fn: _previewExtExpand, lk: 'extExpandDefault', hk: 'extExpandDefaultDesc' },
        'pref-sv-edge-style': { fn: _previewSvEdgeStyle, lk: 'sectionLayout', hk: null },
        'pref-layout-l0': { fn: _previewLayout, lk: 'layoutL0Label', hk: null },
        'pref-layout-l1': { fn: _previewLayout, lk: 'layoutL1Label', hk: null },
        'pref-layout-l2': { fn: _previewLayout, lk: 'layoutL2Label', hk: null },
    };
    const cfg = PREVIEWS[id];
    if (!cfg) return;
    area.style.opacity = '0';
    area.style.transform = 'translateY(6px)';
    area.style.transition = 'none';
    setTimeout(() => {
        area.innerHTML = cfg.fn(value);
        if (label) label.textContent = (typeof T === 'function') ? T(cfg.lk) : cfg.lk;
        if (hint) hint.innerHTML = cfg.hk ? ((typeof T === 'function') ? T(cfg.hk) : '') : '';
        area.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        area.style.opacity = '1';
        area.style.transform = 'translateY(0)';
    }, 60);
}
const _PREF_PREVIEW_SELECT_IDS = new Set([
    'font-select', 'pref-theme-select', 'pref-lang-select',
    'pref-node-style', 'pref-ext-files', 'pref-ext-funcs', 'pref-edge-type-labels', 'pref-ext-expand',
    'pref-sv-edge-style',
    'pref-layout-l0', 'pref-layout-l1', 'pref-layout-l2',
]);
let _prefDropdownDocBound = false;

function _prefSupportsPreview(id) {
    return _PREF_PREVIEW_SELECT_IDS.has(id);
}

function _setPrefDropdownOpen(dropdown, open) {
    if (!dropdown) return;
    const menu = dropdown.querySelector('.pref-dd-menu');
    const trigger = dropdown.querySelector('.pref-dd-trigger');
    const chevron = dropdown.querySelector('.pref-dd-chevron');
    dropdown.dataset.open = open ? 'true' : 'false';
    if (menu) {
        menu.style.display = open ? 'block' : 'none';
        menu.style.pointerEvents = open ? 'auto' : 'none';
    }
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';

    const sel = document.getElementById(dropdown.dataset.selectId || '');
    if (!open && sel && _prefSupportsPreview(sel.id)) {
        _showPrefPreview(sel.id, sel.value);
    }
}

function _syncPrefDropdown(sel) {
    if (!sel || !sel._prefDropdown) return;
    const dropdown = sel._prefDropdown;
    const label = dropdown.querySelector('.pref-dd-value');
    const optionsWrap = dropdown.querySelector('.pref-dd-options');
    if (!optionsWrap) return;

    const active = sel.options[sel.selectedIndex] || sel.options[0];
    if (label) label.textContent = active ? active.textContent.trim() : '';
    optionsWrap.innerHTML = '';

    Array.from(sel.options).forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pref-dd-option';
        btn.dataset.value = opt.value;
        btn.style.cssText = 'width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;border:none;background:' +
            (opt.selected ? 'color-mix(in srgb, var(--accent) 16%, var(--panel2))' : 'transparent') +
            ';color:' + (opt.selected ? 'var(--text)' : 'var(--muted)') + ';padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;text-align:left;transition:background 0.15s ease,color 0.15s ease;';
        btn.setAttribute('data-selected', opt.selected ? 'true' : 'false');

        const textSpan = document.createElement('span');
        textSpan.textContent = opt.textContent.trim();
        textSpan.style.flex = '1';
        btn.appendChild(textSpan);

        const mark = document.createElement('span');
        mark.textContent = opt.selected ? '✓' : '';
        mark.style.cssText = 'color:var(--accent);font-size:12px;min-width:12px;text-align:right;';
        btn.appendChild(mark);

        const applyHoverState = (hovered) => {
            const selected = btn.getAttribute('data-selected') === 'true';
            btn.style.background = hovered
                ? 'color-mix(in srgb, var(--accent) 12%, var(--panel2))'
                : (selected ? 'color-mix(in srgb, var(--accent) 16%, var(--panel2))' : 'transparent');
            btn.style.color = hovered || selected ? 'var(--text)' : 'var(--muted)';
        };

        btn.addEventListener('mouseenter', () => {
            applyHoverState(true);
            if (_prefSupportsPreview(sel.id)) _showPrefPreview(sel.id, opt.value);
        });
        btn.addEventListener('mouseleave', () => applyHoverState(false));
        btn.addEventListener('focus', () => {
            applyHoverState(true);
            if (_prefSupportsPreview(sel.id)) _showPrefPreview(sel.id, opt.value);
        });
        btn.addEventListener('blur', () => applyHoverState(false));
        btn.addEventListener('click', () => {
            if (sel.value !== opt.value) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (_prefSupportsPreview(sel.id)) {
                _showPrefPreview(sel.id, opt.value);
            }
            _syncPrefDropdown(sel);
            _setPrefDropdownOpen(dropdown, false);
        });

        optionsWrap.appendChild(btn);
    });
}

function _syncAllPrefDropdowns() {
    document.querySelectorAll('select[data-pref-custom="true"]').forEach(_syncPrefDropdown);
}

function _enhancePrefSelect(sel) {
    if (!sel) return;
    if (sel.dataset.prefCustom === 'true') {
        _syncPrefDropdown(sel);
        return;
    }

    sel.dataset.prefCustom = 'true';
    sel.style.cssText += 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    sel.setAttribute('aria-hidden', 'true');
    sel.tabIndex = -1;

    const dropdown = document.createElement('div');
    dropdown.className = 'pref-dd';
    dropdown.dataset.selectId = sel.id;
    dropdown.dataset.open = 'false';
    dropdown.style.cssText = 'position:relative;width:100%;';
    dropdown.innerHTML = `
      <button type="button" class="pref-dd-trigger" aria-haspopup="listbox" aria-expanded="false"
        style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:13px;outline:none;cursor:pointer;font-family:inherit;">
        <span class="pref-dd-value" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;"></span>
        <span class="pref-dd-chevron" style="color:var(--accent);transition:transform 0.18s ease;">▾</span>
      </button>
      <div class="pref-dd-menu" style="display:none;pointer-events:none;position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:30;background:var(--panel);border:1px solid var(--border);border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,0.35);padding:6px;max-height:220px;overflow:auto;">
        <div class="pref-dd-options" role="listbox" aria-label="${sel.id}"></div>
      </div>`;

    sel.insertAdjacentElement('afterend', dropdown);
    sel._prefDropdown = dropdown;

    const trigger = dropdown.querySelector('.pref-dd-trigger');
    trigger?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = dropdown.dataset.open !== 'true';
        document.querySelectorAll('.pref-dd[data-open="true"]').forEach(openDd => {
            if (openDd !== dropdown) _setPrefDropdownOpen(openDd, false);
        });
        _setPrefDropdownOpen(dropdown, willOpen);
        if (willOpen && _prefSupportsPreview(sel.id)) _showPrefPreview(sel.id, sel.value);
    });
    trigger?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            trigger.click();
        }
        if (e.key === 'Escape') _setPrefDropdownOpen(dropdown, false);
    });

    sel.addEventListener('change', () => _syncPrefDropdown(sel));
    _syncPrefDropdown(sel);
}

function _initPrefDropdowns(selects) {
    selects.forEach(_enhancePrefSelect);
    if (_prefDropdownDocBound) return;
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.pref-dd')) {
            document.querySelectorAll('.pref-dd[data-open="true"]').forEach(dd => _setPrefDropdownOpen(dd, false));
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.pref-dd[data-open="true"]').forEach(dd => _setPrefDropdownOpen(dd, false));
        }
    });
    _prefDropdownDocBound = true;
}
function _previewTheme(v) {
    const p = _PREF_THEME_PALETTES[v] || _PREF_THEME_PALETTES.dark;
    const tc = p.text === '#020826' ? p.text : '#fff';
    return `<svg width="230" height="155" viewBox="0 0 230 155" xmlns="http://www.w3.org/2000/svg" style="border-radius:7px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.5);">
      <rect width="230" height="155" fill="${p.bg}"/>
      <rect width="230" height="26" fill="${p.panel}"/>
      <circle cx="13" cy="13" r="5" fill="${p.accent}"/>
      <rect x="24" y="9" width="36" height="8" rx="3" fill="${p.accent}" opacity="0.75"/>
      <rect x="68" y="10" width="28" height="6" rx="2" fill="${p.muted}" opacity="0.5"/>
      <rect x="195" y="10" width="22" height="6" rx="2" fill="${p.muted}" opacity="0.35"/>
      <rect x="0" y="26" width="52" height="129" fill="${p.panel}"/>
      <rect x="7" y="36" width="38" height="5" rx="2" fill="${p.muted}" opacity="0.4"/>
      <rect x="7" y="47" width="32" height="5" rx="2" fill="${p.accent}" opacity="0.85"/>
      <rect x="7" y="58" width="35" height="5" rx="2" fill="${p.muted}" opacity="0.35"/>
      <rect x="7" y="69" width="28" height="5" rx="2" fill="${p.muted}" opacity="0.3"/>
      <rect x="7" y="80" width="33" height="5" rx="2" fill="${p.muted}" opacity="0.25"/>
      <circle cx="120" cy="85" r="22" fill="${p.accent}" opacity="0.18" stroke="${p.accent}" stroke-width="1.5"/>
      <text x="120" y="89" text-anchor="middle" fill="${p.accent}" font-size="9" font-family="monospace" font-weight="600">main.py</text>
      <circle cx="175" cy="60" r="16" fill="${p.card}" stroke="${p.muted}" stroke-width="1" opacity="0.9"/>
      <text x="175" y="64" text-anchor="middle" fill="${p.text}" font-size="8" font-family="monospace" opacity="0.75">utils</text>
      <circle cx="175" cy="112" r="16" fill="${p.card}" stroke="${p.muted}" stroke-width="1" opacity="0.9"/>
      <text x="175" y="116" text-anchor="middle" fill="${p.text}" font-size="8" font-family="monospace" opacity="0.75">parser</text>
      <line x1="141" y1="75" x2="160" y2="65" stroke="${p.muted}" stroke-width="1.2" opacity="0.45"/>
      <line x1="141" y1="95" x2="160" y2="107" stroke="${p.muted}" stroke-width="1.2" opacity="0.45"/>
      <rect x="68" y="138" width="94" height="12" rx="3" fill="${p.panel}"/>
      <text x="115" y="147" text-anchor="middle" fill="${p.accent}" font-size="9" font-family="monospace">${p.name}</text>
    </svg>`;
}

function _previewFont(v) {
    const name = (v || '').replace(/['"]/g, '').split(',')[0].trim();
    return `<div style="font-family:${v};font-size:13px;line-height:1.9;padding:14px 16px;background:var(--panel2);border-radius:7px;border:1px solid var(--border);width:100%;box-sizing:border-box;white-space:pre-wrap;word-break:break-all;">` +
        `<span style="color:#6ab0f5;">const</span> scan = (root) => {<br>` +
        `&nbsp;&nbsp;<span style="color:#e5c07b;">nodes</span>, <span style="color:#e5c07b;">edges</span> = parse(root);<br>` +
        `&nbsp;&nbsp;<span style="color:#6ab0f5;">return</span> { nodes, edges };<br>` +
        `};<br><br>` +
        `<span style="color:var(--muted);font-size:11px;">${name}</span>` +
        `</div>`;
}

function _previewLang(v) {
    const LABELS = {
        en: ['Files', 'Modules', 'Functions', 'Settings', 'Done'],
        'zh-tw': ['\u6a94\u6848', '\u6a21\u7d44', '\u51fd\u6578', '\u8a2d\u5b9a', '\u5b8c\u6210'],
    };
    const items = LABELS[v] || LABELS.en;
    return `<div style="display:flex;flex-direction:column;gap:6px;width:100%;">` +
        items.map(val => `<div style="padding:5px 10px;background:var(--panel2);border-radius:5px;border:1px solid var(--border);font-size:13px;color:var(--text);text-align:center;">${val}</div>`).join('') +
        `</div>`;
}

function _previewNodeStyle(v) {
    if (v === 'simple') {
        return `<svg width="220" height="140" viewBox="0 0 220 140" xmlns="http://www.w3.org/2000/svg">
          <line x1="52" y1="56" x2="102" y2="38" stroke="var(--muted)" stroke-width="1.4" opacity="0.42"/>
          <line x1="52" y1="60" x2="102" y2="92" stroke="var(--muted)" stroke-width="1.4" opacity="0.42"/>
          <line x1="132" y1="38" x2="176" y2="60" stroke="var(--muted)" stroke-width="1.4" opacity="0.42"/>
          <circle cx="44" cy="58" r="18" fill="#dfa745" opacity="0.92"/>
          <circle cx="118" cy="34" r="15" fill="#849646" opacity="0.92"/>
          <circle cx="118" cy="98" r="15" fill="#5f8b9e" opacity="0.92"/>
          <circle cx="184" cy="64" r="15" fill="#d16d6a" opacity="0.92"/>
          <text x="44" y="91" text-anchor="middle" fill="var(--text)" font-size="8.5" font-family="monospace">main.py</text>
          <text x="118" y="61" text-anchor="middle" fill="var(--text)" font-size="8.5" font-family="monospace">utils.py</text>
          <text x="118" y="124" text-anchor="middle" fill="var(--text)" font-size="8.5" font-family="monospace">parser.ts</text>
          <text x="184" y="92" text-anchor="middle" fill="var(--text)" font-size="8.5" font-family="monospace">server.go</text>
        </svg>`;
    }
    return `<svg width="220" height="140" viewBox="0 0 220 140" xmlns="http://www.w3.org/2000/svg">
      <line x1="62" y1="72" x2="112" y2="42" stroke="var(--muted)" stroke-width="1.4" opacity="0.42"/>
      <line x1="62" y1="72" x2="112" y2="102" stroke="var(--muted)" stroke-width="1.4" opacity="0.42"/>
      <line x1="142" y1="42" x2="180" y2="68" stroke="var(--muted)" stroke-width="1.4" opacity="0.42"/>
      <ellipse cx="46" cy="72" rx="26" ry="15" fill="#dfa745" opacity="0.92"/>
      <text x="46" y="75" text-anchor="middle" fill="#111" font-size="8.5" font-family="monospace" font-weight="700">main.c</text>
      <polygon points="92,44 138,44 148,70 102,70" fill="#4584c3" opacity="0.92"/>
      <text x="120" y="61" text-anchor="middle" fill="#fff" font-size="8" font-family="monospace">model.py</text>
      <path d="M96 92 H144 L152 100 V120 H104 L96 112 Z" fill="#f0c040" opacity="0.92"/>
      <text x="124" y="109" text-anchor="middle" fill="#111" font-size="7.8" font-family="monospace" font-weight="700">view.js</text>
      <path d="M166 58 H202 Q210 58 210 66 V86 Q210 96 200 96 H168 Q158 96 158 86 V58 Z" fill="#3b8fd4" opacity="0.92"/>
      <text x="184" y="79" text-anchor="middle" fill="#fff" font-size="7.8" font-family="monospace">types.ts</text>
      <polygon points="170,108 182,98 198,98 210,108 198,122 182,122" fill="#00c6db" opacity="0.92"/>
      <text x="190" y="113" text-anchor="middle" fill="#042f3a" font-size="7.2" font-family="monospace" font-weight="700">go</text>
    </svg>`;
}

function _previewExtFiles(v) {
    const on = v === 'true';
    return `<svg width="230" height="140" viewBox="0 0 230 140" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="28" width="56" height="26" rx="4" fill="#dfa745" opacity="0.85"/>
      <text x="36" y="45" text-anchor="middle" fill="#000" font-size="9" font-family="monospace" font-weight="700">main.py</text>
      <rect x="88" y="12" width="56" height="26" rx="4" fill="#849646" opacity="0.85"/>
      <text x="116" y="29" text-anchor="middle" fill="#fff" font-size="9" font-family="monospace">utils.py</text>
      <rect x="88" y="56" width="56" height="26" rx="4" fill="#5f8b9e" opacity="0.85"/>
      <text x="116" y="73" text-anchor="middle" fill="#fff" font-size="9" font-family="monospace">parser.py</text>
      <line x1="64" y1="38" x2="88" y2="28" stroke="var(--muted)" stroke-width="1.5" opacity="0.5"/>
      <line x1="64" y1="48" x2="88" y2="66" stroke="var(--muted)" stroke-width="1.5" opacity="0.5"/>
      ${on
            ? `<rect x="166" y="28" width="56" height="26" rx="4" fill="var(--muted)" opacity="0.4" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 2"/>
           <text x="194" y="45" text-anchor="middle" fill="var(--text)" font-size="8" font-family="monospace" opacity="0.65">os.path</text>
           <line x1="144" y1="28" x2="166" y2="38" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 2" opacity="0.45"/>`
            : `<text x="194" y="38" text-anchor="middle" fill="var(--muted)" font-size="9" opacity="0.35">&#x2205;</text>`}
      <text x="115" y="115" text-anchor="middle" fill="${on ? '#dfa745' : 'var(--muted)'}" font-size="10" font-family="monospace">${on ? 'External files visible' : 'External files hidden'}</text>
      <text x="115" y="130" text-anchor="middle" fill="var(--muted)" font-size="9" font-family="monospace">Dependency Map (L1)</text>
    </svg>`;
}

function _previewExtFuncs(v) {
    const on = v === 'true';
    return `<svg width="230" height="140" viewBox="0 0 230 140" xmlns="http://www.w3.org/2000/svg">
      <circle cx="45" cy="65" r="22" fill="#dfa745" opacity="0.18" stroke="#dfa745" stroke-width="1.5"/>
      <text x="45" y="62" text-anchor="middle" fill="#dfa745" font-size="8" font-family="monospace">build_</text>
      <text x="45" y="73" text-anchor="middle" fill="#dfa745" font-size="8" font-family="monospace">graph()</text>
      <circle cx="118" cy="38" r="16" fill="var(--panel2)" stroke="var(--muted)" stroke-width="1" opacity="0.9"/>
      <text x="118" y="42" text-anchor="middle" fill="var(--text)" font-size="8" font-family="monospace">scan()</text>
      <circle cx="118" cy="92" r="16" fill="var(--panel2)" stroke="var(--muted)" stroke-width="1" opacity="0.9"/>
      <text x="118" y="96" text-anchor="middle" fill="var(--text)" font-size="8" font-family="monospace">parse()</text>
      <line x1="67" y1="55" x2="103" y2="43" stroke="var(--muted)" stroke-width="1.2" opacity="0.5"/>
      <line x1="67" y1="75" x2="103" y2="87" stroke="var(--muted)" stroke-width="1.2" opacity="0.5"/>
      ${on
            ? `<circle cx="185" cy="38" r="14" fill="var(--muted)" opacity="0.25" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 2"/>
           <text x="185" y="42" text-anchor="middle" fill="var(--text)" font-size="7" font-family="monospace" opacity="0.6">os.walk</text>
           <circle cx="185" cy="92" r="14" fill="var(--muted)" opacity="0.25" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 2"/>
           <text x="185" y="96" text-anchor="middle" fill="var(--text)" font-size="7" font-family="monospace" opacity="0.6">re.match</text>
           <line x1="134" y1="40" x2="172" y2="40" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 2" opacity="0.4"/>
           <line x1="134" y1="90" x2="172" y2="90" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 2" opacity="0.4"/>`
            : `<text x="185" y="65" text-anchor="middle" fill="var(--muted)" font-size="9" opacity="0.35">&#x2205;</text>`}
      <text x="115" y="118" text-anchor="middle" fill="${on ? '#dfa745' : 'var(--muted)'}" font-size="10" font-family="monospace">${on ? 'External funcs visible' : 'External funcs hidden'}</text>
      <text x="115" y="132" text-anchor="middle" fill="var(--muted)" font-size="9" font-family="monospace">Call Flow (L2)</text>
    </svg>`;
}

function _previewEdgeTypeLabels(v) {
    const on = v === 'true';
    return `<svg width="230" height="140" viewBox="0 0 230 140" xmlns="http://www.w3.org/2000/svg">
      <rect x="16" y="48" width="52" height="26" rx="6" fill="#dfa745" opacity="0.9"/>
      <text x="42" y="65" text-anchor="middle" fill="#111" font-size="9" font-family="monospace" font-weight="700">main.py</text>
      <rect x="162" y="48" width="52" height="26" rx="6" fill="#5f8b9e" opacity="0.9"/>
      <text x="188" y="65" text-anchor="middle" fill="#fff" font-size="9" font-family="monospace">utils.py</text>
      <line x1="68" y1="61" x2="162" y2="61" stroke="#c084fc" stroke-width="2"/>
      ${on
            ? `<rect x="92" y="49" width="46" height="18" rx="5" fill="#111827" opacity="0.9"/>
           <text x="115" y="61" text-anchor="middle" fill="#e5e7eb" font-size="8" font-family="monospace">Include</text>`
            : `<text x="115" y="57" text-anchor="middle" fill="var(--muted)" font-size="10" font-family="monospace" opacity="0.55">&#x2205;</text>`}
      <text x="115" y="116" text-anchor="middle" fill="${on ? '#dfa745' : 'var(--muted)'}" font-size="10" font-family="monospace">${on ? 'Edge type labels visible' : 'Edge type labels hidden'}</text>
      <text x="115" y="130" text-anchor="middle" fill="var(--muted)" font-size="9" font-family="monospace">Dependency Map (L1)</text>
    </svg>`;
}

function _previewExtExpand(v) {
    const on = v === 'true';
    if (on) {
        return `<svg width="230" height="150" viewBox="0 0 230 150" xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="20" width="210" height="100" rx="6" fill="none" stroke="#dfa745" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.7"/>
          <text x="115" y="15" text-anchor="middle" fill="#dfa745" font-size="9" font-family="monospace">stdlib (expanded)</text>
          <circle cx="52" cy="70" r="15" fill="var(--panel2)" stroke="var(--muted)" stroke-width="1"/>
          <text x="52" y="74" text-anchor="middle" fill="var(--text)" font-size="7" font-family="monospace">os.path</text>
          <circle cx="108" cy="55" r="15" fill="var(--panel2)" stroke="var(--muted)" stroke-width="1"/>
          <text x="108" y="59" text-anchor="middle" fill="var(--text)" font-size="7" font-family="monospace">re</text>
          <circle cx="108" cy="95" r="15" fill="var(--panel2)" stroke="var(--muted)" stroke-width="1"/>
          <text x="108" y="99" text-anchor="middle" fill="var(--text)" font-size="7" font-family="monospace">json</text>
          <circle cx="168" cy="70" r="15" fill="var(--panel2)" stroke="var(--muted)" stroke-width="1"/>
          <text x="168" y="74" text-anchor="middle" fill="var(--text)" font-size="7" font-family="monospace">sys</text>
          <text x="115" y="140" text-anchor="middle" fill="#dfa745" font-size="10" font-family="monospace">Groups auto-expand</text>
        </svg>`;
    }
    return `<svg width="230" height="150" viewBox="0 0 230 150" xmlns="http://www.w3.org/2000/svg">
      <rect x="60" y="38" width="110" height="44" rx="6" fill="var(--panel2)" stroke="var(--muted)" stroke-width="1.5"/>
      <text x="115" y="56" text-anchor="middle" fill="var(--text)" font-size="10" font-family="monospace" font-weight="600">stdlib</text>
      <text x="115" y="72" text-anchor="middle" fill="var(--muted)" font-size="9" font-family="monospace">4 modules &#x25BC;</text>
      <text x="115" y="110" text-anchor="middle" fill="var(--muted)" font-size="10" font-family="monospace">Click to expand</text>
      <text x="115" y="140" text-anchor="middle" fill="var(--muted)" font-size="10" font-family="monospace">Groups stay collapsed</text>
    </svg>`;
}

// ─── Preferences Init ─────────────────────────────────────────────────────────

function initPreferences() {
    const prefBtn = document.getElementById('pref-btn');
    if (!prefBtn) return;

    // Dynamically create modal if not yet in DOM
    if (!document.getElementById('pref-modal')) {
        const modal = document.createElement('div');
        modal.id = 'pref-modal';
        modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:999;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
        modal.innerHTML = _buildPrefModalHTML();
        document.body.appendChild(modal);
        if (window._i18n && window._i18n.apply) window._i18n.apply(modal);
    }

    const prefModal = document.getElementById('pref-modal');

    // Apply saved values on load
    const savedFont = getSavedFont();
    const savedTheme = _PREFS.get('theme');
    const savedLang = _PREFS.get('lang');

    applyFont(savedFont, savedLang);
    applyTheme(savedTheme);
    _applyLang(savedLang);

    const fontSel = document.getElementById('font-select');
    const themeSel = document.getElementById('pref-theme-select');
    const langSel = document.getElementById('pref-lang-select');

    if (fontSel) { fontSel.value = savedFont; fontSel.style.fontFamily = savedFont; }
    if (themeSel) themeSel.value = savedTheme;
    if (langSel) langSel.value = savedLang;

    // Behaviour selects
    const extFilesSel = document.getElementById('pref-ext-files');
    const extFuncsSel = document.getElementById('pref-ext-funcs');
    const edgeTypeLabelsSel = document.getElementById('pref-edge-type-labels');
    const expandSel = document.getElementById('pref-ext-expand');

    if (extFilesSel) extFilesSel.value = String(_PREFS.get('extFiles'));
    if (extFuncsSel) extFuncsSel.value = String(_PREFS.get('extFuncs'));
    if (edgeTypeLabelsSel) edgeTypeLabelsSel.value = String(_PREFS.get('edgeTypeLabels'));
    if (expandSel) {
        try {
            const cp = JSON.parse(localStorage.getItem('codeviz_prefs') || '{}');
            expandSel.value = String(cp.extExpand !== false);
        } catch (_) { expandSel.value = 'true'; }
    }

    // Layout defaults
    const layoutL0Sel = document.getElementById('pref-layout-l0');
    const layoutL1Sel = document.getElementById('pref-layout-l1');
    const layoutL2Sel = document.getElementById('pref-layout-l2');
    if (layoutL0Sel) layoutL0Sel.value = _PREFS.get('layoutL0');
    if (layoutL1Sel) layoutL1Sel.value = _PREFS.get('layoutL1');
    if (layoutL2Sel) layoutL2Sel.value = _PREFS.get('layoutL2');

    // Open/close
    prefBtn.addEventListener('click', () => {
        prefModal.style.display = 'flex';
        setTimeout(() => _showPrefPreview('pref-theme-select', themeSel?.value || _PREFS.get('theme')), 50);
    });
    const close = () => { prefModal.style.display = 'none'; };
    document.getElementById('pref-close-x')?.addEventListener('click', close);
    document.getElementById('pref-close-btn')?.addEventListener('click', close);
    prefModal.addEventListener('click', e => { if (e.target === prefModal) close(); });

    // Font
    if (fontSel) fontSel.addEventListener('change', e => {
        const f = e.target.value; applyFont(f, _PREFS.get('lang')); _PREFS.set('font', f);
        fontSel.style.fontFamily = f;
    });

    // Theme
    if (themeSel) themeSel.addEventListener('change', e => {
        const t = e.target.value; applyTheme(t); _PREFS.set('theme', t);
    });

    // Language
    if (langSel) langSel.addEventListener('change', e => {
        const l = e.target.value; _PREFS.set('lang', l); _applyLang(l);
    });

    // Behaviour selects
    if (extFilesSel) extFilesSel.addEventListener('change', e => {
        const v = e.target.value === 'true';
        _PREFS.set('extFiles', v);
        depMapState.showExternalFiles = v;
        updateDepMapExtToggle?.();
    });
    if (extFuncsSel) extFuncsSel.addEventListener('change', e => {
        const v = e.target.value === 'true';
        _PREFS.set('extFuncs', v);
        l2State.showExternalFuncs = v;
        l2State.showExternalEdges = v;
        updateExternalFuncsToggle?.();
        applyExternalEdgeVisibility?.();
    });
    if (edgeTypeLabelsSel) edgeTypeLabelsSel.addEventListener('change', e => {
        const v = e.target.value === 'true';
        _PREFS.set('edgeTypeLabels', v);
        depMapState.showEdgeTypeLabels = v;
        if (state.level === 1) rerenderCurrentLevel?.();
    });
    if (expandSel) expandSel.addEventListener('change', e => {
        _updateCodevizPref('extExpand', e.target.value === 'true');
    });

    // Layout selects
    if (layoutL0Sel) layoutL0Sel.addEventListener('change', e => { _PREFS.set('layoutL0', e.target.value); });
    if (layoutL1Sel) layoutL1Sel.addEventListener('change', e => { _PREFS.set('layoutL1', e.target.value); });
    if (layoutL2Sel) layoutL2Sel.addEventListener('change', e => { _PREFS.set('layoutL2', e.target.value); });

    // Symbol View edge style
    const svEdgeStyleSel = document.getElementById('pref-sv-edge-style');
    if (svEdgeStyleSel) {
        svEdgeStyleSel.value = _PREFS.get('svEdgeStyle');
        svEdgeStyleSel.addEventListener('change', e => {
            _PREFS.set('svEdgeStyle', e.target.value);
            // Re-render the Symbol View if it's currently open.
            if (typeof _svState !== 'undefined' && _svState.fileRel &&
                typeof _svLoadFileGraph === 'function') {
                _svLoadFileGraph(_svState.fileRel);
            }
        });
    }

    // Node style
    const nodeStyleSel = document.getElementById('pref-node-style');
    if (nodeStyleSel) {
        nodeStyleSel.value = _PREFS.get('shapeMode');
        nodeStyleSel.addEventListener('change', e => {
            _shapeMode = e.target.value;
            _PREFS.set('shapeMode', _shapeMode);
            buildNodeLegend();
            rerenderCurrentLevel();
        });
    }
    _initPrefDropdowns([
        fontSel, themeSel, langSel, nodeStyleSel,
        extFilesSel, extFuncsSel, edgeTypeLabelsSel, expandSel,
        layoutL0Sel, layoutL1Sel, layoutL2Sel,
        svEdgeStyleSel,
    ]);
}

