// Small CSV reader. Indonesian Excel saves CSV with ";" between cells and "," as the decimal mark,
// so the separator is detected from the heading line and reported back to the caller.

function detectDelimiter(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] === 0
    ? ','
    : Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function splitRecords(text, delimiter) {
  const records = [];
  let cell = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      records.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); records.push(row); }
  return records;
}

// Returns { headers, rows, delimiter }. Each row is { line, cells: { heading: text } };
// `line` is the line number in the file (the heading is line 1). Blank lines are skipped.
export function parseCsv(input) {
  const text = String(input).replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = detectDelimiter(firstLine);
  const records = splitRecords(text, delimiter);
  if (records.length === 0) return { headers: [], rows: [], delimiter };
  const headers = records[0].map((h) => h.trim());
  const rows = [];
  records.slice(1).forEach((record, i) => {
    if (record.every((c) => c.trim() === '')) return;
    const cells = {};
    headers.forEach((h, c) => { if (h) cells[h] = (record[c] ?? '').trim(); });
    rows.push({ line: i + 2, cells });
  });
  return { headers, rows, delimiter };
}
