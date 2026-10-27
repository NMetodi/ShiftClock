// Spreadsheet export (CSV that Excel / Numbers / Google Sheets open). Pure: builds rows and text, no DOM.
import { shiftPay, dayPay, monthSummary, fmtMin } from './calc.js';

export const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const round2 = x => Math.round(x * 100) / 100;
const hm = ms => new Date(ms).toTimeString().slice(0, 5);
const dmy = date => `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const key = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

export function toCsv(rows) {
  const cell = v => {
    if (typeof v === 'number') return String(v);
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // stop Excel from running text as a formula
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(cell).join(',')).join('\r\n');
}

export function monthRows(state, y, m) {
  const { settings, entries } = state;
  const bonuses = state.bonuses?.[key(y, m)] || [];
  const sum = monthSummary(entries, bonuses, settings, y, m);
  const rows = [['תאריך', 'יום', 'סוג רשומה', 'סוג משמרת', 'אחוז', 'חג / שבת', 'כניסה', 'יציאה', 'שעות ברוטו', 'שעות נטו', 'שעות נוספות',
    'שכר לשעה', 'שכר לפני הורדת הפסקה', 'שכר אחרי הפסקה', 'טיפים / תוספת', 'הערות']];
  const list = entries.filter(e => e.date >= sum.from && e.date <= sum.to)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start || 0) - (b.start || 0));
  for (const e of list) {
    const day = DAYS[new Date(`${e.date}T00:00`).getDay()];
    if (e.kind !== 'shift') {
      rows.push([dmy(e.date), day, e.kind === 'sick' ? 'יום מחלה' : 'יום חופש', '', '', '', '', '', '', '', '', '', '', dayPay(e, entries, settings), '', e.note || '']);
      continue;
    }
    const p = shiftPay(e, settings);
    const full = shiftPay({ ...e, noBreak: true }, settings);
    rows.push([dmy(e.date), day, 'משמרת', p.type?.name || 'רגילה', p.pct, p.holiday ? 'כן' : '', hm(e.start), hm(e.end),
      fmtMin(p.grossMin), fmtMin(p.netMin), fmtMin(p.otMin), p.rate, full.pay, p.pay, p.extra, e.note || '']);
  }
  rows.push([]);
  rows.push(['משמרות', sum.shifts], ['שעות ברוטו', fmtMin(sum.grossMin)], ['שעות נטו', fmtMin(sum.netMin)], ['שעות נוספות', fmtMin(sum.otMin)],
    ['ימי מחלה', sum.sickDays], ['ימי חופש', sum.vacDays], ['שכר עבודה', sum.workPay], ['תשלום ימי מחלה/חופש', sum.dayPay],
    ['נסיעות', sum.travel], ['טיפים / תוספות', sum.extras]);
  for (const b of bonuses) rows.push([b.name, Number(b.amount) || 0]);
  rows.push(['סה״כ ברוטו', sum.total]);
  const paid = state.paid?.[key(y, m)];
  if (paid != null) rows.push(['שולם בפועל (תלוש)', paid], ['הפרש', round2(paid - sum.total)]);
  return rows;
}

export function yearRows(state, y) {
  const rows = [['חודש', 'משמרות', 'שעות ברוטו', 'שעות נטו', 'שעות נוספות', 'ימי מחלה', 'ימי חופש', 'שכר עבודה', 'ימי מחלה/חופש ₪',
    'נסיעות', 'טיפים / תוספות', 'פרמיות / ניכויים', 'סה״כ ברוטו', 'שולם בפועל', 'הפרש']];
  const t = { shifts: 0, grossMin: 0, netMin: 0, otMin: 0, sickDays: 0, vacDays: 0, workPay: 0, dayPay: 0, travel: 0, extras: 0, bonus: 0, total: 0, paid: 0, diff: 0 };
  for (let m = 1; m <= 12; m++) {
    const s = monthSummary(state.entries, state.bonuses?.[key(y, m)], state.settings, y, m);
    const paid = state.paid?.[key(y, m)];
    const diff = paid != null ? round2(paid - s.total) : '';
    for (const k of Object.keys(t)) if (k in s) t[k] += s[k];
    if (paid != null) { t.paid += paid; t.diff += diff; }
    rows.push([MONTHS[m - 1], s.shifts, fmtMin(s.grossMin), fmtMin(s.netMin), fmtMin(s.otMin), s.sickDays, s.vacDays, s.workPay, s.dayPay,
      s.travel, s.extras, s.bonus, s.total, paid ?? '', diff]);
  }
  rows.push(['סה״כ', t.shifts, fmtMin(t.grossMin), fmtMin(t.netMin), fmtMin(t.otMin), t.sickDays, t.vacDays, round2(t.workPay), round2(t.dayPay),
    round2(t.travel), round2(t.extras), round2(t.bonus), round2(t.total), round2(t.paid), round2(t.diff)]);
  return rows;
}
