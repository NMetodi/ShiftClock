// Pure pay logic. No DOM, no storage. Times are ms timestamps, dates are local 'YYYY-MM-DD'.
const MIN = 60000;

export function defaultSettings() {
  return {
    rate: 0, mode: 'shift', types: [],
    otAfter: 8, ot1Hours: 2, ot1Pct: 125, ot2Pct: 150, breakMin: 0,
    travel: { amount: 0, per: 'month' }, sick: [0, 50, 100], dayHours: 8, monthStart: 1, holidayPct: 150,
  };
}

export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
const round2 = x => Math.round(x * 100) / 100;

export function fmtMin(min) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

// Every concrete window of every type near the shift. A window "belongs" to the weekday it starts on.
function windows(entry, types) {
  const out = [];
  for (const type of types) {
    const [fh, fm] = type.from.split(':').map(Number);
    const [th, tm] = type.to.split(':').map(Number);
    for (const off of [-1, 0, 1]) {
      const day = parseDate(addDays(entry.date, off));
      if (!type.days.includes(day.getDay())) continue;
      const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), fh, fm).getTime();
      let e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), th, tm).getTime();
      if (e <= s) e = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, th, tm).getTime();
      out.push({ type, s, e });
    }
  }
  return out;
}

function classify(entry, types) {
  const overlap = new Map();
  for (const w of windows(entry, types)) {
    const o = Math.max(0, Math.min(w.e, entry.end) - Math.max(w.s, entry.start));
    if (o > 0) overlap.set(w.type, (overlap.get(w.type) || 0) + o);
  }
  let best = null;
  for (const [type, o] of overlap) {
    const bo = best && overlap.get(best);
    if (!best || o > bo || (o === bo && type.pct > best.pct)) best = type;
  }
  // A type counts only if it covers most of the shift; otherwise the shift is regular.
  return best && overlap.get(best) * 2 > entry.end - entry.start ? best : null;
}

// Settings that decide pay. A closed entry stores a copy (entry.snap) so later changes don't rewrite history.
const PAY_KEYS = ['rate', 'mode', 'types', 'otAfter', 'ot1Hours', 'ot1Pct', 'ot2Pct', 'breakMin', 'travel', 'sick', 'dayHours', 'holidayPct'];
export const freeze = s => JSON.parse(JSON.stringify(Object.fromEntries(PAY_KEYS.map(k => [k, s[k]]))));
const eff = (entry, settings) => (entry.snap ? { ...settings, ...entry.snap } : settings);

export function shiftPay(entry, settings) {
  const s = eff(entry, settings);
  const grossMin = Math.round((entry.end - entry.start) / MIN);
  const netMin = Math.max(0, grossMin - (entry.noBreak ? 0 : s.breakMin || 0));
  const rate = (entry.rate ?? s.rate) || 0;
  const forced = entry.typeId ? s.types.find(t => t.id === entry.typeId) || null : null;
  const type = forced || classify(entry, s.types);
  const otStart = (s.otAfter || 0) * 60;
  const ot1End = otStart + (s.ot1Hours || 0) * 60;
  const otMin = Math.max(0, netMin - otStart);
  const otFactor = i => (i < otStart ? 1 : i < ot1End ? s.ot1Pct / 100 : s.ot2Pct / 100);
  const fixedPct = entry.pct ?? (entry.holiday ? s.holidayPct : null); // manual % or holiday % covers the whole shift

  let units = 0; // minutes weighted by pct and overtime factor
  if (s.mode === 'hourly' && fixedPct == null && !forced) {
    const ws = windows(entry, s.types);
    const breakMin = grossMin - netMin;
    for (let i = 0; i < netMin; i++) {
      const at = entry.start + (breakMin + i) * MIN + MIN / 2;
      let pct = 100;
      for (const w of ws) if (at >= w.s && at < w.e) pct = Math.max(pct, w.type.pct);
      units += (pct / 100) * otFactor(i);
    }
  } else {
    const pct = (fixedPct ?? type?.pct ?? 100) / 100;
    for (let i = 0; i < netMin; i++) units += pct * otFactor(i);
  }
  return {
    grossMin, netMin, otMin, type, rate, holiday: !!entry.holiday,
    pct: fixedPct ?? type?.pct ?? 100,
    pay: round2((rate / 60) * units),
    extra: Number(entry.extra) || 0,
  };
}

export function periodRange(year, month, startDay) {
  return { from: ymd(new Date(year, month - 1, startDay)), to: ymd(new Date(year, month, startDay - 1)) };
}

export function sickPct(date, entries, settings) {
  const sick = new Set(entries.filter(e => e.kind === 'sick').map(e => e.date));
  let n = 1;
  while (sick.has(addDays(date, -n))) n++;
  const [d1, d23, d4] = settings.sick;
  return n === 1 ? d1 : n <= 3 ? d23 : d4;
}

// Pay for a sick or vacation day: dayHours × rate × (sick % by streak, or 100% for vacation).
export function dayPay(e, entries, settings) {
  const s = eff(e, settings);
  const pct = e.kind === 'sick' ? sickPct(e.date, entries, s) : 100;
  return round2((s.dayHours || 0) * (s.rate || 0) * pct / 100);
}

export function monthSummary(entries, bonuses, settings, year, month) {
  const { from, to } = periodRange(year, month, settings.monthStart || 1);
  const inRange = entries.filter(e => e.date >= from && e.date <= to);
  const m = { from, to, shifts: 0, grossMin: 0, netMin: 0, otMin: 0, sickDays: 0, vacDays: 0, workPay: 0, dayPay: 0, travel: 0, extras: 0, bonus: 0, total: 0 };
  const workDates = new Set(), offDays = new Set();
  let tr = settings.travel || { amount: 0 }, trAt = -Infinity; // travel rule of the period's latest shift
  for (const e of inRange) {
    const s = eff(e, settings);
    if (e.kind !== 'shift') {
      if (offDays.has(e.date)) continue; // same day entered twice is paid once
      offDays.add(e.date);
    }
    if (e.kind === 'shift' && e.end) {
      const p = shiftPay(e, settings);
      m.shifts++; m.grossMin += p.grossMin; m.netMin += p.netMin; m.otMin += p.otMin;
      m.workPay += p.pay; m.extras += p.extra;
      workDates.add(e.date);
      if (e.start > trAt) { tr = s.travel || tr; trAt = e.start; }
    } else {
      if (e.kind === 'sick') m.sickDays++; else m.vacDays++;
      m.dayPay += dayPay(e, entries, settings);
    }
  }
  // Monthly travel only counts once there is work in the period, so empty future months show 0.
  m.travel = tr.per === 'day' ? tr.amount * workDates.size : workDates.size ? tr.amount : 0;
  m.bonus = (bonuses || []).reduce((a, b) => a + (Number(b.amount) || 0), 0);
  for (const k of ['workPay', 'dayPay', 'extras']) m[k] = round2(m[k]);
  m.total = round2(m.workPay + m.dayPay + m.travel + m.bonus + m.extras);
  return m;
}
