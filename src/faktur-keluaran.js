// Faktur Pajak Keluaran (sales tax invoice) import file for Coretax.
// Layout: the tax office's "Sample Faktur PK Template v.1.4" (1 March 2025), root <TaxInvoiceBulk>.
// Element order and number style were checked against that official sample file on 2026-11-18.
import { parseAmount, mulDiv, fixed2, trimmed } from './num.js';
import { digits, clean, isoDate, el, checkColumns } from './common.js';

export const id = 'faktur-keluaran';
export const label = 'Faktur Pajak Keluaran';
export const TEMPLATE = 'Faktur PK v1.4 (2025-03-01)';
export const MAX_INVOICES = 1000;

// One CSV row = one goods/service line. Rows that share a Ref form one invoice.
export const HEADER_FIELDS = [
  'TaxInvoiceDate', 'TrxCode', 'AddInfo', 'CustomDoc', 'CustomDocMonthYear', 'RefDesc', 'FacilityStamp',
  'BuyerTin', 'BuyerDocument', 'BuyerCountry', 'BuyerDocumentNumber', 'BuyerName', 'BuyerAdress', 'BuyerEmail', 'BuyerIDTKU',
];
export const LINE_FIELDS = [
  'Opt', 'Code', 'Name', 'Unit', 'Price', 'Qty', 'TotalDiscount', 'TaxBase', 'OtherTaxBase', 'VATRate', 'VAT', 'STLGRate', 'STLG',
];
export const COLUMNS = ['Ref', 'SellerTIN', 'SellerIDTKU', ...HEADER_FIELDS, ...LINE_FIELDS];
const REQUIRED_COLUMNS = ['Ref', 'TaxInvoiceDate', 'TrxCode', 'Name', 'Unit', 'Price', 'Qty'];

const BUYER_DOCS = {
  tin: 'TIN', npwp: 'TIN',
  'national id': 'National ID', nik: 'National ID', ktp: 'National ID',
  passport: 'Passport', paspor: 'Passport',
  'other id': 'Other ID', other: 'Other ID', lainnya: 'Other ID',
};
const ZERO_TIN = '0'.repeat(16);
const EXACT_VAT_CODES = new Set(['01', '04', '09']);

// rows: [{ line, cells }] from parseCsv. options: { sellerTin, sellerIdtku, decimalComma, today }.
// Returns { doc, findings, xml }. xml is null while any finding is an error.
export function build(rows, options = {}) {
  const findings = [];
  const add = (level, code, at = {}, params = {}) => findings.push({ level, code, ...at, params });
  const { decimalComma = false, today = new Date().toISOString().slice(0, 10) } = options;

  if (!checkColumns(rows, REQUIRED_COLUMNS, add)) return { doc: null, findings, xml: null };

  // Seller: from the file when it has the columns, otherwise from the page's two boxes.
  const sellerTin = digits(rows[0].cells.SellerTIN || options.sellerTin);
  const sellerIdtku = digits(rows[0].cells.SellerIDTKU || options.sellerIdtku);
  if (!/^\d{16}$/.test(sellerTin)) add('error', 'SELLER_TIN', { field: 'SellerTIN' });
  if (!/^\d{22}$/.test(sellerIdtku)) add('error', 'SELLER_IDTKU', { field: 'SellerIDTKU' });
  else if (/^\d{16}$/.test(sellerTin) && !sellerIdtku.startsWith(sellerTin)) add('warning', 'SELLER_IDTKU_PREFIX', { field: 'SellerIDTKU' });

  const invoices = [];
  const byRef = new Map();
  for (const row of rows) {
    const c = row.cells;
    const at = { line: row.line, ref: c.Ref };
    if ((c.SellerTIN && digits(c.SellerTIN) !== sellerTin) || (c.SellerIDTKU && digits(c.SellerIDTKU) !== sellerIdtku)) {
      add('error', 'MULTI_SELLER', at);
    }
    if (!c.Ref) { add('error', 'REF_MISSING', { line: row.line, field: 'Ref' }); continue; }

    let invoice = byRef.get(c.Ref);
    if (!invoice) {
      invoice = readHeader(c, at, add, today);
      byRef.set(c.Ref, invoice);
      invoices.push(invoice);
    } else {
      for (const field of HEADER_FIELDS) {
        const value = c[field] ?? '';
        if (value !== '' && value !== invoice.raw[field]) add('error', 'HEADER_MISMATCH', { ...at, field }, { field, first: invoice.raw[field] || '-' });
      }
    }
    invoice.lines.push(readLine(c, at, add, decimalComma, invoice.TrxCode));
  }
  if (invoices.length > MAX_INVOICES) add('error', 'TOO_MANY', {}, { count: invoices.length, max: MAX_INVOICES });

  const doc = { sellerTin, sellerIdtku, invoices };
  const blocked = findings.some((f) => f.level === 'error');
  return { doc, findings, xml: blocked ? null : toXml(doc) };
}

