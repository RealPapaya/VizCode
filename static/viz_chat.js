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

(function () {
    'use strict';

        // ── State ─────────────────────────────────────────────────────────────────
    let _isOpen   = false;
    let _isBusy   = false;   // waiting for AI response
    let _history  = [];      // [{role, content}] sent to server
    let _streamBubble = null;        // DOM element currently streaming into
    let _streamText   = '';          // accumulated text for current stream bubble

    // ── DOM refs (populated in initChat) ─────────────────────────────────────
    let _btn, _panel, _msgs, _input, _sendBtn, _modal;
    let _chatCfgSnapshot = {};

    // ── Drag state ────────────────────────────────────────────────────────────
    let _isDragging = false;
    let _dragOffsetX = 0;
    let _dragOffsetY = 0;

    // ── Markdown-lite renderer ────────────────────────────────────────────────
    // Handles: ```mermaid blocks, ``` code blocks, `inline code`, **bold**, *italic*
    //
    // Mermaid blocks are extracted BEFORE HTML escaping so their raw syntax is
    // preserved verbatim inside .chat-mermaid divs.  _renderPendingMermaid()
    // renders them asynchronously once mermaid.min.js is loaded.
    function _renderMarkdown(text) {
        // 1. Extract mermaid fences first, replace with sentinel placeholders
        const mermaidBlocks = [];
        let t = text.replace(/```mermaid\n?([\s\S]*?)```/g, function (_, code) {
            const idx = mermaidBlocks.length;
            mermaidBlocks.push(code.trim());
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

        // 7. Substitute mermaid placeholders back with .mermaid divs.
        //    The div textContent is the raw mermaid source (browser decodes entities).
        t = t.replace(/\x00MM(\d+)\x00/g, function (_, idx) {
            const src = mermaidBlocks[Number(idx)] || '';
            const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div class="chat-mermaid mermaid">${esc}</div>`;
        });

        // 8. Paragraphs (double newline)
        t = t.replace(/\n{2,}/g, '</p><p>');
        return '<p>' + t + '</p>';
    }

        // ── Panel open / close ───────────────────────────────────────────────────
    function _open() {
        _isOpen = true;
        _panel.classList.add('open');
        _btn.classList.add('active');
        _updateButtonIcon();
        setTimeout(() => _input.focus(), 220);
    }

    function _close() {
        _isOpen = false;
        _panel.classList.remove('open');
        _btn.classList.remove('active');
        _updateButtonIcon();
    }

    function _updateButtonIcon() {
        const svg = _isOpen
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        _btn.innerHTML = svg;
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
        div.innerHTML = '<span></span><span></span><span></span>';
        div.id = '_chat-typing';
        _msgs.appendChild(div);
        _scrollBottom();
        return div;
    }

    function _removeTyping() {
        const el = document.getElementById('_chat-typing');
        if (el) el.remove();
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
        _streamBubble.innerHTML = _renderMarkdown(_streamText);
        _scrollBottom();
    }

    function _finaliseStreamBubble() {
        _streamBubble = null;
        _streamText   = '';
        // Any ```mermaid blocks in the finished bubble get rendered now.
        _triggerMermaidIfNeeded();
    }

    function _scrollBottom() {
        _msgs.scrollTop = _msgs.scrollHeight;
    }

    function _escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Mermaid: lazy-load from CDN, render on demand ─────────────────────────
    const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js';
    let _mermaidLoading = null;

    function _ensureMermaid() {
        if (window.mermaid && window.mermaid.run) return Promise.resolve();
        if (_mermaidLoading) return _mermaidLoading;
        _mermaidLoading = new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src   = MERMAID_CDN;
            s.async = true;
            s.onload = function () {
                try {
                    window.mermaid.initialize({
                        startOnLoad:   false,
                        theme:         'dark',
                        securityLevel: 'loose',
                    });
                } catch (_) {}
                resolve();
            };
            s.onerror = function () { reject(new Error('mermaid script load failed')); };
            document.head.appendChild(s);
        });
        return _mermaidLoading;
    }

    function _renderPendingMermaid() {
        if (!window.mermaid || !window.mermaid.run) return;
        const nodes = _msgs.querySelectorAll('.chat-mermaid:not([data-rendered])');
        if (!nodes.length) return;
        nodes.forEach(function (n) { n.setAttribute('data-rendered', '1'); });
        window.mermaid.run({ nodes: Array.from(nodes) }).then(function () {
            _scrollBottom();
        }).catch(function (e) {
            nodes.forEach(function (n) {
                if (!n.querySelector('svg')) {
                    n.innerHTML =
                        `<pre style="color:var(--red,#f87171);font-size:11px;margin:0">`
                        + `[mermaid error] ${_escHtml(String(e && e.message || e))}</pre>`;
                }
            });
        });
    }

    function _triggerMermaidIfNeeded() {
        if (!_msgs.querySelector('.chat-mermaid:not([data-rendered])')) return;
        _ensureMermaid().then(_renderPendingMermaid).catch(function () {
            // CDN blocked — leave mermaid blocks as pre-formatted text
            _msgs.querySelectorAll('.chat-mermaid:not([data-rendered])').forEach(function (n) {
                n.setAttribute('data-rendered', '1');
                n.classList.add('chat-mermaid-fallback');
            });
        });
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

                case 'highlight_path':
                    _highlightPath(args.source || '', args.target || '');
                    break;

                case 'noop':
                    break;

                default:
                    console.warn('[VizBridge] unknown ui_action:', action);
            }
        } catch (err) {
            console.error('[VizBridge] ui_action dispatch failed:', err);
        }

        _appendUiActionBadge(action, args);
    }

    function _highlightNodeById(id) {
        if (!id || !window.cy) return;
        const el = window.cy.getElementById(id);
        if (el && el.length && typeof window.highlightNode === 'function') {
            window.highlightNode(el);
        } else if (window.cy.$id) {
            // Fallback: label match (L0/L1 nodes are indexed by file path, not label)
            const byLabel = window.cy.nodes().filter(function (n) {
                return n.data('label') === id || n.data('id') === id;
            });
            if (byLabel.length && typeof window.highlightNode === 'function') {
                window.highlightNode(byLabel[0]);
            }
        }
    }

    function _highlightPath(src, tgt) {
        if (!src || !tgt || !window.cy) return;
        const cy = window.cy;
        const s = cy.getElementById(src);
        const t = cy.getElementById(tgt);
        if (!s || !s.length || !t || !t.length) return;
        try {
            const dj   = cy.elements().dijkstra({ root: s, directed: false });
            const path = dj.pathTo(t);
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

        _input.value = '';
        _input.style.height = '';   // reset auto-grow
        _appendMsg('user', text);

        _history.push({ role: 'user', content: text });
        _setBusy(true);

        const jobId = window.JOB_ID || '';
        const body  = JSON.stringify({ job_id: jobId, history: _history });

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
            _removeTyping();
            _startStreamBubble();
            _readSSE(resp.body);
        }).catch(function (err) {
            _removeTyping();
            _appendMsg('err', 'Error: ' + err.message);
            _setBusy(false);
        });
    }

    // ── SSE reader (ReadableStream) ───────────────────────────────────────────
    function _readSSE(readableStream) {
        const reader  = readableStream.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        const assistantContent = [];   // accumulates for history

        function pump() {
            reader.read().then(function ({ done, value }) {
                if (done) {
                    _finishTurn(assistantContent);
                    return;
                }
                buf += decoder.decode(value, { stream: true });

                // Process complete SSE messages (separated by \n\n)
                let idx;
                while ((idx = buf.indexOf('\n\n')) !== -1) {
                    const raw = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);

                    for (const line of raw.split('\n')) {
                        if (!line.startsWith('data:')) continue;
                        const dataStr = line.slice(5).trim();
                        if (!dataStr) continue;
                        try {
                            const ev = JSON.parse(dataStr);
                            _handleSSEEvent(ev, assistantContent);
                        } catch (_) {}
                    }
                }
                pump();
            }).catch(function (err) {
                _removeTyping();
                _appendMsg('err', 'Stream error: ' + err.message);
                _setBusy(false);
            });
        }
        pump();
    }

    function _handleSSEEvent(ev, assistantContent) {
        if (ev.type === 'delta') {
            if (!_streamBubble) _startStreamBubble();
            _appendStreamDelta(ev.text);
            assistantContent.push({ type: 'text_fragment', text: ev.text });

        } else if (ev.type === 'tool_call') {
            _appendToolBadge(ev.name, ev.result || '');

        } else if (ev.type === 'ui_action') {
            _dispatchUiAction(ev.action, ev.args || {});

        } else if (ev.type === 'done') {
            // handled in finishTurn after stream ends

        } else if (ev.type === 'error') {
            _removeTyping();
            if (_streamBubble) {
                _streamBubble.remove();
                _streamBubble = null;
            }
            _appendMsg('err', ev.message || 'Unknown error');
        }
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
        }

        _setBusy(false);
    }

    function _setBusy(busy) {
        _isBusy = busy;
        _sendBtn.disabled = busy;
        _input.disabled   = busy;
    }

    // ── Config modal ──────────────────────────────────────────────────────────

    function _updateProviderSections(provider) {
        document.querySelectorAll('.chat-cfg-section').forEach(function (sec) {
            sec.style.display = (sec.dataset.provider === provider) ? '' : 'none';
        });
    }

    function _providerHasAppliedKey(provider, cfg) {
        if (provider === 'anthropic') return !!cfg.anthropic_api_key_present;
        if (provider === 'openai') return !!cfg.openai_api_key_present;
        if (provider === 'grok') return !!cfg.grok_api_key_present;
        if (provider === 'gemini') return !!cfg.gemini_api_key_present;
        return provider === 'ollama';
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
        if (status) status.classList.toggle('applied', !!(active && _providerHasAppliedKey(active.value, cfg || _chatCfgSnapshot)));
        if (!optionsWrap) return;
        optionsWrap.innerHTML = '';

        Array.from(sel.options).forEach(opt => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chat-cfg-provider-option';
            btn.dataset.value = opt.value;
            btn.setAttribute('data-selected', opt.selected ? 'true' : 'false');

            const main = document.createElement('span');
            main.className = 'chat-cfg-provider-option-main';

            const dot = document.createElement('span');
            dot.className = 'chat-cfg-provider-status' + (_providerHasAppliedKey(opt.value, cfg || _chatCfgSnapshot) ? ' applied' : '');
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
        }
    }

    async function _openConfigModal() {
        let cfg = {};
        try {
            const r = await fetch('/chat-config');
            if (r.ok) cfg = await r.json();
        } catch (_) {}
        _chatCfgSnapshot = cfg || {};

        const provider = cfg.provider || 'anthropic';
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
        document.getElementById('chat-cfg-ollama-url').value        = cfg.ollama_url || 'http://localhost:11434';
        document.getElementById('chat-cfg-ollama-model').value      = cfg.ollama_model || 'llama3.1';
        _setKeyStatus('chat-cfg-anthropic-key-status', 'anthropic_api_key', cfg);
        _setKeyStatus('chat-cfg-openai-key-status', 'openai_api_key', cfg);
        _setKeyStatus('chat-cfg-grok-key-status', 'grok_api_key', cfg);
        _setKeyStatus('chat-cfg-gemini-key-status', 'gemini_api_key', cfg);
        document.querySelectorAll('[data-open-key-folder]').forEach(btn => {
            const keyDir = cfg.key_store_dir || '.local';
            btn.title = `Open key folder: ${keyDir}`;
            btn.setAttribute('aria-label', `Open key folder: ${keyDir}`);
        });
        _syncChatProviderDropdown(document.getElementById('chat-cfg-provider'), cfg);
        _updateProviderSections(provider);
        _modal.classList.remove('hidden');
    }

    function _closeConfigModal() {
        _modal.classList.add('hidden');
    }

    async function _saveConfig() {
        const provider = document.getElementById('chat-cfg-provider').value;
        const cfg = {
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
            _appendMsg('sys', `AI provider saved: ${provider}`);
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
                    newLeft = startLeft + dx;
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
            
            // Update position if resizing from left or top
            if (resizeDirection.includes('w') || resizeDirection.includes('n')) {
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

        _sendBtn.addEventListener('click', _sendMessage);

        _input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _sendMessage();
            }
        });

        // Auto-grow textarea
        _input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        // Config button in header
        const cfgBtn = document.getElementById('chat-cfg-btn');
        if (cfgBtn) cfgBtn.addEventListener('click', _openConfigModal);

        // Provider selector — show/hide relevant fields
        const providerSelect = document.getElementById('chat-cfg-provider');
        if (providerSelect) {
            _enhanceChatProviderSelect(providerSelect);
            providerSelect.addEventListener('change', function () {
                _updateProviderSections(this.value);
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
        document.getElementById('chat-config-save').addEventListener('click', _saveConfig);
        document.getElementById('chat-config-cancel').addEventListener('click', _closeConfigModal);

        // Close modal on backdrop click
        _modal.addEventListener('click', function (e) {
            if (e.target === _modal) _closeConfigModal();
        });
        document.addEventListener('click', function (e) {
            if (!e.target.closest('.chat-cfg-provider-dd')) {
                document.querySelectorAll('.chat-cfg-provider-dd[data-open="true"]').forEach(dd => _setChatProviderDropdownOpen(dd, false));
            }
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
    }

    // ── Check if configured ───────────────────────────────────────────────────
    async function _checkConfig() {
        try {
            const r = await fetch('/chat-config');
            if (!r.ok) return;
            const cfg = await r.json();
            // If no API key is set at all, prompt setup on first open
            const hasKey = cfg.anthropic_api_key || cfg.openai_api_key || cfg.grok_api_key || cfg.gemini_api_key;
            if (!hasKey) {
                _btn.title = 'AI Chat — click to set up';
                // Override open to show config first
                const origOpen = _open;
                const setupAndOpen = function () {
                    origOpen();
                    _openConfigModal();
                    _btn.removeEventListener('click', setupAndOpen);
                    _btn.addEventListener('click', toggleChatPanel);
                };
                _btn.removeEventListener('click', toggleChatPanel);
                _btn.addEventListener('click', setupAndOpen);
            }
        } catch (_) {}
    }

        // ── Public init ───────────────────────────────────────────────────────────
    function initChat() {
        if (!_buildDOM()) return;   // HTML elements not present (launcher page)
        _updateButtonIcon();
        _attachEvents();
        _checkConfig();
    }

    // Expose globally so viz.js can call initChat()
    window.initChat = initChat;

})();
