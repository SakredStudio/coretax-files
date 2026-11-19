// Withholding slip import files: BPPU (unification), BP21 (income tax art. 21, non-permanent staff
// and others) and BPMP (monthly slips for permanent employees). One CSV row = one slip.
// Element order follows the tax office sample files bppu.xml, bp21.xml and bpmp.xml (7 Nov 2024),
// read on 2026-11-18. Allowed code lists are only known from those samples, so values outside
// them are warnings, not errors.
import { mulDiv, trimmed } from './num.js';
import { digits, isoDate, el, nil, cellReader, checkColumns, finite } from './common.js';

const ZERO_TIN = '0'.repeat(16);

// Field kinds, in the order the elements are written.
const SPECS = {
  bppu: {
    label: 'Bukti Potong Unifikasi (BPPU)', root: 'BpuBulk', list: 'ListOfBpu', item: 'Bpu',
    fields: [
      ['TaxPeriodMonth', 'month'], ['TaxPeriodYear', 'year'], ['CounterpartTin', 'tin'],
      ['IDPlaceOfBusinessActivityOfIncomeRecipient', 'recipientIdtku'],
      ['TaxCertificate', 'seen', ['N/A', 'DTP', 'PP23', 'ETC']], ['TaxObjectCode', 'objectCode'],
      ['TaxBase', 'money'], ['Rate', 'percent'],
      ['Document', 'seenRequired', ['CommercialInvoice', 'TaxInvoice']], ['DocumentNumber', 'text'], ['DocumentDate', 'date'],
      ['IDPlaceOfBusinessActivity', 'ownIdtku'], ['GovTreasurerOpt', 'seen', ['N/A']], ['SP2DNumber', 'nil'],
      ['WithholdingDate', 'withholdingDate'],
    ],
    tax: (s) => mulDiv(s.TaxBase, s.Rate, 10000), base: 'TaxBase',
  },
  bp21: {
    label: 'Bukti Potong PPh 21 (BP21)', root: 'Bp21Bulk', list: 'ListOfBp21', item: 'Bp21',
    fields: [
      ['TaxPeriodMonth', 'month'], ['TaxPeriodYear', 'year'], ['CounterpartTin', 'tin'],
      ['IDPlaceOfBusinessActivityOfIncomeRecipient', 'recipientIdtku'], ['StatusTaxExemption', 'ptkp'],
      ['TaxCertificate', 'seen', ['N/A', 'TaxExAr21', 'DTP', 'ETC']], ['TaxObjectCode', 'objectCode'],
      ['Gross', 'money'], ['Deemed', 'percent'], ['Rate', 'percent'],
      ['Document', 'seenRequired', ['CommercialInvoice', 'TaxInvoice']], ['DocumentNumber', 'text'], ['DocumentDate', 'date'],
      ['IDPlaceOfBusinessActivity', 'ownIdtku'], ['WithholdingDate', 'withholdingDate'],
    ],
    tax: (s) => mulDiv(mulDiv(s.Gross, s.Deemed, 10000), s.Rate, 10000), base: 'Gross',
  },
  bpmp: {
    label: 'Bukti Potong Bulanan Pegawai Tetap (BPMP)', root: 'MmPayrollBulk', list: 'ListOfMmPayroll', item: 'MmPayroll',
    fields: [
      ['TaxPeriodMonth', 'month'], ['TaxPeriodYear', 'year'], ['CounterpartOpt', 'resident'], ['CounterpartPassport', 'passport'],
      ['CounterpartTin', 'tin'], ['StatusTaxExemption', 'ptkp'], ['Position', 'text'],
      ['TaxCertificate', 'seen', ['N/A', 'DTP', 'ETC']], ['TaxObjectCode', 'objectCode'],
      ['Gross', 'money'], ['Rate', 'percent'], ['IDPlaceOfBusinessActivity', 'ownIdtku'], ['WithholdingDate', 'withholdingDate'],
    ],
    tax: (s) => mulDiv(s.Gross, s.Rate, 10000), base: 'Gross',
  },
};