function readHeader(c, at, add, today) {
  const inv = { ref: c.Ref, line: at.line, raw: {}, lines: [] };
  for (const field of HEADER_FIELDS) inv.raw[field] = c[field] ?? '';
  const text = (field) => {
    const value = c[field] ?? '';
    const safe = clean(value);
    if (safe !== value) add('warning', 'BAD_CHARS', { ...at, field }, { field });
    return safe.trim();
  };

  inv.TaxInvoiceDate = isoDate(c.TaxInvoiceDate);
  if (!inv.TaxInvoiceDate) add('error', 'DATE', { ...at, field: 'TaxInvoiceDate' });
  else if (inv.TaxInvoiceDate > today) add('warning', 'DATE_FUTURE', { ...at, field: 'TaxInvoiceDate' }, { date: inv.TaxInvoiceDate });

  const code = /^\d{1,2}$/.test(c.TrxCode ?? '') ? String(c.TrxCode).padStart(2, '0') : '';
  inv.TrxCode = code >= '01' && code <= '10' ? code : '';
  if (!inv.TrxCode) add('error', 'TRXCODE', { ...at, field: 'TrxCode' });

  inv.AddInfo = text('AddInfo');
  inv.FacilityStamp = text('FacilityStamp');
  const needsFacility = inv.TrxCode === '07' || inv.TrxCode === '08';
  for (const [field, missing] of [['AddInfo', 'ADDINFO_REQUIRED'], ['FacilityStamp', 'FACILITY_REQUIRED']]) {
    if (needsFacility && !inv[field]) add('error', missing, { ...at, field }, { code: inv.TrxCode });
    else if (inv[field] && !/^TD\.\d{5}$/.test(inv[field])) add('error', 'TD_FORMAT', { ...at, field }, { field });
    else if (inv[field] && inv.TrxCode && !needsFacility) add('warning', 'ADDINFO_UNUSED', { ...at, field }, { field });
  }
  inv.CustomDoc = text('CustomDoc');
  inv.CustomDocMonthYear = text('CustomDocMonthYear');
  if (inv.CustomDocMonthYear && !/^(0[1-9]|1[0-2])\d{4}$/.test(inv.CustomDocMonthYear)) add('error', 'CUSTOMDOC_MONTHYEAR', { ...at, field: 'CustomDocMonthYear' });
  inv.RefDesc = text('RefDesc');

  const docKey = String(c.BuyerDocument || 'TIN').trim().toLowerCase();
  inv.BuyerDocument = BUYER_DOCS[docKey] || '';
  if (!inv.BuyerDocument) add('error', 'BUYER_DOC', { ...at, field: 'BuyerDocument' });
  const isTin = inv.BuyerDocument === 'TIN';
  const fill = (field, value) => { add('info', 'FILLED', { ...at, field }, { field, value }); return value; };

  inv.BuyerTin = digits(c.BuyerTin);
  inv.BuyerDocumentNumber = text('BuyerDocumentNumber');
  inv.BuyerIDTKU = digits(c.BuyerIDTKU);
  if (isTin) {
    if (!/^\d{16}$/.test(inv.BuyerTin)) add('error', 'BUYER_TIN', { ...at, field: 'BuyerTin' });
    if (!/^\d{22}$/.test(inv.BuyerIDTKU)) add('error', 'BUYER_IDTKU', { ...at, field: 'BuyerIDTKU' });
    else if (/^\d{16}$/.test(inv.BuyerTin) && !inv.BuyerIDTKU.startsWith(inv.BuyerTin)) add('warning', 'BUYER_IDTKU_PREFIX', { ...at, field: 'BuyerIDTKU' });
  } else if (inv.BuyerDocument) {
    if (inv.BuyerTin === '') inv.BuyerTin = fill('BuyerTin', ZERO_TIN);
    else if (inv.BuyerTin !== ZERO_TIN) add('error', 'BUYER_TIN_ZERO', { ...at, field: 'BuyerTin' });
    if (!inv.BuyerDocumentNumber || inv.BuyerDocumentNumber === '-') add('error', 'BUYER_DOCNUM', { ...at, field: 'BuyerDocumentNumber' }, { doc: inv.BuyerDocument });
    else if (inv.BuyerDocument === 'National ID' && !/^\d{16}$/.test(digits(inv.BuyerDocumentNumber))) add('error', 'BUYER_NIK', { ...at, field: 'BuyerDocumentNumber' });
    if (inv.BuyerIDTKU === '') inv.BuyerIDTKU = fill('BuyerIDTKU', '000000');
    else if (inv.BuyerIDTKU !== '000000') add('error', 'BUYER_IDTKU_NON_TIN', { ...at, field: 'BuyerIDTKU' });
  }

  inv.BuyerCountry = String(c.BuyerCountry ?? '').trim().toUpperCase();
  if (inv.BuyerCountry === '') inv.BuyerCountry = fill('BuyerCountry', 'IDN');
  else if (!/^[A-Z]{3}$/.test(inv.BuyerCountry)) add('error', 'BUYER_COUNTRY', { ...at, field: 'BuyerCountry' });
  inv.BuyerName = text('BuyerName');
  if (!inv.BuyerName) add(isTin ? 'warning' : 'error', isTin ? 'BUYER_NAME_TIN' : 'BUYER_NAME', { ...at, field: 'BuyerName' }, { field: 'BuyerName' });
  inv.BuyerAdress = text('BuyerAdress');
  if (!inv.BuyerAdress) add(isTin ? 'warning' : 'error', isTin ? 'BUYER_NAME_TIN' : 'BUYER_ADDRESS', { ...at, field: 'BuyerAdress' }, { field: 'BuyerAdress' });
  inv.BuyerEmail = text('BuyerEmail');
  if (inv.BuyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inv.BuyerEmail)) add('error', 'BUYER_EMAIL', { ...at, field: 'BuyerEmail' });
  return inv;
}

