// Retur Faktur Pajak Masukan (return note for a purchase invoice), root <InputTaxInvoiceReturn>.
// Element order follows the tax office's "Sample Retur Faktur PM Template v.1.1" (1 March 2025),
// read on 2026-11-18. One CSV row = one returned goods/service line; rows that share an
// InvoiceNumber form one return. Invoice totals and the footer are added up from the rows.
import { mulDiv, fixed2, trimmed } from './num.js';
import { digits, isoDate, el, cellReader, checkColumns, finite } from './common.js';

export const id = 'retur-masukan';
export const label = 'Retur Faktur Pajak Masukan';
export const TEMPLATE = 'Retur Faktur PM v1.1 (2025-03-01)';
export const MAX_RETURNS = 1000;

const HEADER_FIELDS = ['SellerTIN', 'ReturnDate'];
export const COLUMNS = [
  'InvoiceNumber', ...HEADER_FIELDS, 'Type', 'Name', 'Code', 'Quantity', 'Unit', 'UnitPrice', 'STLGRate',
  'ReturnQuantity', 'ReturnDiscount', 'ReturnTaxBase', 'ReturnOtherTaxBase', 'VATRate', 'ReturnVAT', 'ReturnSTLG',
];
const REQUIRED_COLUMNS = ['InvoiceNumber', 'SellerTIN', 'ReturnDate', 'Name', 'Quantity', 'Unit', 'UnitPrice', 'ReturnQuantity'];

export function build(rows, options = {}) {
  const findings = [];
  const add = (level, code, at = {}, params = {}) => findings.push({ level, code, ...at, params });
  const { decimalComma = false, today = new Date().toISOString().slice(0, 10) } = options;
  if (!checkColumns(rows, REQUIRED_COLUMNS, add)) return { doc: null, findings, xml: null };

  const tin = digits(options.sellerTin);
  if (!/^\d{16}$/.test(tin)) add('error', 'OWN_TIN', { field: 'TIN' });

  const returns = [];
  const byNumber = new Map();
  for (const row of rows) {
    const c = row.cells;
    const number = digits(c.InvoiceNumber);
    const at = { line: row.line, ref: number || undefined };
    if (!/^\d{17}$/.test(number)) { add('error', 'INVOICE_NUMBER', { ...at, field: 'InvoiceNumber' }); continue; }

    let ret = byNumber.get(number);
    if (!ret) {
      ret = { InvoiceNumber: number, line: row.line, raw: { SellerTIN: c.SellerTIN ?? '', ReturnDate: c.ReturnDate ?? '' }, rows: [] };
      ret.SellerTIN = digits(c.SellerTIN);
      if (!/^\d{16}$/.test(ret.SellerTIN)) add('error', 'RETURN_SELLER_TIN', { ...at, field: 'SellerTIN' });
      const iso = isoDate(c.ReturnDate);
      if (!iso) add('error', 'DATE_FIELD', { ...at, field: 'ReturnDate' }, { field: 'ReturnDate' });
      else if (iso > today) add('warning', 'DATE_FUTURE', { ...at, field: 'ReturnDate' }, { date: iso });
      // The return file writes dates day first, unlike the invoice file.
      ret.ReturnDate = iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '';
      byNumber.set(number, ret);
      returns.push(ret);
    } else {
      for (const field of HEADER_FIELDS) {
        const value = c[field] ?? '';
        if (value !== '' && value !== ret.raw[field]) add('error', 'HEADER_MISMATCH', { ...at, field }, { field, first: ret.raw[field] || '-' });
      }
    }
    ret.rows.push(readRow(c, at, add, decimalComma));
  }
  if (returns.length > MAX_RETURNS) add('error', 'TOO_MANY', {}, { count: returns.length, max: MAX_RETURNS });

  for (const ret of returns) {
    const sum = (key) => ret.rows.reduce((n, r) => n + (Number.isFinite(r[key]) ? r[key] : 0), 0);
    ret.totals = { taxBase: sum('ReturnTaxBase'), otherTaxBase: sum('ReturnOtherTaxBase'), vat: sum('ReturnVAT'), stlg: sum('ReturnSTLG') };
  }
  const doc = { tin, returns };
  const blocked = findings.some((f) => f.level === 'error');
  return { doc, findings, xml: blocked ? null : toXml(doc) };
}