const NOTE_TEXT = {
  TaxPeriodMonth: ['yes', 'Masa pajak, bulan 1 sampai 12.', 'Tax period month, 1 to 12.'],
  TaxPeriodYear: ['yes', 'Masa pajak, tahun 4 digit.', 'Tax period year, 4 digits.'],
  CounterpartTin: ['yes', 'NPWP atau NIK penerima penghasilan, 16 digit.', 'TIN or national ID of the income recipient, 16 digits.'],
  IDPlaceOfBusinessActivityOfIncomeRecipient: ['auto', 'NITKU penerima, 22 digit. Kosong = NPWP penerima + 000000.', 'Recipient NITKU, 22 digits. Empty = recipient TIN + 000000.'],
  StatusTaxExemption: ['yes', 'Status PTKP, misalnya TK/0 atau K/2.', 'Tax-free allowance status, for example TK/0 or K/2.'],
  TaxCertificate: ['auto', 'Fasilitas pajak. Kosong = N/A.', 'Tax facility. Empty = N/A.'],
  TaxObjectCode: ['yes', 'Kode objek pajak, misalnya 24-104-05.', 'Tax object code, for example 24-104-05.'],
  TaxBase: ['yes', 'Dasar pengenaan pajak (rupiah).', 'Tax base (rupiah).'],
  Gross: ['yes', 'Penghasilan bruto (rupiah).', 'Gross income (rupiah).'],
  Deemed: ['yes', 'Persentase dasar pengenaan, 0 sampai 100.', 'Deemed percentage of gross, 0 to 100.'],
  Rate: ['yes', 'Tarif dalam persen, misalnya 2 atau 0,5.', 'Rate in percent, for example 2 or 0.5.'],
  Document: ['yes', 'Jenis dokumen dasar, misalnya CommercialInvoice atau TaxInvoice.', 'Kind of supporting document, for example CommercialInvoice or TaxInvoice.'],
  DocumentNumber: ['yes', 'Nomor dokumen dasar.', 'Number of the supporting document.'],
  DocumentDate: ['yes', 'Tanggal dokumen, DD/MM/YYYY atau YYYY-MM-DD.', 'Document date, DD/MM/YYYY or YYYY-MM-DD.'],
  IDPlaceOfBusinessActivity: ['auto', 'NITKU pemotong, 22 digit. Kosong = NITKU di kotak atas.', 'Withholder NITKU, 22 digits. Empty = the NITKU box above.'],
  GovTreasurerOpt: ['auto', 'Khusus bendahara pemerintah. Kosong = N/A.', 'Government treasurers only. Empty = N/A.'],
  SP2DNumber: ['no', 'Nomor SP2D, khusus bendahara pemerintah.', 'SP2D number, government treasurers only.'],
  WithholdingDate: ['yes', 'Tanggal pemotongan, DD/MM/YYYY atau YYYY-MM-DD.', 'Withholding date, DD/MM/YYYY or YYYY-MM-DD.'],
  CounterpartOpt: ['auto', 'Resident atau Foreign. Kosong = Resident.', 'Resident or Foreign. Empty = Resident.'],
  CounterpartPassport: ['no', 'Nomor paspor, wajib untuk Foreign.', 'Passport number, required for Foreign.'],
  Position: ['yes', 'Jabatan pegawai.', 'Employee position.'],
};