function readLine(c, at, add, decimalComma, trxCode) {
  const line = { line: at.line };
  line.Opt = String(c.Opt || 'A').trim().toUpperCase();
  if (line.Opt !== 'A' && line.Opt !== 'B') add('error', 'OPT', { ...at, field: 'Opt' });
  line.Code = digits(c.Code) || '000000';
  if (!/^\d{6}$/.test(line.Code)) add('error', 'CODE', { ...at, field: 'Code' });
  const name = clean(c.Name ?? '');
  if (name !== (c.Name ?? '')) add('warning', 'BAD_CHARS', { ...at, field: 'Name' }, { field: 'Name' });
  line.Name = name.trim();
  if (!line.Name) add('error', 'NAME', { ...at, field: 'Name' });
  line.Unit = String(c.Unit ?? '').trim().toUpperCase();
  const unit = /^UM\.(\d{4})$/.exec(line.Unit);
  if (!unit) add('error', 'UNIT', { ...at, field: 'Unit' });
  else if (+unit[1] < 1 || +unit[1] > 39) add('warning', 'UNIT_RANGE', { ...at, field: 'Unit' }, { unit: line.Unit });

  // Reads one amount. Returns hundredths, or null when the cell is empty, or NaN when it is wrong.
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

  line.Price = required('Price', { positive: true });
  line.Qty = required('Qty', { positive: true });
  line.TotalDiscount = amount('TotalDiscount') ?? 0;
  const ok = (...values) => values.every((v) => Number.isFinite(v));

  const expectedBase = ok(line.Price, line.Qty, line.TotalDiscount) ? mulDiv(line.Price, line.Qty, 100) - line.TotalDiscount : NaN;
  line.TaxBase = amount('TaxBase') ?? expectedBase;
  if (ok(expectedBase, line.TaxBase)) {
    if (expectedBase < 0) add('error', 'NEGATIVE', { ...at, field: 'TaxBase' }, { field: 'TaxBase' });
    else if (Math.abs(line.TaxBase - expectedBase) > 100) add('error', 'TAXBASE', { ...at, field: 'TaxBase' }, { got: fixed2(line.TaxBase), expected: fixed2(expectedBase) });
  }

  const elevenTwelfths = ok(line.TaxBase) ? mulDiv(line.TaxBase, 11, 12) : NaN;
  line.OtherTaxBase = amount('OtherTaxBase') ?? (trxCode === '04' ? elevenTwelfths : line.TaxBase);
  if (trxCode === '04' && ok(line.OtherTaxBase, elevenTwelfths) && Math.abs(line.OtherTaxBase - elevenTwelfths) > 100) {
    add('warning', 'OTHER_TAXBASE_1112', { ...at, field: 'OtherTaxBase' }, { got: fixed2(line.OtherTaxBase), expected: fixed2(elevenTwelfths) });
  }

  line.VATRate = amount('VATRate') ?? 1200;
  const expectedVat = ok(line.OtherTaxBase, line.VATRate) ? mulDiv(line.OtherTaxBase, line.VATRate, 10000) : NaN;
  line.VAT = amount('VAT') ?? expectedVat;
  if (ok(line.VAT, expectedVat) && line.VAT !== expectedVat) {
    const params = { got: fixed2(line.VAT), expected: fixed2(expectedVat) };
    const far = Math.abs(line.VAT - expectedVat) >= 100;
    if (far && EXACT_VAT_CODES.has(trxCode)) add('error', 'VAT', { ...at, field: 'VAT' }, params);
    else add('warning', far ? 'VAT' : 'VAT_ROUNDING', { ...at, field: 'VAT' }, params);
  }

  line.STLGRate = amount('STLGRate') ?? 0;
  const expectedStlg = ok(line.TaxBase, line.STLGRate) ? mulDiv(line.TaxBase, line.STLGRate, 10000) : NaN;
  line.STLG = amount('STLG') ?? (Number.isFinite(expectedStlg) ? expectedStlg : 0);
  if (ok(line.STLG, expectedStlg) && Math.abs(line.STLG - expectedStlg) >= 100) {
    add('warning', 'STLG', { ...at, field: 'STLG' }, { got: fixed2(line.STLG), expected: fixed2(expectedStlg) });
  }
  return line;
}

