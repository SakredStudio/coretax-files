import { buildFromCsv, fileTypes, text, fixed2 } from '../src/index.js';

const $ = (id) => document.getElementById(id);

// Page wording. Finding wording lives in src/messages.js.
const UI = {
  id: {
    lede: 'Periksa daftar faktur, retur atau bukti potong Anda, lihat kesalahannya dalam bahasa yang jelas, lalu unduh file XML untuk diimpor ke Coretax.',
    typeLabel: 'Jenis file',
    early: 'Versi awal. Susunan file sudah dicocokkan dengan file contoh resmi DJP ({template}), tetapi file dari alat ini belum pernah diunggah ke Coretax. Selalu periksa hasilnya sebelum mengunggah.',
    dropTitle: 'Pilih atau seret file CSV ke sini',
    privacy: 'File dibaca di browser Anda. Tidak ada data yang dikirim atau disimpan.',
    trySample: 'Coba dengan data contoh',
    getTemplate: 'Unduh template CSV',
    download: 'Unduh XML',
    findingsTitle: 'Temuan',
    columnsTitle: 'Kolom file CSV',
    columnsIntro: 'Nama kolom sama dengan nama elemen di template DJP. Di Excel pilih "Save As" lalu "CSV". Angka boleh ditulis 1.500.000 atau 1500000.',
    colName: 'Kolom', colNeed: 'Wajib', colNote: 'Isi',
    footNot: 'Alat ini tidak berafiliasi dengan Direktorat Jenderal Pajak (DJP) dan bukan penyedia jasa aplikasi perpajakan. Alat ini hanya membuat file; Anda sendiri yang mengunggahnya ke Coretax.',
    footSource: 'Kode sumber (MIT)', footIssue: 'Laporkan masalah (jangan lampirkan data pajak asli)',
    footEarly: 'Bukan nasihat pajak. Jika aturan atau template DJP berubah, hasil alat ini bisa tidak berlaku lagi.',
    verdictOk: 'Tidak ada kesalahan. File XML siap diunduh.',
    verdictErr: '{n} kesalahan harus diperbaiki sebelum file XML bisa dibuat.',
    counts: '{e} kesalahan, {w} peringatan, {i} catatan',
    none: 'Tidak ada temuan.',
    line: 'Baris {line}', file: 'File',
    notCsv: 'File ini tidak bisa dibaca sebagai CSV.',
    sampleFail: 'Data contoh tidak bisa dimuat.',
    yes: 'Ya', no: 'Tidak', auto: 'Otomatis',
    fileNote: 'Nama file: {name}',
  },
  en: {
    lede: 'Check your list of invoices, returns or withholding slips, see the mistakes in plain words, then download the XML file to import into Coretax.',
    typeLabel: 'File type',
    early: 'Early version. The file layout has been matched against the tax office sample file ({template}), but a file from this tool has never been uploaded to Coretax. Always check the result before you upload.',
    dropTitle: 'Choose a CSV file or drop it here',
    privacy: 'The file is read in your browser. Nothing is sent or stored.',
    trySample: 'Try with sample data',
    getTemplate: 'Download CSV template',
    download: 'Download XML',
    findingsTitle: 'Findings',
    columnsTitle: 'CSV columns',
    columnsIntro: 'Column names match the element names in the tax office template. In Excel choose "Save As", then "CSV". Numbers may be written 1.500.000 or 1500000.',
    colName: 'Column', colNeed: 'Required', colNote: 'What goes in it',
    footNot: 'This tool is not affiliated with the Directorate General of Taxes (DJP) and is not a tax application service provider. It only builds a file; you upload it to Coretax yourself.',
    footSource: 'Source code (MIT)', footIssue: 'Report a problem (never attach real tax data)',
    footEarly: 'Not tax advice. If the rules or the tax office template change, this tool\'s output may stop being valid.',
    verdictOk: 'No errors. The XML file is ready to download.',
    verdictErr: 'Errors to fix before the XML file can be built: {n}.',
    counts: '{e} errors, {w} warnings, {i} notes',
    none: 'No findings.',
    line: 'Row {line}', file: 'File',
    notCsv: 'This file could not be read as CSV.',
    sampleFail: 'The sample data could not be loaded.',
    yes: 'Yes', no: 'No', auto: 'Automatic',
    fileNote: 'File name: {name}',
  },
};

let lang = 'id';
try { lang = localStorage.getItem('lang') === 'en' ? 'en' : 'id'; } catch { /* storage may be blocked */ }
let type = fileTypes[0];
let last = null; // { csv, name } of the file on screen
let lastXml = null;

const t = (key, params = {}) => UI[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
const rupiah = (cents) => new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(fixed2(cents)));