function make(id) {
  const spec = SPECS[id];
  const COLUMNS = spec.fields.map(([name]) => name);
  const autoKinds = new Set(['recipientIdtku', 'seen', 'ownIdtku', 'nil', 'resident', 'passport']);
  const REQUIRED = spec.fields.filter(([, kind]) => !autoKinds.has(kind)).map(([name]) => name);

  function build(rows, options = {}) {
    const findings = [];
    const add = (level, code, at = {}, params = {}) => findings.push({ level, code, ...at, params });
    if (!checkColumns(rows, REQUIRED, add)) return { doc: null, findings, xml: null };

    const tin = digits(options.sellerTin);
    const ownIdtku = digits(options.sellerIdtku);
    if (!/^\d{16}$/.test(tin)) add('error', 'OWN_TIN', { field: 'TIN' });

    const slips = rows.map((row) => {
      const c = row.cells;
      const at = { line: row.line };
      const read = cellReader(c, at, add, options.decimalComma);
      const fill = (field, value) => { add('info', 'FILLED', { ...at, field }, { field, value }); return value; };
      const bad = (code, field, params = {}) => { add('error', code, { ...at, field }, { field, ...params }); };
      const slip = { line: row.line };

      for (const [field, kind, seen] of spec.fields) {
        const raw = (c[field] ?? '').trim();
        let value = raw;
        if (kind === 'month') {
          value = /^\d{1,2}$/.test(raw) && +raw >= 1 && +raw <= 12 ? String(+raw) : '';
          if (!value) bad('PERIOD_MONTH', field);
        } else if (kind === 'year') {
          value = /^(19|20)\d{2}$/.test(raw) ? raw : '';
          if (!value) bad('PERIOD_YEAR', field);
        } else if (kind === 'tin') {
          value = digits(raw);
          if (value === '' && slip.CounterpartOpt === 'Foreign') value = fill(field, ZERO_TIN);
          else if (!/^\d{16}$/.test(value)) bad('COUNTERPART_TIN', field);
        } else if (kind === 'recipientIdtku') {
          value = digits(raw);
          if (value === '' && /^\d{16}$/.test(slip.CounterpartTin)) value = fill(field, `${slip.CounterpartTin}000000`);
          else if (!/^\d{22}$/.test(value)) bad('IDTKU_22', field);
        } else if (kind === 'ownIdtku') {
          value = digits(raw) || ownIdtku;
          if (!/^\d{22}$/.test(value)) bad('IDTKU_22', field);
          else if (/^\d{16}$/.test(tin) && !value.startsWith(tin)) add('warning', 'OWN_IDTKU_PREFIX', { ...at, field }, { field });
        } else if (kind === 'ptkp') {
          value = raw.toUpperCase().replace(/\s/g, '');
          if (!/^(TK|K|HB)\/[0-3]$/.test(value)) bad('PTKP', field);
        } else if (kind === 'seen' || kind === 'seenRequired') {
          if (raw === '' && kind === 'seen') value = seen[0];
          else if (raw === '') bad('REQUIRED', field);
          else {
            const match = seen.find((s) => s.toLowerCase() === raw.toLowerCase());
            if (match) value = match;
            else add('warning', 'VALUE_UNSEEN', { ...at, field }, { field, value: raw, seen: seen.join(', ') });
          }
        } else if (kind === 'objectCode') {
          if (!/^\d{2}-\d{3}-\d{2}$/.test(raw)) bad('TAX_OBJECT_CODE', field);
        } else if (kind === 'money') {
          value = read.required(field);
        } else if (kind === 'percent') {
          value = read.required(field);
          if (Number.isFinite(value) && value > 10000) { bad('PERCENT', field); value = NaN; }
        } else if (kind === 'text') {
          value = read.text(field);
          if (!value) bad('REQUIRED', field);
        } else if (kind === 'nil') {
          value = read.text(field);
        } else if (kind === 'date' || kind === 'withholdingDate') {
          value = isoDate(raw);
          if (!value) bad('DATE_FIELD', field);
          else if (kind === 'withholdingDate' && slip.TaxPeriodMonth && slip.TaxPeriodYear
            && value.slice(0, 7) !== `${slip.TaxPeriodYear}-${slip.TaxPeriodMonth.padStart(2, '0')}`) {
            add('warning', 'WITHHOLDING_PERIOD', { ...at, field }, { date: value, month: slip.TaxPeriodMonth, year: slip.TaxPeriodYear });
          }
        } else if (kind === 'resident') {
          const key = raw.toLowerCase();
          value = { '': 'Resident', resident: 'Resident', foreign: 'Foreign', wni: 'Resident', wna: 'Foreign' }[key] || '';
          if (!value) bad('COUNTERPART_OPT', field);
        } else if (kind === 'passport') {
          value = read.text(field);
          if (!value && slip.CounterpartOpt === 'Foreign') bad('PASSPORT_REQUIRED', field);
        }
        slip[field] = value;
      }
      const inputs = spec.fields.filter(([, kind]) => kind === 'money' || kind === 'percent').map(([name]) => slip[name]);
      slip.tax = finite(...inputs) ? spec.tax(slip) : NaN;
      return slip;
    });

    const doc = { tin, slips };
    const blocked = findings.some((f) => f.level === 'error');
    return { doc, findings, xml: blocked ? null : toXml(doc) };
  }

  function toXml(doc) {
    const out = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      `<${spec.root} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
      el('TIN', doc.tin, '\t'),
      `\t<${spec.list}>`,
    ];
    for (const slip of doc.slips) {
      out.push(`\t\t<${spec.item}>`);
      for (const [field, kind] of spec.fields) {
        const value = kind === 'money' || kind === 'percent' ? trimmed(slip[field]) : slip[field];
        out.push((kind === 'nil' || kind === 'passport' ? nil : el)(field, value, '\t\t\t'));
      }
      out.push(`\t\t</${spec.item}>`);
    }
    out.push(`\t</${spec.list}>`, `</${spec.root}>`, '');
    return out.join('\n');
  }

  function totals(doc) {
    const sum = (key) => doc.slips.reduce((n, s) => n + (Number.isFinite(s[key]) ? s[key] : 0), 0);
    return [
      { id: 'Bukti potong', en: 'Slips', value: doc.slips.length },
      { id: spec.base === 'Gross' ? 'Total bruto' : 'Total DPP', en: spec.base === 'Gross' ? 'Total gross' : 'Total tax base', value: sum(spec.base), money: true },
      { id: 'Perkiraan pajak dipotong', en: 'Estimated tax withheld', value: sum('tax'), money: true },
    ];
  }

  return {
    id, label: spec.label, TEMPLATE: `${id}.xml (2024-11-07)`, COLUMNS, build, toXml, totals,
    OWN: {
      tin: { id: 'NPWP pemotong (16 digit)', en: 'Withholder TIN / NPWP (16 digits)' },
      idtku: { id: 'NITKU pemotong (22 digit)', en: 'Withholder NITKU (22 digits)' },
    },
    HINT: { id: 'Satu baris = satu bukti potong.', en: 'One row = one withholding slip.' },
    NOTES: COLUMNS.map((name) => [name, ...NOTE_TEXT[name]]),
  };
}

export const bppu = make('bppu');
export const bp21 = make('bp21');
export const bpmp = make('bpmp');