export function toXml(doc) {
  const out = [
    '<?xml version="1.0" encoding="utf-8" ?>',
    '<TaxInvoiceBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="TaxInvoice.xsd">',
    el('TIN', doc.sellerTin, '  '),
    '  <ListOfTaxInvoice>',
  ];
  for (const inv of doc.invoices) {
    const i = '      ';
    out.push('    <TaxInvoice>',
      el('TaxInvoiceDate', inv.TaxInvoiceDate, i), el('TaxInvoiceOpt', 'Normal', i), el('TrxCode', inv.TrxCode, i),
      el('AddInfo', inv.AddInfo, i), el('CustomDoc', inv.CustomDoc, i), el('CustomDocMonthYear', inv.CustomDocMonthYear, i),
      el('RefDesc', inv.RefDesc, i), el('FacilityStamp', inv.FacilityStamp, i), el('SellerIDTKU', doc.sellerIdtku, i),
      el('BuyerTin', inv.BuyerTin, i), el('BuyerDocument', inv.BuyerDocument, i), el('BuyerCountry', inv.BuyerCountry, i),
      el('BuyerDocumentNumber', inv.BuyerDocumentNumber, i), el('BuyerName', inv.BuyerName, i), el('BuyerAdress', inv.BuyerAdress, i),
      el('BuyerEmail', inv.BuyerEmail, i), el('BuyerIDTKU', inv.BuyerIDTKU, i),
      `${i}<ListOfGoodService>`);
    for (const line of inv.lines) {
      const j = '          ';
      out.push(`${i}  <GoodService>`,
        el('Opt', line.Opt, j), el('Code', line.Code, j), el('Name', line.Name, j), el('Unit', line.Unit, j),
        el('Price', trimmed(line.Price), j), el('Qty', trimmed(line.Qty), j), el('TotalDiscount', trimmed(line.TotalDiscount), j),
        el('TaxBase', trimmed(line.TaxBase), j), el('OtherTaxBase', trimmed(line.OtherTaxBase), j), el('VATRate', trimmed(line.VATRate), j),
        el('VAT', trimmed(line.VAT), j), el('STLGRate', trimmed(line.STLGRate), j), el('STLG', trimmed(line.STLG), j),
        `${i}  </GoodService>`);
    }
    out.push(`${i}</ListOfGoodService>`, '    </TaxInvoice>');
  }
  out.push('  </ListOfTaxInvoice>', '</TaxInvoiceBulk>', '');
  return out.join('\n');
}

// Totals for the page. Money values are hundredths.
export function totals(doc) {
  const lines = doc.invoices.flatMap((inv) => inv.lines);
  const sum = (key) => lines.reduce((n, l) => n + (Number.isFinite(l[key]) ? l[key] : 0), 0);
  return [
    { id: 'Faktur', en: 'Invoices', value: doc.invoices.length },
    { id: 'Baris barang/jasa', en: 'Goods/service lines', value: lines.length },
    { id: 'Total DPP', en: 'Total tax base', value: sum('TaxBase'), money: true },
    { id: 'Total PPN', en: 'Total VAT', value: sum('VAT'), money: true },
    { id: 'Total PPnBM', en: 'Total luxury tax', value: sum('STLG'), money: true },
  ];
}