function readRow(c, at, add, decimalComma) {
  const read = cellReader(c, at, add, decimalComma);
  const row = { line: at.line };
  row.Type = String(c.Type || 'A').trim().toUpperCase();
  if (row.Type !== 'A' && row.Type !== 'B') add('error', 'TYPE', { ...at, field: 'Type' });
  row.Name = read.text('Name');
  if (!row.Name) add('error', 'NAME', { ...at, field: 'Name' });
  row.Code = digits(c.Code) || '000000';
  if (!/^\d{6}$/.test(row.Code)) add('error', 'CODE', { ...at, field: 'Code' });
  row.Unit = String(c.Unit ?? '').trim().toUpperCase();
  const unit = /^UM\.(\d{4})$/.exec(row.Unit);
  if (!unit) add('error', 'UNIT', { ...at, field: 'Unit' });
  else if (+unit[1] < 1 || +unit[1] > 39) add('warning', 'UNIT_RANGE', { ...at, field: 'Unit' }, { unit: row.Unit });

  row.Quantity = read.required('Quantity', { positive: true });
  row.UnitPrice = read.required('UnitPrice', { positive: true });
  row.STLGRate = read.amount('STLGRate') ?? 0;
  row.ReturnQuantity = read.required('ReturnQuantity', { positive: true });
  if (finite(row.Quantity, row.ReturnQuantity) && row.ReturnQuantity > row.Quantity) {
    add('error', 'RETURN_QTY', { ...at, field: 'ReturnQuantity' }, { got: trimmed(row.ReturnQuantity), max: trimmed(row.Quantity) });
  }
  row.ReturnDiscount = read.amount('ReturnDiscount') ?? 0;

  const expectedBase = finite(row.UnitPrice, row.ReturnQuantity, row.ReturnDiscount) ? mulDiv(row.UnitPrice, row.ReturnQuantity, 100) - row.ReturnDiscount : NaN;
  row.ReturnTaxBase = read.amount('ReturnTaxBase') ?? expectedBase;
  if (finite(expectedBase, row.ReturnTaxBase)) {
    if (expectedBase < 0) add('error', 'NEGATIVE', { ...at, field: 'ReturnTaxBase' }, { field: 'ReturnTaxBase' });
    else if (Math.abs(row.ReturnTaxBase - expectedBase) > 100) add('error', 'RETURN_TAXBASE', { ...at, field: 'ReturnTaxBase' }, { got: fixed2(row.ReturnTaxBase), expected: fixed2(expectedBase) });
  }
  const other = read.amount('ReturnOtherTaxBase');
  row.ReturnOtherTaxBase = other ?? row.ReturnTaxBase;
  // Assumption: the flag is "true" when a different other tax base is used. The sample only shows "false".
  row.ReturnOtherTaxBaseCheck = finite(row.ReturnOtherTaxBase, row.ReturnTaxBase) && row.ReturnOtherTaxBase !== row.ReturnTaxBase ? 'true' : 'false';

  const rate = read.amount('VATRate') ?? 1200;
  const expectedVat = finite(row.ReturnOtherTaxBase, rate) ? mulDiv(row.ReturnOtherTaxBase, rate, 10000) : NaN;
  row.ReturnVAT = read.amount('ReturnVAT') ?? expectedVat;
  if (finite(row.ReturnVAT, expectedVat) && Math.abs(row.ReturnVAT - expectedVat) >= 100) {
    add('warning', 'VAT', { ...at, field: 'ReturnVAT' }, { got: fixed2(row.ReturnVAT), expected: fixed2(expectedVat) });
  }
  const expectedStlg = finite(row.ReturnTaxBase, row.STLGRate) ? mulDiv(row.ReturnTaxBase, row.STLGRate, 10000) : NaN;
  row.ReturnSTLG = read.amount('ReturnSTLG') ?? (Number.isFinite(expectedStlg) ? expectedStlg : 0);
  if (finite(row.ReturnSTLG, expectedStlg) && Math.abs(row.ReturnSTLG - expectedStlg) >= 100) {
    add('warning', 'STLG', { ...at, field: 'ReturnSTLG' }, { got: fixed2(row.ReturnSTLG), expected: fixed2(expectedStlg) });
  }
  return row;
}

