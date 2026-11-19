import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFromCsv, fileTypes, returMasukan, bppu, bp21, bpmp, text, MESSAGES } from '../src/index.js';

const OWN = { sellerTin: '0123456789012345', sellerIdtku: '0123456789012345000000', today: '2026-11-18' };
const sampleOf = (type) => readFile(new URL(`../samples/${type.id}-contoh.csv`, import.meta.url), 'utf8');
const codes = (result, level) => result.findings.filter((f) => !level || f.level === level).map((f) => f.code);
const tags = (xml) => [...xml.matchAll(/<([A-Za-z0-9]+)[ >/]/g)].map((m) => m[1]);
// CSV from a heading list and rows of { column: value }.
const csv = (type, ...rows) => [type.COLUMNS.join(','), ...rows.map((r) => type.COLUMNS.map((c) => r[c] ?? '').join(','))].join('\n');

test('every file type: its made-up sample builds with no errors or warnings', async () => {
  assert.deepEqual(fileTypes.map((t) => t.id), ['faktur-keluaran', 'retur-masukan', 'bppu', 'bp21', 'bpmp']);
  for (const type of fileTypes) {
    const result = buildFromCsv(await sampleOf(type), OWN, type);
    assert.deepEqual(codes(result, 'error'), [], type.id);
    assert.deepEqual(codes(result, 'warning'), [], type.id);
    assert.ok(result.xml.startsWith('<?xml'), type.id);
    assert.ok(type.totals(result.doc).length >= 3, type.id);
    for (const [names] of type.NOTES) for (const name of names.split(', ')) assert.ok(type.COLUMNS.includes(name), `${type.id} note for ${name}`);
    for (const f of result.findings) assert.ok(MESSAGES[f.code] && !/\{\w+\}/.test(text(f, 'id')), f.code);
  }
});

test('return note: totals, day-first date and the other-tax-base flag', async () => {
  const { xml, doc } = buildFromCsv(await sampleOf(returMasukan), OWN, returMasukan);
  assert.equal(doc.returns.length, 2);
  const first = xml.split('<InputReturnData>')[1];
  assert.match(first, /<InvoiceNumber>04002600000123456<\/InvoiceNumber>\s*<SellerTIN>0987654321098765<\/SellerTIN>\s*<ReturnDate>10-11-2026<\/ReturnDate>\s*<ReturnTaxBase>380000<\/ReturnTaxBase>\s*<ReturnOtherTaxBase>355000<\/ReturnOtherTaxBase>\s*<ReturnVAT>42600<\/ReturnVAT>\s*<ReturnSTLG>0<\/ReturnSTLG>/);
  assert.match(first, /<ReturnTaxBaseTotal>380000<\/ReturnTaxBaseTotal>\s*<ReturnOtherTaxBaseTotal>355000<\/ReturnOtherTaxBaseTotal>\s*<ReturnVATTotal>42600<\/ReturnVATTotal>/);
  assert.deepEqual([...xml.matchAll(/<ReturnOtherTaxBaseCheck>(\w+)</g)].map((m) => m[1]), ['true', 'false', 'true']);
  assert.deepEqual(tags(xml.split('<Rows>')[1].split('</Rows>')[0]), [
    'Type', 'Name', 'Code', 'Quantity', 'Unit', 'UnitPrice', 'STLGRate', 'ReturnQuantity', 'ReturnDiscount',
    'ReturnTaxBase', 'ReturnOtherTaxBase', 'ReturnOtherTaxBaseCheck', 'ReturnVAT', 'ReturnSTLG',
  ]);
});