// Which of the page's two boxes this file type uses, and what they are called.
export const OWN = {
  tin: { id: 'NPWP penjual (16 digit)', en: 'Seller TIN / NPWP (16 digits)' },
  idtku: { id: 'NITKU penjual (22 digit)', en: 'Seller NITKU (22 digits)' },
};
export const HINT = {
  id: 'Satu baris = satu barang/jasa. Baris dengan Ref yang sama menjadi satu faktur.',
  en: 'One row = one goods/service line. Rows with the same Ref become one invoice.',
};

// [columns, need: yes | no | auto, Bahasa note, English note]
export const NOTES = [
  ['Ref', 'yes', 'Nomor faktur internal Anda. Hanya untuk mengelompokkan baris; tidak masuk ke XML.', 'Your own invoice number. Only groups rows; it is not written to the XML.'],
  ['TaxInvoiceDate', 'yes', 'Tanggal faktur, DD/MM/YYYY atau YYYY-MM-DD.', 'Invoice date, DD/MM/YYYY or YYYY-MM-DD.'],
  ['TrxCode', 'yes', 'Kode transaksi 01 sampai 10.', 'Transaction code 01 to 10.'],
  ['AddInfo, FacilityStamp', 'no', 'Wajib hanya untuk kode 07 dan 08 (kode referensi TD.xxxxx).', 'Required only for codes 07 and 08 (TD.xxxxx reference codes).'],
  ['CustomDoc, CustomDocMonthYear, RefDesc', 'no', 'Dokumen pendukung (bulan-tahun ditulis MMYYYY) dan referensi.', 'Supporting document (month-year written MMYYYY) and reference.'],
  ['BuyerDocument', 'auto', 'TIN, National ID, Passport atau Other ID. Kosong = TIN.', 'TIN, National ID, Passport or Other ID. Empty = TIN.'],
  ['BuyerTin', 'yes', 'NPWP pembeli 16 digit. Untuk identitas lain dikosongkan (diisi 16 nol).', 'Buyer TIN, 16 digits. Leave empty for other document types (filled with 16 zeros).'],
  ['BuyerDocumentNumber', 'no', 'Wajib jika identitas bukan TIN (NIK, nomor paspor).', 'Required when the document type is not TIN.'],
  ['BuyerCountry', 'auto', 'Kode negara 3 huruf. Kosong = IDN.', '3-letter country code. Empty = IDN.'],
  ['BuyerName, BuyerAdress', 'no', 'Nama dan alamat pembeli. Wajib jika identitas bukan TIN.', 'Buyer name and address. Required when the document type is not TIN.'],
  ['BuyerEmail', 'no', 'E-mail pembeli.', 'Buyer e-mail.'],
  ['BuyerIDTKU', 'yes', 'NITKU pembeli 22 digit. Untuk identitas bukan TIN dikosongkan (diisi 000000).', 'Buyer NITKU, 22 digits. Leave empty when the document type is not TIN (filled with 000000).'],
  ['Opt', 'auto', 'A = barang, B = jasa. Kosong = A.', 'A = goods, B = services. Empty = A.'],
  ['Code', 'auto', 'Kode barang/jasa 6 digit. Kosong = 000000.', 'Goods/service code, 6 digits. Empty = 000000.'],
  ['Name', 'yes', 'Nama barang atau jasa.', 'Name of the goods or service.'],
  ['Unit', 'yes', 'Kode satuan DJP, misalnya UM.0018.', 'Tax office unit code, for example UM.0018.'],
  ['Price, Qty', 'yes', 'Harga satuan dan jumlah, paling banyak 2 desimal.', 'Unit price and quantity, at most 2 decimals.'],
  ['TotalDiscount', 'auto', 'Diskon baris. Kosong = 0.', 'Line discount. Empty = 0.'],
  ['TaxBase', 'auto', 'DPP. Kosong = Harga x Jumlah - Diskon.', 'Tax base. Empty = Price x Qty - Discount.'],
  ['OtherTaxBase', 'auto', 'DPP Nilai Lain. Kosong = 11/12 x DPP untuk kode 04, selain itu sama dengan DPP.', 'Other tax base. Empty = 11/12 x TaxBase for code 04, otherwise equal to TaxBase.'],
  ['VATRate, VAT', 'auto', 'Tarif dan PPN. Kosong = 12 dan tarif x DPP Nilai Lain.', 'Rate and VAT. Empty = 12 and rate x OtherTaxBase.'],
  ['STLGRate, STLG', 'auto', 'Tarif dan PPnBM. Kosong = 0.', 'Luxury tax rate and amount. Empty = 0.'],
  ['SellerTIN, SellerIDTKU', 'no', 'Boleh diisi di file sebagai pengganti dua kotak di atas.', 'May be given in the file instead of the two boxes above.'],
];