function paintStatic() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t, { template: type.TEMPLATE });
  $('ownTinLabel').textContent = type.OWN.tin[lang];
  $('ownIdtkuField').hidden = !type.OWN.idtku;
  if (type.OWN.idtku) $('ownIdtkuLabel').textContent = type.OWN.idtku[lang];
  $('dropHint').textContent = type.HINT[lang];
  for (const btn of document.querySelectorAll('[data-lang]')) btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
  $('columns').replaceChildren(...type.NOTES.map(([name, need, idNote, enNote]) => {
    const tr = document.createElement('tr');
    const code = document.createElement('code');
    code.textContent = name;
    const first = document.createElement('td');
    first.append(code);
    const second = document.createElement('td');
    second.textContent = t(need);
    const third = document.createElement('td');
    third.textContent = lang === 'id' ? idNote : enNote;
    tr.append(first, second, third);
    return tr;
  }));
}

function tile(labelText, value) {
  const div = document.createElement('div');
  div.className = 'tile';
  const small = document.createElement('small');
  small.textContent = labelText;
  const b = document.createElement('b');
  b.textContent = value;
  div.append(small, b);
  return div;
}

function render() {
  if (!last) { $('result').hidden = true; return; }
  let result;
  try {
    result = buildFromCsv(last.csv, { sellerTin: $('sellerTin').value, sellerIdtku: $('sellerIdtku').value }, type);
  } catch (err) {
    console.error(err);
    result = { doc: null, xml: null, findings: [{ level: 'error', code: '__NOT_CSV' }] };
  }
  lastXml = result.xml;

  const sums = result.doc ? type.totals(result.doc) : [];
  $('summary').replaceChildren(...sums.map((s) => tile(s[lang], s.money ? rupiah(s.value) : String(s.value))));

  const count = (level) => result.findings.filter((f) => f.level === level).length;
  const errors = count('error');
  $('verdict').className = `verdict ${errors ? 'error' : 'ok'}`;
  $('verdict').textContent = errors ? t('verdictErr', { n: errors }) : t('verdictOk');
  $('download').disabled = !result.xml;
  $('fileNote').textContent = result.xml ? t('fileNote', { name: xmlName() }) : '';
  $('findingsTitle').textContent = `${t('findingsTitle')}: ${t('counts', { e: errors, w: count('warning'), i: count('info') })}`;

  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...result.findings].sort((a, b) => order[a.level] - order[b.level] || (a.line ?? 0) - (b.line ?? 0));
  const items = sorted.map((f) => {
    const li = document.createElement('li');
    li.className = f.level;
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = f.line ? `${t('line', { line: f.line })}${f.ref ? ` · ${f.ref}` : ''}` : t('file');
    const what = document.createElement('span');
    what.textContent = f.code === '__NOT_CSV' ? t('notCsv') : text(f, lang);
    li.append(where, what);
    return li;
  });
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'info';
    li.textContent = t('none');
    items.push(li);
  }
  $('findings').replaceChildren(...items);
  $('result').hidden = false;
}

const xmlName = () => `${(last?.name || type.id).replace(/\.csv$/i, '')}.xml`;

function save(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function take(file) {
  if (!file) return;
  last = { csv: await file.text(), name: file.name };
  render();
}

$('file').addEventListener('change', (e) => take(e.target.files[0]));
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => take(e.dataTransfer.files[0]));
for (const box of [$('sellerTin'), $('sellerIdtku')]) box.addEventListener('input', render);

$('download').addEventListener('click', () => { if (lastXml) save(xmlName(), lastXml, 'application/xml;charset=utf-8'); });
$('template').addEventListener('click', () => {
  const columns = type.COLUMNS.filter((c) => type.id !== 'faktur-keluaran' || (c !== 'SellerTIN' && c !== 'SellerIDTKU'));
  save('template-' + type.id + '.csv', String.fromCharCode(0xFEFF) + columns.join(';') + String.fromCharCode(13, 10), 'text/csv;charset=utf-8');
});

// Made-up sample. Locally it comes from samples/; a hosted build sets data-samples on <html>.
const SAMPLE_BASE = document.documentElement.dataset.samples || '../samples/';
$('sample').addEventListener('click', async () => {
  try {
    const res = await fetch(`${SAMPLE_BASE}${type.id}-contoh.csv`);
    if (!res.ok) throw new Error(String(res.status));
    last = { csv: await res.text(), name: `${type.id}-contoh.csv` };
    if (!$('sellerTin').value) $('sellerTin').value = '0123456789012345';
    if (!$('sellerIdtku').value) $('sellerIdtku').value = '0123456789012345000000';
    render();
  } catch {
    last = null;
    $('result').hidden = true;
    alert(t('sampleFail'));
  }
});

for (const btn of document.querySelectorAll('[data-lang]')) {
  btn.addEventListener('click', () => {
    lang = btn.dataset.lang;
    try { localStorage.setItem('lang', lang); } catch { /* storage may be blocked */ }
    paintStatic();
    render();
  });
}

for (const ft of fileTypes) {
  const option = document.createElement('option');
  option.value = ft.id;
  option.textContent = ft.label;
  $('type').append(option);
}
$('type').addEventListener('change', () => {
  type = fileTypes.find((ft) => ft.id === $('type').value) || fileTypes[0];
  last = null;
  $('file').value = '';
  paintStatic();
  render();
});

paintStatic();
