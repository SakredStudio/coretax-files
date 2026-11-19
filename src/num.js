// Money is held as whole hundredths (BigInt-safe integers) so sums and products never drift.

// Reads "1.200.000,50", "1,200,000.50", "1200000.5" or "1200000".
// decimalComma says which mark is the decimal one when only one kind appears.
// Returns { cents, decimals } or null when the text is not a number.
export function parseAmount(text, decimalComma = false) {
  let s = String(text ?? '').trim().replace(/\s/g, '').replace(/^Rp\.?/i, '');
  if (s === '') return null;
  let negative = false;
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  let decimalMark = null;
  if (dots && commas) decimalMark = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  else if (dots === 1 && !decimalComma) decimalMark = '.';
  else if (commas === 1 && decimalComma) decimalMark = ',';
  else if (dots === 1 && decimalComma && !/^\d{1,3}\.\d{3}$/.test(s)) decimalMark = '.';
  else if (commas === 1 && !decimalComma && !/^\d{1,3},\d{3}$/.test(s)) decimalMark = ',';

  let whole = s;
  let frac = '';
  if (decimalMark) {
    const at = s.lastIndexOf(decimalMark);
    whole = s.slice(0, at);
    frac = s.slice(at + 1);
    if (/[.,]/.test(frac)) return null;
  }
  const groups = whole.split(/[.,]/);
  if (groups.length > 1 && !(groups[0].length >= 1 && groups[0].length <= 3 && groups.slice(1).every((g) => g.length === 3))) return null;
  whole = groups.join('');
  if (whole === '') whole = '0';
  const decimals = frac.replace(/0+$/, '').length;
  const cents = Number(whole) * 100 + Math.round(Number(`0.${frac || '0'}`) * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return { cents: negative ? -cents : cents, decimals };
}

// (a * b) / divisor, rounded half up, for hundredths that would overflow a double when multiplied.
export function mulDiv(a, b, divisor) {
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(divisor);
  const q = (n * 2n + d) / (d * 2n);
  return Number(q);
}

// 123456 -> "1234.56"
export function fixed2(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// 1200 -> "12", 1150 -> "11.5"
export function trimmed(cents) {
  return fixed2(cents).replace(/\.?0+$/, '');
}
