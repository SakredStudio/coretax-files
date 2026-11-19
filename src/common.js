// Helpers shared by every file type.
import { parseAmount } from './num.js';

export const digits = (s) => String(s ?? '').replace(/[\s.\-]/g, '');
export const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// "03/11/2026", "03-11-2026" or "2026-11-03" -> "2026-11-03"; null when it is not a real date.
export function isoDate(textIn) {
  const s = String(textIn ?? '').trim();
  let y; let m; let d;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (hit) [, y, m, d] = hit;
  else if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, m, y] = hit;
  else return null;
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export const el = (name, value, indent) => (value === '' || value == null ? `${indent}<${name}/>` : `${indent}<${name}>${esc(value)}</${name}>`);
export const nil = (name, value, indent) => (value === '' || value == null ? `${indent}<${name} xsi:nil="true"/>` : el(name, value, indent));

// Readers for one CSV row. `add` records a finding; `at` says where (line, ref).
export function cellReader(c, at, add, decimalComma) {
  // Hundredths, or null when the cell is empty, or NaN (with a finding) when it is wrong.
  const amount = (field, { positive = false } = {}) => {
    const raw = c[field] ?? '';
    if (raw === '') return null;
    const parsed = parseAmount(raw, decimalComma);
    if (!parsed) { add('error', 'NUMBER', { ...at, field }, { field }); return NaN; }
    if (parsed.decimals > 2) { add('error', 'DECIMALS', { ...at, field }, { field }); return NaN; }
    if (parsed.cents < 0) { add('error', 'NEGATIVE', { ...at, field }, { field }); return NaN; }
    if (positive && parsed.cents === 0) { add('error', 'ZERO', { ...at, field }, { field }); return NaN; }
    return parsed.cents;
  };
  const required = (field, opts) => {
    const value = amount(field, opts);
    if (value === null) { add('error', 'NUMBER', { ...at, field }, { field }); return NaN; }
    return value;
  };
  const text = (field) => {
    const value = c[field] ?? '';
    const safe = clean(value);
    if (safe !== value) add('warning', 'BAD_CHARS', { ...at, field }, { field });
    return safe.trim();
  };
  return { amount, required, text };
}

export const finite = (...values) => values.every((v) => Number.isFinite(v));

// Shared start of every build(): empty file and missing columns.
export function checkColumns(rows, requiredColumns, add) {
  if (!rows || rows.length === 0) { add('error', 'NO_ROWS'); return false; }
  const present = new Set(Object.keys(rows[0].cells));
  let ok = true;
  for (const column of requiredColumns) if (!present.has(column)) { add('error', 'MISSING_COLUMN', {}, { column }); ok = false; }
  return ok;
}