test('return note: rules', () => {
  const good = { InvoiceNumber: '04002600000123456', SellerTIN: '0987654321098765', ReturnDate: '2026-11-10', Name: 'Barang', Quantity: '5', Unit: 'UM.0018', UnitPrice: '1000', ReturnQuantity: '2' };
  const run = (changes) => buildFromCsv(csv(returMasukan, { ...good, ...changes }), OWN, returMasukan);
  assert.deepEqual(codes(run({}), 'error'), []);
  assert.deepEqual(codes(run({ InvoiceNumber: '123' }), 'error'), ['INVOICE_NUMBER']);
  assert.deepEqual(codes(run({ SellerTIN: '1' }), 'error'), ['RETURN_SELLER_TIN']);
  assert.deepEqual(codes(run({ ReturnDate: '2026-13-01' }), 'error'), ['DATE_FIELD']);
  assert.deepEqual(codes(run({ ReturnQuantity: '6' }), 'error'), ['RETURN_QTY']);
  assert.deepEqual(codes(run({ ReturnTaxBase: '5000' }), 'error'), ['RETURN_TAXBASE']);
  assert.deepEqual(codes(run({ ReturnVAT: '100' }), 'warning'), ['VAT']);
  assert.deepEqual(codes(run({ Type: 'X' }), 'error'), ['TYPE']);
  assert.deepEqual(codes(buildFromCsv(csv(returMasukan, good), { today: '2026-11-18' }, returMasukan), 'error'), ['OWN_TIN']);
});

