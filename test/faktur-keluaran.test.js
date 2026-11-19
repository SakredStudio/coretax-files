import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFromCsv, parseCsv, text, MESSAGES } from '../src/index.js';
import { parseAmount, mulDiv, fixed2 } from '../src/num.js';

const SELLER = { sellerTin: '0123456789012345', sellerIdtku: '0123456789012345000000', today: '2026-11-18' };
const sample = await readFile(new URL('../samples/faktur-keluaran-contoh.csv', import.meta.url), 'utf8');
const HEAD = 'Ref,TaxInvoiceDate,TrxCode,AddInfo,FacilityStamp,BuyerDocument,BuyerTin,BuyerDocumentNumber,BuyerName,BuyerAdress,BuyerEmail,BuyerIDTKU,Opt,Code,Name,Unit,Price,Qty,TotalDiscount,TaxBase,OtherTaxBase,VATRate,VAT';
const GOOD = 'A1,2026-11-03,04,,,TIN,0987654321098765,,PT Contoh,Jl. Contoh 1,,0987654321098765000000,A,,Barang,UM.0018,1000,3,0,,,,';
// Replaces named cells in the GOOD row.
function row(changes = {}) {
  const names = HEAD.split(',');
  const cells = GOOD.split(',');
  for (const [k, v] of Object.entries(changes)) cells[names.indexOf(k)] = v;
  return cells.join(',');
}
const run = (...rows) => buildFromCsv([HEAD, ...rows].join('\n'), SELLER);
const codes = (result, level) => result.findings.filter((f) => !level || f.level === level).map((f) => f.code);

test('amounts: Indonesian and English number styles', () => {
  assert.equal(parseAmount('1.200.000,50', true).cents, 120000050);
  assert.equal(parseAmount('1,200,000.50', false).cents, 120000050);
  assert.equal(parseAmount('150.000', true).cents, 15000000);
  assert.equal(parseAmount('150.000', false).cents, 15000);
  assert.equal(parseAmount('2,5', true).cents, 250);
  assert.equal(parseAmount('Rp 10.000', true).cents, 1000000);
  assert.equal(parseAmount('1.234,567', true).decimals, 3);
  assert.equal(parseAmount('12a', false), null);
  assert.equal(parseAmount('1.2.3', false), null);
  assert.equal(fixed2(mulDiv(95000000, 11, 12)), '870833.33');
});

test('csv: semicolons, quotes, blank lines and a byte-order mark', () => {
  const { headers, rows, delimiter } = parseCsv('﻿A;B\r\n"x;1";"say ""hi"""\r\n\r\n2;3\r\n');
  assert.equal(delimiter, ';');
  assert.deepEqual(headers, ['A', 'B']);
  assert.deepEqual(rows.map((r) => [r.line, r.cells.A, r.cells.B]), [[2, 'x;1', 'say "hi"'], [4, '2', '3']]);
});

test('sample file: builds with no errors and no warnings', () => {
  const result = buildFromCsv(sample, SELLER);
  assert.deepEqual(codes(result, 'error'), []);
  assert.deepEqual(codes(result, 'warning'), []);
  assert.equal(result.doc.invoices.length, 3);
  assert.deepEqual(result.doc.invoices.map((i) => i.lines.length), [2, 1, 1]);
  assert.ok(result.xml.startsWith('<?xml version="1.0" encoding="utf-8" ?>\n<TaxInvoiceBulk '));
});

test('sample file: element order and values of one invoice', () => {
  const { xml } = buildFromCsv(sample, SELLER);
  const second = xml.split('<TaxInvoice>')[2].split('</TaxInvoice>')[0];
  const flat = second.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(flat, [
    '<TaxInvoiceDate>2026-11-05</TaxInvoiceDate>', '<TaxInvoiceOpt>Normal</TaxInvoiceOpt>', '<TrxCode>04</TrxCode>',
    '<AddInfo/>', '<CustomDoc/>', '<CustomDocMonthYear/>', '<RefDesc/>', '<FacilityStamp/>',
    '<SellerIDTKU>0123456789012345000000</SellerIDTKU>', '<BuyerTin>0000000000000000</BuyerTin>',
    '<BuyerDocument>National ID</BuyerDocument>', '<BuyerCountry>IDN</BuyerCountry>',
    '<BuyerDocumentNumber>9999010101900001</BuyerDocumentNumber>', '<BuyerName>Budi Contoh</BuyerName>',
    '<BuyerAdress>Jl. Mawar No. 7, Bandung</BuyerAdress>', '<BuyerEmail/>', '<BuyerIDTKU>000000</BuyerIDTKU>',
    '<ListOfGoodService>', '<GoodService>', '<Opt>A</Opt>', '<Code>000000</Code>',
    '<Name>Meja kerja &quot;Seri A&quot; &amp; kursi</Name>', '<Unit>UM.0018</Unit>', '<Price>250000</Price>', '<Qty>4</Qty>',
    '<TotalDiscount>50000</TotalDiscount>', '<TaxBase>950000</TaxBase>', '<OtherTaxBase>870833.33</OtherTaxBase>',
    '<VATRate>12</VATRate>', '<VAT>104500</VAT>', '<STLGRate>0</STLGRate>', '<STLG>0</STLG>',
    '</GoodService>', '</ListOfGoodService>',
  ]);
});

