// @ts-nocheck -- JS->TS migration: renamed to .ts, type-curation pending. Remove this line and fix errors to enable checking.
// @module Dashboard_view/dashboard_ai_prompt
// AI-assisted remediation prompt generator for problem-focused dashboard
// detail panels. This module is intentionally frontend-only: it reuses the
// existing /chat-config readiness check and /chat-stream SSE endpoint.

(function () {
    'use strict';

    const _DASH_AI_SUPPORTED = new Set([
        'dead_code',
        'circular_deps',
        'issues',
        'duplication',
        'complexity',
        'coupling',
        'tech_debt',
        'security',
        'entry_points',
    ]);

    const _DASH_AI_MODAL_ID = 'dash-ai-prompt-modal';
    const _DASH_AI_DEFAULT_MULTI_LIMIT = 5;
    const _DASH_AI_MAX_CONTEXT_ITEMS = 12;

    const _dashAiJobs = new Map();
    let _dashAiState = null;
    let _dashAiRenderQueued = false;
    let _dashAiEscBound = false;

    function _dashAiT(key, fallback) {
        if (typeof _dashT === 'function') {
            const value = _dashT(key);
            if (value && value !== key) return value;
        }
        if (typeof T === 'function') {
            try {
                const value = T(key);
                if (value && value !== key) return value;
            } catch (_) {}
        }
        return fallback || key;
    }

    function _dashAiEsc(value) {
        if (typeof _dashEscape === 'function') return _dashEscape(value);
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[ch]);
    }

    function _dashAiJson(value) {
        return JSON.stringify(value, null, 2);
    }

    function _dashAiPath(value) {
        return String(value || '').replace(/\\/g, '/').trim();
    }

    function _dashAiBaseName(path) {
        return _dashAiPath(path).split('/').filter(Boolean).pop() || _dashAiPath(path) || 'unknown';
    }

    function _dashAiUnique(values) {
        const seen = new Set();
        const out = [];
        for (const value of values || []) {
            const key = typeof value === 'string' ? _dashAiPath(value) : JSON.stringify(value || {});
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(value);
        }
        return out;
    }

    function _dashAiUniqueFiles(values) {
        return _dashAiUnique((values || []).map(_dashAiPath).filter(Boolean));
    }

    function _dashAiSeverityRank(severity) {
        const key = String(severity || '').toLowerCase();
        if (key === 'critical') return 4;
        if (key === 'high') return 3;
        if (key === 'medium' || key === 'warn' || key === 'warning') return 2;
        if (key === 'low' || key === 'info') return 1;
        return 0;
    }

    function _dashAiNormalizeSeverity(severity) {
        const key = String(severity || '').toLowerCase();
        if (key === 'critical') return 'critical';
        if (key === 'high') return 'high';
        if (key === 'medium' || key === 'warn' || key === 'warning') return 'medium';
        if (key === 'low' || key === 'info') return 'low';
        return 'low';
    }

    function _dashAiItem(input) {
        const item = Object.assign({
            title: '',
            kind: 'finding',
            severity: 'low',
            files: [],
            symbols: [],
            evidence: [],
            summary: '',
        }, input || {});
        item.title = String(item.title || item.summary || item.kind || 'Finding');
        item.kind = String(item.kind || 'finding');
        item.severity = _dashAiNormalizeSeverity(item.severity);
        item.files = _dashAiUniqueFiles(item.files || []);
        item.symbols = _dashAiUnique((item.symbols || []).filter(Boolean).map(sym => ({
            file: _dashAiPath(sym.file || item.files[0] || ''),
            name: String(sym.name || sym.label || '').trim(),
            line: Number(sym.line || 0) || undefined,
        })).filter(sym => sym.name || sym.file));
        item.evidence = _dashAiUnique((item.evidence || []).map(v => String(v || '').trim()).filter(Boolean));
        item.summary = String(item.summary || '').trim();
        return item;
    }

    function _dashAiFinalizeItems(items) {
        return (items || [])
            .map(_dashAiItem)
            .filter(item => item.files.length || item.symbols.length || item.evidence.length || item.summary)
            .sort((a, b) => {
                const sev = _dashAiSeverityRank(b.severity) - _dashAiSeverityRank(a.severity);
                if (sev) return sev;
                const fileDelta = (b.files?.length || 0) - (a.files?.length || 0);
                if (fileDelta) return fileDelta;
                return String(a.title).localeCompare(String(b.title));
            })
            .map((item, idx) => Object.assign(item, {
                id: `${item.kind}-${idx}-${String(item.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
                priority: idx + 1,
            }));
    }

    function _dashAiGroupByFile(symbols) {
        const byFile = new Map();
        for (const sym of symbols || []) {
            const file = _dashAiPath(sym.file || '');
            if (!file) continue;
            if (!byFile.has(file)) byFile.set(file, []);
            byFile.get(file).push(sym);
        }
        return [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
    }

    function _dashAiDeadCodeExtractor(stats) {
        const dead = stats.dead_code_symbols || [];
        const total = Number(stats.uncalled_functions || dead.length || 0);
        return _dashAiGroupByFile(dead).map(([file, symbols]) => {
            const count = symbols.length;
            const severity = count >= 10 ? 'high' : count >= 3 ? 'medium' : 'low';
            return _dashAiItem({
                title: `Dead code in ${_dashAiBaseName(file)}`,
                kind: 'dead_code',
                severity,
                files: [file],
                symbols: symbols.map(sym => ({ file, name: sym.name, line: sym.line })),
                evidence: [
                    `${count} unused symbol${count === 1 ? '' : 's'} in this file`,
                    `${total} total uncalled function${total === 1 ? '' : 's'} reported`,
                ],
                summary: `Review whether ${count} symbol${count === 1 ? '' : 's'} in ${file} are genuinely unused before removing or reconnecting them.`,
            });
        });
    }

    function _dashAiCircularDepsExtractor(stats) {
        const cycles = stats.top_circular_deps || [];
        return cycles.map((cycle, idx) => {
            const files = _dashAiUniqueFiles(cycle || []);
            const len = files.length;
            const severity = len >= 10 ? 'critical' : len >= 5 ? 'high' : 'medium';
            return _dashAiItem({
                title: `Circular dependency ${idx + 1}`,
                kind: 'circular_deps',
                severity,
                files,
                evidence: [
                    `${len} files in dependency cycle`,
                    files.map(_dashAiBaseName).join(' -> '),
                ],
                summary: `Break or invert the dependency chain involving ${files.map(_dashAiBaseName).join(', ')}.`,
            });
        });
    }

    function _dashAiIssuesExtractor(stats) {
        const items = [];
        items.push(..._dashAiCircularDepsExtractor(stats));
        items.push(..._dashAiDeadCodeExtractor(stats).slice(0, 20));

        for (const file of stats.unimported_file_paths || []) {
            const path = _dashAiPath(file);
            if (!path) continue;
            items.push(_dashAiItem({
                title: `Unimported file: ${_dashAiBaseName(path)}`,
                kind: 'unimported_file',
                severity: 'low',
                files: [path],
                evidence: ['File is not imported by tracked source files'],
                summary: `Confirm whether ${path} is an intended entry point, generated file, test fixture, or orphaned code.`,
            }));
        }

        for (const file of stats.isolated_file_paths || []) {
            const path = _dashAiPath(file);
            if (!path) continue;
            items.push(_dashAiItem({
                title: `Isolated file: ${_dashAiBaseName(path)}`,
                kind: 'isolated_file',
                severity: 'low',
                files: [path],
                evidence: ['File has no tracked import edges in either direction'],
                summary: `Verify whether ${path} is intentionally standalone or should be wired into the import graph.`,
            }));
        }
        return items;
    }

    function _dashAiDuplicationExtractor(stats) {
        const pct = Number(stats.duplication_percent || 0);
        const blocks = stats.duplication_blocks || [];
        return blocks.map((block, idx) => {
            const occ = block.occurrences || [];
            const files = _dashAiUniqueFiles(occ.map(o => o.file));
            const locs = occ.map(o => `${_dashAiPath(o.file)}:${Number(o.line || 0) || '?'}`).slice(0, 10);
            return _dashAiItem({
                title: `Duplicate block ${idx + 1}`,
                kind: 'duplication',
                severity: occ.length >= 5 || pct >= 15 ? 'high' : occ.length >= 3 || pct >= 5 ? 'medium' : 'low',
                files,
                evidence: [
                    `${occ.length} occurrence${occ.length === 1 ? '' : 's'}`,
                    `${Number(block.lines || 0) || '?'} normalized lines per duplicate window`,
                    `Repository duplication: ${pct.toFixed(1)}%`,
                    ...locs,
                ],
                summary: `Verify the duplicate block across ${files.length} file${files.length === 1 ? '' : 's'} and extract or consolidate only if the repeated behavior is truly shared.`,
            });
        });
    }

    function _dashAiComplexityExtractor(stats) {
        const avg = Number(stats.avg_complexity || 0);
        return (stats.complexity_top_offenders || []).map(sym => {
            const cx = Number(sym.complexity || sym.score || 0);
            const file = _dashAiPath(sym.file || '');
            return _dashAiItem({
                title: `Complex function: ${sym.name || _dashAiBaseName(file)}`,
                kind: 'complexity',
                severity: cx >= 21 ? 'critical' : cx >= 16 ? 'high' : cx >= 11 ? 'medium' : 'low',
                files: [file],
                symbols: [{ file, name: sym.name || '', line: sym.line }],
                evidence: [
                    `Cyclomatic complexity ${cx}`,
                    `Repository average complexity ${avg.toFixed(1)}`,
                    Number(sym.line || 0) ? `Starts near line ${Number(sym.line)}` : '',
                ].filter(Boolean),
                summary: `Reduce branching and split responsibilities in ${sym.name || _dashAiBaseName(file)} after verifying the measured control-flow paths.`,
            });
        });
    }

    function _dashAiCouplingExtractor(stats) {
        const imported = stats.top_imported_files || [];
        const callers = stats.top_caller_files || [];
        const totalImports = imported.reduce((sum, it) => sum + Number(it.count || 0), 0);
        const top3 = imported.slice(0, 3).reduce((sum, it) => sum + Number(it.count || 0), 0);
        const conc = totalImports ? Math.round((top3 / totalImports) * 100) : 0;
        const items = [];

        imported.forEach((item, idx) => {
            const count = Number(item.count || 0);
            const file = _dashAiPath(item.file || '');
            items.push(_dashAiItem({
                title: `Import hotspot: ${_dashAiBaseName(file)}`,
                kind: 'coupling_imported',
                severity: idx < 3 && conc >= 50 ? 'high' : idx < 10 ? 'medium' : 'low',
                files: [file],
                evidence: [
                    `${count} tracked imports target this file`,
                    `Top-3 import concentration: ${conc}%`,
                ],
                summary: `Inspect whether ${file} has too many responsibilities or needs a narrower interface.`,
            }));
        });

        callers.forEach((item, idx) => {
            const count = Number(item.count || 0);
            const file = _dashAiPath(item.file || '');
            items.push(_dashAiItem({
                title: `Caller hotspot: ${_dashAiBaseName(file)}`,
                kind: 'coupling_caller',
                severity: count >= 100 ? 'high' : count >= 50 ? 'medium' : 'low',
                files: [file],
                evidence: [`${count} outgoing function calls tracked`],
                summary: `Review whether ${file} is acting as an oversized coordinator or god file.`,
            }));
        });

        return items;
    }

    function _dashAiDebtFilesFor(category, stats) {
        if (category === 'circular') return _dashAiUniqueFiles((stats.top_circular_deps || []).flat());
        if (category === 'god') return _dashAiUniqueFiles((stats.top_caller_files || []).map(x => x.file));
        if (category === 'complexity') return _dashAiUniqueFiles((stats.complexity_top_offenders || []).map(x => x.file));
        if (category === 'duplication') {
            return _dashAiUniqueFiles((stats.duplication_blocks || []).flatMap(block => (block.occurrences || []).map(o => o.file)));
        }
        if (category === 'dead') return _dashAiUniqueFiles((stats.dead_code_symbols || []).map(x => x.file));
        return [];
    }

    function _dashAiTechDebtExtractor(stats) {
        const labels = {
            circular: 'Circular dependencies',
            god: 'God files',
            complexity: 'High complexity',
            duplication: 'Duplicated blocks',
            dead: 'Dead code',
        };
        const breakdown = stats.tech_debt_breakdown || {};
        const weights = stats.tech_debt_weights || {};
        return Object.keys(labels).map(key => {
            const minutes = Number(breakdown[key] || 0);
            if (minutes <= 0) return null;
            const files = _dashAiDebtFilesFor(key, stats);
            return _dashAiItem({
                title: `Tech debt: ${labels[key]}`,
                kind: `tech_debt_${key}`,
                severity: minutes >= 240 ? 'high' : minutes >= 60 ? 'medium' : 'low',
                files,
                evidence: [
                    `${minutes} estimated remediation minutes`,
                    weights[key] ? `${weights[key]} minutes per finding weight` : '',
                    `${files.length} related file${files.length === 1 ? '' : 's'} in dashboard context`,
                ].filter(Boolean),
                summary: `Triage the ${labels[key].toLowerCase()} debt category before generating broad cleanup changes.`,
            });
        }).filter(Boolean);
    }

    function _dashAiSecurityExtractor(stats) {
        const f = stats.security_findings || {};
        const all = []
            .concat((f.by_severity || {}).high || [])
            .concat((f.by_severity || {}).medium || [])
            .concat((f.by_severity || {}).low || []);
        return all.map(issue => {
            const file = _dashAiPath(issue.path || issue.file || '');
            const sev = _dashAiNormalizeSeverity(issue.severity || 'low');
            const line = Number(issue.line || 0) || 0;
            return _dashAiItem({
                title: issue.title || issue.rule_id || 'Security finding',
                kind: 'security',
                severity: sev,
                files: [file],
                evidence: [
                    issue.rule_id ? `Rule: ${issue.rule_id}` : '',
                    line ? `Line: ${line}` : '',
                    issue.recommendation ? `Recommendation: ${issue.recommendation}` : '',
                ].filter(Boolean),
                summary: `Validate the ${sev} security finding${file ? ` in ${file}` : ''} and remediate only after checking the exact usage and threat model.`,
            });
        });
    }

    function _dashAiEntryPointsExtractor(stats) {
        const items = [];
        for (const file of stats.entry_point_files || []) {
            const path = _dashAiPath(file);
            if (!path) continue;
            items.push(_dashAiItem({
                title: `Entry point: ${_dashAiBaseName(path)}`,
                kind: 'entry_point',
                severity: 'low',
                files: [path],
                evidence: ['File is not imported by any tracked source file'],
                summary: `Confirm whether ${path} is an intentional executable/config entry point or should be connected to the module graph.`,
            }));
        }
        for (const file of stats.isolated_file_paths || []) {
            const path = _dashAiPath(file);
            if (!path) continue;
            items.push(_dashAiItem({
                title: `Isolated file: ${_dashAiBaseName(path)}`,
                kind: 'isolated_file',
                severity: 'medium',
                files: [path],
                evidence: ['No tracked import edges in either direction'],
                summary: `Verify whether ${path} is unused, generated, a fixture, or intentionally standalone.`,
            }));
        }
        return items;
    }

    const _dashAiPromptExtractors = {
        dead_code: _dashAiDeadCodeExtractor,
        circular_deps: _dashAiCircularDepsExtractor,
        issues: _dashAiIssuesExtractor,
        duplication: _dashAiDuplicationExtractor,
        complexity: _dashAiComplexityExtractor,
        coupling: _dashAiCouplingExtractor,
        tech_debt: _dashAiTechDebtExtractor,
        security: _dashAiSecurityExtractor,
        entry_points: _dashAiEntryPointsExtractor,
    };

    function _dashAiItemsFor(widgetId, stats) {
        const extractor = _dashAiPromptExtractors[widgetId];
        if (!extractor) return [];
        try {
            return _dashAiFinalizeItems(extractor(stats || {}));
        } catch (err) {
            console.warn(`[dashboard-ai] extractor failed for ${widgetId}`, err);
            return [];
        }
    }

    function _dashAiWidgetLabel(widgetId) {
        const registry = typeof _dashWidgetRegistry !== 'undefined'
            ? _dashWidgetRegistry
            : (window._dashWidgetRegistry || {});
        const widget = registry[widgetId];
        const key = widget?.detailLabelKey || widget?.labelKey || widgetId;
        const label = _dashAiT(key, widgetId);
        return label && label !== key ? label : widgetId;
    }

    function _dashAiProviderHasCredential(provider, cfg) {
        if (provider === 'anthropic') return !!cfg.anthropic_api_key_present;
        if (provider === 'openai') return !!cfg.openai_api_key_present;
        if (provider === 'grok') return !!cfg.grok_api_key_present;
        if (provider === 'gemini') return !!cfg.gemini_api_key_present;
        if (provider === 'ollama') return !!cfg.ollama_url_present;
        if (provider === 'custom') return !!cfg.custom_api_key_present;
        return false;
    }

    function _dashAiConfigIsReady(cfg) {
        if (!cfg) return false;
        if ((cfg.ai_mode || 'api') === 'cli') return !!(cfg.cli_agent || 'claude');
        return _dashAiProviderHasCredential(cfg.provider || 'anthropic', cfg);
    }

    function _dashAiConfigLabel(cfg) {
        if (!cfg) return '';
        if ((cfg.ai_mode || 'api') === 'cli') return `CLI: ${cfg.cli_agent || 'claude'}`;
        return `API: ${cfg.provider || 'anthropic'}`;
    }

    function _dashAiJobAlive(state) {
        return !!(state && _dashAiJobs.get(state.widgetId) === state);
    }

    function _dashAiSyncIndicators() {
        const jobs = [..._dashAiJobs.values()];
        const busy = jobs.some(job => job.busy);
        const unread = jobs.filter(job => job.unread && !job.busy);

        const dashBtn = document.getElementById('dashboard-btn');
        if (dashBtn) {
            dashBtn.classList.toggle('computing', busy);
            dashBtn.classList.toggle('dash-ai-rail-busy', busy);
            dashBtn.classList.toggle('dash-ai-rail-unread', unread.length > 0);
        }

        document.querySelectorAll('#dashboard-bento .dash-widget').forEach(widgetEl => {
            const widgetId = widgetEl.dataset.id || '';
            const job = _dashAiJobs.get(widgetId);
            const isBusy = !!job?.busy;
            const isUnread = !!(job?.unread && !job.busy);
            widgetEl.classList.toggle('dash-ai-widget-generating', isBusy);
            widgetEl.classList.toggle('dash-ai-widget-unread', isUnread);

            let hint = widgetEl.querySelector('.dash-ai-widget-hint');
            if (!isBusy && !isUnread) {
                hint?.remove();
                return;
            }

            if (!hint) {
                hint = document.createElement('button');
                hint.type = 'button';
                hint.className = 'dash-ai-widget-hint';
                hint.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const id = widgetEl.dataset.id || widgetId;
                    const existing = _dashAiJobs.get(id);
                    _dashAiOpen(id, window.DATA?.stats || existing?.stats || {});
                });
                widgetEl.appendChild(hint);
            }
            hint.dataset.state = isBusy ? 'busy' : 'unread';
            hint.textContent = isBusy
                ? _dashAiT('dashAiPromptWidgetGenerating', 'AI prompt generating')
                : _dashAiT('dashAiPromptWidgetUnread', 'AI prompt ready');
            hint.setAttribute('aria-label', hint.textContent);
        });
    }

    async function _dashAiLoadConfig() {
        const state = _dashAiState;
        if (!state) return;
        state.configLoading = true;
        state.status = _dashAiT('dashAiPromptChecking', 'Checking AI settings...');
        _dashAiRenderModal();
        try {
            const resp = await fetch('/chat-config');
            const cfg = await resp.json().catch(() => ({}));
            if (!resp.ok || cfg.error) throw new Error(cfg.error || `HTTP ${resp.status}`);
            if (!_dashAiJobAlive(state)) return;
            state.config = cfg || {};
            state.ready = _dashAiConfigIsReady(cfg || {});
            state.status = state.ready
                ? `${_dashAiT('dashAiPromptReady', 'AI ready')}: ${_dashAiConfigLabel(cfg || {})}`
                : _dashAiT('dashAiPromptAiMissingTitle', 'AI is not configured');
        } catch (err) {
            if (!_dashAiJobAlive(state)) return;
            state.config = {};
            state.ready = false;
            state.error = err.message || String(err);
            state.status = _dashAiT('dashAiPromptAiMissingTitle', 'AI is not configured');
        } finally {
            if (_dashAiJobAlive(state)) {
                state.configLoading = false;
                _dashAiRenderModal();
                _dashAiSyncIndicators();
            }
        }
    }

    function _dashAiOpenSettings() {
        if (typeof window.openPreferences === 'function') {
            window.openPreferences('ai');
            return;
        }
        if (typeof window.openAiSettings === 'function') {
            window.openAiSettings();
            return;
        }
        document.getElementById('pref-btn')?.click();
    }

    function _dashAiEnhanceDetail(body, widgetId, stats) {
        if (!body || !_DASH_AI_SUPPORTED.has(widgetId)) return;
        const items = _dashAiItemsFor(widgetId, stats || {});
        if (!items.length) return;

        const panel = body.closest('.dash-detail-panel') || document.getElementById('dash-detail-panel');
        const head = panel?.querySelector('.dash-detail-head');
        if (!head || head.querySelector('[data-dash-ai-prompt]')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dash-ai-prompt-btn';
        btn.dataset.dashAiPrompt = 'true';
        btn.title = _dashAiT('dashAiPromptButton', 'AI Prompt');
        btn.setAttribute('aria-label', _dashAiT('dashAiPromptButton', 'AI Prompt'));
        btn.innerHTML = `<span class="dash-ai-prompt-btn__icon" aria-hidden="true">AI</span><span>${_dashAiEsc(_dashAiT('dashAiPromptButton', 'AI Prompt'))}</span>`;
        btn.addEventListener('click', () => _dashAiOpen(widgetId, stats || {}));

        const close = head.querySelector('#dash-detail-close, .dash-detail-close');
        head.insertBefore(btn, close || null);
    }

    function _dashAiOpen(widgetId, stats, defaultScope) {
        const items = _dashAiItemsFor(widgetId, stats || {});
        const existing = _dashAiJobs.get(widgetId);
        if (!items.length && !existing) return;
        if (_dashAiState && _dashAiState !== existing) {
            _dashAiClose();
        }

        if (existing) {
            _dashAiState = existing;
            existing.modalOpen = true;
            existing.unread = false;
            if (!existing.busy && items.length) {
                existing.stats = stats || existing.stats || {};
                existing.items = items;
                if (!existing.items.some(item => item.id === existing.selectedId)) {
                    existing.selectedId = existing.items[0]?.id || '';
                }
                existing.checkedIds = new Set([...existing.checkedIds].filter(id => existing.items.some(item => item.id === id)));
                if (!existing.checkedIds.size) {
                    existing.checkedIds = new Set(existing.items.slice(0, _DASH_AI_DEFAULT_MULTI_LIMIT).map(item => item.id));
                }
                existing.multiLimit = Math.min(existing.multiLimit || _DASH_AI_DEFAULT_MULTI_LIMIT, Math.max(1, existing.items.length));
            }
            _dashAiRenderModal();
            if (!existing.config && !existing.configLoading) _dashAiLoadConfig();
            _dashAiSyncIndicators();
            if (!_dashAiEscBound) {
                document.addEventListener('keydown', _dashAiKeyHandler, true);
                _dashAiEscBound = true;
            }
            return;
        }

        const scope = ['single', 'multiple', 'overall'].includes(defaultScope) ? defaultScope : 'single';
        _dashAiState = {
            widgetId,
            widgetLabel: _dashAiWidgetLabel(widgetId),
            stats: stats || {},
            items,
            scope,
            selectedId: items[0]?.id || '',
            checkedIds: new Set(items.slice(0, _DASH_AI_DEFAULT_MULTI_LIMIT).map(item => item.id)),
            multiLimit: Math.min(_DASH_AI_DEFAULT_MULTI_LIMIT, Math.max(1, items.length)),
            config: null,
            configLoading: false,
            ready: false,
            busy: false,
            response: '',
            parsed: null,
            status: '',
            error: '',
            copied: false,
            unread: false,
            modalOpen: true,
            abortController: null,
        };
        _dashAiJobs.set(widgetId, _dashAiState);
        _dashAiRenderModal();
        _dashAiLoadConfig();
        _dashAiSyncIndicators();
        if (!_dashAiEscBound) {
            document.addEventListener('keydown', _dashAiKeyHandler, true);
            _dashAiEscBound = true;
        }
    }

    function _dashAiClose() {
        const state = _dashAiState;
        if (state) {
            state.modalOpen = false;
            if (!state.busy && !state.response && !state.parsed && !state.error) {
                _dashAiJobs.delete(state.widgetId);
            }
        }
        document.getElementById(_DASH_AI_MODAL_ID)?.remove();
        _dashAiState = null;
        if (_dashAiEscBound) {
            document.removeEventListener('keydown', _dashAiKeyHandler, true);
            _dashAiEscBound = false;
        }
        _dashAiSyncIndicators();
    }

    function _dashAiKeyHandler(event) {
        if (!_dashAiState) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            _dashAiClose();
        }
    }

    function _dashAiScheduleRender() {
        if (_dashAiRenderQueued) return;
        _dashAiRenderQueued = true;
        requestAnimationFrame(() => {
            _dashAiRenderQueued = false;
            _dashAiRenderModal();
            _dashAiSyncIndicators();
        });
    }

    function _dashAiSelectedItems() {
        if (!_dashAiState) return [];
        if (_dashAiState.scope === 'overall') {
            return _dashAiState.items.slice(0, _DASH_AI_MAX_CONTEXT_ITEMS);
        }
        if (_dashAiState.scope === 'multiple') {
            return _dashAiState.items.filter(item => _dashAiState.checkedIds.has(item.id));
        }
        return _dashAiState.items.filter(item => item.id === _dashAiState.selectedId).slice(0, 1);
    }

    function _dashAiCompactItem(item) {
        return {
            title: item.title,
            kind: item.kind,
            severity: item.severity,
            priority: item.priority,
            summary: item.summary,
            files: (item.files || []).slice(0, 12),
            symbols: (item.symbols || []).slice(0, 24),
            evidence: (item.evidence || []).slice(0, 12),
        };
    }

    function _dashAiWidgetMetrics(widgetId, stats) {
        const s = stats || {};
        return {
            widget_id: widgetId,
            codebase_root: s.root || '',
            files: s.files,
            functions: s.functions,
            circular_dependencies: s.circular_dependencies,
            uncalled_functions: s.uncalled_functions,
            unimported_files: s.unimported_files,
            entry_points: s.entry_points,
            isolated_files: s.isolated_files,
            avg_complexity: s.avg_complexity,
            duplication_percent: s.duplication_percent,
            tech_debt_hours: s.tech_debt_hours,
            security_score: s.security_findings?.score,
            security_total: s.security_findings?.total,
        };
    }

    function _dashAiBuildPrompt() {
        const state = _dashAiState;
        const selected = _dashAiSelectedItems();
        const context = {
            source: 'VizCode dashboard detail panel',
            widget_id: state.widgetId,
            widget_label: state.widgetLabel,
            scope: state.scope,
            scope_intent: state.scope === 'single'
                ? 'Verify one selected finding and produce a targeted remediation prompt.'
                : state.scope === 'multiple'
                    ? 'Verify the selected findings in priority order and produce a bounded remediation prompt.'
                    : 'Verify the whole widget signal and produce a triage/remediation strategy.',
            metrics: _dashAiWidgetMetrics(state.widgetId, state.stats),
            selected_findings: selected.map(_dashAiCompactItem),
            all_findings_summary: {
                total: state.items.length,
                top_findings: state.items.slice(0, _DASH_AI_MAX_CONTEXT_ITEMS).map(_dashAiCompactItem),
            },
        };

        return [
            'You are helping generate a copy-ready remediation prompt for a repo-aware coding agent such as Codex, Claude Code, or Gemini CLI.',
            '',
            'Before writing the prompt, use VizCode repository tools to verify whether the dashboard findings below are real. Inspect referenced files, symbols, imports, or dependency edges as needed. If the dashboard finding looks stale, ambiguous, generated/test-only, or a likely false positive, say so.',
            '',
            'Do not include raw source code in the final prompt unless a very small verified snippet is essential. Prefer paths, symbols, line numbers, evidence, and remediation intent.',
            '',
            'Return exactly these sections:',
            '## Verification Summary',
            '- concise bullets covering what you checked, which findings look real, and likely false positives or uncertainty',
            '',
            '## Agent Prompt',
            '```text',
            'Write the copy-ready prompt here. It should instruct a coding agent to verify first, make scoped changes, preserve behavior, and run relevant checks.',
            '```',
            '',
            'Dashboard context JSON:',
            _dashAiJson(context),
        ].join('\n');
    }

    function _dashAiParseResponse(text) {
        const raw = String(text || '').trim();
        if (!raw) return { summary: '', prompt: '', raw };

        const marker = /(^|\n)##\s*Agent Prompt\s*\n/i.exec(raw);
        if (marker) {
            const before = raw.slice(0, marker.index).replace(/^\s*##\s*Verification Summary\s*/i, '').trim();
            const after = raw.slice(marker.index + marker[0].length).trim();
            const fenced = /```(?:text|markdown|md)?\s*([\s\S]*?)```/i.exec(after);
            return {
                summary: before,
                prompt: (fenced ? fenced[1] : after).trim(),
                raw,
            };
        }

        const lastFence = /```(?:text|markdown|md)?\s*([\s\S]*?)```/i.exec(raw);
        if (lastFence) {
            return {
                summary: raw.replace(lastFence[0], '').trim(),
                prompt: lastFence[1].trim(),
                raw,
            };
        }

        return { summary: '', prompt: raw, raw };
    }

    async function _dashAiGenerate() {
        const state = _dashAiState;
        if (!state || state.busy) return;
        if (!state.ready) {
            state.error = _dashAiT('dashAiPromptAiMissingCopy', 'Configure an API provider or local CLI before generating dashboard AI prompts.');
            _dashAiRenderModal();
            return;
        }
        const selected = _dashAiSelectedItems();
        if (!selected.length) {
            state.error = _dashAiT('dashAiPromptSelectAtLeastOne', 'Select at least one finding.');
            _dashAiRenderModal();
            return;
        }

        const forceRefresh = !!(state.response || state.parsed);
        state.busy = true;
        state.response = '';
        state.parsed = null;
        state.error = '';
        state.copied = false;
        state.status = _dashAiT('dashAiPromptStreaming', 'Streaming AI analysis...');
        state.abortController = new AbortController();
        _dashAiRenderModal();
        _dashAiSyncIndicators();

        try {
            const resp = await fetch('/chat-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: state.abortController.signal,
                body: JSON.stringify({
                    job_id: window.JOB_ID || '',
                    history: [{ role: 'user', content: _dashAiBuildPrompt() }],
                    depth: 'general',
                    output: 'remediation_prompt',
                    force_refresh: forceRefresh,
                }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `Server error ${resp.status}`);
            }
            await _dashAiReadSSE(resp.body, ev => {
                if (!_dashAiJobAlive(state)) return;
                if (ev.type === 'delta') {
                    state.response += ev.text || '';
                    state.status = _dashAiT('dashAiPromptStreaming', 'Streaming AI analysis...');
                    _dashAiScheduleRender();
                } else if (ev.type === 'tool_call') {
                    state.status = `${_dashAiT('dashAiPromptVerifying', 'Verifying with VizCode tools')}: ${ev.name || 'tool'}`;
                    _dashAiScheduleRender();
                } else if (ev.type === 'provider') {
                    state.status = `${_dashAiT('dashAiPromptStreaming', 'Streaming AI analysis...')} (${ev.name || 'AI'})`;
                    _dashAiScheduleRender();
                } else if (ev.type === 'status' && ev.message) {
                    state.status = ev.message;
                    _dashAiScheduleRender();
                } else if (ev.type === 'error') {
                    throw new Error(ev.message || 'AI stream error');
                }
            });
            if (!_dashAiJobAlive(state)) return;
            state.parsed = _dashAiParseResponse(state.response);
            state.status = state.parsed.prompt
                ? _dashAiT('dashAiPromptReadyResult', 'Prompt ready')
                : _dashAiT('dashAiPromptRawResponse', 'AI response received');
            state.unread = !state.modalOpen;
        } catch (err) {
            if (!_dashAiJobAlive(state)) return;
            if (err.name === 'AbortError') {
                state.status = _dashAiT('dashAiPromptCanceled', 'Generation canceled');
            } else {
                state.error = err.message || String(err);
                state.status = _dashAiT('dashAiPromptError', 'AI generation failed');
            }
            state.unread = !state.modalOpen;
        } finally {
            if (_dashAiJobAlive(state)) {
                state.busy = false;
                state.abortController = null;
                _dashAiRenderModal();
                _dashAiSyncIndicators();
            }
        }
    }

    async function _dashAiReadSSE(readableStream, onEvent) {
        if (!readableStream) throw new Error('No response stream');
        const reader = readableStream.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
                const raw = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                for (const line of raw.split('\n')) {
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (!payload) continue;
                    const ev = JSON.parse(payload);
                    if (ev.type === 'done') {
                        try { await reader.cancel(); } catch (_) {}
                        return;
                    }
                    onEvent(ev);
                }
            }
        }
    }

    async function _dashAiCopyPrompt() {
        const state = _dashAiState;
        const text = state?.parsed?.prompt || state?.parsed?.raw || state?.response || '';
        if (!text.trim()) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            if (_dashAiState) {
                _dashAiState.copied = true;
                _dashAiState.unread = false;
                _dashAiRenderModal();
                _dashAiSyncIndicators();
                setTimeout(() => {
                    if (_dashAiState) {
                        _dashAiState.copied = false;
                        _dashAiRenderModal();
                    }
                }, 1300);
            }
        } catch (err) {
            if (_dashAiState) {
                _dashAiState.error = err.message || 'Copy failed';
                _dashAiRenderModal();
            }
        }
    }

    function _dashAiScopeHtml(state) {
        const scopes = [
            ['single', _dashAiT('dashAiPromptScopeSingle', 'Single issue'), _dashAiT('dashAiPromptScopeSingleDesc', 'Verify and prompt for one finding.')],
            ['multiple', _dashAiT('dashAiPromptScopeMultiple', 'Multiple issues'), _dashAiT('dashAiPromptScopeMultipleDesc', 'Verify selected findings; top five selected by default.')],
            ['overall', _dashAiT('dashAiPromptScopeOverall', 'Overall strategy'), _dashAiT('dashAiPromptScopeOverallDesc', 'Triage the whole widget signal.')],
        ];
        return `<div class="dash-ai-scope" role="tablist" aria-label="${_dashAiEsc(_dashAiT('dashAiPromptScopeLabel', 'Scope'))}">
${scopes.map(([id, label, desc]) => `<button type="button" class="dash-ai-scope-btn${state.scope === id ? ' active' : ''}" data-ai-scope="${id}" aria-pressed="${state.scope === id ? 'true' : 'false'}">
  <span>${_dashAiEsc(label)}</span>
  <small>${_dashAiEsc(desc)}</small>
</button>`).join('')}
</div>`;
    }

    function _dashAiFindingTitle(item) {
        return `${item.priority}. ${item.title} (${item.severity})`;
    }

    function _dashAiFindingMeta(item) {
        const parts = [];
        if (item.files?.length) parts.push(`${item.files.length} file${item.files.length === 1 ? '' : 's'}`);
        if (item.symbols?.length) parts.push(`${item.symbols.length} symbol${item.symbols.length === 1 ? '' : 's'}`);
        if (item.evidence?.[0]) parts.push(item.evidence[0]);
        return parts.join(' · ');
    }

    function _dashAiSelectionHtml(state) {
        if (state.scope === 'overall') {
            return `<div class="dash-ai-overall-hint">${_dashAiEsc(_dashAiT('dashAiPromptOverallHint', 'The request will include the full widget metrics and the highest-priority findings for triage.'))}</div>`;
        }
        if (state.scope === 'single') {
            return `<div class="dash-ai-field">
  <span>${_dashAiEsc(_dashAiT('dashAiPromptFindings', 'Findings'))}</span>
  <div class="dash-ai-choice-list dash-ai-choice-list--single" role="listbox">
    ${state.items.map(item => {
        const active = item.id === state.selectedId;
        return `<button type="button" class="dash-ai-choice${active ? ' active' : ''}" data-ai-single-option="${_dashAiEsc(item.id)}" role="option" aria-selected="${active ? 'true' : 'false'}">
      <span class="dash-ai-choice-mark" aria-hidden="true"></span>
      <span class="dash-ai-choice-copy">
        <strong>${_dashAiEsc(_dashAiFindingTitle(item))}</strong>
        <small>${_dashAiEsc(_dashAiFindingMeta(item))}</small>
      </span>
    </button>`;
    }).join('')}
  </div>
</div>
<div class="dash-ai-finding-preview">${_dashAiEsc(_dashAiFindingMeta(state.items.find(item => item.id === state.selectedId) || state.items[0] || {}))}</div>`;
        }
        return `<div class="dash-ai-multi-head">
  <div class="dash-ai-limit">
    <span>${_dashAiEsc(_dashAiT('dashAiPromptTopLimit', 'Top count'))}</span>
    <div class="dash-ai-stepper" role="group" aria-label="${_dashAiEsc(_dashAiT('dashAiPromptTopLimit', 'Top count'))}">
      <button type="button" data-ai-limit-step="-1" aria-label="Decrease">-</button>
      <strong>${_dashAiEsc(String(state.multiLimit))}</strong>
      <button type="button" data-ai-limit-step="1" aria-label="Increase">+</button>
    </div>
  </div>
  <button type="button" class="dash-ai-link-btn" data-ai-apply-top>${_dashAiEsc(_dashAiT('dashAiPromptApplyTop', 'Select top'))}</button>
</div>
<div class="dash-ai-check-list">
  ${state.items.map(item => {
      const checked = state.checkedIds.has(item.id);
      return `<button type="button" class="dash-ai-check${checked ? ' active' : ''}" data-ai-check-toggle="${_dashAiEsc(item.id)}" aria-pressed="${checked ? 'true' : 'false'}">
    <span class="dash-ai-check-box" aria-hidden="true"></span>
    <span class="dash-ai-choice-copy">
      <strong>${_dashAiEsc(_dashAiFindingTitle(item))}</strong>
      <small>${_dashAiEsc(_dashAiFindingMeta(item))}</small>
    </span>
  </button>`;
  }).join('')}
</div>`;
    }

    function _dashAiResultHtml(state) {
        const parsed = state.parsed;
        const streamingPreview = state.busy && state.response
            ? `<pre class="dash-ai-stream-preview">${_dashAiEsc(state.response)}</pre>`
            : '';
        const summary = parsed?.summary
            ? `<section class="dash-ai-result-section"><h4>${_dashAiEsc(_dashAiT('dashAiPromptSummary', 'Verification Summary'))}</h4><pre>${_dashAiEsc(parsed.summary)}</pre></section>`
            : '';
        const prompt = parsed?.prompt
            ? `<section class="dash-ai-result-section"><h4>${_dashAiEsc(_dashAiT('dashAiPromptAgentPrompt', 'Agent Prompt'))}</h4><textarea readonly>${_dashAiEsc(parsed.prompt)}</textarea></section>`
            : '';
        const rawFallback = parsed && !parsed.prompt && parsed.raw
            ? `<section class="dash-ai-result-section"><h4>${_dashAiEsc(_dashAiT('dashAiPromptRawResponse', 'Raw AI Response'))}</h4><pre>${_dashAiEsc(parsed.raw)}</pre></section>`
            : '';
        if (!state.busy && !state.response && !parsed) {
            return `<div class="dash-ai-empty">${_dashAiEsc(_dashAiT('dashAiPromptEmpty', 'Choose a scope, then generate a prompt.'))}</div>`;
        }
        return `${streamingPreview}${summary}${prompt}${rawFallback}`;
    }

    function _dashAiRenderModal() {
        const state = _dashAiState;
        if (!state) return;
        if (!state.modalOpen) return;

        let overlay = document.getElementById(_DASH_AI_MODAL_ID);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = _DASH_AI_MODAL_ID;
            overlay.className = 'dash-ai-modal-overlay';
            overlay.addEventListener('click', _dashAiHandleClick);
            document.body.appendChild(overlay);
        }

        const ready = !!state.ready;
        const canGenerate = ready && !state.configLoading && !state.busy;
        const hasPrompt = !!(state.parsed?.prompt || state.parsed?.raw || state.response);
        const generateLabel = state.response || state.parsed
            ? _dashAiT('dashAiPromptRegenerate', 'Regenerate')
            : _dashAiT('dashAiPromptGenerate', 'Generate');
        const status = state.status || (state.configLoading
            ? _dashAiT('dashAiPromptChecking', 'Checking AI settings...')
            : '');

        overlay.innerHTML = `
<div class="dash-ai-modal" role="dialog" aria-modal="true" aria-labelledby="dash-ai-modal-title">
  <div class="dash-ai-modal-head">
    <div>
      <div class="dash-detail-head-label">${_dashAiEsc(_dashAiT('dashAiPromptButton', 'AI Prompt'))}</div>
      <h3 id="dash-ai-modal-title">${_dashAiEsc(_dashAiT('dashAiPromptTitle', 'AI remediation prompt'))}</h3>
      <p>${_dashAiEsc(state.widgetLabel)} · ${state.items.length} ${_dashAiEsc(_dashAiT('dashAiPromptFindings', 'findings'))}</p>
    </div>
    <button class="dash-detail-close" type="button" data-ai-close aria-label="${_dashAiEsc(_dashAiT('dashAiPromptClose', 'Close'))}">×</button>
  </div>
  <div class="dash-ai-modal-body">
    <section class="dash-ai-config ${ready ? 'is-ready' : 'is-missing'}">
      <div>
        <strong>${_dashAiEsc(ready ? _dashAiT('dashAiPromptReady', 'AI ready') : _dashAiT('dashAiPromptAiMissingTitle', 'AI is not configured'))}</strong>
        <span>${_dashAiEsc(ready ? _dashAiConfigLabel(state.config || {}) : _dashAiT('dashAiPromptAiMissingCopy', 'Configure an API provider or local CLI before generating dashboard AI prompts.'))}</span>
      </div>
      ${ready ? '' : `<button type="button" data-ai-open-settings>${_dashAiEsc(_dashAiT('dashAiPromptOpenSettings', 'Open AI Settings'))}</button>`}
    </section>
    <section class="dash-ai-settings">
      ${_dashAiScopeHtml(state)}
      ${_dashAiSelectionHtml(state)}
    </section>
    <section class="dash-ai-output">
      <div class="dash-ai-status" aria-live="polite">${_dashAiEsc(status)}</div>
      ${state.error ? `<div class="dash-ai-error">${_dashAiEsc(state.error)}</div>` : ''}
      ${_dashAiResultHtml(state)}
    </section>
  </div>
  <div class="dash-ai-modal-foot">
    <button type="button" class="dash-ai-primary" data-ai-generate ${canGenerate ? '' : 'disabled'}>${_dashAiEsc(generateLabel)}</button>
    <button type="button" data-ai-copy ${hasPrompt && !state.busy ? '' : 'disabled'}>${_dashAiEsc(state.copied ? _dashAiT('dashAiPromptCopied', 'Copied') : _dashAiT('dashAiPromptCopy', 'Copy Prompt'))}</button>
    <button type="button" data-ai-close>${_dashAiEsc(_dashAiT('dashAiPromptClose', 'Close'))}</button>
  </div>
</div>`;
    }

    function _dashAiHandleClick(event) {
        if (!_dashAiState) return;
        if (event.target.id === _DASH_AI_MODAL_ID || event.target.closest('[data-ai-close]')) {
            _dashAiClose();
            return;
        }
        const scopeBtn = event.target.closest('[data-ai-scope]');
        if (scopeBtn) {
            _dashAiState.scope = scopeBtn.dataset.aiScope || 'single';
            _dashAiState.error = '';
            _dashAiRenderModal();
            return;
        }
        if (event.target.closest('[data-ai-open-settings]')) {
            _dashAiOpenSettings();
            return;
        }
        const singleOption = event.target.closest('[data-ai-single-option]');
        if (singleOption) {
            _dashAiState.selectedId = singleOption.dataset.aiSingleOption || _dashAiState.selectedId;
            _dashAiState.error = '';
            _dashAiRenderModal();
            return;
        }
        const checkToggle = event.target.closest('[data-ai-check-toggle]');
        if (checkToggle) {
            const id = checkToggle.dataset.aiCheckToggle;
            if (id) {
                if (_dashAiState.checkedIds.has(id)) _dashAiState.checkedIds.delete(id);
                else _dashAiState.checkedIds.add(id);
            }
            _dashAiState.error = '';
            _dashAiRenderModal();
            return;
        }
        const limitStep = event.target.closest('[data-ai-limit-step]');
        if (limitStep) {
            const delta = Number(limitStep.dataset.aiLimitStep || 0);
            const max = _dashAiState.items.length;
            _dashAiState.multiLimit = Math.min(Math.max(Number(_dashAiState.multiLimit || 1) + delta, 1), max);
            _dashAiRenderModal();
            return;
        }
        if (event.target.closest('[data-ai-apply-top]')) {
            const limit = Math.min(Math.max(Number(_dashAiState.multiLimit || _DASH_AI_DEFAULT_MULTI_LIMIT), 1), _dashAiState.items.length);
            _dashAiState.checkedIds = new Set(_dashAiState.items.slice(0, limit).map(item => item.id));
            _dashAiRenderModal();
            return;
        }
        if (event.target.closest('[data-ai-generate]')) {
            _dashAiGenerate();
            return;
        }
        if (event.target.closest('[data-ai-copy]')) {
            _dashAiCopyPrompt();
        }
    }

    window._dashAiPromptExtractors = _dashAiPromptExtractors;
    window._dashAiPromptEnhanceDetail = _dashAiEnhanceDetail;
    window._dashAiPromptOpen = _dashAiOpen;
    window._dashAiPromptSyncIndicators = _dashAiSyncIndicators;

    window.addEventListener('vizAiConfigChanged', event => {
        if (!_dashAiState) return;
        _dashAiState.config = event.detail || {};
        _dashAiState.ready = _dashAiConfigIsReady(_dashAiState.config);
        _dashAiState.error = '';
        _dashAiState.status = _dashAiState.ready
            ? `${_dashAiT('dashAiPromptReady', 'AI ready')}: ${_dashAiConfigLabel(_dashAiState.config)}`
            : _dashAiT('dashAiPromptAiMissingTitle', 'AI is not configured');
        _dashAiRenderModal();
    });
})();
