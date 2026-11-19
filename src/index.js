import { parseCsv } from './csv.js';
import * as fakturKeluaran from './faktur-keluaran.js';
import * as returMasukan from './retur-masukan.js';
import { bppu, bp21, bpmp } from './bupot.js';

export { parseCsv } from './csv.js';
export { text, MESSAGES } from './messages.js';
export { fixed2 } from './num.js';
export { fakturKeluaran, returMasukan, bppu, bp21, bpmp };

// File types this library can build. Each has id, label, TEMPLATE, COLUMNS, NOTES, OWN, HINT,
// build(rows, options) and totals(doc).
export const fileTypes = [fakturKeluaran, returMasukan, bppu, bp21, bpmp];

// CSV text in, findings and (when nothing blocks) XML out.
// Cells with "," as the decimal mark are assumed when the file uses ";" between cells.
export function buildFromCsv(csvText, options = {}, type = fakturKeluaran) {
  const { rows, delimiter } = parseCsv(csvText);
  const result = type.build(rows, { decimalComma: delimiter === ';', ...options });
  return { ...result, delimiter, type: type.id };
}
