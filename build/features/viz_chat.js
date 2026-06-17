(function() {
  "use strict";
  let _isOpen = false;
  let _isBusy = false;
  let _history = [];
  let _streamBubble = null;
  let _streamText = "";
  let _currentChatProvider = null;
  let _lastTurnHadError = false;
  let _cancelStream = null;
  let _thinkLog = [];
  let _inputHistory = [];
  let _historyIndex = -1;
  let _tempInput = "";
  const _badgeMap = /* @__PURE__ */ new Map();
  let _tourSubtitleEl = null;
  let _tourSubtitleTimer = null;
  let _currentDepth = localStorage.getItem("vizcode.chat.depth") || "quick";
  let _currentOutput = localStorage.getItem("vizcode.chat.output") || null;
  if (_currentOutput === "mermaid_flow") {
    _currentOutput = "flow";
    localStorage.setItem("vizcode.chat.output", "flow");
  }
  let _modePickerOpen = false;
  let _currentSessionId = null;
  let _sessionsOpen = false;
  let _btn, _panel, _msgs, _input, _sendBtn, _modal;
  let _chatCfgSnapshot = {};
  let _chatIsConfigured = null;
  let _isDragging = false;
  let _dragOffsetX = 0;
  let _dragOffsetY = 0;
  let _panelMode = localStorage.getItem("vizcode.chat.panelMode") || "side";
  function _renderMarkdown(text) {
    const flowBlocks = [];
    let t = text.replace(/```(?:vizflow|mermaid)\n?([\s\S]*?)```/g, function(_, code) {
      const idx = flowBlocks.length;
      flowBlocks.push(code.trim());
      return "\0MM" + idx + "\0";
    });
    t = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_, lang, code) {
      const cls = lang ? ` class="language-${lang}"` : "";
      return `<pre><code${cls}>${code.trimEnd()}</code></pre>`;
    });
    t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
    t = t.replace(/\x00MM(\d+)\x00/g, function(_, idx) {
      const src = flowBlocks[Number(idx)] || "";
      const esc = src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<div class="chat-flow">${esc}</div>`;
    });
    t = t.replace(/\n{2,}/g, "</p><p>");
    t = _applyBadges(t);
    return "<p>" + t + "</p>";
  }
  function _applyBadges(html) {
    if (!_badgeMap.size) return html;
    const labels = Array.from(_badgeMap.keys()).sort((a, b) => b.length - a.length);
    for (const label of labels) {
      const nodeId = _badgeMap.get(label);
      if (!label || !nodeId) continue;
      const safe = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("(^|[^<\\w/])(" + safe + ")(?![\\w/])");
      const idAttr = nodeId.replace(/"/g, "&quot;");
      const labelAttr = label.replace(/"/g, "&quot;");
      html = html.replace(
        re,
        (_, pre, body) => pre + `<span class="chat-badge" data-node-id="${idAttr}" data-label="${labelAttr}">${body}</span>`
      );
    }
    return html;
  }
  function _open() {
    _isOpen = true;
    _panel.classList.add("open");
    if (_panelMode === "side" && _chatResizer) _chatResizer.style.display = "block";
    _btn.classList.add("active");
    _updateButtonIcon();
    _checkConfig();
    _triggerFlowsIfNeeded();
    setTimeout(() => _input.focus(), 220);
  }
  function _close() {
    _isOpen = false;
    _panel.classList.remove("open");
    if (_chatResizer) _chatResizer.style.display = "none";
    _btn.classList.remove("active");
    _updateButtonIcon();
  }
  function _updateButtonIcon() {
    const svg = _isOpen ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    _btn.innerHTML = svg + `<span>AI Chat</span>`;
  }
  function toggleChatPanel() {
    _isOpen ? _close() : _open();
  }
  function _appendMsg(role, htmlContent) {
    const div = document.createElement("div");
    div.className = role === "user" ? "chat-msg chat-msg-user" : role === "sys" ? "chat-msg-sys" : role === "err" ? "chat-msg-err" : "chat-msg chat-msg-ai";
    if (role === "user" || role === "sys" || role === "err") {
      div.textContent = htmlContent;
    } else {
      div.innerHTML = htmlContent;
    }
    _msgs.appendChild(div);
    _scrollBottom();
    return div;
  }
  function _appendToolBadge(name, result) {
    const badge = document.createElement("div");
    badge.className = "chat-tool-badge";
    badge.innerHTML = `<span class="tool-icon">\u{1F50D}</span><span>${_escHtml(name)}</span>`;
    const resultBox = document.createElement("pre");
    resultBox.className = "chat-tool-result";
    resultBox.textContent = result;
    badge.addEventListener("click", function() {
      resultBox.classList.toggle("show");
    });
    _msgs.appendChild(badge);
    _msgs.appendChild(resultBox);
    _scrollBottom();
  }
  function _appendTyping() {
    const div = document.createElement("div");
    div.className = "chat-typing";
    div.id = "_chat-typing";
    div.innerHTML = '<div class="chat-typing-dots"><span></span><span></span><span></span></div><div class="chat-think-log" hidden></div>';
    div.querySelector(".chat-typing-dots").addEventListener("click", function() {
      const log = div.querySelector(".chat-think-log");
      if (!log || !_thinkLog.length) return;
      if (log.hasAttribute("hidden")) {
        log.removeAttribute("hidden");
        div.classList.add("open");
        log.scrollTop = log.scrollHeight;
      } else {
        log.setAttribute("hidden", "");
        div.classList.remove("open");
      }
      _scrollBottom();
    });
    _msgs.appendChild(div);
    _renderThinkLog();
    _scrollBottom();
    return div;
  }
  function _removeTyping() {
    const el = document.getElementById("_chat-typing");
    if (el) el.remove();
  }
  function _pushThink(text) {
    text = String(text == null ? "" : text).trim();
    if (!text) return;
    if (_thinkLog.length && _thinkLog[_thinkLog.length - 1] === text) return;
    _thinkLog.push(text);
    _renderThinkLog();
  }
  function _renderThinkLog() {
    const typing = document.getElementById("_chat-typing");
    if (!typing) return;
    const log = typing.querySelector(".chat-think-log");
    if (!log) return;
    if (!_thinkLog.length) {
      typing.classList.remove("has-think");
      return;
    }
    typing.classList.add("has-think");
    typing.title = _t("chatThinkHint", "Click to see what the AI is doing");
    log.innerHTML = _thinkLog.map(function(s) {
      return '<div class="chat-think-step">' + _escHtml(s) + "</div>";
    }).join("");
    if (!log.hasAttribute("hidden")) log.scrollTop = log.scrollHeight;
  }
  function _startStreamBubble() {
    _streamText = "";
    _streamBubble = document.createElement("div");
    _streamBubble.className = "chat-msg chat-msg-ai";
    _msgs.appendChild(_streamBubble);
    _scrollBottom();
  }
  function _appendStreamDelta(text) {
    _streamText += text;
    _streamBubble.innerHTML = _renderMarkdown(_streamText);
    _scrollBottom();
  }
  function _finaliseStreamBubble() {
    _triggerFlowsIfNeeded();
    if (_isOpen && _msgs) {
      _msgs.querySelectorAll(".chat-flow:not([data-rendered])").forEach(_showFlowSource);
    }
    _streamBubble = null;
    _streamText = "";
  }
  function _scrollBottom() {
    _msgs.scrollTop = _msgs.scrollHeight;
  }
  function _escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function _chatProviderHasCredential(provider, cfg) {
    if (provider === "anthropic") return !!cfg.anthropic_api_key_present;
    if (provider === "openai") return !!cfg.openai_api_key_present;
    if (provider === "grok") return !!cfg.grok_api_key_present;
    if (provider === "gemini") return !!cfg.gemini_api_key_present;
    if (provider === "ollama") return !!cfg.ollama_url_present;
    if (provider === "custom") return !!cfg.custom_api_key_present;
    return false;
  }
  function _chatConfigIsReady(cfg) {
    if (!cfg) return false;
    if ((cfg.ai_mode || "api") === "cli") return !!(cfg.cli_agent || "claude");
    return _chatProviderHasCredential(cfg.provider || "anthropic", cfg);
  }
  function _openAiSettingsFromChat() {
    if (typeof window.openAiSettings === "function") {
      window.openAiSettings();
      return;
    }
    const prefBtn = document.getElementById("pref-btn");
    if (prefBtn) {
      prefBtn.click();
      setTimeout(() => {
        try {
          if (typeof _activatePrefSection === "function") _activatePrefSection("ai");
        } catch (_) {
        }
      }, 80);
    }
  }
  function _appendSetupGuide() {
    if (!_msgs || document.getElementById("chat-setup-card")) return;
    const card = document.createElement("div");
    card.id = "chat-setup-card";
    card.className = "chat-setup-card";
    card.innerHTML = `
          <div class="chat-setup-title">${_escHtml(_t("chatSetupRequiredTitle", "AI is not configured"))}</div>
          <div class="chat-setup-copy">${_escHtml(_t("chatSetupRequiredCopy", "Choose an API provider or Local CLI before using chat."))}</div>
          <button type="button" class="chat-setup-btn">${_escHtml(_t("chatSetupRequiredAction", "Open AI Settings"))}</button>`;
    card.querySelector(".chat-setup-btn")?.addEventListener("click", _openAiSettingsFromChat);
    _msgs.appendChild(card);
    _scrollBottom();
  }
  const _FLOW_MAX_NODES = 80;
  function _flowTheme() {
    const cs = getComputedStyle(document.documentElement);
    const get = function(v, d) {
      return cs.getPropertyValue(v).trim() || d;
    };
    return {
      bg: get("--bg", "#0f110e"),
      panel2: get("--panel2", "#1b1c19"),
      border: get("--border", "#2c2d2a"),
      accent: get("--accent", "#dfa745"),
      text: get("--text", "#eae8e3"),
      muted: get("--muted", "#93918b")
    };
  }
  function _flowKindColor(kind, theme) {
    switch (String(kind || "").toLowerCase()) {
      case "entry":
        return theme.accent;
      case "exit":
        return "#e0795b";
      case "decision":
        return "#c9a227";
      case "io":
      case "data":
        return "#5b8def";
      default:
        return theme.border;
    }
  }
  function _parseMermaidFlow(src) {
    const text = String(src || "").replace(/<br\s*\/?>/gi, " ");
    if (!/^\s*(flowchart|graph)\b/i.test(text)) return null;
    const ARROW = /\s*(-->|---|-\.->|-\.-|==>|===|--[xo]|==[xo])\s*/;
    const ARROW_ONLY = /^(-->|---|-\.->|-\.-|==>|===|--[xo]|==[xo])$/;
    let direction = "TB";
    const nodes = /* @__PURE__ */ new Map();
    const edges = [];
    function reg(token) {
      const m = String(token).trim().match(/^([A-Za-z0-9_]+)\s*([\s\S]*)$/);
      if (!m) return null;
      const id = m[1];
      let label = id, kind = "process";
      const rest = m[2].trim();
      if (rest) {
        const sh = rest.match(/^(\{\{[\s\S]*\}\}|\{[\s\S]*\}|\(\[[\s\S]*\]\)|\[\([\s\S]*\)\]|\[\[[\s\S]*\]\]|\[[\s\S]*\]|\([\s\S]*\))$/);
        if (sh) {
          const inner = sh[1];
          if (inner.charAt(0) === "{") kind = "decision";
          label = inner.replace(/^[\[\(\{]+/, "").replace(/[\]\)\}]+$/, "").replace(/^["']|["']$/g, "").trim() || id;
        }
      }
      if (!nodes.has(id)) {
        nodes.set(id, { id, label, kind });
      } else {
        const n = nodes.get(id);
        if (label !== id && n.label === id) n.label = label;
        if (kind === "decision") n.kind = "decision";
      }
      return id;
    }
    text.split(/\r?\n/).forEach(function(raw) {
      let line = raw.trim();
      if (!line) return;
      const dm = line.match(/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/i);
      if (dm) {
        const d = dm[1].toUpperCase();
        direction = d === "LR" || d === "RL" ? "LR" : "TB";
        return;
      }
      if (/^(flowchart|graph)\b/i.test(line)) return;
      if (/^(subgraph|end|classDef|class|style|linkStyle|click|direction|%%)/i.test(line)) return;
      line = line.replace(/;+\s*$/, "");
      const segs = line.split(ARROW);
      let prevId = null;
      for (let i = 0; i < segs.length; i++) {
        let seg = (segs[i] || "").trim();
        if (!seg || ARROW_ONLY.test(seg)) continue;
        let label = "";
        const lm = seg.match(/^\|([^|]*)\|\s*([\s\S]*)$/);
        if (lm) {
          label = lm[1].trim();
          seg = lm[2].trim();
        }
        if (!seg) continue;
        const id = reg(seg);
        if (id && prevId) edges.push({ from: prevId, to: id, label });
        if (id) prevId = id;
      }
    });
    if (!nodes.size) return null;
    return { direction, nodes: Array.from(nodes.values()), edges };
  }
  function _buildFlowElements(spec, theme) {
    const els = [];
    const ids = /* @__PURE__ */ new Set();
    (spec.nodes || []).slice(0, _FLOW_MAX_NODES).forEach(function(n) {
      if (!n || n.id == null) return;
      const id = String(n.id);
      if (ids.has(id)) return;
      ids.add(id);
      els.push({ data: {
        id,
        label: String(n.label != null ? n.label : id),
        ref: n.ref ? String(n.ref) : "",
        accent: _flowKindColor(n.kind, theme),
        shape: String(n.kind || "").toLowerCase() === "decision" ? "round-diamond" : "round-rectangle"
      } });
    });
    (spec.edges || []).forEach(function(e) {
      if (!e) return;
      const s = String(e.from != null ? e.from : e.source);
      const t = String(e.to != null ? e.to : e.target);
      if (!ids.has(s) || !ids.has(t)) return;
      els.push({ data: { source: s, target: t, label: e.label ? String(e.label) : "" } });
    });
    return els;
  }
  function _flowStyle(theme, opts) {
    opts = opts || {};
    return [
      { selector: "node", style: {
        "background-color": theme.panel2,
        "border-color": "data(accent)",
        "border-width": 1.5,
        "shape": "data(shape)",
        "label": "data(label)",
        "color": theme.text,
        "font-size": opts.fontSize || 11,
        "font-family": "'Segoe UI', system-ui, sans-serif",
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "text-max-width": opts.maxWidth || 120,
        "width": "label",
        "height": "label",
        "padding": opts.padding || "8px"
      } },
      { selector: 'node[ref != ""]', style: { "cursor": "pointer" } },
      { selector: "edge", style: {
        "width": 1.4,
        "line-color": theme.muted,
        "target-arrow-color": theme.muted,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        "curve-style": "bezier",
        "label": "data(label)",
        "font-size": opts.edgeFontSize || 9.5,
        "color": theme.muted,
        "text-background-color": theme.bg,
        "text-background-opacity": 1,
        "text-background-padding": "2px"
      } }
    ];
  }
  function _makeFlowCy(host, els, rankDir, theme, opts) {
    opts = opts || {};
    let cy;
    try {
      cy = window.cytoscape({
        container: host,
        elements: els,
        style: _flowStyle(theme, opts),
        userZoomingEnabled: !!opts.interactive,
        userPanningEnabled: !!opts.interactive,
        boxSelectionEnabled: false,
        autoungrabify: !opts.interactive,
        minZoom: 0.2,
        maxZoom: 3
      });
    } catch (_) {
      return null;
    }
    function _runLayout(name, extra) {
      const lay = cy.layout(Object.assign({ name }, extra || {}));
      lay.one("layoutstop", function() {
        try {
          cy.fit(void 0, opts.fitPadding || 16);
        } catch (_) {
        }
      });
      lay.run();
    }
    try {
      _runLayout("dagre", { rankDir, nodeSep: 28, rankSep: 42, edgeSep: 12 });
    } catch (_) {
      try {
        _runLayout("breadthfirst", { directed: true, spacingFactor: 1.1 });
      } catch (e2) {
        try {
          cy.destroy();
        } catch (_2) {
        }
        return null;
      }
    }
    cy.on("tap", "node", function(evt) {
      const ref = evt.target.data("ref");
      if (ref) _highlightNodeById(ref);
    });
    return cy;
  }
  const _FLOW_EXPAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  const _FLOW_CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  function _openFlowModal(spec) {
    if (!spec || typeof window.cytoscape !== "function") return;
    const prev = document.getElementById("chat-flow-modal");
    if (prev) prev.remove();
    const theme = _flowTheme();
    const overlay = document.createElement("div");
    overlay.id = "chat-flow-modal";
    overlay.className = "chat-flow-modal";
    const panel = document.createElement("div");
    panel.className = "chat-flow-modal-panel";
    const head = document.createElement("div");
    head.className = "chat-flow-modal-head";
    const ttl = document.createElement("span");
    ttl.className = "chat-flow-modal-title";
    ttl.textContent = spec.title ? String(spec.title) : _t("chatFlowDiagram", "Flow diagram");
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "chat-flow-modal-close";
    closeBtn.title = _t("chatFlowClose", "Close");
    closeBtn.setAttribute("aria-label", _t("chatFlowClose", "Close"));
    closeBtn.innerHTML = _FLOW_CLOSE_SVG;
    head.appendChild(ttl);
    head.appendChild(closeBtn);
    const host = document.createElement("div");
    host.className = "chat-flow-modal-canvas";
    const ctrls = document.createElement("div");
    ctrls.className = "chat-flow-modal-ctrls";
    panel.appendChild(head);
    panel.appendChild(host);
    panel.appendChild(ctrls);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const els = _buildFlowElements(spec, theme);
    const dir = String(spec.direction || "TB").toUpperCase();
    const rankDir = dir === "LR" || dir === "RL" ? "LR" : "TB";
    const cy = _makeFlowCy(host, els, rankDir, theme, {
      interactive: true,
      fontSize: 16,
      edgeFontSize: 12.5,
      maxWidth: 220,
      padding: "12px",
      fitPadding: 32
    });
    function _zoomBy(factor) {
      if (!cy) return;
      const next = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
      cy.zoom({ level: next, renderedPosition: { x: host.clientWidth / 2, y: host.clientHeight / 2 } });
    }
    function _mkCtrl(label, title, fn) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", function(e) {
        e.stopPropagation();
        fn();
      });
      ctrls.appendChild(b);
    }
    _mkCtrl("+", _t("chatFlowZoomIn", "Zoom in"), function() {
      _zoomBy(1.25);
    });
    _mkCtrl("\u2212", _t("chatFlowZoomOut", "Zoom out"), function() {
      _zoomBy(0.8);
    });
    _mkCtrl("\u2922", _t("chatFlowFit", "Fit to view"), function() {
      if (cy) {
        try {
          cy.fit(void 0, 32);
        } catch (_) {
        }
      }
    });
    function _close2() {
      try {
        if (cy) cy.destroy();
      } catch (_) {
      }
      document.removeEventListener("keydown", _onKey);
      overlay.remove();
    }
    function _onKey(e) {
      if (e.key === "Escape") _close2();
    }
    closeBtn.addEventListener("click", _close2);
    overlay.addEventListener("click", function(e) {
      if (e.target === overlay) _close2();
    });
    document.addEventListener("keydown", _onKey);
  }
  function _showFlowSource(el) {
    const src = el.dataset.src || el.textContent || "";
    el.setAttribute("data-rendered", "1");
    el.classList.add("chat-flow-fallback");
    el.innerHTML = "<pre>" + _escHtml(src) + "</pre>";
  }
  function _renderFlowEl(el) {
    if (typeof window.cytoscape !== "function") {
      _showFlowSource(el);
      return true;
    }
    const raw = (el.dataset.src || el.textContent || "").trim();
    let spec = null;
    try {
      spec = JSON.parse(raw);
    } catch (_) {
      spec = null;
    }
    if (!spec || typeof spec !== "object" || !Array.isArray(spec.nodes)) {
      try {
        spec = _parseMermaidFlow(raw);
      } catch (_) {
        spec = null;
      }
    }
    if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) return false;
    const theme = _flowTheme();
    const els = _buildFlowElements(spec, theme);
    if (!els.length) {
      el.dataset.src = raw;
      _showFlowSource(el);
      return true;
    }
    if (el.__cy) {
      try {
        el.__cy.destroy();
      } catch (_) {
      }
      el.__cy = null;
    }
    el.dataset.src = raw;
    el.textContent = "";
    el.setAttribute("data-rendered", "1");
    if (spec.title) {
      const cap = document.createElement("div");
      cap.className = "chat-flow-title";
      cap.textContent = String(spec.title);
      el.appendChild(cap);
    }
    const host = document.createElement("div");
    host.className = "chat-flow-canvas";
    el.appendChild(host);
    const dir = String(spec.direction || "TB").toUpperCase();
    const rankDir = dir === "LR" || dir === "RL" ? "LR" : "TB";
    const cy = _makeFlowCy(host, els, rankDir, theme, { interactive: false });
    if (!cy) {
      _showFlowSource(el);
      return true;
    }
    el.__cy = cy;
    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "chat-flow-expand";
    expandBtn.title = _t("chatFlowExpand", "Enlarge diagram");
    expandBtn.setAttribute("aria-label", _t("chatFlowExpand", "Enlarge diagram"));
    expandBtn.innerHTML = _FLOW_EXPAND_SVG;
    expandBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      _openFlowModal(spec);
    });
    el.appendChild(expandBtn);
    return true;
  }
  function _renderPendingFlows() {
    const nodes = _msgs.querySelectorAll(".chat-flow:not([data-rendered])");
    if (!nodes.length) return;
    nodes.forEach(function(el) {
      try {
        _renderFlowEl(el);
      } catch (_) {
      }
    });
    _scrollBottom();
  }
  function _triggerFlowsIfNeeded() {
    if (!_msgs || !_isOpen) return;
    if (!_msgs.querySelector(".chat-flow:not([data-rendered])")) return;
    _renderPendingFlows();
  }
  function _appendUiActionBadge(action, args) {
    const div = document.createElement("div");
    div.className = "chat-ui-action";
    const val = args && Object.keys(args).length ? " " + Object.values(args).map(function(v) {
      return String(v);
    }).join(" \u2192 ") : "";
    div.textContent = "\u2192 canvas: " + action + val;
    _msgs.appendChild(div);
    _scrollBottom();
  }
  function _dispatchUiAction(action, args) {
    args = args || {};
    const toast = typeof window.showToast === "function" ? window.showToast : function() {
    };
    try {
      switch (action) {
        case "goto_l0":
          if (typeof window.loadLevel0 === "function") {
            window.loadLevel0();
            toast("AI: switched to L0 overview", "info");
          }
          break;
        case "goto_l1": {
          const mod = args.module || "";
          if (mod && typeof window.drillToModule === "function") {
            window.drillToModule(mod);
            toast("AI: opened module " + mod, "info");
          }
          break;
        }
        case "goto_l2": {
          const f = args.file || "";
          if (f && typeof window.drillToFile === "function") {
            window.drillToFile(f);
            toast("AI: opened " + f, "info");
          }
          break;
        }
        case "highlight_node":
          _highlightNodeById(args.node_id || "");
          break;
        case "highlight_nodes":
          if (Array.isArray(args.node_ids) && typeof window.highlightNodes === "function") {
            const realIds = [];
            args.node_ids.forEach(function(nid) {
              const n = _resolveCanvasNode(nid);
              if (n && n.length) realIds.push((n.length > 1 ? n.first() : n).id());
            });
            if (realIds.length) window.highlightNodes(realIds);
            else _canvasMissToast((args.node_ids[0] || "") + " \u2026");
          }
          break;
        case "highlight_path":
          _highlightPath(args.source || "", args.target || "");
          break;
        case "emit_badge":
          if (args.label && args.node_id) {
            _badgeMap.set(String(args.label), String(args.node_id));
          }
          if (_streamBubble && _streamText) {
            _streamBubble.innerHTML = _renderMarkdown(_streamText);
          }
          break;
        case "tour_step":
          _runTourStep(args.node_id || "", args.caption || "");
          break;
        case "noop":
          break;
        default:
          console.warn("[VizBridge] unknown ui_action:", action);
      }
    } catch (err) {
      console.error("[VizBridge] ui_action dispatch failed:", err);
    }
    if (action !== "emit_badge") _appendUiActionBadge(action, args);
  }
  function _resolveCanvasNode(id) {
    const cy = window.cy;
    if (!id || !cy) return null;
    const direct = cy.getElementById(id);
    if (direct && direct.length) return direct;
    const sep = id.indexOf("::");
    if (sep !== -1) {
      const path = id.slice(0, sep);
      const fn = id.slice(sep + 2);
      let m = cy.nodes().filter(function(n) {
        return n.data("_t") === "func" && n.data("_f") === path && (n.data("fn") === fn || n.data("label") === fn);
      });
      if (m.length) return m;
      m = cy.nodes().filter(function(n) {
        return n.data("_t") === "func" && (n.data("fn") === fn || n.data("label") === fn);
      });
      if (m.length) return m;
    }
    const byPath = cy.nodes().filter(function(n) {
      const f = n.data("_f");
      return n.data("_t") === "file" && f && f.path === id;
    });
    if (byPath.length) return byPath;
    const byLabel = cy.nodes().filter(function(n) {
      return n.data("label") === id || n.data("id") === id;
    });
    if (byLabel.length) return byLabel;
    const base = id.indexOf("/") !== -1 ? id.split("/").pop() : "";
    if (base) {
      const byBase = cy.nodes().filter(function(n) {
        return n.data("label") === base;
      });
      if (byBase.length) return byBase;
    }
    return cy.collection();
  }
  function _navigateToNodeId(id) {
    if (!id) return false;
    const sep = id.indexOf("::");
    if (sep !== -1) {
      const path = id.slice(0, sep);
      if (path && typeof window.drillToFile === "function") {
        try {
          window.drillToFile(path);
          return true;
        } catch (_) {
        }
      }
      return false;
    }
    if (/\.[A-Za-z0-9]+$/.test(id)) {
      const mod = window.DATA && window.DATA.file_to_module && window.DATA.file_to_module[id] || (typeof window.resolveModuleForFile === "function" ? window.resolveModuleForFile(id) : "");
      if (mod && typeof window.drillToModule === "function") {
        try {
          window.drillToModule(mod, { focusFile: id });
          return true;
        } catch (_) {
        }
      }
    }
    return false;
  }
  function _canvasMissToast(nodeId) {
    if (typeof window.showToast === "function") {
      window.showToast("AI \u5C0E\u89BD\u627E\u4E0D\u5230\u7BC0\u9EDE:" + nodeId, "info");
    }
    console.warn("[VizBridge] node not found on canvas:", nodeId);
  }
  function _runTourStep(nodeId, caption) {
    if (!nodeId || !window.cy) return;
    const node = _resolveCanvasNode(nodeId);
    if (node && node.length) {
      _focusTourNode(node.length > 1 ? node.first() : node, caption);
      return;
    }
    if (_navigateToNodeId(nodeId)) {
      setTimeout(function() {
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
      { duration: 500, easing: "ease-in-out-cubic" }
    );
    if (typeof window.pinHighlightNode === "function") {
      try {
        window.pinHighlightNode(node);
      } catch (_) {
      }
    }
    if (caption) _showTourSubtitle(node, caption);
  }
  function _showTourSubtitle(node, caption) {
    if (!_tourSubtitleEl) {
      _tourSubtitleEl = document.createElement("div");
      _tourSubtitleEl.className = "tour-subtitle";
      document.body.appendChild(_tourSubtitleEl);
    }
    _tourSubtitleEl.textContent = caption;
    _tourSubtitleEl.style.opacity = "1";
    setTimeout(() => {
      if (!_tourSubtitleEl || !node || !node.length) return;
      const rp = node.renderedPosition();
      const cyContainer = window.cy && window.cy.container();
      const rect = cyContainer ? cyContainer.getBoundingClientRect() : { left: 0, top: 0 };
      _tourSubtitleEl.style.left = rect.left + rp.x + 16 + "px";
      _tourSubtitleEl.style.top = rect.top + rp.y - 8 + "px";
    }, 520);
    if (_tourSubtitleTimer) clearTimeout(_tourSubtitleTimer);
    _tourSubtitleTimer = setTimeout(() => {
      if (_tourSubtitleEl) _tourSubtitleEl.style.opacity = "0";
    }, 3500);
  }
  function _highlightNodeById(id) {
    if (!id || !window.cy) return;
    const node = _resolveCanvasNode(id);
    if (node && node.length && typeof window.highlightNode === "function") {
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
      const dj = cy.elements().dijkstra({ root: sRoot, directed: false });
      const path = dj.pathTo(tNode);
      if (!path || !path.length) return;
      cy.elements().removeClass("hl");
      path.addClass("hl");
    } catch (e) {
      console.warn("[VizBridge] highlight_path failed:", e);
    }
  }
  function _sendMessage() {
    const text = _input.value.trim();
    if (!text || _isBusy) return;
    if (_chatIsConfigured === false) {
      _appendSetupGuide();
      return;
    }
    _badgeMap.clear();
    _input.value = "";
    _input.style.height = "";
    _appendMsg("user", text);
    _inputHistory.push(text);
    _historyIndex = -1;
    _tempInput = "";
    _history.push({ role: "user", content: text });
    _setBusy(true);
    const jobId = window.JOB_ID || "";
    const body = JSON.stringify({
      job_id: jobId,
      history: _history,
      depth: _currentDepth,
      output: _currentOutput
    });
    _thinkLog = [];
    _removeTyping();
    _appendTyping();
    fetch("/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    }).then(function(resp) {
      if (!resp.ok) {
        return resp.json().then(function(err) {
          throw new Error(err.error || "Server error " + resp.status);
        });
      }
      _readSSE(resp.body);
    }).catch(function(err) {
      _removeTyping();
      _appendMsg("err", "Error: " + err.message);
      _setBusy(false);
    });
  }
  function _readSSE(readableStream) {
    _currentChatProvider = null;
    _lastTurnHadError = false;
    const reader = readableStream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const assistantContent = [];
    let _sseFinished = false;
    let _timeoutId = null;
    function _idleLimitMs() {
      return (_currentChatProvider || "").startsWith("cli:") ? 10 * 60 * 1e3 : 90 * 1e3;
    }
    function _resetIdleTimer() {
      clearTimeout(_timeoutId);
      _timeoutId = setTimeout(function() {
        if (!_cleanup(true)) return;
        _removeTyping();
        if (!_lastTurnHadError) {
          const seconds = Math.round(_idleLimitMs() / 1e3);
          _appendMsg("err", `No activity from AI for ${seconds} s. The local CLI may still be running in the background.`);
        }
        _setBusy(false);
      }, _idleLimitMs());
    }
    function _cleanup(cancel) {
      if (_sseFinished) return false;
      _sseFinished = true;
      _cancelStream = null;
      clearTimeout(_timeoutId);
      try {
        if (cancel) reader.cancel();
      } catch (_) {
      }
      return true;
    }
    _timeoutId = setTimeout(function() {
      if (!_cleanup(true)) return;
      _removeTyping();
      if (!_lastTurnHadError) {
        _appendMsg("err", "No response after 90 s \u2014 check your API key and server logs.");
      }
      _setBusy(false);
    }, _idleLimitMs());
    _cancelStream = function() {
      if (!_cleanup(true)) return;
      if (_streamBubble) _finaliseStreamBubble();
      const fullText = assistantContent.filter(function(c) {
        return c.type === "text_fragment";
      }).map(function(c) {
        return c.text;
      }).join("");
      if (fullText) _history.push({ role: "assistant", content: fullText });
      _removeTyping();
      _setBusy(false);
    };
    function _finish() {
      if (!_cleanup(false)) return;
      _finishTurn(assistantContent);
    }
    function pump() {
      reader.read().then(function({ done, value }) {
        if (_sseFinished) return;
        if (done) {
          _finish();
          return;
        }
        buf += decoder.decode(value, { stream: true });
        let idx;
        let gotDone = false;
        while (!gotDone && (idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;
            try {
              const ev = JSON.parse(dataStr);
              _resetIdleTimer();
              if (ev.type === "done") {
                gotDone = true;
                break;
              }
              _handleSSEEvent(ev, assistantContent);
            } catch (_) {
            }
          }
        }
        if (gotDone) {
          try {
            reader.cancel();
          } catch (_) {
          }
          _finish();
          return;
        }
        pump();
      }).catch(function(err) {
        if (_sseFinished) return;
        _cleanup(false);
        _removeTyping();
        _appendMsg("err", "Stream error: " + err.message);
        _setBusy(false);
      });
    }
    pump();
  }
  function _handleSSEEvent(ev, assistantContent) {
    if (ev.type === "delta") {
      _removeTyping();
      if (!_streamBubble) _startStreamBubble();
      _appendStreamDelta(ev.text);
      assistantContent.push({ type: "text_fragment", text: ev.text });
    } else if (ev.type === "provider") {
      _currentChatProvider = ev.name;
    } else if (ev.type === "tool_call") {
      _appendToolBadge(ev.name, ev.result || "");
      _pushThink("\u{1F527} " + (ev.name || "tool"));
    } else if (ev.type === "ui_action") {
      _dispatchUiAction(ev.action, ev.args || {});
      _pushThink("\u2192 " + (ev.action || "canvas"));
    } else if (ev.type === "cached") {
      _markBubbleCached(ev.entry_id || "");
    } else if (ev.type === "status") {
      if (ev.message) _pushThink(ev.message);
    } else if (ev.type === "metrics") {
      const parts = [];
      if (ev.cached) parts.push("cached");
      if (ev.tool_calls != null) parts.push(`${ev.tool_calls} tools`);
      if (ev.input_chars != null) parts.push(`${ev.input_chars} input chars`);
      if (ev.elapsed_ms != null) parts.push(`${ev.elapsed_ms} ms`);
      if (parts.length) _pushThink(parts.join(" | "));
    } else if (ev.type === "done") {
    } else if (ev.type === "error") {
      _removeTyping();
      if (_streamBubble) {
        _streamBubble.remove();
        _streamBubble = null;
      }
      _lastTurnHadError = true;
      _appendMsg("err", ev.message || "Unknown error");
      _setBusy(false);
    }
  }
  function _markBubbleCached(entryId) {
    const bubble = _streamBubble || _msgs.querySelector(".chat-msg-ai:last-child");
    if (!bubble) return;
    if (bubble.querySelector(".chat-cached-badge")) return;
    const badge = document.createElement("span");
    badge.className = "chat-cached-badge";
    badge.dataset.entryId = entryId;
    badge.innerHTML = '\u26A1 Cached <button class="chat-cached-refresh" title="Regenerate">\u21BA</button>';
    badge.querySelector(".chat-cached-refresh").addEventListener("click", function(e) {
      e.stopPropagation();
      _resendLastWithForceRefresh();
    });
    bubble.appendChild(badge);
  }
  function _resendLastWithForceRefresh() {
    if (_isBusy) return;
    if (_history.length >= 1 && _history[_history.length - 1].role === "assistant") {
      _history.pop();
    }
    const bubbles = _msgs ? _msgs.querySelectorAll(".chat-msg-ai") : [];
    if (bubbles.length) bubbles[bubbles.length - 1].remove();
    _setBusy(true);
    _thinkLog = [];
    _removeTyping();
    _appendTyping();
    fetch("/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: window.JOB_ID || "",
        history: _history,
        depth: _currentDepth,
        output: _currentOutput,
        force_refresh: true
      })
    }).then(function(resp) {
      if (!resp.ok) {
        return resp.json().then(function(err) {
          throw new Error(err.error || "Server error " + resp.status);
        });
      }
      _readSSE(resp.body);
    }).catch(function(err) {
      _removeTyping();
      _appendMsg("err", "Error: " + err.message);
      _setBusy(false);
    });
  }
  function _newSessionId() {
    const d = /* @__PURE__ */ new Date(), pad = function(n) {
      return String(n).padStart(2, "0");
    };
    return "session_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  function _saveHistory() {
    if (!_currentSessionId || !_history.length) return;
    fetch("/chat-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: window.JOB_ID || "", session_id: _currentSessionId, history: _history })
    }).catch(function() {
    });
  }
  function _renderSessionMessages(history) {
    if (_msgs) _msgs.innerHTML = "";
    history.forEach(function(msg) {
      if (msg.role === "user") _appendMsg("user", msg.content);
      else if (msg.role === "assistant") _appendMsg("ai", _renderMarkdown(msg.content));
    });
    _triggerFlowsIfNeeded();
  }
  function _loadHistory() {
    const jobId = window.JOB_ID || "";
    fetch("/chat-history?job=" + encodeURIComponent(jobId)).then(function(r) {
      return r.ok ? r.json() : null;
    }).then(function(data) {
      if (!data || !Array.isArray(data.history) || !data.history.length) return;
      _currentSessionId = data.session_id || null;
      _history = data.history;
      _renderSessionMessages(data.history);
    }).catch(function() {
    });
  }
  function _clearHistory() {
    _currentSessionId = _newSessionId();
    _history = [];
    if (_msgs) _msgs.innerHTML = "";
  }
  function _buildSessionsList(sessions) {
    const panel = document.getElementById("chat-sessions-panel");
    if (!panel) return;
    panel.innerHTML = "";
    const title = document.createElement("div");
    title.className = "chat-sessions-title";
    title.textContent = "Conversations";
    panel.appendChild(title);
    if (!sessions.length) {
      const empty = document.createElement("div");
      empty.className = "chat-sessions-empty";
      empty.textContent = "No saved conversations yet";
      panel.appendChild(empty);
      return;
    }
    sessions.forEach(function(s) {
      const item = document.createElement("button");
      item.className = "chat-session-item" + (s.session_id === _currentSessionId ? " active" : "");
      const d = new Date(s.created || "");
      const dateStr = isNaN(d.getTime()) ? "" : d.toLocaleDateString(void 0, { month: "short", day: "numeric" }) + "  " + d.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" });
      item.innerHTML = '<span class="chat-si-date">' + dateStr + '</span><span class="chat-si-preview">' + (s.preview || "\u2014") + '</span><span class="chat-si-count">' + (s.message_count || 0) + " msg</span>";
      item.addEventListener("click", function() {
        _currentSessionId = s.session_id;
        _history = [];
        fetch("/chat-history?job=" + encodeURIComponent(window.JOB_ID || "") + "&session=" + encodeURIComponent(s.session_id)).then(function(r) {
          return r.ok ? r.json() : null;
        }).then(function(data) {
          if (!data) return;
          _history = data.history || [];
          _renderSessionMessages(_history);
          _closeSessionsPanel();
        }).catch(function() {
          _closeSessionsPanel();
        });
      });
      panel.appendChild(item);
    });
  }
  function _openSessionsPanel() {
    const panel = document.getElementById("chat-sessions-panel");
    const btn = document.getElementById("chat-hist-btn");
    if (!panel) return;
    fetch("/chat-sessions?job=" + encodeURIComponent(window.JOB_ID || "")).then(function(r) {
      return r.ok ? r.json() : { sessions: [] };
    }).then(function(d) {
      _buildSessionsList(d.sessions || []);
    }).catch(function() {
      _buildSessionsList([]);
    });
    panel.classList.add("open");
    _sessionsOpen = true;
    if (btn) btn.setAttribute("aria-expanded", "true");
  }
  function _closeSessionsPanel() {
    const panel = document.getElementById("chat-sessions-panel");
    const btn = document.getElementById("chat-hist-btn");
    if (!panel) return;
    panel.classList.remove("open");
    _sessionsOpen = false;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function _finishTurn(assistantContent) {
    if (_streamBubble) _finaliseStreamBubble();
    _removeTyping();
    const fullText = assistantContent.filter(function(c) {
      return c.type === "text_fragment";
    }).map(function(c) {
      return c.text;
    }).join("");
    if (fullText) {
      _history.push({ role: "assistant", content: fullText });
      _saveHistory();
      if (_currentChatProvider) {
        try {
          const s = JSON.parse(localStorage.getItem("vizcode_ai_interactions") || "{}");
          s[_currentChatProvider] = true;
          localStorage.setItem("vizcode_ai_interactions", JSON.stringify(s));
        } catch (_) {
        }
      }
    } else if (!_lastTurnHadError) {
      _appendMsg("err", "No response received from AI. Check your API key and server logs.");
    }
    _setBusy(false);
  }
  const _SEND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  const _STOP_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;
  function _setBusy(busy) {
    _isBusy = busy;
    _input.disabled = busy;
    _sendBtn.disabled = false;
    _sendBtn.innerHTML = busy ? _STOP_ICON : _SEND_ICON;
    _sendBtn.title = busy ? "Stop" : "Send";
    _sendBtn.classList.toggle("stop", busy);
  }
  function _updateProviderSections(provider) {
    const mode = document.getElementById("chat-cfg-ai-mode")?.value || "api";
    const activeProvider = mode === "cli" ? "cli" : provider;
    document.querySelectorAll(".chat-cfg-section").forEach(function(sec) {
      sec.style.display = sec.dataset.provider === activeProvider ? "" : "none";
    });
  }
  function _getStatusTitle(isApplied, isInteracted) {
    const i18n = window._i18n;
    if (isInteracted) return i18n ? i18n.t("chatAiStatusInteracted") : "Verified";
    if (isApplied) return i18n ? i18n.t("chatAiStatusApplied") : "Applied";
    return i18n ? i18n.t("chatAiStatusNone") : "Not Configured";
  }
  function _providerHasAppliedKey(provider, cfg) {
    if (provider === "anthropic") return !!cfg.anthropic_api_key_present;
    if (provider === "openai") return !!cfg.openai_api_key_present;
    if (provider === "grok") return !!cfg.grok_api_key_present;
    if (provider === "gemini") return !!cfg.gemini_api_key_present;
    if (provider === "ollama") return !!cfg.ollama_url_present;
    if (provider === "custom") return !!cfg.custom_api_key_present;
    return false;
  }
  function _providerHasInteracted(provider) {
    try {
      const s = JSON.parse(localStorage.getItem("vizcode_ai_interactions") || "{}");
      return !!s[provider];
    } catch (_) {
      return false;
    }
  }
  function _setChatProviderDropdownOpen(dropdown, open) {
    if (!dropdown) return;
    const menu = dropdown.querySelector(".chat-cfg-provider-menu");
    const trigger = dropdown.querySelector(".chat-cfg-provider-trigger");
    const chevron = dropdown.querySelector(".chat-cfg-provider-chevron");
    dropdown.dataset.open = open ? "true" : "false";
    if (menu) {
      menu.style.display = open ? "block" : "none";
      menu.style.pointerEvents = open ? "auto" : "none";
    }
    if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
    if (chevron) chevron.style.transform = open ? "rotate(180deg)" : "rotate(0deg)";
  }
  function _syncChatProviderDropdown(sel, cfg) {
    if (!sel || !sel._chatCfgDropdown) return;
    const dropdown = sel._chatCfgDropdown;
    const label = dropdown.querySelector(".chat-cfg-provider-label");
    const status = dropdown.querySelector(".chat-cfg-provider-status");
    const optionsWrap = dropdown.querySelector(".chat-cfg-provider-options");
    const active = sel.options[sel.selectedIndex] || sel.options[0];
    if (label) label.textContent = active ? active.textContent.trim() : "";
    if (status) {
      const isApplied = active && _providerHasAppliedKey(active.value, cfg || _chatCfgSnapshot);
      const isInteracted = active && _providerHasInteracted(active.value);
      status.classList.toggle("applied", isApplied && !isInteracted);
      status.classList.toggle("interacted", isApplied && isInteracted);
      status.title = _getStatusTitle(isApplied, isInteracted);
    }
    if (!optionsWrap) return;
    optionsWrap.innerHTML = "";
    Array.from(sel.options).forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chat-cfg-provider-option";
      btn.dataset.value = opt.value;
      btn.setAttribute("data-selected", opt.selected ? "true" : "false");
      const main = document.createElement("span");
      main.className = "chat-cfg-provider-option-main";
      const isApplied = _providerHasAppliedKey(opt.value, cfg || _chatCfgSnapshot);
      const isInteracted = _providerHasInteracted(opt.value);
      const dot = document.createElement("span");
      dot.className = "chat-cfg-provider-status" + (isApplied && isInteracted ? " interacted" : isApplied ? " applied" : "");
      dot.title = _getStatusTitle(isApplied, isInteracted);
      main.appendChild(dot);
      const text = document.createElement("span");
      text.className = "chat-cfg-provider-label";
      text.textContent = opt.textContent.trim();
      main.appendChild(text);
      btn.appendChild(main);
      const mark = document.createElement("span");
      mark.className = "chat-cfg-provider-check";
      mark.textContent = opt.selected ? "\u2713" : "";
      btn.appendChild(mark);
      btn.addEventListener("click", () => {
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
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
    const dropdown = document.createElement("div");
    dropdown.className = "chat-cfg-provider-dd";
    dropdown.dataset.open = "false";
    dropdown.innerHTML = `
          <button type="button" class="chat-cfg-provider-trigger" aria-haspopup="listbox" aria-expanded="false">
            <span class="chat-cfg-provider-value">
              <span class="chat-cfg-provider-status"></span>
              <span class="chat-cfg-provider-label"></span>
            </span>
            <span class="chat-cfg-provider-chevron">\u25BE</span>
          </button>
          <div class="chat-cfg-provider-menu">
            <div class="chat-cfg-provider-options" role="listbox" aria-label="Provider"></div>
          </div>`;
    sel.insertAdjacentElement("afterend", dropdown);
    sel._chatCfgDropdown = dropdown;
    const trigger = dropdown.querySelector(".chat-cfg-provider-trigger");
    trigger?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = dropdown.dataset.open !== "true";
      document.querySelectorAll('.chat-cfg-provider-dd[data-open="true"]').forEach((openDd) => {
        if (openDd !== dropdown) _setChatProviderDropdownOpen(openDd, false);
      });
      _setChatProviderDropdownOpen(dropdown, willOpen);
    });
    trigger?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        trigger.click();
      }
      if (e.key === "Escape") _setChatProviderDropdownOpen(dropdown, false);
    });
    sel.addEventListener("change", () => _syncChatProviderDropdown(sel, _chatCfgSnapshot));
    _syncChatProviderDropdown(sel, _chatCfgSnapshot);
  }
  function _setKeyStatus(inputId, cfgKey, cfg) {
    const el = document.getElementById(inputId);
    if (!el) return;
    const masked = cfg[cfgKey] || "";
    const present = !!cfg[cfgKey + "_present"];
    if (present && masked) {
      el.innerHTML = `<strong>Active</strong>${_escHtml(masked)}`;
      el.classList.add("present");
    } else {
      el.textContent = "No stored key";
      el.classList.remove("present");
      el.classList.remove("interacted");
    }
  }
  async function _openConfigModal() {
    _openAiSettingsFromChat();
    return;
    let cfg = {};
    try {
      const r = await fetch("/chat-config");
      if (r.ok) cfg = await r.json();
    } catch (_) {
    }
    _chatCfgSnapshot = cfg || {};
    const provider = cfg.provider || "anthropic";
    document.getElementById("chat-cfg-ai-mode").value = cfg.ai_mode === "cli" ? "cli" : "api";
    document.getElementById("chat-cfg-provider").value = provider;
    document.getElementById("chat-cfg-anthropic-key").value = "";
    document.getElementById("chat-cfg-anthropic-model").value = cfg.anthropic_model || "claude-sonnet-4-6";
    document.getElementById("chat-cfg-openai-key").value = "";
    document.getElementById("chat-cfg-openai-model").value = cfg.openai_model || "gpt-4o";
    document.getElementById("chat-cfg-openai-base-url").value = cfg.openai_base_url || "";
    document.getElementById("chat-cfg-grok-key").value = "";
    document.getElementById("chat-cfg-grok-model").value = cfg.grok_model || "grok-4.20";
    document.getElementById("chat-cfg-gemini-key").value = "";
    document.getElementById("chat-cfg-gemini-model").value = cfg.gemini_model || "gemini-2.0-flash";
    document.getElementById("chat-cfg-ollama-url").value = cfg.ollama_url || "";
    document.getElementById("chat-cfg-ollama-model").value = cfg.ollama_model || "llama3.1";
    document.getElementById("chat-cfg-custom-key").value = "";
    document.getElementById("chat-cfg-custom-base-url").value = cfg.custom_base_url || "";
    document.getElementById("chat-cfg-custom-model").value = cfg.custom_model || "";
    document.getElementById("chat-cfg-cli-agent").value = cfg.cli_agent || "claude";
    document.getElementById("chat-cfg-cli-model").value = cfg.cli_model || "";
    document.getElementById("chat-cfg-claude-cli-path").value = cfg.claude_cli_path || "";
    document.getElementById("chat-cfg-codex-cli-path").value = cfg.codex_cli_path || "";
    document.getElementById("chat-cfg-gemini-cli-path").value = cfg.gemini_cli_path || "";
    _setKeyStatus("chat-cfg-anthropic-key-status", "anthropic_api_key", cfg);
    _setKeyStatus("chat-cfg-openai-key-status", "openai_api_key", cfg);
    _setKeyStatus("chat-cfg-grok-key-status", "grok_api_key", cfg);
    _setKeyStatus("chat-cfg-gemini-key-status", "gemini_api_key", cfg);
    _setKeyStatus("chat-cfg-custom-key-status", "custom_api_key", cfg);
    ["anthropic", "openai", "grok", "gemini", "custom"].forEach((p) => {
      const el = document.getElementById(`chat-cfg-${p}-key-status`);
      if (el && _providerHasInteracted(p)) el.classList.add("interacted");
      else if (el) el.classList.remove("interacted");
    });
    document.querySelectorAll("[data-open-key-folder]").forEach((btn) => {
      const keyDir = cfg.key_store_dir || ".vizcode";
      btn.title = `Open key folder: ${keyDir}`;
      btn.setAttribute("aria-label", `Open key folder: ${keyDir}`);
    });
    _syncChatProviderDropdown(document.getElementById("chat-cfg-provider"), cfg);
    _updateProviderSections(provider);
    _modal.classList.remove("hidden");
  }
  function _closeConfigModal() {
    if (_modal) _modal.classList.add("hidden");
  }
  async function _saveConfig() {
    const provider = document.getElementById("chat-cfg-provider").value;
    const cfg = {
      ai_mode: document.getElementById("chat-cfg-ai-mode").value || "api",
      provider,
      anthropic_api_key: document.getElementById("chat-cfg-anthropic-key").value.trim(),
      anthropic_model: document.getElementById("chat-cfg-anthropic-model").value.trim() || "claude-sonnet-4-6",
      openai_api_key: document.getElementById("chat-cfg-openai-key").value.trim(),
      openai_model: document.getElementById("chat-cfg-openai-model").value.trim() || "gpt-4o",
      openai_base_url: document.getElementById("chat-cfg-openai-base-url").value.trim(),
      grok_api_key: document.getElementById("chat-cfg-grok-key").value.trim(),
      grok_model: document.getElementById("chat-cfg-grok-model").value.trim() || "grok-4.20",
      gemini_api_key: document.getElementById("chat-cfg-gemini-key").value.trim(),
      gemini_model: document.getElementById("chat-cfg-gemini-model").value.trim() || "gemini-2.0-flash",
      ollama_url: document.getElementById("chat-cfg-ollama-url").value.trim() || "http://localhost:11434",
      ollama_model: document.getElementById("chat-cfg-ollama-model").value.trim() || "llama3.1",
      custom_api_key: document.getElementById("chat-cfg-custom-key").value.trim(),
      custom_base_url: document.getElementById("chat-cfg-custom-base-url").value.trim(),
      custom_model: document.getElementById("chat-cfg-custom-model").value.trim(),
      cli_agent: document.getElementById("chat-cfg-cli-agent").value || "claude",
      cli_model: document.getElementById("chat-cfg-cli-model").value.trim(),
      claude_cli_path: document.getElementById("chat-cfg-claude-cli-path").value.trim(),
      codex_cli_path: document.getElementById("chat-cfg-codex-cli-path").value.trim(),
      gemini_cli_path: document.getElementById("chat-cfg-gemini-cli-path").value.trim()
    };
    try {
      const resp = await fetch("/chat-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) throw new Error(data.error || "Unable to save config");
      _chatCfgSnapshot = {};
      _closeConfigModal();
      _appendMsg("sys", cfg.ai_mode === "cli" ? `AI mode saved: Local CLI (${cfg.cli_agent})` : `AI provider saved: ${provider}`);
    } catch (e) {
      alert("Failed to save config: " + e.message);
    }
  }
  function _buildDOM() {
    _btn = document.getElementById("chat-btn");
    if (!_btn) return false;
    _panel = document.getElementById("chat-panel");
    _msgs = document.getElementById("chat-messages");
    _input = document.getElementById("chat-input");
    _sendBtn = document.getElementById("chat-send");
    _modal = document.getElementById("chat-config-modal");
    return true;
  }
  function _initDrag() {
    const header = document.getElementById("chat-header");
    if (!header) return;
    header.addEventListener("mousedown", (e) => {
      if (_panelMode === "side") return;
      if (e.target.closest("button") || e.target.closest(".chat-cfg-btn")) return;
      _isDragging = true;
      const rect = _panel.getBoundingClientRect();
      _dragOffsetX = e.clientX - rect.left;
      _dragOffsetY = e.clientY - rect.top;
      header.style.cursor = "grabbing";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!_isDragging) return;
      const x = e.clientX - _dragOffsetX;
      const y = e.clientY - _dragOffsetY;
      _panel.style.left = Math.max(0, Math.min(x, window.innerWidth - _panel.offsetWidth)) + "px";
      _panel.style.top = Math.max(0, Math.min(y, window.innerHeight - _panel.offsetHeight)) + "px";
      _panel.style.right = "auto";
    });
    document.addEventListener("mouseup", () => {
      if (_isDragging) {
        _isDragging = false;
        header.style.cursor = "move";
      }
    });
  }
  function _initResize() {
    let isResizing = false;
    let resizeDirection = null;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    const directions = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    directions.forEach((dir) => {
      const handle = document.createElement("div");
      handle.className = `chat-resize-handle ${dir}`;
      handle.dataset.direction = dir;
      _panel.appendChild(handle);
      handle.addEventListener("mousedown", (e) => {
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
    document.addEventListener("mousemove", (e) => {
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
      if (resizeDirection.includes("e")) {
        newWidth = Math.max(minW, Math.min(startWidth + dx, maxW));
      } else if (resizeDirection.includes("w")) {
        const proposedWidth = startWidth - dx;
        if (proposedWidth >= minW) {
          newWidth = proposedWidth;
          if (_panelMode !== "side") newLeft = startLeft + dx;
        }
      }
      if (resizeDirection.includes("s")) {
        newHeight = Math.max(minH, Math.min(startHeight + dy, maxH));
      } else if (resizeDirection.includes("n")) {
        const proposedHeight = startHeight - dy;
        if (proposedHeight >= minH) {
          newHeight = proposedHeight;
          newTop = startTop + dy;
        }
      }
      _panel.style.width = newWidth + "px";
      _panel.style.height = newHeight + "px";
      if (_panelMode !== "side" && (resizeDirection.includes("w") || resizeDirection.includes("n"))) {
        _panel.style.left = Math.max(0, Math.min(newLeft, window.innerWidth - newWidth)) + "px";
        _panel.style.top = Math.max(0, Math.min(newTop, window.innerHeight - newHeight)) + "px";
        _panel.style.right = "auto";
      }
    });
    document.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        resizeDirection = null;
      }
    });
  }
  function _attachEvents() {
    _btn.addEventListener("click", toggleChatPanel);
    document.getElementById("chat-close").addEventListener("click", _close);
    _sendBtn.addEventListener("click", function() {
      if (_isBusy) {
        if (_cancelStream) _cancelStream();
      } else {
        _sendMessage();
      }
    });
    _input.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        _sendMessage();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (_inputHistory.length === 0) return;
        if (_historyIndex === -1) {
          _tempInput = _input.value;
          _historyIndex = _inputHistory.length - 1;
        } else if (_historyIndex > 0) {
          _historyIndex--;
        }
        _input.value = _inputHistory[_historyIndex];
        _input.style.height = "auto";
        _input.style.height = Math.min(_input.scrollHeight, 120) + "px";
        setTimeout(() => _input.setSelectionRange(_input.value.length, _input.value.length), 0);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (_historyIndex === -1) return;
        if (_historyIndex < _inputHistory.length - 1) {
          _historyIndex++;
          _input.value = _inputHistory[_historyIndex];
        } else {
          _historyIndex = -1;
          _input.value = _tempInput;
          _tempInput = "";
        }
        _input.style.height = "auto";
        _input.style.height = Math.min(_input.scrollHeight, 120) + "px";
        setTimeout(() => _input.setSelectionRange(_input.value.length, _input.value.length), 0);
      }
    });
    _input.addEventListener("input", function() {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 120) + "px";
    });
    const cfgBtn = document.getElementById("chat-cfg-btn");
    if (cfgBtn) cfgBtn.addEventListener("click", _openAiSettingsFromChat);
    const histBtn = document.getElementById("chat-hist-btn");
    if (histBtn) histBtn.addEventListener("click", function() {
      _sessionsOpen ? _closeSessionsPanel() : _openSessionsPanel();
    });
    const newBtn = document.getElementById("chat-new-btn");
    if (newBtn) newBtn.addEventListener("click", function() {
      if (_isBusy) return;
      _closeSessionsPanel();
      _clearHistory();
    });
    const providerSelect = document.getElementById("chat-cfg-provider");
    if (providerSelect) {
      _enhanceChatProviderSelect(providerSelect);
      providerSelect.addEventListener("change", function() {
        _updateProviderSections(this.value);
      });
    }
    const modeSelect = document.getElementById("chat-cfg-ai-mode");
    if (modeSelect) {
      modeSelect.addEventListener("change", function() {
        _updateProviderSections(providerSelect?.value || "anthropic");
      });
    }
    document.querySelectorAll("[data-open-key-folder]").forEach((btn) => {
      btn.addEventListener("click", async function() {
        try {
          const r = await fetch("/open-key-folder", { method: "POST" });
          const data = await r.json().catch(() => ({}));
          if (!r.ok || data.error) throw new Error(data.error || "Unable to open key folder");
        } catch (e) {
          alert("Failed to open key folder: " + e.message);
        }
      });
    });
    document.getElementById("chat-config-save")?.addEventListener("click", _saveConfig);
    document.getElementById("chat-config-cancel")?.addEventListener("click", _closeConfigModal);
    _modal?.addEventListener("click", function(e) {
      if (e.target === _modal) _closeConfigModal();
    });
    document.addEventListener("click", function(e) {
      if (!e.target.closest(".chat-cfg-provider-dd")) {
        document.querySelectorAll('.chat-cfg-provider-dd[data-open="true"]').forEach((dd) => _setChatProviderDropdownOpen(dd, false));
      }
    });
    window.addEventListener("vizAiConfigChanged", function(e) {
      _chatCfgSnapshot = e.detail || {};
      _chatIsConfigured = _chatConfigIsReady(_chatCfgSnapshot);
      _btn.classList.toggle("needs-setup", !_chatIsConfigured);
      if (_chatIsConfigured) document.getElementById("chat-setup-card")?.remove();
    });
    document.addEventListener("keydown", function(e) {
      if (e.altKey && e.key === "c") {
        e.preventDefault();
        toggleChatPanel();
      }
    });
    _initDrag();
    _initResize();
    _msgs.addEventListener("click", function(e) {
      const b = e.target.closest(".chat-badge");
      if (!b) return;
      const id = b.dataset.nodeId;
      if (!id || !window.cy) return;
      const focus = function(node2) {
        window.cy.animate(
          { center: { eles: node2 }, zoom: Math.max(window.cy.zoom(), 1.8) },
          { duration: 300 }
        );
        if (typeof window.pinHighlightNode === "function") window.pinHighlightNode(node2);
      };
      const node = _resolveCanvasNode(id);
      if (node && node.length) {
        focus(node.length > 1 ? node.first() : node);
      } else if (_navigateToNodeId(id)) {
        setTimeout(function() {
          const n2 = _resolveCanvasNode(id);
          if (n2 && n2.length) focus(n2.length > 1 ? n2.first() : n2);
          else _canvasMissToast(id);
        }, 700);
      } else {
        _canvasMissToast(id);
      }
    });
    _msgs.addEventListener("mouseover", function(e) {
      const b = e.target.closest(".chat-badge");
      if (!b || !window.cy) return;
      const node = _resolveCanvasNode(b.dataset.nodeId);
      if (node && node.length && typeof window.highlightNode === "function") {
        window.highlightNode(node.length > 1 ? node.first() : node);
      }
    });
    _msgs.addEventListener("mouseout", function(e) {
      const b = e.target.closest(".chat-badge");
      if (b && typeof window.clearHighlight === "function") window.clearHighlight();
    });
    document.addEventListener("vizNodeHover", function(e) {
      const d = e.detail || {};
      if (!d.nodeId) return;
      const sel = `.chat-badge[data-node-id="${d.nodeId.replace(/"/g, '\\"')}"]`;
      let badges;
      try {
        badges = _msgs.querySelectorAll(sel);
      } catch (_) {
        return;
      }
      badges.forEach(function(el) {
        el.classList.toggle("chat-badge-hl", !!d.enter);
      });
    });
  }
  async function _checkConfig() {
    try {
      const r = await fetch("/chat-config");
      if (!r.ok) return;
      const cfg = await r.json();
      _chatCfgSnapshot = cfg || {};
      _chatIsConfigured = _chatConfigIsReady(_chatCfgSnapshot);
      _btn.classList.toggle("needs-setup", !_chatIsConfigured);
      _btn.title = _chatIsConfigured ? "AI Chat" : "AI Chat - open to set up";
      if (!_chatIsConfigured && _isOpen) _appendSetupGuide();
      return;
      const hasKey = cfg.anthropic_api_key || cfg.openai_api_key || cfg.grok_api_key || cfg.gemini_api_key;
      if (!hasKey) {
        _btn.title = "AI Chat \u2014 click to set up";
        const setupAndOpen = function() {
          _open();
          _openConfigModal();
          _btn.removeEventListener("click", setupAndOpen);
          _btn.addEventListener("click", toggleChatPanel);
        };
        _btn.removeEventListener("click", toggleChatPanel);
        _btn.addEventListener("click", setupAndOpen);
      }
    } catch (_) {
    }
  }
  const _DEPTH_SVGS = {
    general: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H8.5L4 20V4z"/></svg>',
    deep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
    quick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 2 8 13 13 13 11 22 16 11 11 11"/></svg>'
  };
  const _OUTPUT_SVGS = {
    flow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="7" height="4" rx="1"/><rect x="15" y="10" width="7" height="4" rx="1"/><rect x="2" y="17" width="7" height="4" rx="1"/><path d="M9 5h3a3 3 0 0 1 3 3v4M9 19h3a3 3 0 0 0 3-3v-4"/></svg>',
    file_tour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88"/></svg>',
    health_report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 12 6 12 8 5 11 19 14 12 16 15 18 12 22 12"/></svg>'
  };
  const _DEFAULT_MODE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="16" cy="6" r="2.5" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="8" cy="12" r="2.5" fill="currentColor" stroke="none"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="13" cy="18" r="2.5" fill="currentColor" stroke="none"/></svg>';
  const _DEPTH_ORDER = ["quick", "general", "deep"];
  function _t(k, fb) {
    return window._i18n ? window._i18n.t(k) : fb;
  }
  function _depthItems() {
    return [
      { id: "quick", label: _t("chatDepthLabel_quick"), desc: _t("chatDepthDesc_quick") },
      { id: "general", label: _t("chatDepthLabel_general"), desc: _t("chatDepthDesc_general") },
      { id: "deep", label: _t("chatDepthLabel_deep"), desc: _t("chatDepthDesc_deep") }
    ];
  }
  function _outputItems() {
    return [
      { id: "flow", label: _t("chatOutputLabel_flow"), desc: _t("chatOutputDesc_flow") },
      { id: "file_tour", label: _t("chatOutputLabel_file_tour"), desc: _t("chatOutputDesc_file_tour") },
      { id: "health_report", label: _t("chatOutputLabel_health_report"), desc: _t("chatOutputDesc_health_report") }
    ];
  }
  function _refreshHeaderTitle() {
  }
  function _depthToRange(id) {
    const idx = _DEPTH_ORDER.indexOf(id);
    return idx < 0 ? 1 : idx;
  }
  function _rangeToDepth(val) {
    return _DEPTH_ORDER[parseInt(val)] || "general";
  }
  function _updateDepthBtn() {
    const btn = document.getElementById("chat-depth-btn");
    if (!btn) return;
    const info = _depthItems().find(function(d) {
      return d.id === _currentDepth;
    }) || _depthItems()[1];
    btn.innerHTML = '<span class="chat-ctrl-icon">' + (_DEPTH_SVGS[_currentDepth] || "") + '</span><span class="chat-ctrl-label">' + info.label + "</span>";
  }
  function _updateDepthInfo() {
    const info = _depthItems().find(function(d) {
      return d.id === _currentDepth;
    });
    if (!info) return;
    const lbl = document.getElementById("chat-depth-info-label");
    const dsc = document.getElementById("chat-depth-info-desc");
    if (lbl) lbl.textContent = info.label;
    if (dsc) dsc.textContent = info.desc;
  }
  function _closeDepthPicker() {
    const picker = document.getElementById("chat-depth-picker");
    const btn = document.getElementById("chat-depth-btn");
    if (picker) picker.classList.remove("open");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function _initDepthBtn() {
    const btn = document.getElementById("chat-depth-btn");
    const range = document.getElementById("chat-depth-range");
    if (btn) {
      _updateDepthBtn();
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        const picker = document.getElementById("chat-depth-picker");
        if (!picker) return;
        if (picker.classList.contains("open")) {
          _closeDepthPicker();
        } else {
          _closeOutputPicker();
          picker.classList.add("open");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    }
    if (range) {
      range.value = _depthToRange(_currentDepth);
      _updateDepthInfo();
      range.addEventListener("input", function() {
        _selectDepth(_rangeToDepth(range.value));
      });
    }
  }
  function _makeOutputRow(disabledAll) {
    const row = document.createElement("div");
    row.className = "chat-mode-row";
    _outputItems().forEach(function(item) {
      const card = document.createElement("button");
      card.className = "chat-mode-pill" + (item.id === _currentOutput ? " active" : "");
      if (disabledAll) {
        card.disabled = true;
        card.setAttribute("aria-disabled", "true");
      }
      card.innerHTML = '<span class="chat-mode-pill-icon">' + (_OUTPUT_SVGS[item.id] || "") + '</span><span class="chat-mode-pill-label">' + item.label + "</span>";
      if (item.desc) card.title = item.desc;
      card.addEventListener("click", function() {
        if (!disabledAll) _selectOutput(item.id);
      });
      row.appendChild(card);
    });
    return row;
  }
  function _buildOutputPicker() {
    const picker = document.getElementById("chat-output-picker");
    if (!picker) return;
    picker.innerHTML = "";
    picker.appendChild(_makeOutputRow(_currentDepth === "quick"));
  }
  function _openOutputPicker() {
    const picker = document.getElementById("chat-output-picker");
    const btn = document.getElementById("chat-mode-btn");
    if (!picker) return;
    _closeDepthPicker();
    _buildOutputPicker();
    picker.classList.add("open");
    _modePickerOpen = true;
    if (btn) btn.setAttribute("aria-expanded", "true");
  }
  function _closeOutputPicker() {
    const picker = document.getElementById("chat-output-picker");
    const btn = document.getElementById("chat-mode-btn");
    if (picker) picker.classList.remove("open");
    _modePickerOpen = false;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function _updateModeBtnIcon() {
    const btn = document.getElementById("chat-mode-btn");
    if (!btn) return;
    if (_currentOutput) {
      const info = _outputItems().find(function(o) {
        return o.id === _currentOutput;
      });
      const label = info ? info.label : "";
      btn.innerHTML = '<span class="chat-ctrl-icon">' + (_OUTPUT_SVGS[_currentOutput] || _DEFAULT_MODE_SVG) + '</span><span class="chat-ctrl-label">' + label + "</span>";
      btn.classList.add("has-output");
    } else {
      btn.innerHTML = _DEFAULT_MODE_SVG;
      btn.classList.remove("has-output");
    }
    btn.classList.toggle("active", !!_currentOutput);
  }
  function _selectDepth(id) {
    _currentDepth = id;
    localStorage.setItem("vizcode.chat.depth", id);
    if (id === "quick" && _currentOutput) {
      _currentOutput = null;
      localStorage.removeItem("vizcode.chat.output");
    }
    _updateModeBtnIcon();
    _updateModeBtnDisabled();
    _updateDepthBtn();
    _updateDepthInfo();
    const range = document.getElementById("chat-depth-range");
    if (range) range.value = _depthToRange(id);
    _buildOutputPicker();
  }
  function _selectOutput(id) {
    if (_currentDepth === "quick") return;
    _currentOutput = _currentOutput === id ? null : id;
    if (_currentOutput) {
      localStorage.setItem("vizcode.chat.output", _currentOutput);
    } else {
      localStorage.removeItem("vizcode.chat.output");
    }
    _updateModeBtnIcon();
    _closeOutputPicker();
  }
  function _updateModeBtnDisabled() {
    const btn = document.getElementById("chat-mode-btn");
    if (!btn) return;
    if (_currentDepth === "quick") {
      btn.disabled = true;
    } else {
      btn.disabled = false;
    }
  }
  function _initModeBtn() {
    const btn = document.getElementById("chat-mode-btn");
    if (!btn) return;
    _updateModeBtnIcon();
    _updateModeBtnDisabled();
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      if (_modePickerOpen) {
        _closeOutputPicker();
      } else {
        _openOutputPicker();
      }
    });
    document.addEventListener("click", function(e) {
      const depthPicker = document.getElementById("chat-depth-picker");
      if (depthPicker && depthPicker.classList.contains("open") && !e.target.closest("#chat-depth-picker") && !e.target.closest("#chat-depth-btn")) {
        _closeDepthPicker();
      }
      if (_modePickerOpen && !e.target.closest("#chat-output-picker") && !e.target.closest("#chat-mode-btn")) {
        _closeOutputPicker();
      }
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        _closeOutputPicker();
        _closeDepthPicker();
      }
    });
  }
  let _chatResizer = null;
  function _initSideResizer() {
    _chatResizer = document.createElement("div");
    _chatResizer.id = "chat-resizer";
    _chatResizer.style.display = "none";
    let startX, startW;
    _chatResizer.addEventListener("mousedown", (e) => {
      if (_panelMode !== "side") return;
      startX = e.clientX;
      startW = _panel.offsetWidth;
      _chatResizer.classList.add("dragging");
      _panel.style.transition = "none";
      const gw = document.getElementById("graph-wrap");
      if (gw) gw.style.pointerEvents = "none";
      document.addEventListener("mousemove", onDrag);
      document.addEventListener("mouseup", stopDrag);
      e.preventDefault();
    });
    let dragRaf;
    function onDrag(e) {
      if (dragRaf) cancelAnimationFrame(dragRaf);
      dragRaf = requestAnimationFrame(() => {
        const delta = startX - e.clientX;
        const newW = Math.max(260, Math.min(1200, startW + delta));
        _panel.style.width = newW + "px";
        document.documentElement.style.setProperty("--chat-side-w", newW + "px");
      });
    }
    function stopDrag() {
      _chatResizer.classList.remove("dragging");
      _panel.style.transition = "";
      const gw = document.getElementById("graph-wrap");
      if (gw) gw.style.pointerEvents = "";
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", stopDrag);
      if (window.cy) window.cy.resize();
    }
  }
  const _ICON_SIDE = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="2" y="3" width="16" height="14" rx="2"/><line x1="13" y1="3" x2="13" y2="17"/></svg>`;
  const _ICON_FLOAT = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 1h8a2 2 0 0 1 2 2v8"/></svg>`;
  let _floatParent = null;
  let _floatNextSibling = null;
  function _applyPanelMode(mode, skipResize) {
    _panelMode = mode;
    localStorage.setItem("vizcode.chat.panelMode", mode);
    const btn = document.getElementById("chat-mode-toggle-btn");
    const layout = document.getElementById("layout");
    if (mode === "side") {
      if (_panel.parentElement !== layout) {
        _floatParent = _panel.parentElement || document.body;
        _floatNextSibling = _panel.nextSibling;
        layout.appendChild(_chatResizer);
        layout.appendChild(_panel);
      }
      _panel.classList.add("side-mode");
      _panel.classList.remove("open");
      if (_isOpen) _panel.classList.add("open");
      document.body.classList.remove("chat-side-open");
      if (btn) {
        btn.innerHTML = _ICON_FLOAT;
        btn.title = "Switch to floating window";
      }
    } else {
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
      _chatResizer.style.display = "none";
      _panel.classList.remove("side-mode");
      _panel.classList.remove("open");
      if (_isOpen) _panel.classList.add("open");
      document.body.classList.remove("chat-side-open");
      if (btn) {
        btn.innerHTML = _ICON_SIDE;
        btn.title = "Switch to side panel mode";
      }
    }
    if (!skipResize) {
      setTimeout(() => {
        if (window.cy) window.cy.resize();
      }, 50);
    }
  }
  function _initPanelModeToggle() {
    const btn = document.getElementById("chat-mode-toggle-btn");
    if (!btn) return;
    _floatParent = _panel.parentElement || document.body;
    _floatNextSibling = _panel.nextSibling;
    _applyPanelMode(_panelMode, true);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      _applyPanelMode(_panelMode === "side" ? "float" : "side");
    });
  }
  function initChat() {
    if (!_buildDOM()) return;
    _updateButtonIcon();
    _attachEvents();
    _initModeBtn();
    _initDepthBtn();
    _initSideResizer();
    _initPanelModeToggle();
    _setBusy(false);
    _checkConfig();
    _loadHistory();
  }
  window.initChat = initChat;
})();