test('sample file: luxury goods keep the full tax base', () => {
  const { xml } = buildFromCsv(sample, SELLER);
  const third = xml.split('<TaxInvoice>')[3];
  assert.match(third, /<TrxCode>01<\/TrxCode>/);
  assert.match(third, /<OtherTaxBase>50000000<\/OtherTaxBase>\s*<VATRate>12<\/VATRate>\s*<VAT>6000000<\/VAT>\s*<STLGRate>20<\/STLGRate>\s*<STLG>10000000<\/STLG>/);
});

test('a clean row builds; filled defaults are reported as notes', () => {
  const result = run(GOOD);
  assert.deepEqual(codes(result, 'error'), []);
  assert.match(result.xml, /<TaxBase>3000<\/TaxBase>\s*<OtherTaxBase>2750<\/OtherTaxBase>\s*<VATRate>12<\/VATRate>\s*<VAT>330<\/VAT>/);
  assert.deepEqual(codes(result, 'info'), ['FILLED']); // BuyerCountry -> IDN
});

test('errors block the XML', () => {
  const result = run(row({ TaxInvoiceDate: '31/02/2026' }));
  assert.deepEqual(codes(result, 'error'), ['DATE']);
  assert.equal(result.xml, null);
  const finding = result.findings.find((f) => f.code === 'DATE');
  assert.equal(finding.line, 2);
  assert.equal(finding.ref, 'A1');
});

test('seller identity', () => {
  const csv = [HEAD, GOOD].join('\n');
  assert.deepEqual(codes(buildFromCsv(csv, { today: '2026-11-18' }), 'error'), ['SELLER_TIN', 'SELLER_IDTKU']);
  assert.deepEqual(codes(buildFromCsv(csv, { ...SELLER, sellerIdtku: '9999999999999999000000' }), 'warning'), ['SELLER_IDTKU_PREFIX']);
  assert.deepEqual(codes(buildFromCsv(csv, { ...SELLER, sellerTin: '01.234.567.8-901.2345' }), 'error'), []);
});

test('header rules', () => {
  assert.deepEqual(codes(run(row({ TrxCode: '11' })), 'error'), ['TRXCODE']);
  assert.deepEqual(codes(run(row({ TrxCode: '4' })), 'error'), []);
  assert.deepEqual(codes(run(row({ TrxCode: '07' })), 'error'), ['ADDINFO_REQUIRED', 'FACILITY_REQUIRED']);
  assert.deepEqual(codes(run(row({ TrxCode: '07', AddInfo: 'TD.00501', FacilityStamp: 'bebas' })), 'error'), ['TD_FORMAT']);
  assert.deepEqual(codes(run(row({ AddInfo: 'TD.00501' })), 'warning'), ['ADDINFO_UNUSED']);
  assert.deepEqual(codes(run(row({ TaxInvoiceDate: '2026-12-01' })), 'warning'), ['DATE_FUTURE']);
  assert.deepEqual(codes(run(row({ BuyerName: '' })), 'warning'), ['BUYER_NAME_TIN']);
  assert.deepEqual(codes(run(row({ BuyerName: '' })), 'error'), []);
  assert.deepEqual(codes(run(row({ BuyerName: '', BuyerDocument: 'Passport', BuyerTin: '', BuyerIDTKU: '', BuyerDocumentNumber: 'X1' })), 'error'), ['BUYER_NAME']);
  assert.deepEqual(codes(run(row({ CustomDocMonthYear: '2024-12' })), 'error'), []);
  assert.deepEqual(codes(run(row({ BuyerEmail: 'bukan-email' })), 'error'), ['BUYER_EMAIL']);
});

