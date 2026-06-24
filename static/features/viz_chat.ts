// ── VizBridge Chat Panel ──────────────────────────────────────────────────────
//
// Floating AI chat panel for VizCode graph visualization.
// Communicates with server.py via:
//   POST /chat-stream   → SSE streaming response
//   GET  /chat-config   → read provider config
//   POST /chat-config   → save provider config
//
// Public API (called from viz.js):
//   initChat()          — build DOM, attach events
//

(function () {
    'use strict';

            // ── State ─────────────────────────────────────────────────────────────────
    let _isOpen   = false;
    let _isBusy   = false;   // waiting for AI response
    let _history  = [];      // [{role, content}] sent to server
    let _streamBubble = null;        // DOM element currently streaming into
    let _streamText   = '';          // accumulated text for current stream bubble
    let _currentChatProvider = null; // provider name for the current turn
    let _lastTurnHadError = false;   // true if error SSE event was received this turn
    let _cancelStream     = null;    // fn to abort the current SSE stream (set by _readSSE)
    let _thinkLog         = [];      // per-turn process steps (status + tools) shown when the dots are clicked

    // ── Input history (for arrow key navigation) ──────────────────────────────
    let _inputHistory = [];          // array of previously sent user messages
    let _historyIndex = -1;          // current position in history (-1 = not navigating)
    let _tempInput    = '';          // save current input when starting to navigate

    // ── AI-in-canvas integration state ────────────────────────────────────────
    // Registered by the AI via `vizcode_ui_emit_badge`. The markdown post-pass
    // wraps the first occurrence of `label` in each newly rendered AI bubble
    // with a clickable <span class="chat-badge" data-node-id="..."> element.
    const _badgeMap = new Map();     // label -> node_id
    let   _tourSubtitleEl = null;    // floating caption DOM for vizcode_ui_tour_step
    let   _tourSubtitleTimer = null;

    // ── Chat mode state (depth × output) ─────────────────────────────────────
    let _currentDepth  = localStorage.getItem('vizcode.chat.depth')  || 'quick';
    let _currentOutput = localStorage.getItem('vizcode.chat.output') || null;
    // Migrate the legacy Mermaid output mode to the native Cytoscape flow renderer.
    if (_currentOutput === 'mermaid_flow') {
        _currentOutput = 'flow';
        localStorage.setItem('vizcode.chat.output', 'flow');
    }
    let _modePickerOpen = false;

    // ── Session state ─────────────────────────────────────────────────────────
    let _currentSessionId = null;
    let _sessionsOpen     = false;

    // ── DOM refs (populated in initChat) ─────────────────────────────────────
    let _btn, _panel, _msgs, _input, _sendBtn, _modal;
    let _chatCfgSnapshot = {};
    let _chatIsConfigured = null;

    // ── Drag state ────────────────────────────────────────────────────────────
    let _isDragging = false;
    let _dragOffsetX = 0;
    let _dragOffsetY = 0;

    // ── Panel mode ('side' | 'float') ────────────────────────────────────────
    // 'side' = docked right-side panel (Mode 1, default)
    // 'float' = free-floating window (Mode 2)
    let _panelMode = localStorage.getItem('vizcode.chat.panelMode') || 'side';

    // ── Markdown-lite renderer ────────────────────────────────────────────────
    // Handles: ```vizflow blocks, ``` code blocks, `inline code`, **bold**, *italic*
    //
    // Flow blocks (vizflow JSON, or a Mermaid flowchart/graph block) are
    // extracted BEFORE HTML escaping so their raw source is preserved verbatim
    // inside .chat-flow divs. _renderPendingFlows() draws them with Cytoscape +
    // dagre once the panel is visible — same engine/theme as the main graph,
    // no external library (Mermaid syntax is parsed locally, not rendered by it).
    function _renderMarkdown(text) {
        // 1. Extract vizflow / mermaid fences first, replace with placeholders
        const flowBlocks = [];
        let t = text.replace(/```(?:vizflow|mermaid)\n?([\s\S]*?)```/g, function (_, code) {
            const idx = flowBlocks.length;
            flowBlocks.push(code.trim());
            return '\x00MM' + idx + '\x00';
        });

        // 2. Escape HTML
        t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // 3. Other fenced code blocks (```lang\n...\n```)
        t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
            const cls = lang ? ` class="language-${lang}"` : '';
            return `<pre><code${cls}>${code.trimEnd()}</code></pre>`;
        });

        // 4. Inline code
        t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');

        // 5. Bold
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // 6. Italic (single *)
        t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

        // 7. Substitute flow placeholders back with .chat-flow divs.
        //    The div textContent is the raw JSON source (browser decodes entities);
        //    _renderFlowEl() parses it once the block is complete.
        t = t.replace(/\x00MM(\d+)\x00/g, function (_, idx) {
            const src = flowBlocks[Number(idx)] || '';
            const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div class="chat-flow">${esc}</div>`;
        });

        // 8. Paragraphs (double newline)
        t = t.replace(/\n{2,}/g, '</p><p>');
        // 9. Wrap AI-registered labels as clickable badges (first occurrence only).
        t = _applyBadges(t);
        return '<p>' + t + '</p>';
    }

    // Wrap the first occurrence of each registered label as a .chat-badge span.
    // Skips matches that are already inside a tag (avoids badgifying tag names
    // or attributes). Longer labels are processed first so that, e.g., a label
    // "ai/vizbridge.py::stream_response" is matched before the shorter
    // "ai/vizbridge.py" swallows it.
    function _applyBadges(html) {
        if (!_badgeMap.size) return html;
        const labels = Array.from(_badgeMap.keys()).sort((a, b) => b.length - a.length);
        for (const label of labels) {
            const nodeId = _badgeMap.get(label);
            if (!label || !nodeId) continue;
            const safe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Only match outside existing tags (no < before the match on the same line fragment).
            const re = new RegExp('(^|[^<\\w/])(' + safe + ')(?![\\w/])');
            const idAttr    = nodeId.replace(/"/g, '&quot;');
            const labelAttr = label.replace(/"/g, '&quot;');
            html = html.replace(re, (_, pre, body) =>
                pre + `<span class="chat-badge" data-node-id="${idAttr}" data-label="${labelAttr}">${body}</span>`
            );
        }
        return html;
    }

        // ── Panel open / close ───────────────────────────────────────────────────
    const _CHAT_PANEL_TRANSITION_MS = 200;
    let _chatResizerHideTimer = null;

    function _open() {
        _isOpen = true;
        if (_chatResizerHideTimer) {
            clearTimeout(_chatResizerHideTimer);
            _chatResizerHideTimer = null;
        }
        _panel.classList.add('open');
        if (_panelMode === 'side' && _chatResizer) _chatResizer.style.display = 'block';
        _btn.classList.add('active');
        _updateButtonIcon();
        _checkConfig();
        // Draw any flow blocks that were restored while the panel was hidden
        // (Cytoscape can only measure the container once it is visible).
        _triggerFlowsIfNeeded();
        setTimeout(() => _input.focus(), 220);
    }

    function _close() {
        _isOpen = false;
        _panel.classList.remove('open');
        if (_panelMode === 'side' && _chatResizer) {
            _chatResizer.style.display = 'block';
            if (_chatResizerHideTimer) clearTimeout(_chatResizerHideTimer);
            _chatResizerHideTimer = setTimeout(() => {
                if (!_isOpen && _chatResizer) _chatResizer.style.display = 'none';
                _chatResizerHideTimer = null;
            }, _CHAT_PANEL_TRANSITION_MS);
        } else if (_chatResizer) {
            _chatResizer.style.display = 'none';
        }
        _btn.classList.remove('active');
        _updateButtonIcon();
    }

    function _updateButtonIcon() {
        const svg = _isOpen
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        _btn.innerHTML = svg + `<span>AI Chat</span>`;
    }

    function toggleChatPanel() {
        _isOpen ? _close() : _open();
    }

    // ── Message DOM helpers ───────────────────────────────────────────────────
    function _appendMsg(role, htmlContent) {
        const div = document.createElement('div');
        div.className = role === 'user' ? 'chat-msg chat-msg-user'
                      : role === 'sys'  ? 'chat-msg-sys'
                      : role === 'err'  ? 'chat-msg-err'
                      : 'chat-msg chat-msg-ai';
        if (role === 'user' || role === 'sys' || role === 'err') {
            div.textContent = htmlContent;  // safe
        } else {
            div.innerHTML = htmlContent;    // pre-rendered markdown
        }
        _msgs.appendChild(div);
        _scrollBottom();
        return div;
    }

    function _appendToolBadge(name, result) {
        const badge = document.createElement('div');
        badge.className = 'chat-tool-badge';
        badge.innerHTML = `<span class="tool-icon">🔍</span><span>${_escHtml(name)}</span>`;

        const resultBox = document.createElement('pre');
        resultBox.className = 'chat-tool-result';
        resultBox.textContent = result;

        badge.addEventListener('click', function () {
            resultBox.classList.toggle('show');
        });

        _msgs.appendChild(badge);
        _msgs.appendChild(resultBox);
        _scrollBottom();
    }

    function _appendTyping() {
        const div = document.createElement('div');
        div.className = 'chat-typing';
        div.id = '_chat-typing';
        div.innerHTML =
            '<div class="chat-typing-dots"><span></span><span></span><span></span></div>' +
            '<div class="chat-think-log" hidden></div>';
        // Click the dots to reveal / hide what the AI is actually doing this turn
        // (tool calls + status steps captured in _thinkLog). No steps yet → no-op.
        div.querySelector('.chat-typing-dots').addEventListener('click', function () {
            const log = div.querySelector('.chat-think-log');
            if (!log || !_thinkLog.length) return;
            if (log.hasAttribute('hidden')) {
                log.removeAttribute('hidden');
                div.classList.add('open');
                log.scrollTop = log.scrollHeight;
            } else {
                log.setAttribute('hidden', '');
                div.classList.remove('open');
            }
            _scrollBottom();
        });
        _msgs.appendChild(div);
        _renderThinkLog();   // restore any steps already collected before the dots existed
        _scrollBottom();
        return div;
    }

    function _removeTyping() {
        const el = document.getElementById('_chat-typing');
        if (el) el.remove();
    }

    // Record one process step and reflect it in the (possibly open) log panel.
    function _pushThink(text) {
        text = String(text == null ? '' : text).trim();
        if (!text) return;
        if (_thinkLog.length && _thinkLog[_thinkLog.length - 1] === text) return;  // collapse repeats
        _thinkLog.push(text);
        _renderThinkLog();
    }

    function _renderThinkLog() {
        const typing = document.getElementById('_chat-typing');
        if (!typing) return;
        const log = typing.querySelector('.chat-think-log');
        if (!log) return;
        if (!_thinkLog.length) {
            typing.classList.remove('has-think');
            return;
        }
        typing.classList.add('has-think');
        typing.title = _t('chatThinkHint', 'Click to see what the AI is doing');
        log.innerHTML = _thinkLog.map(function (s) {
            return '<div class="chat-think-step">' + _escHtml(s) + '</div>';
        }).join('');
        if (!log.hasAttribute('hidden')) log.scrollTop = log.scrollHeight;
    }

    function _startStreamBubble() {
        _streamText   = '';
        _streamBubble = document.createElement('div');
        _streamBubble.className = 'chat-msg chat-msg-ai';
        _msgs.appendChild(_streamBubble);
        _scrollBottom();
    }

    function _appendStreamDelta(text) {
        _streamText += text;
        // Flow blocks stay as a light placeholder while streaming; we draw them
        // once at finalise (re-instantiating Cytoscape per delta would thrash).
        _streamBubble.innerHTML = _renderMarkdown(_streamText);
        _scrollBottom();
    }

    function _finaliseStreamBubble() {
        // Draw any ```vizflow blocks now that the JSON is complete.
        _triggerFlowsIfNeeded();
        // A block that never parsed (malformed JSON) is final → show its source.
        if (_isOpen && _msgs) {
            _msgs.querySelectorAll('.chat-flow:not([data-rendered])').forEach(_showFlowSource);
        }
        _streamBubble = null;
        _streamText   = '';
    }

    function _scrollBottom() {
        _msgs.scrollTop = _msgs.scrollHeight;
    }

    function _escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function _chatProviderHasCredential(provider, cfg) {
        if (provider === 'anthropic') return !!cfg.anthropic_api_key_present;
        if (provider === 'openai') return !!cfg.openai_api_key_present;
        if (provider === 'grok') return !!cfg.grok_api_key_present;
        if (provider === 'gemini') return !!cfg.gemini_api_key_present;
        if (provider === 'ollama') return !!cfg.ollama_url_present;
        if (provider === 'custom') return !!cfg.custom_api_key_present;
        return false;
    }

    function _chatConfigIsReady(cfg) {
        if (!cfg) return false;
        if ((cfg.ai_mode || 'api') === 'cli') return !!(cfg.cli_agent || 'claude');
        return _chatProviderHasCredential(cfg.provider || 'anthropic', cfg);
    }

    function _openAiSettingsFromChat() {
        if (typeof window.openAiSettings === 'function') {
            window.openAiSettings();
            return;
        }
        const prefBtn = document.getElementById('pref-btn');
        if (prefBtn) {
            prefBtn.click();
            setTimeout(() => {
                try { if (typeof _activatePrefSection === 'function') _activatePrefSection('ai'); } catch (_) {}
            }, 80);
        }
    }

    function _appendSetupGuide() {
        if (!_msgs || document.getElementById('chat-setup-card')) return;
        const card = document.createElement('div');
        card.id = 'chat-setup-card';
        card.className = 'chat-setup-card';
        card.innerHTML = `
          <div class="chat-setup-title">${_escHtml(_t('chatSetupRequiredTitle', 'AI is not configured'))}</div>
          <div class="chat-setup-copy">${_escHtml(_t('chatSetupRequiredCopy', 'Choose an API provider or Local CLI before using chat.'))}</div>
          <button type="button" class="chat-setup-btn">${_escHtml(_t('chatSetupRequiredAction', 'Open AI Settings'))}</button>`;
        card.querySelector('.chat-setup-btn')?.addEventListener('click', _openAiSettingsFromChat);
        _msgs.appendChild(card);
        _scrollBottom();
    }

    // ── Native flow diagrams: render `vizflow` JSON via Cytoscape + dagre ──────
    // The AI emits a ```vizflow fenced JSON block ({direction, title, nodes,
    // edges}). We draw it inline with the same engine and theme as the main
    // graph, so the style is consistent and a node carrying a `ref` deep-links
    // into the real canvas (ref → window.cy node id). Cytoscape and the dagre
    // layout are already loaded on the analysis page — no external library.
    const _FLOW_MAX_NODES = 80;

    function _flowTheme() {
        const cs  = getComputedStyle(document.documentElement);
        const get = function (v, d) { return cs.getPropertyValue(v).trim() || d; };
        return {
            bg:     get('--bg',     '#0f110e'),
            panel2: get('--panel2', '#1b1c19'),
            border: get('--border', '#2c2d2a'),
            accent: get('--accent', '#dfa745'),
            text:   get('--text',   '#eae8e3'),
            muted:  get('--muted',  '#93918b'),
        };
    }

    // kind → node accent colour. Unknown kinds fall back to the neutral border.
    function _flowKindColor(kind, theme) {
        switch (String(kind || '').toLowerCase()) {
            case 'entry':    return theme.accent;
            case 'exit':     return '#e0795b';
            case 'decision': return '#c9a227';
            case 'io':
            case 'data':     return '#5b8def';
            default:         return theme.border;   // process
        }
    }

    // Parse the common Mermaid `flowchart`/`graph` subset into a vizflow spec, so
    // models that emit Mermaid (their default) still render natively. Handles node
    // shapes [..] (..) {..}, edges --> --- -.-> ==>, and |edge labels|. Returns
    // null when the source is not a Mermaid flow diagram.
    function _parseMermaidFlow(src) {
        const text = String(src || '').replace(/<br\s*\/?>/gi, ' ');
        if (!/^\s*(flowchart|graph)\b/i.test(text)) return null;

        const ARROW      = /\s*(-->|---|-\.->|-\.-|==>|===|--[xo]|==[xo])\s*/;
        const ARROW_ONLY = /^(-->|---|-\.->|-\.-|==>|===|--[xo]|==[xo])$/;
        let direction = 'TB';
        const nodes = new Map();
        const edges = [];

        function reg(token) {
            const m = String(token).trim().match(/^([A-Za-z0-9_]+)\s*([\s\S]*)$/);
            if (!m) return null;
            const id = m[1];
            let label = id, kind = 'process';
            const rest = m[2].trim();
            if (rest) {
                const sh = rest.match(/^(\{\{[\s\S]*\}\}|\{[\s\S]*\}|\(\[[\s\S]*\]\)|\[\([\s\S]*\)\]|\[\[[\s\S]*\]\]|\[[\s\S]*\]|\([\s\S]*\))$/);
                if (sh) {
                    const inner = sh[1];
                    if (inner.charAt(0) === '{') kind = 'decision';
                    label = inner.replace(/^[\[\(\{]+/, '').replace(/[\]\)\}]+$/, '')
                                 .replace(/^["']|["']$/g, '').trim() || id;
                }
            }
            if (!nodes.has(id)) {
                nodes.set(id, { id: id, label: label, kind: kind });
            } else {
                const n = nodes.get(id);
                if (label !== id && n.label === id) n.label = label;
                if (kind === 'decision') n.kind = 'decision';
            }
            return id;
        }

        text.split(/\r?\n/).forEach(function (raw) {
            let line = raw.trim();
            if (!line) return;
            const dm = line.match(/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/i);
            if (dm) { const d = dm[1].toUpperCase(); direction = (d === 'LR' || d === 'RL') ? 'LR' : 'TB'; return; }
            if (/^(flowchart|graph)\b/i.test(line)) return;
            if (/^(subgraph|end|classDef|class|style|linkStyle|click|direction|%%)/i.test(line)) return;
            line = line.replace(/;+\s*$/, '');

            const segs = line.split(ARROW);
            let prevId = null;
            for (let i = 0; i < segs.length; i++) {
                let seg = (segs[i] || '').trim();
                if (!seg || ARROW_ONLY.test(seg)) continue;     // skip connector tokens
                let label = '';
                const lm = seg.match(/^\|([^|]*)\|\s*([\s\S]*)$/);   // |edge label| node
                if (lm) { label = lm[1].trim(); seg = lm[2].trim(); }
                if (!seg) continue;
                const id = reg(seg);
                if (id && prevId) edges.push({ from: prevId, to: id, label: label });
                if (id) prevId = id;
            }
        });

        if (!nodes.size) return null;
        return { direction: direction, nodes: Array.from(nodes.values()), edges: edges };
    }

    function _buildFlowElements(spec, theme) {
        const els = [];
        const ids = new Set();
        (spec.nodes || []).slice(0, _FLOW_MAX_NODES).forEach(function (n) {
            if (!n || n.id == null) return;
            const id = String(n.id);
            if (ids.has(id)) return;
            ids.add(id);
            els.push({ data: {
                id:     id,
                label:  String(n.label != null ? n.label : id),
                ref:    n.ref ? String(n.ref) : '',
                accent: _flowKindColor(n.kind, theme),
                shape:  String(n.kind || '').toLowerCase() === 'decision'
                            ? 'round-diamond' : 'round-rectangle',
            }});
        });
        (spec.edges || []).forEach(function (e) {
            if (!e) return;
            const s = String(e.from != null ? e.from : e.source);
            const t = String(e.to   != null ? e.to   : e.target);
            if (!ids.has(s) || !ids.has(t)) return;
            els.push({ data: { source: s, target: t, label: e.label ? String(e.label) : '' } });
        });
        return els;
    }

    // ── Reusable Cytoscape builder for chat flow diagrams ─────────────────────
    // Both the inline card and the enlarge-overlay use this so style + behaviour
    // (deep-link on `ref` tap) stay in sync; only sizing/interactivity differ.
    function _flowStyle(theme, opts) {
        opts = opts || {};
        return [
            { selector: 'node', style: {
                'background-color': theme.panel2,
                'border-color':     'data(accent)',
                'border-width':     1.5,
                'shape':            'data(shape)',
                'label':            'data(label)',
                'color':            theme.text,
                'font-size':        opts.fontSize || 11,
                'font-family':      "'Segoe UI', system-ui, sans-serif",
                'text-valign':      'center',
                'text-halign':      'center',
                'text-wrap':        'wrap',
                'text-max-width':   opts.maxWidth || 120,
                'width':            'label',
                'height':           'label',
                'padding':          opts.padding || '8px',
            }},
            { selector: 'node[ref != ""]', style: { 'cursor': 'pointer' } },
            { selector: 'edge', style: {
                'width':                   1.4,
                'line-color':              theme.muted,
                'target-arrow-color':      theme.muted,
                'target-arrow-shape':      'triangle',
                'arrow-scale':             0.9,
                'curve-style':             'bezier',
                'label':                   'data(label)',
                'font-size':               opts.edgeFontSize || 9.5,
                'color':                   theme.muted,
                'text-background-color':   theme.bg,
                'text-background-opacity': 1,
                'text-background-padding': '2px',
            }},
        ];
    }

    // Build a Cytoscape instance into `host`. Returns the instance, or null if
    // Cytoscape is unavailable or no layout could run (caller shows the source).
    function _makeFlowCy(host, els, rankDir, theme, opts) {
        opts = opts || {};
        let cy;
        try {
            cy = window.cytoscape({
                container: host,
                elements:  els,
                style:     _flowStyle(theme, opts),
                userZoomingEnabled:  !!opts.interactive,
                userPanningEnabled:  !!opts.interactive,
                boxSelectionEnabled: false,
                autoungrabify:       !opts.interactive,
                minZoom:             0.2,
                maxZoom:             3,
            });
        } catch (_) { return null; }

        function _runLayout(name, extra) {
            const lay = cy.layout(Object.assign({ name: name }, extra || {}));
            lay.one('layoutstop', function () { try { cy.fit(undefined, opts.fitPadding || 16); } catch (_) {} });
            lay.run();
        }
        try {
            _runLayout('dagre', { rankDir: rankDir, nodeSep: 28, rankSep: 42, edgeSep: 12 });
        } catch (_) {
            // dagre plugin unavailable → fall back to a built-in directed layout
            try { _runLayout('breadthfirst', { directed: true, spacingFactor: 1.1 }); }
            catch (e2) { try { cy.destroy(); } catch (_) {} return null; }
        }

        cy.on('tap', 'node', function (evt) {
            const ref = evt.target.data('ref');
            if (ref) _highlightNodeById(ref);
        });
        return cy;
    }

    const _FLOW_EXPAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    const _FLOW_CLOSE_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    // Enlarge overlay: same spec, drawn big and fully zoom/pan-able with controls.
    function _openFlowModal(spec) {
        if (!spec || typeof window.cytoscape !== 'function') return;
        const prev = document.getElementById('chat-flow-modal');
        if (prev) prev.remove();

        const theme   = _flowTheme();
        const overlay = document.createElement('div');
        overlay.id = 'chat-flow-modal';
        overlay.className = 'chat-flow-modal';

        const panel = document.createElement('div');
        panel.className = 'chat-flow-modal-panel';

        const head = document.createElement('div');
        head.className = 'chat-flow-modal-head';
        const ttl = document.createElement('span');
        ttl.className = 'chat-flow-modal-title';
        ttl.textContent = spec.title ? String(spec.title) : _t('chatFlowDiagram', 'Flow diagram');
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'chat-flow-modal-close';
        closeBtn.title = _t('chatFlowClose', 'Close');
        closeBtn.setAttribute('aria-label', _t('chatFlowClose', 'Close'));
        closeBtn.innerHTML = _FLOW_CLOSE_SVG;
        head.appendChild(ttl);
        head.appendChild(closeBtn);

        const host = document.createElement('div');
        host.className = 'chat-flow-modal-canvas';

        const ctrls = document.createElement('div');
        ctrls.className = 'chat-flow-modal-ctrls';

        panel.appendChild(head);
        panel.appendChild(host);
        panel.appendChild(ctrls);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const els     = _buildFlowElements(spec, theme);
        const dir     = String(spec.direction || 'TB').toUpperCase();
        const rankDir = (dir === 'LR' || dir === 'RL') ? 'LR' : 'TB';
        const cy = _makeFlowCy(host, els, rankDir, theme, {
            interactive: true, fontSize: 16, edgeFontSize: 12.5,
            maxWidth: 220, padding: '12px', fitPadding: 32,
        });

        function _zoomBy(factor) {
            if (!cy) return;
            const next = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
            cy.zoom({ level: next, renderedPosition: { x: host.clientWidth / 2, y: host.clientHeight / 2 } });
        }
        function _mkCtrl(label, title, fn) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.title = title;
            b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
            ctrls.appendChild(b);
        }
        _mkCtrl('+',        _t('chatFlowZoomIn',  'Zoom in'),     function () { _zoomBy(1.25); });
        _mkCtrl('−',   _t('chatFlowZoomOut', 'Zoom out'),    function () { _zoomBy(0.8); });
        _mkCtrl('⤢',   _t('chatFlowFit',     'Fit to view'), function () { if (cy) { try { cy.fit(undefined, 32); } catch (_) {} } });

        function _close() {
            try { if (cy) cy.destroy(); } catch (_) {}
            document.removeEventListener('keydown', _onKey);
            overlay.remove();
        }
        function _onKey(e) { if (e.key === 'Escape') _close(); }
        closeBtn.addEventListener('click', _close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) _close(); });
        document.addEventListener('keydown', _onKey);
    }

    function _showFlowSource(el) {
        const src = el.dataset.src || el.textContent || '';
        el.setAttribute('data-rendered', '1');
        el.classList.add('chat-flow-fallback');
        el.innerHTML = '<pre>' + _escHtml(src) + '</pre>';
    }

    // Returns true once the block is rendered (or shown as source); false while
    // the JSON is still incomplete (streaming) so it can be retried later.
    function _renderFlowEl(el) {
        if (typeof window.cytoscape !== 'function') { _showFlowSource(el); return true; }

        const raw = (el.dataset.src || el.textContent || '').trim();
        let spec = null;
        try { spec = JSON.parse(raw); } catch (_) { spec = null; }   // vizflow JSON
        if (!spec || typeof spec !== 'object' || !Array.isArray(spec.nodes)) {
            // Not vizflow JSON — try the Mermaid flowchart/graph subset.
            try { spec = _parseMermaidFlow(raw); } catch (_) { spec = null; }
        }
        if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) return false;

        const theme = _flowTheme();
        const els   = _buildFlowElements(spec, theme);
        if (!els.length) { el.dataset.src = raw; _showFlowSource(el); return true; }

        if (el.__cy) { try { el.__cy.destroy(); } catch (_) {} el.__cy = null; }
        el.dataset.src = raw;            // keep source for the fallback path
        el.textContent = '';
        el.setAttribute('data-rendered', '1');

        if (spec.title) {
            const cap = document.createElement('div');
            cap.className = 'chat-flow-title';
            cap.textContent = String(spec.title);
            el.appendChild(cap);
        }
        const host = document.createElement('div');
        host.className = 'chat-flow-canvas';
        el.appendChild(host);

        const dir     = String(spec.direction || 'TB').toUpperCase();
        const rankDir = (dir === 'LR' || dir === 'RL') ? 'LR' : 'TB';

        const cy = _makeFlowCy(host, els, rankDir, theme, { interactive: false });
        if (!cy) { _showFlowSource(el); return true; }
        el.__cy = cy;

        // "Enlarge" affordance → reopen the same diagram large & zoomable in an
        // overlay (the inline copy keeps small, readable labels by default).
        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'chat-flow-expand';
        expandBtn.title = _t('chatFlowExpand', 'Enlarge diagram');
        expandBtn.setAttribute('aria-label', _t('chatFlowExpand', 'Enlarge diagram'));
        expandBtn.innerHTML = _FLOW_EXPAND_SVG;
        expandBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            _openFlowModal(spec);
        });
        el.appendChild(expandBtn);
        return true;
    }

    function _renderPendingFlows() {
        const nodes = _msgs.querySelectorAll('.chat-flow:not([data-rendered])');
        if (!nodes.length) return;
        nodes.forEach(function (el) {
            try { _renderFlowEl(el); } catch (_) { /* retry on next pass */ }
        });
        _scrollBottom();
    }

    function _triggerFlowsIfNeeded() {
        // Wait until the panel is visible — Cytoscape needs a measurable container.
        if (!_msgs || !_isOpen) return;
        if (!_msgs.querySelector('.chat-flow:not([data-rendered])')) return;
        _renderPendingFlows();
    }

    // ── Canvas action dispatch (invoked on SSE `ui_action` events) ────────────
    function _appendUiActionBadge(action, args) {
        const div = document.createElement('div');
        div.className = 'chat-ui-action';
        const val = args && Object.keys(args).length
            ? ' ' + Object.values(args).map(function (v) { return String(v); }).join(' → ')
            : '';
        div.textContent = '→ canvas: ' + action + val;
        _msgs.appendChild(div);
        _scrollBottom();
    }

    function _dispatchUiAction(action, args) {
        args = args || {};
        const toast = (typeof window.showToast === 'function')
            ? window.showToast
            : function () {};

        try {
            switch (action) {
                case 'goto_l0':
                    if (typeof window.loadLevel0 === 'function') {
                        window.loadLevel0();
                        toast('AI: switched to L0 overview', 'info');
                    }
                    break;

                case 'goto_l1': {
                    const mod = args.module || '';
                    if (mod && typeof window.drillToModule === 'function') {
                        window.drillToModule(mod);
                        toast('AI: opened module ' + mod, 'info');
                    }
                    break;
                }

                case 'goto_l2': {
                    const f = args.file || '';
                    if (f && typeof window.drillToFile === 'function') {
                        window.drillToFile(f);
                        toast('AI: opened ' + f, 'info');
                    }
                    break;
                }

                case 'highlight_node':
                    _highlightNodeById(args.node_id || '');
                    break;

                case 'highlight_nodes':
                    if (Array.isArray(args.node_ids) && typeof window.highlightNodes === 'function') {
                        // Map AI-supplied paths/'path::func' to real cy ids first —
                        // window.highlightNodes only matches by raw id or label.
                        const realIds = [];
                        args.node_ids.forEach(function (nid) {
                            const n = _resolveCanvasNode(nid);
                            if (n && n.length) realIds.push((n.length > 1 ? n.first() : n).id());
                        });
                        if (realIds.length) window.highlightNodes(realIds);
                        else _canvasMissToast((args.node_ids[0] || '') + ' …');
                    }
                    break;

                case 'highlight_path':
                    _highlightPath(args.source || '', args.target || '');
                    break;

                case 'emit_badge':
                    // Register mapping; rendering happens in _applyBadges on next _renderMarkdown pass.
                    if (args.label && args.node_id) {
                        _badgeMap.set(String(args.label), String(args.node_id));
                    }
                    // Re-render current streaming bubble so pre-existing text gets badgified
                    // if the AI already wrote the label before calling emit_badge.
                    if (_streamBubble && _streamText) {
                        _streamBubble.innerHTML = _renderMarkdown(_streamText);
                    }
                    break;

                case 'tour_step':
                    _runTourStep(args.node_id || '', args.caption || '');
                    break;

                case 'noop':
                    break;

                default:
                    console.warn('[VizBridge] unknown ui_action:', action);
            }
        } catch (err) {
            console.error('[VizBridge] ui_action dispatch failed:', err);
        }

        // Don't dump noise into the chat for every badge registration.
        if (action !== 'emit_badge') _appendUiActionBadge(action, args);
    }

    // Resolve an AI-supplied node_id to the matching cy node(s).
    // The AI addresses nodes by file path ('ai/vizbridge.py') or 'path::func' per the
    // tool contract, but cy ids are internal ('f37', 'fn-0'); match on the structured
    // data fields the renderer stores (_f / fn / label) rather than the raw id.
    // Returns a cy collection (possibly empty), or null when cy isn't ready.
    function _resolveCanvasNode(id) {
        const cy = window.cy;
        if (!id || !cy) return null;

        // 1. Exact cy id — covers L0 module nodes whose id IS the module name.
        const direct = cy.getElementById(id);
        if (direct && direct.length) return direct;

        // 2. 'path::func' → an L2 function node (data._f = file path, data.fn = func name).
        const sep = id.indexOf('::');
        if (sep !== -1) {
            const path = id.slice(0, sep);
            const fn   = id.slice(sep + 2);
            let m = cy.nodes().filter(function (n) {
                return n.data('_t') === 'func' && n.data('_f') === path
                    && (n.data('fn') === fn || n.data('label') === fn);
            });
            if (m.length) return m;
            // Func-name only — whichever file's L2 view happens to be open.
            m = cy.nodes().filter(function (n) {
                return n.data('_t') === 'func' && (n.data('fn') === fn || n.data('label') === fn);
            });
            if (m.length) return m;
        }

        // 3. File path → an L1 file node (data._f = {path, ...}).
        const byPath = cy.nodes().filter(function (n) {
            const f = n.data('_f');
            return n.data('_t') === 'file' && f && f.path === id;
        });
        if (byPath.length) return byPath;

        // 4. Bare label or raw data id.
        const byLabel = cy.nodes().filter(function (n) {
            return n.data('label') === id || n.data('id') === id;
        });
        if (byLabel.length) return byLabel;

        // 5. Last resort: a path's basename matching a node label ('a/b.py' → 'b.py').
        const base = id.indexOf('/') !== -1 ? id.split('/').pop() : '';
        if (base) {
            const byBase = cy.nodes().filter(function (n) { return n.data('label') === base; });
            if (byBase.length) return byBase;
        }

        return cy.collection();
    }

    // When a node_id isn't on the current canvas, drive the canvas to the level
    // where it lives so a follow-up resolve can find it. Returns true if a
    // navigation was triggered (caller should retry after the layout settles).
    function _navigateToNodeId(id) {
        if (!id) return false;
        const sep = id.indexOf('::');
        // 'path::func' → open that file's L2 function view.
        if (sep !== -1) {
            const path = id.slice(0, sep);
            if (path && typeof window.drillToFile === 'function') {
                try { window.drillToFile(path); return true; } catch (_) {}
            }
            return false;
        }
        // File path → open its module's L1, focused on the file node.
        if (/\.[A-Za-z0-9]+$/.test(id)) {
            const mod = (window.DATA && window.DATA.file_to_module && window.DATA.file_to_module[id])
                || (typeof window.resolveModuleForFile === 'function' ? window.resolveModuleForFile(id) : '');
            if (mod && typeof window.drillToModule === 'function') {
                try { window.drillToModule(mod, { focusFile: id }); return true; } catch (_) {}
            }
        }
        return false;
    }

    function _canvasMissToast(nodeId) {
        if (typeof window.showToast === 'function') {
            window.showToast('AI 導覽找不到節點:' + nodeId, 'info');
        }
        console.warn('[VizBridge] node not found on canvas:', nodeId);
    }

    // Pan camera to a node, pin it, and show a floating subtitle card beside it.
    function _runTourStep(nodeId, caption) {
        if (!nodeId || !window.cy) return;
        const node = _resolveCanvasNode(nodeId);
        if (node && node.length) {
            _focusTourNode(node.length > 1 ? node.first() : node, caption);
            return;
        }
        // Not on the current canvas — navigate to where it lives, then retry once
        // after the level switch + layout settle.
        if (_navigateToNodeId(nodeId)) {
            setTimeout(function () {
                const n2 = _resolveCanvasNode(nodeId);
                if (n2 && n2.length) _focusTourNode(n2.length > 1 ? n2.first() : n2, caption);
                else _canvasMissToast(nodeId);
            }, 700);
        } else {
            _canvasMissToast(nodeId);
        }
    }

    function _focusTourNode(node, caption) {
        const cy = window.cy;
        const targetZoom = Math.max(cy.zoom(), 1.6);
        cy.animate(
            { center: { eles: node }, zoom: targetZoom },
            { duration: 500, easing: 'ease-in-out-cubic' }
        );
        if (typeof window.pinHighlightNode === 'function') {
            try { window.pinHighlightNode(node); } catch (_) {}
        }
        if (caption) _showTourSubtitle(node, caption);
    }

    // Floating caption that sits near the focused node for ~3 s, replacing the
    // previous step's caption. Absolute position tracks the node's rendered
    // screen coords; kept simple (no pan/zoom live follow).
    function _showTourSubtitle(node, caption) {
        if (!_tourSubtitleEl) {
            _tourSubtitleEl = document.createElement('div');
            _tourSubtitleEl.className = 'tour-subtitle';
            document.body.appendChild(_tourSubtitleEl);
        }
        _tourSubtitleEl.textContent = caption;
        _tourSubtitleEl.style.opacity = '1';

        // Position after the camera animation settles so coords are final.
        setTimeout(() => {
            if (!_tourSubtitleEl || !node || !node.length) return;
            const rp = node.renderedPosition();
            const cyContainer = window.cy && window.cy.container();
            const rect = cyContainer ? cyContainer.getBoundingClientRect() : { left: 0, top: 0 };
            _tourSubtitleEl.style.left = (rect.left + rp.x + 16) + 'px';
            _tourSubtitleEl.style.top  = (rect.top  + rp.y - 8)  + 'px';
        }, 520);

        if (_tourSubtitleTimer) clearTimeout(_tourSubtitleTimer);
        _tourSubtitleTimer = setTimeout(() => {
            if (_tourSubtitleEl) _tourSubtitleEl.style.opacity = '0';
        }, 3500);
    }

    function _highlightNodeById(id) {
        if (!id || !window.cy) return;
        const node = _resolveCanvasNode(id);
        if (node && node.length && typeof window.highlightNode === 'function') {
            window.highlightNode(node.length > 1 ? node.first() : node);
        } else {
            _canvasMissToast(id);
        }
    }

    function _highlightPath(src, tgt) {
        if (!src || !tgt || !window.cy) return;
        const cy = window.cy;
        const s = _resolveCanvasNode(src);
        const t = _resolveCanvasNode(tgt);
        if (!s || !s.length || !t || !t.length) {
            _canvasMissToast(!s || !s.length ? src : tgt);
            return;
        }
        try {
            const sRoot = s.length > 1 ? s.first() : s;
            const tNode = t.length > 1 ? t.first() : t;
            const dj   = cy.elements().dijkstra({ root: sRoot, directed: false });
            const path = dj.pathTo(tNode);
            if (!path || !path.length) return;
            // Reuse the existing .hl class already defined in CY_STYLE.
            cy.elements().removeClass('hl');
            path.addClass('hl');
        } catch (e) {
            console.warn('[VizBridge] highlight_path failed:', e);
        }
    }

        // ── Send message ─────────────────────────────────────────────────────────
    function _sendMessage() {
        const text = _input.value.trim();
        if (!text || _isBusy) return;
        if (_chatIsConfigured === false) {
            _appendSetupGuide();
            return;
        }

        // New turn: drop stale badge mappings so labels that collided with a
        // previous turn's node_id don't leak into this response.
        _badgeMap.clear();

        _input.value = '';
        _input.style.height = '';   // reset auto-grow
        _appendMsg('user', text);

        // Add to input history (for arrow key recall)
        _inputHistory.push(text);
        _historyIndex = -1;  // reset navigation state
        _tempInput = '';

        _history.push({ role: 'user', content: text });
        _setBusy(true);

        const jobId = window.JOB_ID || '';
        const body  = JSON.stringify({
            job_id:  jobId,
            history: _history,
            depth:   _currentDepth,
            output:  _currentOutput,
        });

        _thinkLog = [];
        _removeTyping();
        _appendTyping();

        fetch('/chat-stream', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    body,
        }).then(function (resp) {
            if (!resp.ok) {
                return resp.json().then(function (err) {
                    throw new Error(err.error || 'Server error ' + resp.status);
                });
            }
            _readSSE(resp.body);
        }).catch(function (err) {
            _removeTyping();
            _appendMsg('err', 'Error: ' + err.message);
            _setBusy(false);
        });
    }

    // ── SSE reader (ReadableStream) ───────────────────────────────────────────
    function _readSSE(readableStream) {
        _currentChatProvider = null; // reset for this turn
        _lastTurnHadError = false;
        const reader  = readableStream.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        const assistantContent = [];   // accumulates for history
        let _sseFinished = false;
        let _timeoutId = null;

        function _idleLimitMs() {
            return (_currentChatProvider || '').startsWith('cli:') ? 10 * 60 * 1000 : 90 * 1000;
        }

        function _resetIdleTimer() {
            clearTimeout(_timeoutId);
            _timeoutId = setTimeout(function () {
                if (!_cleanup(true)) return;
                _removeTyping();
                if (!_lastTurnHadError) {
                    const seconds = Math.round(_idleLimitMs() / 1000);
                    _appendMsg('err', `No activity from AI for ${seconds} s. The local CLI may still be running in the background.`);
                }
                _setBusy(false);
            }, _idleLimitMs());
        }

        function _cleanup(cancel) {
            if (_sseFinished) return false;
            _sseFinished = true;
            _cancelStream = null;
            clearTimeout(_timeoutId);
            try { if (cancel) reader.cancel(); } catch (_) {}
            return true;
        }

        // Safety valve: if server never sends 'done' or closes connection
        _timeoutId = setTimeout(function () {
            if (!_cleanup(true)) return;
            _removeTyping();
            if (!_lastTurnHadError) {
                _appendMsg('err', 'No response after 90 s — check your API key and server logs.');
            }
            _setBusy(false);
        }, _idleLimitMs());

        // Exposed for the stop button
        _cancelStream = function () {
            if (!_cleanup(true)) return;
            if (_streamBubble) _finaliseStreamBubble();
            const fullText = assistantContent
                .filter(function (c) { return c.type === 'text_fragment'; })
                .map(function (c) { return c.text; })
                .join('');
            if (fullText) _history.push({ role: 'assistant', content: fullText });
            _removeTyping();
            _setBusy(false);
        };

        function _finish() {
            if (!_cleanup(false)) return;
            _finishTurn(assistantContent);
        }

        function pump() {
            reader.read().then(function ({ done, value }) {
                if (_sseFinished) return;   // stopped while read was pending
                if (done) { _finish(); return; }

                buf += decoder.decode(value, { stream: true });

                // Process complete SSE messages (separated by \n\n)
                let idx;
                let gotDone = false;
                while (!gotDone && (idx = buf.indexOf('\n\n')) !== -1) {
                    const raw = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);

                    for (const line of raw.split('\n')) {
                        if (!line.startsWith('data:')) continue;
                        const dataStr = line.slice(5).trim();
                        if (!dataStr) continue;
                        try {
                            const ev = JSON.parse(dataStr);
                            _resetIdleTimer();
                            if (ev.type === 'done') { gotDone = true; break; }
                            _handleSSEEvent(ev, assistantContent);
                        } catch (_) {}
                    }
                }

                if (gotDone) {
                    try { reader.cancel(); } catch (_) {}
                    _finish();
                    return;
                }
                pump();
            }).catch(function (err) {
                if (_sseFinished) return;   // cancelled — already cleaned up
                _cleanup(false);
                _removeTyping();
                _appendMsg('err', 'Stream error: ' + err.message);
                _setBusy(false);
            });
        }
        pump();
    }

    function _handleSSEEvent(ev, assistantContent) {
        if (ev.type === 'delta') {
            _removeTyping();
            if (!_streamBubble) _startStreamBubble();
            _appendStreamDelta(ev.text);
            assistantContent.push({ type: 'text_fragment', text: ev.text });

        } else if (ev.type === 'provider') {
            _currentChatProvider = ev.name;

        } else if (ev.type === 'tool_call') {
            _appendToolBadge(ev.name, ev.result || '');
            _pushThink('🔧 ' + (ev.name || 'tool'));

        } else if (ev.type === 'ui_action') {
            _dispatchUiAction(ev.action, ev.args || {});
            _pushThink('→ ' + (ev.action || 'canvas'));

        } else if (ev.type === 'cached') {
            _markBubbleCached(ev.entry_id || '');

        } else if (ev.type === 'status') {
            if (ev.message) _pushThink(ev.message);

        } else if (ev.type === 'metrics') {
            const parts = [];
            if (ev.cached) parts.push('cached');
            if (ev.tool_calls != null) parts.push(`${ev.tool_calls} tools`);
            if (ev.input_chars != null) parts.push(`${ev.input_chars} input chars`);
            if (ev.elapsed_ms != null) parts.push(`${ev.elapsed_ms} ms`);
            if (parts.length) _pushThink(parts.join(' | '));

        } else if (ev.type === 'done') {
            // handled in finishTurn after stream ends

        } else if (ev.type === 'error') {
            _removeTyping();
            if (_streamBubble) {
                _streamBubble.remove();
                _streamBubble = null;
            }
            _lastTurnHadError = true;
            _appendMsg('err', ev.message || 'Unknown error');
            _setBusy(false);
        }
    }

    // ── QA cache helpers ─────────────────────────────────────────────────────
    function _markBubbleCached(entryId) {
        const bubble = _streamBubble || _msgs.querySelector('.chat-msg-ai:last-child');
        if (!bubble) return;
        if (bubble.querySelector('.chat-cached-badge')) return;  // already marked
        const badge = document.createElement('span');
        badge.className = 'chat-cached-badge';
        badge.dataset.entryId = entryId;
        badge.innerHTML = '⚡ Cached <button class="chat-cached-refresh" title="Regenerate">↺</button>';
        badge.querySelector('.chat-cached-refresh').addEventListener('click', function (e) {
            e.stopPropagation();
            _resendLastWithForceRefresh();
        });
        bubble.appendChild(badge);
    }

    function _resendLastWithForceRefresh() {
        if (_isBusy) return;
        // Remove last assistant turn from history (the cached answer)
        if (_history.length >= 1 && _history[_history.length - 1].role === 'assistant') {
            _history.pop();
        }
        // Remove cached bubble from DOM
        const bubbles = _msgs ? _msgs.querySelectorAll('.chat-msg-ai') : [];
        if (bubbles.length) bubbles[bubbles.length - 1].remove();

        _setBusy(true);
        _thinkLog = [];
        _removeTyping();
        _appendTyping();

        fetch('/chat-stream', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                job_id:        window.JOB_ID || '',
                history:       _history,
                depth:         _currentDepth,
                output:        _currentOutput,
                force_refresh: true,
            }),
        }).then(function (resp) {
            if (!resp.ok) {
                return resp.json().then(function (err) {
                    throw new Error(err.error || 'Server error ' + resp.status);
                });
            }
            _readSSE(resp.body);
        }).catch(function (err) {
            _removeTyping();
            _appendMsg('err', 'Error: ' + err.message);
            _setBusy(false);
        });
    }

    // ── Conversation sessions (.vizcode/chat/) ─────────────────────────────────
    function _newSessionId() {
        const d = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
        return 'session_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
               '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    }

    function _saveHistory() {
        if (!_currentSessionId || !_history.length) return;
        fetch('/chat-history', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ job_id: window.JOB_ID || '', session_id: _currentSessionId, history: _history }),
        }).catch(function () {});
    }

    function _renderSessionMessages(history) {
        if (_msgs) _msgs.innerHTML = '';
        history.forEach(function (msg) {
            if (msg.role === 'user')      _appendMsg('user', msg.content);
            else if (msg.role === 'assistant') _appendMsg('ai', _renderMarkdown(msg.content));
        });
        _triggerFlowsIfNeeded();   // draw restored ```vizflow diagrams (if panel is open)
    }

    function _loadHistory() {
        const jobId = window.JOB_ID || '';
        fetch('/chat-history?job=' + encodeURIComponent(jobId))
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data || !Array.isArray(data.history) || !data.history.length) return;
                _currentSessionId = data.session_id || null;
                _history = data.history;
                _renderSessionMessages(data.history);
            })
            .catch(function () {});
    }

    function _clearHistory() {
        _currentSessionId = _newSessionId();
        _history = [];
        if (_msgs) _msgs.innerHTML = '';
    }

    // ── Sessions panel ────────────────────────────────────────────────────────
    function _buildSessionsList(sessions) {
        const panel = document.getElementById('chat-sessions-panel');
        if (!panel) return;
        panel.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'chat-sessions-title';
        title.textContent = 'Conversations';
        panel.appendChild(title);
        if (!sessions.length) {
            const empty = document.createElement('div');
            empty.className = 'chat-sessions-empty';
            empty.textContent = 'No saved conversations yet';
            panel.appendChild(empty);
            return;
        }
        sessions.forEach(function (s) {
            const item = document.createElement('button');
            item.className = 'chat-session-item' + (s.session_id === _currentSessionId ? ' active' : '');
            const d = new Date(s.created || '');
            const dateStr = isNaN(d.getTime()) ? '' :
                d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '  ' +
                d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            item.innerHTML =
                '<span class="chat-si-date">' + dateStr + '</span>' +
                '<span class="chat-si-preview">' + (s.preview || '—') + '</span>' +
                '<span class="chat-si-count">' + (s.message_count || 0) + ' msg</span>';
            item.addEventListener('click', function () {
                _currentSessionId = s.session_id;
                _history = [];
                fetch('/chat-history?job=' + encodeURIComponent(window.JOB_ID || '') +
                      '&session=' + encodeURIComponent(s.session_id))
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (data) {
                        if (!data) return;
                        _history = data.history || [];
                        _renderSessionMessages(_history);
                        _closeSessionsPanel();
                    }).catch(function () { _closeSessionsPanel(); });
            });
            panel.appendChild(item);
        });
    }

    function _openSessionsPanel() {
        const panel = document.getElementById('chat-sessions-panel');
        const btn   = document.getElementById('chat-hist-btn');
        if (!panel) return;
        fetch('/chat-sessions?job=' + encodeURIComponent(window.JOB_ID || ''))
            .then(function (r) { return r.ok ? r.json() : { sessions: [] }; })
            .then(function (d) { _buildSessionsList(d.sessions || []); })
            .catch(function () { _buildSessionsList([]); });
        panel.classList.add('open');
        _sessionsOpen = true;
        if (btn) btn.setAttribute('aria-expanded', 'true');
    }

    function _closeSessionsPanel() {
        const panel = document.getElementById('chat-sessions-panel');
        const btn   = document.getElementById('chat-hist-btn');
        if (!panel) return;
        panel.classList.remove('open');
        _sessionsOpen = false;
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function _finishTurn(assistantContent) {
        if (_streamBubble) _finaliseStreamBubble();
        _removeTyping();

        // Append assistant turn to history (merge text fragments)
        const fullText = assistantContent
            .filter(function (c) { return c.type === 'text_fragment'; })
            .map(function (c) { return c.text; })
            .join('');
        if (fullText) {
            _history.push({ role: 'assistant', content: fullText });
            _saveHistory();
            if (_currentChatProvider) {
                try {
                    const s = JSON.parse(localStorage.getItem('vizcode_ai_interactions') || '{}');
                    s[_currentChatProvider] = true;
                    localStorage.setItem('vizcode_ai_interactions', JSON.stringify(s));
                } catch (_) { }
            }
        } else if (!_lastTurnHadError) {
            _appendMsg('err', 'No response received from AI. Check your API key and server logs.');
        }

        _setBusy(false);
    }

    const _SEND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
    const _STOP_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;

    function _setBusy(busy) {
        _isBusy = busy;
        _input.disabled    = busy;
        _sendBtn.disabled  = false;  // always clickable (stop or send)
        _sendBtn.innerHTML = busy ? _STOP_ICON : _SEND_ICON;
        _sendBtn.title     = busy ? 'Stop' : 'Send';
        _sendBtn.classList.toggle('stop', busy);
    }

    // ── Config modal ──────────────────────────────────────────────────────────

    function _updateProviderSections(provider) {
        const mode = document.getElementById('chat-cfg-ai-mode')?.value || 'api';
        const activeProvider = mode === 'cli' ? 'cli' : provider;
        document.querySelectorAll('.chat-cfg-section').forEach(function (sec) {
            sec.style.display = (sec.dataset.provider === activeProvider) ? '' : 'none';
        });
    }

    function _getStatusTitle(isApplied, isInteracted) {
        const i18n = window._i18n;
        if (isInteracted) return i18n ? i18n.t('chatAiStatusInteracted') : 'Verified';
        if (isApplied) return i18n ? i18n.t('chatAiStatusApplied') : 'Applied';
        return i18n ? i18n.t('chatAiStatusNone') : 'Not Configured';
    }

    function _providerHasAppliedKey(provider, cfg) {
        if (provider === 'anthropic') return !!cfg.anthropic_api_key_present;
        if (provider === 'openai') return !!cfg.openai_api_key_present;
        if (provider === 'grok') return !!cfg.grok_api_key_present;
        if (provider === 'gemini') return !!cfg.gemini_api_key_present;
        if (provider === 'ollama') return !!cfg.ollama_url_present;
        if (provider === 'custom') return !!cfg.custom_api_key_present;
        return false;
    }

    function _providerHasInteracted(provider) {
        try {
            const s = JSON.parse(localStorage.getItem('vizcode_ai_interactions') || '{}');
            return !!s[provider];
        } catch (_) { return false; }
    }

    function _setChatProviderDropdownOpen(dropdown, open) {
        if (!dropdown) return;
        const menu = dropdown.querySelector('.chat-cfg-provider-menu');
        const trigger = dropdown.querySelector('.chat-cfg-provider-trigger');
        const chevron = dropdown.querySelector('.chat-cfg-provider-chevron');
        dropdown.dataset.open = open ? 'true' : 'false';
        if (menu) {
            menu.style.display = open ? 'block' : 'none';
            menu.style.pointerEvents = open ? 'auto' : 'none';
        }
        if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
    }

    function _syncChatProviderDropdown(sel, cfg) {
        if (!sel || !sel._chatCfgDropdown) return;
        const dropdown = sel._chatCfgDropdown;
        const label = dropdown.querySelector('.chat-cfg-provider-label');
        const status = dropdown.querySelector('.chat-cfg-provider-status');
        const optionsWrap = dropdown.querySelector('.chat-cfg-provider-options');
        const active = sel.options[sel.selectedIndex] || sel.options[0];
        if (label) label.textContent = active ? active.textContent.trim() : '';
        if (status) {
            const isApplied = active && _providerHasAppliedKey(active.value, cfg || _chatCfgSnapshot);
            const isInteracted = active && _providerHasInteracted(active.value);
            status.classList.toggle('applied', isApplied && !isInteracted);
            status.classList.toggle('interacted', isApplied && isInteracted);
            status.title = _getStatusTitle(isApplied, isInteracted);
        }
        if (!optionsWrap) return;
        optionsWrap.innerHTML = '';

        Array.from(sel.options).forEach((opt: any) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chat-cfg-provider-option';
            btn.dataset.value = opt.value;
            btn.setAttribute('data-selected', opt.selected ? 'true' : 'false');

            const main = document.createElement('span');
            main.className = 'chat-cfg-provider-option-main';

            const isApplied = _providerHasAppliedKey(opt.value, cfg || _chatCfgSnapshot);
            const isInteracted = _providerHasInteracted(opt.value);
            const dot = document.createElement('span');
            dot.className = 'chat-cfg-provider-status' + 
                (isApplied && isInteracted ? ' interacted' : (isApplied ? ' applied' : ''));
            dot.title = _getStatusTitle(isApplied, isInteracted);
            main.appendChild(dot);

            const text = document.createElement('span');
            text.className = 'chat-cfg-provider-label';
            text.textContent = opt.textContent.trim();
            main.appendChild(text);
            btn.appendChild(main);

            const mark = document.createElement('span');
            mark.className = 'chat-cfg-provider-check';
            mark.textContent = opt.selected ? '✓' : '';
            btn.appendChild(mark);

            btn.addEventListener('click', () => {
                if (sel.value !== opt.value) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }
                _syncChatProviderDropdown(sel, cfg || _chatCfgSnapshot);
                _setChatProviderDropdownOpen(dropdown, false);
            });
            optionsWrap.appendChild(btn);
        });
    }

    function _enhanceChatProviderSelect(sel) {
        if (!sel) return;
        if (sel._chatCfgDropdown) {
            _syncChatProviderDropdown(sel, _chatCfgSnapshot);
            return;
        }
        const dropdown = document.createElement('div');
        dropdown.className = 'chat-cfg-provider-dd';
        dropdown.dataset.open = 'false';
        dropdown.innerHTML = `
          <button type="button" class="chat-cfg-provider-trigger" aria-haspopup="listbox" aria-expanded="false">
            <span class="chat-cfg-provider-value">
              <span class="chat-cfg-provider-status"></span>
              <span class="chat-cfg-provider-label"></span>
            </span>
            <span class="chat-cfg-provider-chevron">▾</span>
          </button>
          <div class="chat-cfg-provider-menu">
            <div class="chat-cfg-provider-options" role="listbox" aria-label="Provider"></div>
          </div>`;
        sel.insertAdjacentElement('afterend', dropdown);
        sel._chatCfgDropdown = dropdown;

        const trigger = dropdown.querySelector('.chat-cfg-provider-trigger');
        trigger?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const willOpen = dropdown.dataset.open !== 'true';
            document.querySelectorAll('.chat-cfg-provider-dd[data-open="true"]').forEach(openDd => {
                if (openDd !== dropdown) _setChatProviderDropdownOpen(openDd, false);
            });
            _setChatProviderDropdownOpen(dropdown, willOpen);
        });
        trigger?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                trigger.click();
            }
            if (e.key === 'Escape') _setChatProviderDropdownOpen(dropdown, false);
        });
        sel.addEventListener('change', () => _syncChatProviderDropdown(sel, _chatCfgSnapshot));
        _syncChatProviderDropdown(sel, _chatCfgSnapshot);
    }

    function _setKeyStatus(inputId, cfgKey, cfg) {
        const el = document.getElementById(inputId);
        if (!el) return;
        const masked = cfg[cfgKey] || '';
        const present = !!cfg[cfgKey + '_present'];
        if (present && masked) {
            el.innerHTML = `<strong>Active</strong>${_escHtml(masked)}`;
            el.classList.add('present');
        } else {
            el.textContent = 'No stored key';
            el.classList.remove('present');
            el.classList.remove('interacted');
        }
    }

    async function _openConfigModal() {
        _openAiSettingsFromChat();
        return;
        let cfg: any = {};
        try {
            const r = await fetch('/chat-config');
            if (r.ok) cfg = await r.json();
        } catch (_) {}
        _chatCfgSnapshot = cfg || {};

        const provider = cfg.provider || 'anthropic';
        document.getElementById('chat-cfg-ai-mode').value          = cfg.ai_mode === 'cli' ? 'cli' : 'api';
        document.getElementById('chat-cfg-provider').value          = provider;
        document.getElementById('chat-cfg-anthropic-key').value     = '';
        document.getElementById('chat-cfg-anthropic-model').value   = cfg.anthropic_model || 'claude-sonnet-4-6';
        document.getElementById('chat-cfg-openai-key').value        = '';
        document.getElementById('chat-cfg-openai-model').value      = cfg.openai_model || 'gpt-4o';
        document.getElementById('chat-cfg-openai-base-url').value   = cfg.openai_base_url || '';
        document.getElementById('chat-cfg-grok-key').value          = '';
        document.getElementById('chat-cfg-grok-model').value        = cfg.grok_model || 'grok-4.20';
        document.getElementById('chat-cfg-gemini-key').value        = '';
        document.getElementById('chat-cfg-gemini-model').value      = cfg.gemini_model || 'gemini-2.0-flash';
        document.getElementById('chat-cfg-ollama-url').value        = cfg.ollama_url || '';
        document.getElementById('chat-cfg-ollama-model').value      = cfg.ollama_model || 'llama3.1';
        document.getElementById('chat-cfg-custom-key').value        = '';
        document.getElementById('chat-cfg-custom-base-url').value   = cfg.custom_base_url || '';
        document.getElementById('chat-cfg-custom-model').value      = cfg.custom_model || '';
        document.getElementById('chat-cfg-cli-agent').value         = cfg.cli_agent || 'claude';
        document.getElementById('chat-cfg-cli-model').value         = cfg.cli_model || '';
        document.getElementById('chat-cfg-claude-cli-path').value   = cfg.claude_cli_path || '';
        document.getElementById('chat-cfg-codex-cli-path').value     = cfg.codex_cli_path || '';
        document.getElementById('chat-cfg-gemini-cli-path').value   = cfg.gemini_cli_path || '';
        _setKeyStatus('chat-cfg-anthropic-key-status', 'anthropic_api_key', cfg);
        _setKeyStatus('chat-cfg-openai-key-status', 'openai_api_key', cfg);
        _setKeyStatus('chat-cfg-grok-key-status', 'grok_api_key', cfg);
        _setKeyStatus('chat-cfg-gemini-key-status', 'gemini_api_key', cfg);
        _setKeyStatus('chat-cfg-custom-key-status', 'custom_api_key', cfg);

        // Update key status "Active" color based on interaction
        ['anthropic', 'openai', 'grok', 'gemini', 'custom'].forEach(p => {
            const el = document.getElementById(`chat-cfg-${p}-key-status`);
            if (el && _providerHasInteracted(p)) el.classList.add('interacted');
            else if (el) el.classList.remove('interacted');
        });
        document.querySelectorAll('[data-open-key-folder]').forEach(btn => {
            const keyDir = cfg.key_store_dir || '.vizcode';
            btn.title = `Open key folder: ${keyDir}`;
            btn.setAttribute('aria-label', `Open key folder: ${keyDir}`);
        });
        _syncChatProviderDropdown(document.getElementById('chat-cfg-provider'), cfg);
        _updateProviderSections(provider);
        _modal.classList.remove('hidden');
    }

    function _closeConfigModal() {
        if (_modal) _modal.classList.add('hidden');
    }

    async function _saveConfig() {
        const provider = document.getElementById('chat-cfg-provider').value;
        const cfg = {
            ai_mode:           document.getElementById('chat-cfg-ai-mode').value || 'api',
            provider,
            anthropic_api_key:  document.getElementById('chat-cfg-anthropic-key').value.trim(),
            anthropic_model:    document.getElementById('chat-cfg-anthropic-model').value.trim() || 'claude-sonnet-4-6',
            openai_api_key:     document.getElementById('chat-cfg-openai-key').value.trim(),
            openai_model:       document.getElementById('chat-cfg-openai-model').value.trim() || 'gpt-4o',
            openai_base_url:    document.getElementById('chat-cfg-openai-base-url').value.trim(),
            grok_api_key:       document.getElementById('chat-cfg-grok-key').value.trim(),
            grok_model:         document.getElementById('chat-cfg-grok-model').value.trim() || 'grok-4.20',
            gemini_api_key:     document.getElementById('chat-cfg-gemini-key').value.trim(),
            gemini_model:       document.getElementById('chat-cfg-gemini-model').value.trim() || 'gemini-2.0-flash',
            ollama_url:         document.getElementById('chat-cfg-ollama-url').value.trim() || 'http://localhost:11434',
            ollama_model:       document.getElementById('chat-cfg-ollama-model').value.trim() || 'llama3.1',
            custom_api_key:     document.getElementById('chat-cfg-custom-key').value.trim(),
            custom_base_url:    document.getElementById('chat-cfg-custom-base-url').value.trim(),
            custom_model:       document.getElementById('chat-cfg-custom-model').value.trim(),
            cli_agent:          document.getElementById('chat-cfg-cli-agent').value || 'claude',
            cli_model:          document.getElementById('chat-cfg-cli-model').value.trim(),
            claude_cli_path:    document.getElementById('chat-cfg-claude-cli-path').value.trim(),
            codex_cli_path:     document.getElementById('chat-cfg-codex-cli-path').value.trim(),
            gemini_cli_path:    document.getElementById('chat-cfg-gemini-cli-path').value.trim(),
        };
        try {
            const resp = await fetch('/chat-config', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(cfg),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.error) throw new Error(data.error || 'Unable to save config');
            _chatCfgSnapshot = {};
            _closeConfigModal();
            _appendMsg('sys', cfg.ai_mode === 'cli' ? `AI mode saved: Local CLI (${cfg.cli_agent})` : `AI provider saved: ${provider}`);
        } catch (e) {
            alert('Failed to save config: ' + e.message);
        }
    }

    // ── Build DOM ─────────────────────────────────────────────────────────────
    function _buildDOM() {
        // Button
        _btn = document.getElementById('chat-btn');
        if (!_btn) return false;

        // Panel refs
        _panel   = document.getElementById('chat-panel');
        _msgs    = document.getElementById('chat-messages');
        _input   = document.getElementById('chat-input');
        _sendBtn = document.getElementById('chat-send');
        _modal   = document.getElementById('chat-config-modal');

        return true;
    }

            // ── Dragging ──────────────────────────────────────────────────────────────
    function _initDrag() {
        const header = document.getElementById('chat-header');
        if (!header) return;

        header.addEventListener('mousedown', (e) => {
            // Disable dragging in side mode
            if (_panelMode === 'side') return;
            if (e.target.closest('button') || e.target.closest('.chat-cfg-btn')) return;
            _isDragging = true;
            const rect = _panel.getBoundingClientRect();
            _dragOffsetX = e.clientX - rect.left;
            _dragOffsetY = e.clientY - rect.top;
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!_isDragging) return;
            const x = e.clientX - _dragOffsetX;
            const y = e.clientY - _dragOffsetY;
            _panel.style.left = Math.max(0, Math.min(x, window.innerWidth - _panel.offsetWidth)) + 'px';
            _panel.style.top = Math.max(0, Math.min(y, window.innerHeight - _panel.offsetHeight)) + 'px';
            _panel.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (_isDragging) {
                _isDragging = false;
                header.style.cursor = 'move';
            }
        });
    }

        // ── Resizing (8-direction) ────────────────────────────────────────────────
    function _initResize() {
        let isResizing = false;
        let resizeDirection = null;
        let startX, startY, startWidth, startHeight, startLeft, startTop;

        // Create resize handles
        const directions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        directions.forEach(dir => {
            const handle = document.createElement('div');
            handle.className = `chat-resize-handle ${dir}`;
            handle.dataset.direction = dir;
            _panel.appendChild(handle);

            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                resizeDirection = dir;
                startX = e.clientX;
                startY = e.clientY;
                const rect = _panel.getBoundingClientRect();
                startWidth = rect.width;
                startHeight = rect.height;
                startLeft = rect.left;
                startTop = rect.top;
                e.preventDefault();
                e.stopPropagation();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const minW = 320;
            const minH = 400;
            const maxW = window.innerWidth * 0.9;
            const maxH = window.innerHeight - 140;

            let newWidth = startWidth;
            let newHeight = startHeight;
            let newLeft = startLeft;
            let newTop = startTop;

            // Handle horizontal resizing
            if (resizeDirection.includes('e')) {
                newWidth = Math.max(minW, Math.min(startWidth + dx, maxW));
            } else if (resizeDirection.includes('w')) {
                const proposedWidth = startWidth - dx;
                if (proposedWidth >= minW) {
                    newWidth = proposedWidth;
                    // In side mode panel is a flex item — no left repositioning needed
                    if (_panelMode !== 'side') newLeft = startLeft + dx;
                }
            }

            // Handle vertical resizing
            if (resizeDirection.includes('s')) {
                newHeight = Math.max(minH, Math.min(startHeight + dy, maxH));
            } else if (resizeDirection.includes('n')) {
                const proposedHeight = startHeight - dy;
                if (proposedHeight >= minH) {
                    newHeight = proposedHeight;
                    newTop = startTop + dy;
                }
            }

            // Apply new dimensions
            _panel.style.width = newWidth + 'px';
            _panel.style.height = newHeight + 'px';

            
            // Update position if resizing from left or top (float mode only)
            if (_panelMode !== 'side' && (resizeDirection.includes('w') || resizeDirection.includes('n'))) {
                _panel.style.left = Math.max(0, Math.min(newLeft, window.innerWidth - newWidth)) + 'px';
                _panel.style.top = Math.max(0, Math.min(newTop, window.innerHeight - newHeight)) + 'px';
                _panel.style.right = 'auto';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizeDirection = null;
            }
        });
    }

    // ── Attach events ─────────────────────────────────────────────────────────
    function _attachEvents() {
        _btn.addEventListener('click', toggleChatPanel);

        document.getElementById('chat-close').addEventListener('click', _close);

        _sendBtn.addEventListener('click', function () {
            if (_isBusy) { if (_cancelStream) _cancelStream(); }
            else { _sendMessage(); }
        });

                _input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _sendMessage();
                return;
            }

            // Arrow key history navigation (like terminal)
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (_inputHistory.length === 0) return;

                // First time pressing up: save current input
                if (_historyIndex === -1) {
                    _tempInput = _input.value;
                    _historyIndex = _inputHistory.length - 1;
                } else if (_historyIndex > 0) {
                    _historyIndex--;
                }

                _input.value = _inputHistory[_historyIndex];
                _input.style.height = 'auto';
                _input.style.height = Math.min(_input.scrollHeight, 120) + 'px';
                // Move cursor to end
                setTimeout(() => _input.setSelectionRange(_input.value.length, _input.value.length), 0);
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (_historyIndex === -1) return;  // not navigating

                if (_historyIndex < _inputHistory.length - 1) {
                    _historyIndex++;
                    _input.value = _inputHistory[_historyIndex];
                } else {
                    // Reached the end: restore temp input
                    _historyIndex = -1;
                    _input.value = _tempInput;
                    _tempInput = '';
                }

                _input.style.height = 'auto';
                _input.style.height = Math.min(_input.scrollHeight, 120) + 'px';
                setTimeout(() => _input.setSelectionRange(_input.value.length, _input.value.length), 0);
            }
        });

        // Auto-grow textarea
        _input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        // Config button in header
        const cfgBtn = document.getElementById('chat-cfg-btn');
        if (cfgBtn) cfgBtn.addEventListener('click', _openAiSettingsFromChat);

        // History button
        const histBtn = document.getElementById('chat-hist-btn');
        if (histBtn) histBtn.addEventListener('click', function () {
            _sessionsOpen ? _closeSessionsPanel() : _openSessionsPanel();
        });

        // New conversation button
        const newBtn = document.getElementById('chat-new-btn');
        if (newBtn) newBtn.addEventListener('click', function () {
            if (_isBusy) return;
            _closeSessionsPanel();
            _clearHistory();
        });

        // Provider selector — show/hide relevant fields
        const providerSelect = document.getElementById('chat-cfg-provider');
        if (providerSelect) {
            _enhanceChatProviderSelect(providerSelect);
            providerSelect.addEventListener('change', function () {
                _updateProviderSections(this.value);
            });
        }
        const modeSelect = document.getElementById('chat-cfg-ai-mode');
        if (modeSelect) {
            modeSelect.addEventListener('change', function () {
                _updateProviderSections(providerSelect?.value || 'anthropic');
            });
        }

        document.querySelectorAll('[data-open-key-folder]').forEach(btn => {
            btn.addEventListener('click', async function () {
                try {
                    const r = await fetch('/open-key-folder', { method: 'POST' });
                    const data = await r.json().catch(() => ({}));
                    if (!r.ok || data.error) throw new Error(data.error || 'Unable to open key folder');
                } catch (e) {
                    alert('Failed to open key folder: ' + e.message);
                }
            });
        });

        // Modal buttons
        document.getElementById('chat-config-save')?.addEventListener('click', _saveConfig);
        document.getElementById('chat-config-cancel')?.addEventListener('click', _closeConfigModal);

        // Close modal on backdrop click
        _modal?.addEventListener('click', function (e) {
            if (e.target === _modal) _closeConfigModal();
        });
        document.addEventListener('click', function (e) {
            if (!(e.target as HTMLElement).closest('.chat-cfg-provider-dd')) {
                document.querySelectorAll('.chat-cfg-provider-dd[data-open="true"]').forEach(dd => _setChatProviderDropdownOpen(dd, false));
            }
        });
        window.addEventListener('vizAiConfigChanged', function (e) {
            _chatCfgSnapshot = e.detail || {};
            _chatIsConfigured = _chatConfigIsReady(_chatCfgSnapshot);
            _btn.classList.toggle('needs-setup', !_chatIsConfigured);
            if (_chatIsConfigured) document.getElementById('chat-setup-card')?.remove();
        });

        // Keyboard shortcut: Alt+C toggles chat
        document.addEventListener('keydown', function (e) {
            if (e.altKey && e.key === 'c') {
                e.preventDefault();
                toggleChatPanel();
            }
        });

                // Initialize dragging and resizing
        _initDrag();
        _initResize();

        // ── Badge interactions (delegated on chat messages) ─────────────────
        _msgs.addEventListener('click', function (e) {
            const b = e.target.closest('.chat-badge');
            if (!b) return;
            const id = b.dataset.nodeId;
            if (!id || !window.cy) return;
            const focus = function (node) {
                window.cy.animate(
                    { center: { eles: node }, zoom: Math.max(window.cy.zoom(), 1.8) },
                    { duration: 300 }
                );
                if (typeof window.pinHighlightNode === 'function') window.pinHighlightNode(node);
            };
            const node = _resolveCanvasNode(id);
            if (node && node.length) {
                focus(node.length > 1 ? node.first() : node);
            } else if (_navigateToNodeId(id)) {
                // Badge points off the current canvas — navigate there, then focus.
                setTimeout(function () {
                    const n2 = _resolveCanvasNode(id);
                    if (n2 && n2.length) focus(n2.length > 1 ? n2.first() : n2);
                    else _canvasMissToast(id);
                }, 700);
            } else {
                _canvasMissToast(id);
            }
        });
        _msgs.addEventListener('mouseover', function (e) {
            const b = e.target.closest('.chat-badge');
            if (!b || !window.cy) return;
            const node = _resolveCanvasNode(b.dataset.nodeId);
            if (node && node.length && typeof window.highlightNode === 'function') {
                window.highlightNode(node.length > 1 ? node.first() : node);
            }
        });
        _msgs.addEventListener('mouseout', function (e) {
            const b = e.target.closest('.chat-badge');
            if (b && typeof window.clearHighlight === 'function') window.clearHighlight();
        });

        // ── Canvas node hover → highlight matching badges in chat ───────────
        document.addEventListener('vizNodeHover', function (e) {
            const d = e.detail || {};
            if (!d.nodeId) return;
            const sel = `.chat-badge[data-node-id="${d.nodeId.replace(/"/g, '\\"')}"]`;
            let badges;
            try { badges = _msgs.querySelectorAll(sel); } catch (_) { return; }
            badges.forEach(function (el) { el.classList.toggle('chat-badge-hl', !!d.enter); });
        });
    }

    // ── Check if configured ───────────────────────────────────────────────────
    async function _checkConfig() {
        try {
            const r = await fetch('/chat-config');
            if (!r.ok) return;
            const cfg = await r.json();
            _chatCfgSnapshot = cfg || {};
            _chatIsConfigured = _chatConfigIsReady(_chatCfgSnapshot);
            _btn.classList.toggle('needs-setup', !_chatIsConfigured);
            _btn.title = _chatIsConfigured ? 'AI Chat' : 'AI Chat - open to set up';
            if (!_chatIsConfigured && _isOpen) _appendSetupGuide();
            return;
            // If no API key is set at all, prompt setup on first open
            const hasKey = cfg.anthropic_api_key || cfg.openai_api_key || cfg.grok_api_key || cfg.gemini_api_key;
            if (!hasKey) {
                _btn.title = 'AI Chat — click to set up';
                // Override open to show config first
                const setupAndOpen = function () {
                    _open();
                    _openConfigModal();
                    _btn.removeEventListener('click', setupAndOpen);
                    _btn.addEventListener('click', toggleChatPanel);
                };
                _btn.removeEventListener('click', toggleChatPanel);
                _btn.addEventListener('click', setupAndOpen);
            }
        } catch (_) {}
    }

    // ── Mode controls (depth × output) ─────────────────────────────────────────
    const _DEPTH_SVGS = {
        general: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H8.5L4 20V4z"/></svg>',
        deep:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
        quick:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 2 8 13 13 13 11 22 16 11 11 11"/></svg>',
    };
    const _OUTPUT_SVGS = {
        flow:          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="7" height="4" rx="1"/><rect x="15" y="10" width="7" height="4" rx="1"/><rect x="2" y="17" width="7" height="4" rx="1"/><path d="M9 5h3a3 3 0 0 1 3 3v4M9 19h3a3 3 0 0 0 3-3v-4"/></svg>',
        file_tour:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88"/></svg>',
        health_report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 12 6 12 8 5 11 19 14 12 16 15 18 12 22 12"/></svg>',
    };
    const _DEFAULT_MODE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="16" cy="6" r="2.5" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="8" cy="12" r="2.5" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="13" cy="18" r="2.5" fill="currentColor" stroke="none"/></svg>';
    const _DEPTH_ORDER = ['quick', 'general', 'deep'];

    function _t(k, fb?) { return window._i18n ? window._i18n.t(k) : fb; }

        function _depthItems() {
        return [
            { id: 'quick',   label: _t('chatDepthLabel_quick'),   desc: _t('chatDepthDesc_quick') },
            { id: 'general', label: _t('chatDepthLabel_general'), desc: _t('chatDepthDesc_general') },
            { id: 'deep',    label: _t('chatDepthLabel_deep'),    desc: _t('chatDepthDesc_deep') },
        ];
    }

        function _outputItems() {
        return [
            { id: 'flow',          label: _t('chatOutputLabel_flow'),          desc: _t('chatOutputDesc_flow') },
            { id: 'file_tour',     label: _t('chatOutputLabel_file_tour'),     desc: _t('chatOutputDesc_file_tour') },
            { id: 'health_report', label: _t('chatOutputLabel_health_report'), desc: _t('chatOutputDesc_health_report') },
        ];
    }

    function _refreshHeaderTitle() { /* static title — no-op */ }

    function _depthToRange(id) {
        const idx = _DEPTH_ORDER.indexOf(id);
        return idx < 0 ? 1 : idx;
    }

    function _rangeToDepth(val) { return _DEPTH_ORDER[parseInt(val)] || 'general'; }

    // ── Depth button ──────────────────────────────────────────────────────────
    function _updateDepthBtn() {
        const btn = document.getElementById('chat-depth-btn');
        if (!btn) return;
        const info = _depthItems().find(function (d) { return d.id === _currentDepth; }) || _depthItems()[1];
        btn.innerHTML = '<span class="chat-ctrl-icon">' + (_DEPTH_SVGS[_currentDepth] || '') + '</span>' +
                        '<span class="chat-ctrl-label">' + info.label + '</span>';
    }

    function _updateDepthInfo() {
        const info = _depthItems().find(function (d) { return d.id === _currentDepth; });
        if (!info) return;
        const lbl = document.getElementById('chat-depth-info-label');
        const dsc = document.getElementById('chat-depth-info-desc');
        if (lbl) lbl.textContent = info.label;
        if (dsc) dsc.textContent = info.desc;
    }

    function _closeDepthPicker() {
        const picker = document.getElementById('chat-depth-picker');
        const btn    = document.getElementById('chat-depth-btn');
        if (picker) picker.classList.remove('open');
        if (btn)    btn.setAttribute('aria-expanded', 'false');
    }

    function _initDepthBtn() {
        const btn   = document.getElementById('chat-depth-btn');
        const range = document.getElementById('chat-depth-range');
        if (btn) {
            _updateDepthBtn();
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const picker = document.getElementById('chat-depth-picker');
                if (!picker) return;
                if (picker.classList.contains('open')) {
                    _closeDepthPicker();
                } else {
                    _closeOutputPicker();
                    picker.classList.add('open');
                    btn.setAttribute('aria-expanded', 'true');
                }
            });
        }
        if (range) {
            range.value = _depthToRange(_currentDepth);
            _updateDepthInfo();
            range.addEventListener('input', function () {
                _selectDepth(_rangeToDepth(range.value));
            });
        }
    }

    // ── Output picker (inside card) ───────────────────────────────────────────
    function _makeOutputRow(disabledAll) {
        const row = document.createElement('div');
        row.className = 'chat-mode-row';
                _outputItems().forEach(function (item) {
            const card = document.createElement('button');
            card.className = 'chat-mode-pill' + (item.id === _currentOutput ? ' active' : '');
            if (disabledAll) { card.disabled = true; card.setAttribute('aria-disabled', 'true'); }
            card.innerHTML = '<span class="chat-mode-pill-icon">' + (_OUTPUT_SVGS[item.id] || '') + '</span>' +
                             '<span class="chat-mode-pill-label">' + item.label + '</span>';
            if (item.desc) card.title = item.desc;  // Tooltip showing description
            card.addEventListener('click', function () { if (!disabledAll) _selectOutput(item.id); });
            row.appendChild(card);
        });
        return row;
    }

    function _buildOutputPicker() {
        const picker = document.getElementById('chat-output-picker');
        if (!picker) return;
        picker.innerHTML = '';
        picker.appendChild(_makeOutputRow(_currentDepth === 'quick'));
    }

    function _openOutputPicker() {
        const picker = document.getElementById('chat-output-picker');
        const btn    = document.getElementById('chat-mode-btn');
        if (!picker) return;
        _closeDepthPicker();
        _buildOutputPicker();
        picker.classList.add('open');
        _modePickerOpen = true;
        if (btn) btn.setAttribute('aria-expanded', 'true');
    }

    function _closeOutputPicker() {
        const picker = document.getElementById('chat-output-picker');
        const btn    = document.getElementById('chat-mode-btn');
        if (picker) picker.classList.remove('open');
        _modePickerOpen = false;
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function _updateModeBtnIcon() {
        const btn = document.getElementById('chat-mode-btn');
        if (!btn) return;
        if (_currentOutput) {
            const info = _outputItems().find(function (o) { return o.id === _currentOutput; });
            const label = info ? info.label : '';
            btn.innerHTML = '<span class="chat-ctrl-icon">' + (_OUTPUT_SVGS[_currentOutput] || _DEFAULT_MODE_SVG) + '</span>' +
                            '<span class="chat-ctrl-label">' + label + '</span>';
            btn.classList.add('has-output');
        } else {
            btn.innerHTML = _DEFAULT_MODE_SVG;
            btn.classList.remove('has-output');
        }
        btn.classList.toggle('active', !!_currentOutput);
    }

    // ── Depth / Output selection ──────────────────────────────────────────────
    function _selectDepth(id) {
        _currentDepth = id;
        localStorage.setItem('vizcode.chat.depth', id);
        if (id === 'quick' && _currentOutput) {
            _currentOutput = null;
            localStorage.removeItem('vizcode.chat.output');
        }
        _updateModeBtnIcon();
        _updateModeBtnDisabled();
        _updateDepthBtn();
        _updateDepthInfo();
        const range = document.getElementById('chat-depth-range');
        if (range) range.value = _depthToRange(id);
        _buildOutputPicker();
    }

    function _selectOutput(id) {
        if (_currentDepth === 'quick') return;
        _currentOutput = (_currentOutput === id) ? null : id;
        if (_currentOutput) {
            localStorage.setItem('vizcode.chat.output', _currentOutput);
        } else {
            localStorage.removeItem('vizcode.chat.output');
        }
        _updateModeBtnIcon();
        _closeOutputPicker();
    }

    // ── Mode button init ──────────────────────────────────────────────────────
    function _updateModeBtnDisabled() {
        const btn = document.getElementById('chat-mode-btn');
        if (!btn) return;
        if (_currentDepth === 'quick') {
            btn.disabled = true;
        } else {
            btn.disabled = false;
        }
    }

    function _initModeBtn() {
        const btn = document.getElementById('chat-mode-btn');
        if (!btn) return;
        _updateModeBtnIcon();
        _updateModeBtnDisabled();
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (_modePickerOpen) { _closeOutputPicker(); } else { _openOutputPicker(); }
        });
        document.addEventListener('click', function (e) {
            const depthPicker = document.getElementById('chat-depth-picker');
            if (depthPicker && depthPicker.classList.contains('open') &&
                !(e.target as HTMLElement).closest('#chat-depth-picker') &&
                !(e.target as HTMLElement).closest('#chat-depth-btn')) {
                _closeDepthPicker();
            }
            if (_modePickerOpen &&
                !(e.target as HTMLElement).closest('#chat-output-picker') &&
                !(e.target as HTMLElement).closest('#chat-mode-btn')) {
                _closeOutputPicker();
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { _closeOutputPicker(); _closeDepthPicker(); }
        });
    }

    // ── Side Panel Resizer ───────────────────────────────────────────────────
    let _chatResizer = null;

    function _initSideResizer() {
        _chatResizer = document.createElement('div');
        _chatResizer.id = 'chat-resizer';
        _chatResizer.style.display = 'none';

        let startX, startW;

        _chatResizer.addEventListener('mousedown', (e) => {
            if (_panelMode !== 'side') return;
            startX = e.clientX;
            startW = _panel.offsetWidth;
            _chatResizer.classList.add('dragging');
            _panel.style.transition = 'none';
            const gw = document.getElementById('graph-wrap');
            if (gw) gw.style.pointerEvents = 'none';
            
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
            e.preventDefault();
        });

        let dragRaf;
        function onDrag(e) {
            if (dragRaf) cancelAnimationFrame(dragRaf);
            dragRaf = requestAnimationFrame(() => {
                // Dragging left increases width (since it's docked to the right)
                const delta = startX - e.clientX;
                const newW = Math.max(260, Math.min(1200, startW + delta));
                _panel.style.width = newW + 'px';
                document.documentElement.style.setProperty('--chat-side-w', newW + 'px');
            });
        }

        function stopDrag() {
            _chatResizer.classList.remove('dragging');
            _panel.style.transition = '';
            const gw = document.getElementById('graph-wrap');
            if (gw) gw.style.pointerEvents = '';
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);
            if (window.cy) window.cy.resize();
        }
    }

    // ── Panel mode toggle (side ↔ float) ─────────────────────────────────────
    // side : panel moved into #layout as a flex sibling of #code-panel
    // float: panel lives on document.body (position:fixed, draggable)
    const _ICON_SIDE  = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="2" y="3" width="16" height="14" rx="2"/><line x1="13" y1="3" x2="13" y2="17"/></svg>`;
    const _ICON_FLOAT = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 1h8a2 2 0 0 1 2 2v8"/></svg>`;

    // Saved DOM position for restoring float mode
    let _floatParent      = null;
    let _floatNextSibling = null;

    function _applyPanelMode(mode, skipResize?) {
        _panelMode = mode;
        localStorage.setItem('vizcode.chat.panelMode', mode);

        const btn    = document.getElementById('chat-mode-toggle-btn');
        const layout = document.getElementById('layout');

        if (mode === 'side') {
            // Move panel into #layout (rightmost flex child)
            if (_panel.parentElement !== layout) {
                _floatParent      = _panel.parentElement || document.body;
                _floatNextSibling = _panel.nextSibling;
                layout.appendChild(_chatResizer);
                layout.appendChild(_panel);
            }
            _panel.classList.add('side-mode');
            _panel.classList.remove('open');
            if (_isOpen) _panel.classList.add('open');
            document.body.classList.remove('chat-side-open');
            if (btn) {
                btn.innerHTML = _ICON_FLOAT;
                btn.title = 'Switch to floating window';
            }
        } else {
            // Move panel back to float parent
            const parent = _floatParent || document.body;
            if (_panel.parentElement !== parent) {
                if (_floatNextSibling && _floatNextSibling.parentElement === parent) {
                    parent.insertBefore(_panel, _floatNextSibling);
                } else {
                    parent.appendChild(_panel);
                }
                if (_chatResizer.parentElement) {
                    _chatResizer.parentElement.removeChild(_chatResizer);
                }
            }
            _chatResizer.style.display = 'none';
            _panel.classList.remove('side-mode');
            _panel.classList.remove('open');
            if (_isOpen) _panel.classList.add('open');
            document.body.classList.remove('chat-side-open');
            if (btn) {
                btn.innerHTML = _ICON_SIDE;
                btn.title = 'Switch to side panel mode';
            }
        }

        if (!skipResize) {
            setTimeout(() => { if (window.cy) window.cy.resize(); }, 50);
        }
    }

    function _initPanelModeToggle() {
        const btn = document.getElementById('chat-mode-toggle-btn');
        if (!btn) return;
        // Save initial float position before moving
        _floatParent      = _panel.parentElement || document.body;
        _floatNextSibling = _panel.nextSibling;
        // Apply saved mode (skip cy resize — not ready yet)
        _applyPanelMode(_panelMode, true);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            _applyPanelMode(_panelMode === 'side' ? 'float' : 'side');
        });
    }

        // ── Public init ───────────────────────────────────────────────────────────
    function initChat() {
        if (!_buildDOM()) return;   // HTML elements not present (launcher page)
        _updateButtonIcon();
        _attachEvents();
        _initModeBtn();
        _initDepthBtn();
        _initSideResizer();
        _initPanelModeToggle();
        _setBusy(false);    // initialise send button icon
        _checkConfig();
        _loadHistory();
    }

    // Expose globally so viz.js can call initChat()
    window.initChat = initChat;

})();
