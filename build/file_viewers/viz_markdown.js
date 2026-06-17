function renderMarkdown(src, ext, fname, langHint) {
  codeState.rawLines = src.split("\n");
  codeState.funcLineMap = {};
  codeState.funcList = [];
  const wrap = document.getElementById("cp-code-wrap");
  wrap.onclick = null;
  wrap.innerHTML = `<div class="markdown-doc">${renderMarkdownBlocks(src, langHint || ext || fname)}</div>`;
  wrap.style.display = "";
}
function renderMarkdownBlocks(src, langHint) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fenceMatch = line.match(/^(```|~~~)\s*([\w#+.-]*)\s*$/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const lang = fenceMatch[2] || "";
      const block = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence)) {
        block.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      html.push(renderMarkdownCodeBlock(block.join("\n"), lang));
      continue;
    }
    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderMarkdownInline(headingMatch[2].trim())}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }
    if (isMarkdownTable(lines, i)) {
      const tableLines = [lines[i]];
      i += 2;
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        tableLines.push(lines[i]);
        i++;
      }
      html.push(renderMarkdownTable(tableLines));
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${quote.map((l) => renderMarkdownInline(l)).join("<br>")}</blockquote>`);
      continue;
    }
    const listMatch = line.match(/^\s*(([-*+])|(\d+\.))\s+(.*)$/);
    if (listMatch) {
      const ordered = !!listMatch[3];
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (i < lines.length) {
        const match = lines[i].match(/^\s*(([-*+])|(\d+\.))\s+(.*)$/);
        if (!match || !!match[3] !== ordered) break;
        items.push(`<li>${renderMarkdownListItem(match[4])}</li>`);
        i++;
      }
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim()) {
      if (lines[i].match(/^(```|~~~)\s*([\w#+.-]*)\s*$/) || lines[i].match(/^\s{0,3}(#{1,6})\s+(.*)$/) || /^\s*>\s?/.test(lines[i]) || /^\s*(([-*+])|(\d+\.))\s+/.test(lines[i]) || /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lines[i]) || isMarkdownTable(lines, i)) {
        break;
      }
      paragraph.push(lines[i].trim());
      i++;
    }
    html.push(`<p>${renderMarkdownInline(paragraph.join(" "))}</p>`);
  }
  return html.join("") || '<p class="markdown-empty">Empty markdown file.</p>';
}
function renderMarkdownListItem(text) {
  const checkbox = text.match(/^\[( |x|X)\]\s+(.*)$/);
  if (!checkbox) return renderMarkdownInline(text);
  const checked = checkbox[1].toLowerCase() === "x";
  const mark = checked ? "&#x2611;" : "&#x2610;";
  return `<span class="md-check">${mark}</span>${renderMarkdownInline(checkbox[2])}`;
}
function renderMarkdownInline(text) {
  const chunks = String(text || "").split(/(`[^`]+`)/g);
  return chunks.map((chunk) => {
    if (chunk.startsWith("`") && chunk.endsWith("`") && chunk.length >= 2) {
      return `<code>${escapeHtml(chunk.slice(1, -1))}</code>`;
    }
    return renderMarkdownInlineText(chunk);
  }).join("");
}
function renderMarkdownInlineText(text) {
  let html = escapeHtml(text);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<span class="md-image-ref" title="$2">$1</span>');
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  return html;
}
function renderMarkdownCodeBlock(src, lang) {
  const language = (lang || "").trim().toLowerCase();
  let highlighted = escapeHtml(src);
  if (window.hljs) {
    try {
      highlighted = language ? hljs.highlight(src, { language, ignoreIllegals: true }).value : hljs.highlightAuto(src).value;
    } catch (_) {
      highlighted = escapeHtml(src);
    }
  }
  return `<pre class="md-code-block"><code class="hljs${language ? ` language-${language}` : ""}">${highlighted}</code></pre>`;
}
function isMarkdownTable(lines, index) {
  if (index + 1 >= lines.length) return false;
  const header = lines[index];
  const separator = lines[index + 1];
  return /\|/.test(header) && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(separator);
}
function renderMarkdownTable(rows) {
  const cells = rows.map(splitMarkdownTableRow);
  const head = cells[0] || [];
  const body = cells.slice(1);
  return `<div class="md-table-wrap"><table><thead><tr>${head.map((cell) => `<th>${renderMarkdownInline(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${renderMarkdownInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function splitMarkdownTableRow(row) {
  let normalized = String(row || "").trim();
  if (normalized.startsWith("|")) normalized = normalized.slice(1);
  if (normalized.endsWith("|")) normalized = normalized.slice(0, -1);
  return normalized.split("|").map((cell) => cell.trim());
}