test('buyer identity rules', () => {
  assert.deepEqual(codes(run(row({ BuyerTin: '123' })), 'error'), ['BUYER_TIN']);
  assert.deepEqual(codes(run(row({ BuyerIDTKU: '' })), 'error'), ['BUYER_IDTKU']);
  assert.deepEqual(codes(run(row({ BuyerIDTKU: '1111111111111111000000' })), 'warning'), ['BUYER_IDTKU_PREFIX']);
  assert.deepEqual(codes(run(row({ BuyerDocument: 'SIM' })), 'error'), ['BUYER_DOC']);
  const passport = { BuyerDocument: 'Paspor', BuyerTin: '', BuyerIDTKU: '' };
  assert.deepEqual(codes(run(row(passport)), 'error'), ['BUYER_DOCNUM']);
  assert.deepEqual(codes(run(row({ ...passport, BuyerDocumentNumber: 'X1234567' })), 'error'), []);
  assert.deepEqual(codes(run(row({ ...passport, BuyerDocument: 'NIK', BuyerDocumentNumber: '12345' })), 'error'), ['BUYER_NIK']);
  assert.deepEqual(codes(run(row({ ...passport, BuyerDocumentNumber: 'X1', BuyerTin: '0987654321098765' })), 'error'), ['BUYER_TIN_ZERO']);
});

test('line rules', () => {
  assert.deepEqual(codes(run(row({ Opt: 'C' })), 'error'), ['OPT']);
  assert.deepEqual(codes(run(row({ Code: '12' })), 'error'), ['CODE']);
  assert.deepEqual(codes(run(row({ Name: '' })), 'error'), ['NAME']);
  assert.deepEqual(codes(run(row({ Unit: 'pcs' })), 'error'), ['UNIT']);
  assert.deepEqual(codes(run(row({ Unit: 'UM.0099' })), 'warning'), ['UNIT_RANGE']);
  assert.deepEqual(codes(run(row({ Price: 'seribu' })), 'error'), ['NUMBER']);
  assert.deepEqual(codes(run(row({ Price: '' })), 'error'), ['NUMBER']);
  assert.deepEqual(codes(run(row({ Qty: '0' })), 'error'), ['ZERO']);
  assert.deepEqual(codes(run(row({ Price: '10.123' })), 'error'), ['DECIMALS']);
  assert.deepEqual(codes(run(row({ TotalDiscount: '5000' })), 'error'), ['NEGATIVE']);
});

test('arithmetic checks', () => {
  assert.deepEqual(codes(run(row({ TaxBase: '2500' })), 'error'), ['TAXBASE']);
  assert.deepEqual(codes(run(row({ OtherTaxBase: '3000', VAT: '360' })), 'warning'), ['OTHER_TAXBASE_1112']);
  assert.deepEqual(codes(run(row({ VAT: '300' })), 'error'), ['VAT']);
  assert.deepEqual(codes(run(row({ VAT: '330.40' })), 'warning'), ['VAT_ROUNDING']);
  assert.deepEqual(codes(run(row({ TrxCode: '02', VAT: '300' })), 'error'), []);
  assert.deepEqual(codes(run(row({ TrxCode: '02', VAT: '300' })), 'warning'), ['VAT']);
});

test('rows of one invoice must agree; one file is one seller', () => {
  const mismatch = run(GOOD, row({ BuyerName: 'PT Lain' }));
  assert.deepEqual(codes(mismatch, 'error'), ['HEADER_MISMATCH']);
  assert.equal(mismatch.findings.find((f) => f.code === 'HEADER_MISMATCH').line, 3);
  assert.deepEqual(codes(run(row({ Ref: '' })), 'error'), ['REF_MISSING']);
  const withSeller = buildFromCsv(`SellerTIN,${HEAD}\n0123456789012345,${GOOD}\n0000000000000001,${row({ Ref: 'A2' })}`, SELLER);
  assert.deepEqual(codes(withSeller, 'error'), ['MULTI_SELLER']);
});

test('file-level problems', () => {
  assert.deepEqual(codes(buildFromCsv('Ref,Name\n', SELLER)), ['NO_ROWS']);
  assert.equal(codes(buildFromCsv('Ref,Name\nA1,Barang', SELLER)).filter((c) => c === 'MISSING_COLUMN').length, 5);
  const many = Array.from({ length: 1001 }, (_, i) => row({ Ref: `A${i}` }));
  assert.deepEqual(codes(run(...many), 'error'), ['TOO_MANY']);
});

test('every finding code has wording in both languages', () => {
  const result = run(row({ TaxInvoiceDate: 'x', TrxCode: '99', Unit: 'pcs', BuyerTin: '1' }));
  assert.ok(result.findings.length >= 4);
  for (const f of result.findings) {
    assert.ok(MESSAGES[f.code], f.code);
    assert.ok(!/\{\w+\}/.test(text(f, 'id')), text(f, 'id'));
    assert.ok(!/\{\w+\}/.test(text(f, 'en')), text(f, 'en'));
  }
  assert.equal(text({ code: 'MISSING_COLUMN', params: { column: 'Ref' } }, 'en'), 'Column "Ref" is missing from the file.');
});
