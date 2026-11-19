// Round trip against the tax office's own sample files: read the values out of each official XML,
// feed them to the builder as CSV rows, and require the result to equal the official file.
// The official files are not kept in the repository and none of their values appear here.
// To run these checks, download the samples from
// https://www.pajak.go.id/reformdjp/coretax/template-xml-dan-converter-excel-ke-xml and unzip them
// into test/official/ (the folder is git-ignored). Without the files the checks are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFromCsv, fakturKeluaran, returMasukan, bppu, bp21, bpmp } from '../src/index.js';

const read = (name) => readFile(new URL(`./official/${name}`, import.meta.url), 'utf8').catch(() => null);
// Ignores layout only: the declaration, space between tags, and <X></X> versus <X/>.
const flat = (xml) => xml.replace(/^﻿/, '').replace(/<\?xml[^>]*\?>/, '').replace(/>\s+</g, '><').replace(/<(\w+)><\/\1>/g, '<$1/>').trim();
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// Every <Name>...</Name> block inside xml, as inner text.
const blocks = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
// Leaf elements of a block as { name: value }; empty and nil elements become ''.
function leaves(block) {
  const out = {};
  for (const m of block.matchAll(/<(\w+)(?:\s[^>]*)?\/>|<(\w+)>([^<]*)<\/\2>/g)) out[m[1] || m[2]] = unescape(m[3] || '');
  return out;
}
const first = (xml, name) => leaves(xml)[name];
const csv = (type, rows) => [type.COLUMNS.join(';'), ...rows.map((r) => type.COLUMNS.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');

async function roundTrip(t, file, type, toInput) {
  const official = await read(file);
  if (official === null) { t.skip(`test/official/${file} not present`); return; }
  const { own, rows } = toInput(official);
  assert.ok(rows.length > 0, 'no rows read from the official file');
  const result = buildFromCsv(csv(type, rows), { ...own, today: '2099-01-01' }, type);
  assert.deepEqual(result.findings.filter((f) => f.level === 'error'), []);
  assert.equal(flat(result.xml), flat(official));
}

test('official sample: Faktur PK v1.4', (t) => roundTrip(t, 'Sample Faktur PK Template v.1.4.xml', fakturKeluaran, (xml) => {
  const rows = [];
  blocks(xml, 'TaxInvoice').forEach((invoice, i) => {
    const header = leaves(invoice.split('<ListOfGoodService>')[0]);
    for (const line of blocks(invoice, 'GoodService')) rows.push({ Ref: String(i + 1), ...header, ...leaves(line) });
  });
  return { own: { sellerTin: first(xml.split('<ListOfTaxInvoice>')[0], 'TIN'), sellerIdtku: rows[0].SellerIDTKU }, rows: rows.map(({ SellerIDTKU, ...r }) => r) };
}));

test('official sample: Retur Faktur PM v1.1', (t) => roundTrip(t, 'Sample Retur Faktur PM Template v.1.1.xml', returMasukan, (xml) => {
  const rows = [];
  for (const ret of blocks(xml, 'InputReturnData')) {
    const { InvoiceNumber, SellerTIN, ReturnDate } = leaves(blocks(ret, 'TransactionDocumentData')[0]);
    for (const row of blocks(ret, 'Rows')) rows.push({ InvoiceNumber, SellerTIN, ReturnDate, ...leaves(row) });
  }
  return { own: { sellerTin: first(xml.split('<InputReturnDataList>')[0], 'TIN') }, rows };
}));

for (const [file, type, list, item] of [
  ['bppu.xml', bppu, 'ListOfBpu', 'Bpu'], ['bp21.xml', bp21, 'ListOfBp21', 'Bp21'], ['bpmp.xml', bpmp, 'ListOfMmPayroll', 'MmPayroll'],
]) {
  test(`official sample: ${file}`, (t) => roundTrip(t, file, type, (xml) => ({
    own: { sellerTin: first(xml.split(`<${list}>`)[0], 'TIN') },
    rows: blocks(xml, item).map(leaves),
  })));
}
