# Coretax Files

Checks a spreadsheet of Indonesian tax invoices, returns or withholding slips and builds the XML file you import into Coretax (the Indonesian tax office system). The file is read in your browser; nothing is uploaded.

| File type | XML root | Tax office sample it was matched against |
| --- | --- | --- |
| Faktur Pajak Keluaran (sales tax invoice) | `TaxInvoiceBulk` | Sample Faktur PK Template v.1.4 (1 Mar 2025) |
| Retur Faktur Pajak Masukan (return note) | `InputTaxInvoiceReturn` | Sample Retur Faktur PM Template v.1.1 (1 Mar 2025) |
| BPPU (unification withholding slip) | `BpuBulk` | bppu.xml (7 Nov 2024) |
| BP21 (income tax art. 21 slip) | `Bp21Bulk` | bp21.xml (7 Nov 2024) |
| BPMP (monthly slip, permanent employees) | `MmPayrollBulk` | bpmp.xml (7 Nov 2024) |

## Please read: how sure is this

- **Layout: confirmed against the official samples.** Fed the same data, the tool reproduces each of the five tax office sample files exactly (apart from spacing). `test/official.test.js` does this.
- **Never uploaded.** No file from this tool has been uploaded to Coretax, because there is no public test system. Matching a sample is not the same as being accepted.
- **Code lists are not complete.** Unit, country, goods/service, tax object, `TD.` and certificate codes are checked for shape, or against the few values that appear in the samples. A value outside the sample is a warning, not an error.
- **Samples may lag.** The withholding slip samples date from November 2024; the tax office has since updated its Excel converters (2025), which could mean added fields.
- Everything else is tested with **made-up** data. This is not tax advice, and the project is not affiliated with the Directorate General of Taxes (DJP).

## What it does

- Reads a CSV. Invoices and returns take one row per goods/service line (rows sharing a `Ref` or invoice number are grouped); slips take one row each.
- Accepts Indonesian number style (`1.500.000,50`, `;` between cells) and plain style (`1500000.50`, `,` between cells).
- Fills the usual defaults and says so (buyer country `IDN`, recipient NITKU = NPWP + `000000`, certificate `N/A`, and so on).
- Works out blank amounts: tax base, the 11/12 other tax base for transaction code 04, VAT, return totals and footer.
- Lists every problem with its row number, in Bahasa Indonesia or English, before any file is made. Errors block the download; warnings do not.
- Writes whole rupiah without `.00`, as the tax office samples do, and escapes special characters.

### Checks (examples)

- NPWP is 16 digits, NITKU is 22 digits and starts with the NPWP.
- Dates are real dates; a withholding date outside its tax period is a warning.
- Transaction code is 01 to 10; codes 07 and 08 need `AddInfo` and `FacilityStamp`.
- Tax base, other tax base, VAT and luxury tax agree with each other.
- A return cannot exceed the invoice quantity; its tax base must equal price x returned quantity - discount.
- Allowance status looks like `TK/0`; tax object code looks like `24-104-05`; rates are 0 to 100.
- At most 1,000 invoices or returns per file.

## Known limits

- CSV only. Excel files must be saved as CSV first.
- `ReturnOtherTaxBaseCheck` is written `true` when the other tax base differs from the tax base. The sample only shows `false`, so this is an assumption.
- Replacement invoices, down payments, annual slips (BPA1, BPA2) and non-resident slips (BPNR, BP26) are not handled.
- File-based only. Sending straight to the tax office needs official provider status.

## Run it yourself

```
npm test        # 26 tests, no dependencies
npm run dev     # http://localhost:8816
npm run build   # hosted copy in dist/
```

The five "official sample" tests need the tax office files in `test/official/` (git-ignored). Download them from the [DJP template page](https://www.pajak.go.id/reformdjp/coretax/template-xml-dan-converter-excel-ke-xml) and unzip them there. Without them those tests are skipped.

As a library:

```js
import { buildFromCsv, bppu, text } from './src/index.js';

const { xml, findings } = buildFromCsv(csvText, { sellerTin, sellerIdtku }, bppu);
for (const f of findings) console.log(f.level, f.line, text(f, 'en'));
```

## Reporting a problem

[Open an issue](https://github.com/SakredStudio/coretax-files/issues/new/choose) and describe it in words. **Never attach or paste real tax data.** The most useful report is the exact message Coretax showed when it rejected a file.

## Privacy

The repository ignores every `.csv`, `.xlsx` and `.xml` except the made-up samples in `samples/`. A real invoice list or payroll list must never be committed, attached to an issue or pasted anywhere.

## Licence

MIT. Copyright 17899181 CANADA INC. (Sakred Studio).
