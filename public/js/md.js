// Minimal, safe Markdown -> HTML for AI-written notes: headings, lists, bold/italic, code.
// All text is HTML-escaped first, so model output can never inject markup.

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      flushPara();
      closeList();
      const level = Math.min(4, m[1].length + 1); // page already has an h1
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}