export function toXml(doc) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<InputTaxInvoiceReturn>', el('TIN', doc.tin, '\t'), '\t<InputReturnDataList>'];
  for (const ret of doc.returns) {
    const i = '\t\t\t\t';
    out.push('\t\t<InputReturnData>', '\t\t\t<TransactionDocumentData>',
      el('InvoiceNumber', ret.InvoiceNumber, i), el('SellerTIN', ret.SellerTIN, i), el('ReturnDate', ret.ReturnDate, i),
      el('ReturnTaxBase', trimmed(ret.totals.taxBase), i), el('ReturnOtherTaxBase', trimmed(ret.totals.otherTaxBase), i),
      el('ReturnVAT', trimmed(ret.totals.vat), i), el('ReturnSTLG', trimmed(ret.totals.stlg), i),
      '\t\t\t</TransactionDocumentData>', '\t\t\t<TransactionDetailsData>');
    for (const row of ret.rows) {
      const j = '\t\t\t\t\t';
      out.push(`${i}<Rows>`,
        el('Type', row.Type, j), el('Name', row.Name, j), el('Code', row.Code, j), el('Quantity', trimmed(row.Quantity), j),
        el('Unit', row.Unit, j), el('UnitPrice', trimmed(row.UnitPrice), j), el('STLGRate', trimmed(row.STLGRate), j),
        el('ReturnQuantity', trimmed(row.ReturnQuantity), j), el('ReturnDiscount', trimmed(row.ReturnDiscount), j),
        el('ReturnTaxBase', trimmed(row.ReturnTaxBase), j), el('ReturnOtherTaxBase', trimmed(row.ReturnOtherTaxBase), j),
        el('ReturnOtherTaxBaseCheck', row.ReturnOtherTaxBaseCheck, j), el('ReturnVAT', trimmed(row.ReturnVAT), j),
        el('ReturnSTLG', trimmed(row.ReturnSTLG), j), `${i}</Rows>`);
    }
    const j = '\t\t\t\t\t';
    out.push(`${i}<FooterRow>`,
      el('ReturnTaxBaseTotal', trimmed(ret.totals.taxBase), j), el('ReturnOtherTaxBaseTotal', trimmed(ret.totals.otherTaxBase), j),
      el('ReturnVATTotal', trimmed(ret.totals.vat), j), el('ReturnSTLGTotal', trimmed(ret.totals.stlg), j),
      `${i}</FooterRow>`, '\t\t\t</TransactionDetailsData>', '\t\t</InputReturnData>');
  }
  out.push('\t</InputReturnDataList>', '</InputTaxInvoiceReturn>', '');
  return out.join('\n');
}

export function totals(doc) {
  const sum = (key) => doc.returns.reduce((n, r) => n + r.totals[key], 0);
  return [
    { id: 'Retur', en: 'Returns', value: doc.returns.length },
    { id: 'Baris barang/jasa', en: 'Goods/service lines', value: doc.returns.reduce((n, r) => n + r.rows.length, 0) },
    { id: 'Total DPP retur', en: 'Returned tax base', value: sum('taxBase'), money: true },
    { id: 'Total PPN retur', en: 'Returned VAT', value: sum('vat'), money: true },
    { id: 'Total PPnBM retur', en: 'Returned luxury tax', value: sum('stlg'), money: true },
  ];
}

export const OWN = { tin: { id: 'NPWP Anda sebagai pembeli (16 digit)', en: 'Your TIN / NPWP as the buyer (16 digits)' }, idtku: null };
export const HINT = {
  id: 'Satu baris = satu barang/jasa yang diretur. Baris dengan nomor faktur yang sama menjadi satu retur.',
  en: 'One row = one returned goods/service line. Rows with the same invoice number become one return.',
};
export const NOTES = [
  ['InvoiceNumber', 'yes', 'Nomor faktur pajak yang diretur, 17 digit.', 'Number of the tax invoice being returned, 17 digits.'],
  ['SellerTIN', 'yes', 'NPWP penjual di faktur itu, 16 digit.', 'TIN of the seller on that invoice, 16 digits.'],
  ['ReturnDate', 'yes', 'Tanggal retur, DD/MM/YYYY atau YYYY-MM-DD.', 'Return date, DD/MM/YYYY or YYYY-MM-DD.'],
  ['Type', 'auto', 'A = barang, B = jasa. Kosong = A.', 'A = goods, B = services. Empty = A.'],
  ['Name', 'yes', 'Nama barang atau jasa, sama seperti di faktur.', 'Name of the goods or service, as on the invoice.'],
  ['Code', 'auto', 'Kode barang/jasa 6 digit. Kosong = 000000.', 'Goods/service code, 6 digits. Empty = 000000.'],
  ['Quantity, UnitPrice', 'yes', 'Jumlah dan harga satuan di faktur asal.', 'Quantity and unit price on the original invoice.'],
  ['Unit', 'yes', 'Kode satuan DJP, misalnya UM.0018.', 'Tax office unit code, for example UM.0018.'],
  ['ReturnQuantity', 'yes', 'Jumlah yang diretur; tidak boleh lebih dari Quantity.', 'Quantity returned; not more than Quantity.'],
  ['ReturnDiscount', 'auto', 'Diskon atas barang yang diretur. Kosong = 0.', 'Discount on the returned goods. Empty = 0.'],
  ['ReturnTaxBase', 'auto', 'DPP retur. Kosong = Harga x Jumlah retur - Diskon.', 'Returned tax base. Empty = UnitPrice x ReturnQuantity - Discount.'],
  ['ReturnOtherTaxBase', 'auto', 'DPP Nilai Lain retur. Kosong = sama dengan DPP retur.', 'Returned other tax base. Empty = same as the returned tax base.'],
  ['VATRate, ReturnVAT', 'auto', 'Tarif (tidak masuk ke XML) dan PPN retur. Kosong = 12 dan tarif x DPP Nilai Lain.', 'Rate (not written to the XML) and returned VAT. Empty = 12 and rate x other tax base.'],
  ['STLGRate, ReturnSTLG', 'auto', 'Tarif dan PPnBM retur. Kosong = 0.', 'Luxury tax rate and returned amount. Empty = 0.'],
];
