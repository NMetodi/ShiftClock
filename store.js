// All data lives only in this device's localStorage. Nothing is sent anywhere.
import { defaultSettings } from './calc.js';

export const KEY = 'shiftclock-v1';

function normalize(raw) {
  return {
    settings: { ...defaultSettings(), ...raw.settings },
    entries: raw.entries || [],
    bonuses: raw.bonuses || {},
    paid: raw.paid || {}, // amount actually paid per month, from the payslip
    active: raw.active || null,
  };
}

export function load(storage = localStorage) {
  try { return normalize(JSON.parse(storage.getItem(KEY)) || {}); }
  catch { return normalize({}); } // corrupt data: start clean so the user can still restore a backup
}

// A backup file is untrusted (it may come from someone else): check every field the app relies on.
const ID = /^[\w-]{1,64}$/, HM = /^\d\d:\d\d$/, DATE = /^\d{4}-\d\d-\d\d$/;
const num = v => typeof v === 'number' && Number.isFinite(v);
const numOrNull = v => v == null || num(v);
const validType = t => t && ID.test(t.id) && typeof t.name === 'string' && HM.test(t.from) && HM.test(t.to)
  && Array.isArray(t.days) && t.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6) && num(t.pct);
const validEntry = e => e && ID.test(e.id) && DATE.test(e.date) && ['shift', 'sick', 'vacation'].includes(e.kind)
  && (e.kind !== 'shift' || (num(e.start) && num(e.end) && e.end > e.start))
  && (e.typeId == null || ID.test(e.typeId)) && numOrNull(e.pct) && numOrNull(e.rate)
  && (e.snap == null || validSettings({ ...defaultSettings(), ...e.snap }));
const validSettings = st => Array.isArray(st.types) && st.types.every(validType)
  && Array.isArray(st.sick) && st.sick.length === 3 && st.sick.every(num)
  && ['rate', 'otAfter', 'ot1Hours', 'ot1Pct', 'ot2Pct', 'breakMin', 'dayHours', 'monthStart', 'holidayPct'].every(k => num(st[k]))
  && num(st.travel?.amount);
const MONTH = /^\d{4}-\d\d$/;
const validMonths = (o, ok) => o && typeof o === 'object' && Object.entries(o).every(([k, v]) => MONTH.test(k) && ok(v));
const valid = s => validSettings(s.settings) && s.entries.every(validEntry) && (s.active == null || num(s.active.start))
  && validMonths(s.paid, num)
  && validMonths(s.bonuses, l => Array.isArray(l) && l.every(b => b && typeof b.name === 'string' && num(b.amount)));

export function save(state, storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(state));
}

export function parseBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { raw = null; }
  const state = raw && typeof raw.settings === 'object' && Array.isArray(raw.entries) && normalize(raw);
  if (!state || !valid(state)) throw new Error('קובץ גיבוי לא תקין');
  return state;
}
