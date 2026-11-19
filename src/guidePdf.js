// Builds a printable PDF of a guest guide from its text — the same simple
// formatting the guide page understands (see renderGuide in public/js/app.js):
//   blank line → new paragraph (single line breaks kept), "1. " / "1) " →
//   numbered step, "# " → heading, **bold**, [text](https://…), bare links.
const path = require('path');
const PDFDocument = require('pdfkit');

const INK = '#222222';
const SEA = '#1F5266';
const SOFT = '#6B6B6B';
const SIGN_IMAGE = path.join(__dirname, '..', 'public', 'images', 'mirador-sign.jpg');

function parseBlocks(text) {
  const blocks = [];
  let para = null;
  let list = null;
  const endPara = () => { if (para) blocks.push(para); para = null; };
  const endList = () => { if (list) blocks.push(list); list = null; };
  String(text || '').replace(/\r/g, '').split('\n').forEach((raw) => {
    const line = raw.trim();
    const step = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (!line) { endPara(); if (list) list.gap = true; return; }
    if (line.startsWith('# ')) { endPara(); endList(); blocks.push({ type: 'h', text: line.slice(2) }); return; }
    if (step) {
      endPara();
      if (!list) list = { type: 'ol', items: [] };
      list.items.push({ n: Number(step[1]), text: step[2] });
      list.gap = false;
      return;
    }
    if (list && !list.gap) { list.items[list.items.length - 1].text += ' ' + line; return; }
    endList();
    if (!para) para = { type: 'p', lines: [] };
    para.lines.push(line);
  });
  endPara();
  endList();
  return blocks;
}

// "Some **bold** and [a link](https://…)" → [{ text, bold, link }]
function inlineSegments(text) {
  const segs = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) segs.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) segs.push({ text: m[2], link: m[3] });
    else segs.push({ text: m[4], link: m[4] });
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  return segs.length ? segs : [{ text: '' }];
}

// Writes one run of inline text. `first` holds the position/width options,
// which pdfkit only takes on the first of a run of `continued` calls.
function writeInline(doc, text, first) {
  const segs = inlineSegments(text);
  segs.forEach((seg, i) => {
    doc
      .font(seg.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(seg.link ? SEA : INK);
    const opts = {
      continued: i < segs.length - 1,
      link: seg.link || null,
      underline: Boolean(seg.link),
      lineGap: 2,
    };
    if (i === 0) {
      doc.text(seg.text, first.x, first.y, { ...opts, width: first.width });
    } else {
      doc.text(seg.text, opts);
    }
  });
}

function buildGuidePdf({ title, body }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 56, left: 56, right: 56 },
    info: { Title: `${title} — Casa Moir`, Author: 'Casa Moir' },
  });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  // Header: sign photo, title, a rule.
  try {
    doc.image(SIGN_IMAGE, left, doc.y, { fit: [170, 103] });
    doc.moveDown(0.2);
    doc.y = doc.page.margins.top + 112;
  } catch (e) { /* no image — just carry on with the text */ }
  doc.font('Times-Bold').fontSize(24).fillColor(SEA).text(title, left, doc.y, { width });
  doc.font('Helvetica').fontSize(10).fillColor(SOFT).text('Casa Moir · Mirador de Calahonda', { width });
  doc.moveDown(0.4);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor('#D8D2C4').stroke();
  doc.moveDown(0.8);

  doc.fontSize(11);
  for (const block of parseBlocks(body)) {
    if (block.type === 'h') {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
      doc.moveDown(0.5);
      doc.font('Times-Bold').fontSize(15).fillColor(SEA).text(block.text, left, doc.y, { width });
      doc.moveDown(0.3);
      doc.fontSize(11);
    } else if (block.type === 'p') {
      block.lines.forEach((line) => writeInline(doc, line, { x: left, y: doc.y, width }));
      doc.moveDown(0.6);
    } else if (block.type === 'ol') {
      const numWidth = 24;
      for (const item of block.items) {
        // Keep a step's number with at least its first couple of lines.
        if (doc.y > doc.page.height - doc.page.margins.bottom - 36) doc.addPage();
        const y = doc.y;
        doc.font('Helvetica-Bold').fillColor(SEA).text(`${item.n}.`, left, y, { width: numWidth - 4 });
        writeInline(doc, item.text, { x: left + numWidth, y, width: width - numWidth });
        doc.moveDown(0.45);
      }
      doc.moveDown(0.3);
    }
  }

  doc.end();
  return doc;
}

module.exports = { buildGuidePdf };