test('withholding slips: element order and filled defaults', async () => {
  const b = buildFromCsv(await sampleOf(bppu), OWN, bppu);
  assert.ok(b.xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<BpuBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n\t<TIN>0123456789012345</TIN>\n\t<ListOfBpu>'));
  const second = b.xml.split('<Bpu>')[2].split('</Bpu>')[0].split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(second, [
    '<TaxPeriodMonth>11</TaxPeriodMonth>', '<TaxPeriodYear>2026</TaxPeriodYear>', '<CounterpartTin>0111222333444555</CounterpartTin>',
    '<IDPlaceOfBusinessActivityOfIncomeRecipient>0111222333444555000000</IDPlaceOfBusinessActivityOfIncomeRecipient>',
    '<TaxCertificate>N/A</TaxCertificate>', '<TaxObjectCode>24-100-02</TaxObjectCode>', '<TaxBase>12000000</TaxBase>', '<Rate>10</Rate>',
    '<Document>CommercialInvoice</Document>', '<DocumentNumber>SEWA-2026-11</DocumentNumber>', '<DocumentDate>2026-11-01</DocumentDate>',
    '<IDPlaceOfBusinessActivity>0123456789012345000000</IDPlaceOfBusinessActivity>', '<GovTreasurerOpt>N/A</GovTreasurerOpt>',
    '<SP2DNumber xsi:nil="true"/>', '<WithholdingDate>2026-11-05</WithholdingDate>',
  ]);
  assert.match(b.xml, /<Rate>0\.5<\/Rate>/);
  assert.deepEqual(bppu.totals(b.doc).map((t) => t.value), [3, 4550000000, 174250000]);

  const p = buildFromCsv(await sampleOf(bpmp), OWN, bpmp);
  assert.deepEqual(tags(p.xml.split('<MmPayroll>')[1].split('</MmPayroll>')[0]), [
    'TaxPeriodMonth', 'TaxPeriodYear', 'CounterpartOpt', 'CounterpartPassport', 'CounterpartTin', 'StatusTaxExemption', 'Position',
    'TaxCertificate', 'TaxObjectCode', 'Gross', 'Rate', 'IDPlaceOfBusinessActivity', 'WithholdingDate',
  ]);
  assert.match(p.xml, /<CounterpartOpt>Foreign<\/CounterpartOpt>\s*<CounterpartPassport>X1234567<\/CounterpartPassport>\s*<CounterpartTin>0000000000000000<\/CounterpartTin>/);
  assert.match(p.xml, /<CounterpartOpt>Resident<\/CounterpartOpt>\s*<CounterpartPassport xsi:nil="true"\/>/);

  const q = buildFromCsv(await sampleOf(bp21), OWN, bp21);
  assert.deepEqual(tags(q.xml.split('<Bp21>')[1].split('</Bp21>')[0]), [
    'TaxPeriodMonth', 'TaxPeriodYear', 'CounterpartTin', 'IDPlaceOfBusinessActivityOfIncomeRecipient', 'StatusTaxExemption', 'TaxCertificate',
    'TaxObjectCode', 'Gross', 'Deemed', 'Rate', 'Document', 'DocumentNumber', 'DocumentDate', 'IDPlaceOfBusinessActivity', 'WithholdingDate',
  ]);
  assert.deepEqual(bp21.totals(q.doc).map((t) => t.value), [2, 2100000000, 40500000]); // 30,000 + 375,000
});

test('withholding slips: rules', () => {
  const good = {
    TaxPeriodMonth: '11', TaxPeriodYear: '2026', CounterpartTin: '0987654321098765', TaxObjectCode: '24-104-05', TaxBase: '1000000', Rate: '2',
    Document: 'CommercialInvoice', DocumentNumber: 'A1', DocumentDate: '2026-11-03', WithholdingDate: '2026-11-10',
  };
  const run = (changes, own = OWN) => buildFromCsv(csv(bppu, { ...good, ...changes }), own, bppu);
  assert.deepEqual(codes(run({}), 'error'), []);
  assert.deepEqual(codes(run({ TaxPeriodMonth: '13' }), 'error'), ['PERIOD_MONTH']);
  assert.deepEqual(codes(run({ TaxPeriodYear: '26' }), 'error'), ['PERIOD_YEAR']);
  assert.deepEqual(codes(run({ CounterpartTin: '12' }), 'error'), ['COUNTERPART_TIN', 'IDTKU_22']);
  assert.deepEqual(codes(run({ TaxObjectCode: '2410405' }), 'error'), ['TAX_OBJECT_CODE']);
  assert.deepEqual(codes(run({ TaxBase: '' }), 'error'), ['NUMBER']);
  assert.deepEqual(codes(run({ Rate: '120' }), 'error'), ['PERCENT']);
  assert.deepEqual(codes(run({ Document: '' }), 'error'), ['REQUIRED']);
  assert.deepEqual(codes(run({ Document: 'Kuitansi' }), 'warning'), ['VALUE_UNSEEN']);
  assert.deepEqual(codes(run({ TaxCertificate: 'dtp' }), 'warning'), []);
  assert.deepEqual(codes(run({ DocumentDate: '31/11/2026' }), 'error'), ['DATE_FIELD']);
  assert.deepEqual(codes(run({ WithholdingDate: '2026-12-02' }), 'warning'), ['WITHHOLDING_PERIOD']);
  assert.deepEqual(codes(run({}, { sellerTin: OWN.sellerTin }), 'error'), ['IDTKU_22']);
  assert.deepEqual(codes(run({ IDPlaceOfBusinessActivity: '9999999999999999000000' }), 'warning'), ['OWN_IDTKU_PREFIX']);

  const employee = { TaxPeriodMonth: '11', TaxPeriodYear: '2026', CounterpartTin: '9999010101900001', StatusTaxExemption: 'tk/0', Position: 'Staf', TaxObjectCode: '21-100-01', Gross: '5000000', Rate: '0.25', WithholdingDate: '2026-11-25' };
  const pay = (changes) => buildFromCsv(csv(bpmp, { ...employee, ...changes }), OWN, bpmp);
  assert.deepEqual(codes(pay({}), 'error'), []);
  assert.deepEqual(codes(pay({ StatusTaxExemption: 'lajang' }), 'error'), ['PTKP']);
  assert.deepEqual(codes(pay({ CounterpartOpt: 'Foreign' }), 'error'), ['PASSPORT_REQUIRED']);
  assert.deepEqual(codes(pay({ CounterpartOpt: 'Alien' }), 'error'), ['COUNTERPART_OPT']);
  assert.deepEqual(codes(pay({ Position: '' }), 'error'), ['REQUIRED']);
});
