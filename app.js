import { shiftPay, monthSummary, fmtMin, ymd, freeze } from './calc.js';
import { load, save, parseBackup } from './store.js';
import { DAYS, MONTHS, toCsv, monthRows, yearRows } from './export.js';

const FEEDBACK_EMAIL = ''; // set to show the feedback row in "כללי"

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const money = n => `${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
const hm = ms => new Date(ms).toTimeString().slice(0, 5);
const ddmm = date => `${date.slice(8)}/${date.slice(5, 7)}`;
const pctLabel = p => (p.holiday ? `חג/שבת ${p.pct}%` : p.type ? `${p.type.name} ${p.pct}%` : `${p.pct}%`);

let S = load();
// Entries from before freezing keep today's settings from now on.
if (S.entries.some(e => !e.snap)) { S.entries.forEach(e => (e.snap ??= freeze(S.settings))); save(S); }
function persist() {
  try { save(S); } catch { toast('השמירה נכשלה — אין מקום בזיכרון'); }
}
// In-app yes/no: window.confirm is silently blocked in some embedded browsers and home-screen apps.
function ask(msg) {
  const d = $('#ask');
  $('#ask-text').textContent = msg;
  d.showModal();
  return new Promise(r => {
    d.querySelectorAll('button').forEach(b => (b.onclick = () => { d.close(); r(b.value === 'yes'); }));
    d.oncancel = () => r(false);
  });
}
// 24-hour time fields: digits only, colon added automatically ("2240" → "22:40").
document.querySelectorAll('input.hm').forEach(i => i.addEventListener('input', () => {
  const d = i.value.replace(/\D/g, '').slice(0, 4);
  i.value = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}));
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 2200);
}

// ---------- tabs ----------
let tab = S.active ? 'now' : 'shifts';
function showTab(name) {
  tab = name;
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('on', el.id === `tab-${name}`));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $('#summary').classList.toggle('on', name === 'shifts');
  render();
}
document.querySelectorAll('nav button').forEach(b => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- month view ----------
const today = new Date();
let viewY = today.getFullYear(), viewM = today.getMonth() + 1;
if (today.getDate() < (S.settings.monthStart || 1)) shiftMonth(-1);
function shiftMonth(d) {
  viewM += d;
  if (viewM < 1) { viewM = 12; viewY--; }
  if (viewM > 12) { viewM = 1; viewY++; }
}
const monthKey = () => `${viewY}-${String(viewM).padStart(2, '0')}`;
$('#prev').onclick = () => { shiftMonth(-1); render(); };
$('#next').onclick = () => { shiftMonth(1); render(); };

function renderShifts() {
  const sum = monthSummary(S.entries, S.bonuses[monthKey()], S.settings, viewY, viewM);
  $('#month-title').textContent = `${MONTHS[viewM - 1]} ${viewY}`;
  $('#month-range').textContent = S.settings.monthStart > 1 ? `${ddmm(sum.from)} – ${ddmm(sum.to)}` : '';
  const rows = S.entries
    .filter(e => e.date >= sum.from && e.date <= sum.to)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.start || 0) - (a.start || 0));
  $('#list').innerHTML = rows.map(e => {
    const day = `<div class="day">${ddmm(e.date)}<small>יום ${DAYS[new Date(`${e.date}T00:00`).getDay()]}'</small></div>`;
    if (e.kind !== 'shift') {
      return `<li data-id="${e.id}">${day}<div class="grow"><b>${e.kind === 'sick' ? 'יום מחלה' : 'יום חופש'}</b>${e.note ? ' 📝' : ''}</div></li>`;
    }
    const p = shiftPay(e, S.settings);
    return `<li data-id="${e.id}">${day}<div class="grow"><b>${esc(pctLabel(p))}</b>${e.note ? ' 📝' : ''}<br>
      מ-${hm(e.start)} עד ${hm(e.end)} <span class="sm">${fmtMin(p.grossMin)} (נטו ${fmtMin(p.netMin)})</span></div>
      <div class="pay">${money(p.pay + p.extra)}</div></li>`;
  }).join('') || '<li class="sm">אין רשומות בחודש הזה</li>';
  $('#list').querySelectorAll('li[data-id]').forEach(li => (li.onclick = () => openEdit(S.entries.find(e => e.id === li.dataset.id))));

  $('#sum-hours').textContent = `${fmtMin(sum.netMin)} שעות`;
  $('#sum-total').textContent = money(sum.total);
  const kv = (k, v, cls = '') => `<div class="kv ${cls}"><span>${k}</span><b>${v}</b></div>`;
  const bonuses = S.bonuses[monthKey()] || [], paid = S.paid[monthKey()];
  $('#summary-body').innerHTML =
    kv('משמרות', sum.shifts) +
    kv('שעות ברוטו / נטו', `${fmtMin(sum.grossMin)} / ${fmtMin(sum.netMin)}`) +
    kv('שעות נוספות', fmtMin(sum.otMin)) +
    kv('ימי מחלה / חופש', `${sum.sickDays} / ${sum.vacDays}`) +
    kv('שכר עבודה', money(sum.workPay)) +
    (sum.dayPay ? kv('תשלום ימי מחלה/חופש', money(sum.dayPay)) : '') +
    kv('נסיעות', money(sum.travel)) +
    (sum.extras ? kv('טיפים / תוספות', money(sum.extras)) : '') +
    bonuses.map((b, i) => `<div class="kv"><span>${esc(b.name)} <button class="x" data-i="${i}" aria-label="מחיקה">✕</button></span><b>${money(Number(b.amount) || 0)}</b></div>`).join('') +
    `<div class="bonus-add"><input id="b-name" placeholder="פרמיה / בונוס / ניכוי"><input id="b-amt" type="number" placeholder="₪ (ניכוי במינוס)"><button id="b-add">הוסף</button></div>` +
    kv('סה״כ ברוטו', money(sum.total), 'total') +
    `<div class="kv"><span>שולם בפועל (מהתלוש)</span><input id="paid" type="number" inputmode="decimal" placeholder="₪" value="${paid ?? ''}"></div>` +
    (paid != null ? kv('הפרש מהתלוש', money(Math.round((paid - sum.total) * 100) / 100)) : '') +
    `<div class="bonus-add"><button id="x-month">ייצוא החודש לאקסל</button><button id="x-year">ייצוא שנת ${viewY} לאקסל</button></div>`;
  $('#paid').oninput = e => { // save while typing; refresh the difference when leaving the field
    if (e.target.value === '') delete S.paid[monthKey()]; else S.paid[monthKey()] = Number(e.target.value);
    persist();
  };
  $('#paid').onchange = () => render();
  $('#x-month').onclick = () => shareFile(csvFile(monthRows(S, viewY, viewM), `שעון-נוכחות-${monthKey()}.csv`));
  $('#x-year').onclick = () => shareFile(csvFile(yearRows(S, viewY), `שעון-נוכחות-${viewY}.csv`));
  $('#summary-body').querySelectorAll('.x').forEach(x => (x.onclick = () => {
    bonuses.splice(Number(x.dataset.i), 1); S.bonuses[monthKey()] = bonuses; persist(); render();
  }));
  $('#b-add').onclick = () => {
    const name = $('#b-name').value.trim(), amount = Number($('#b-amt').value);
    if (!name || !amount) return toast('צריך שם וסכום');
    S.bonuses[monthKey()] = [...bonuses, { name, amount }]; persist(); render();
  };
}
$('#summary-toggle').onclick = () => $('#summary').classList.toggle('open');

// ---------- edit entry ----------
const editDlg = $('#edit'), ef = editDlg.querySelector('form');
let editing = null;
function fillTypeSelect(sel, value, types) {
  sel.innerHTML = `<option value="">אוטומטי</option>` + types.map(t => `<option value="${t.id}">${esc(t.name)} ${t.pct}%</option>`).join('');
  sel.value = value || '';
}
function formEntry() {
  const f = ef.elements, base = { ...(editing || {}), kind: f.kind.value, date: f.date.value, note: f.note.value.trim() };
  if (base.kind !== 'shift') return { ...base, start: null, end: null };
  if (!f.date.value || !HM.test(f.in.value) || !HM.test(f.out.value)) return null;
  const start = new Date(`${f.date.value}T${f.in.value}`);
  const end = new Date(`${f.date.value}T${f.out.value}`);
  if (end <= start) end.setDate(end.getDate() + 1); // exit after midnight
  const num = v => (v === '' ? null : Number(v));
  return { ...base, start: start.getTime(), end: end.getTime(), typeId: f.typeId.value || null, noBreak: f.noBreak.checked, holiday: f.holiday.checked, pct: num(f.pct.value), rate: num(f.rate.value), extra: Number(f.extra.value) || 0 };
}
function updateEditView() {
  const shift = ef.elements.kind.value === 'shift';
  ef.querySelector('.only-shift').hidden = !shift;
  const e = shift && formEntry();
  if (e) { const p = shiftPay(e, S.settings); $('#edit-pay').textContent = `${pctLabel(p)} · נטו ${fmtMin(p.netMin)} · ${money(p.pay + p.extra)}`; }
  else $('#edit-pay').textContent = '';
}
ef.oninput = updateEditView;
function openEdit(entry) {
  editing = entry || null;
  const e = entry || { kind: 'shift', date: ymd(new Date()) }, f = ef.elements;
  $('#edit-title').textContent = entry ? 'עריכה' : 'רשומה חדשה';
  $('#edit-delete').hidden = !entry;
  f.kind.value = e.kind; f.date.value = e.date;
  f.in.value = e.start ? hm(e.start) : ''; f.out.value = e.end ? hm(e.end) : '';
  const types = e.snap?.types || S.settings.types; // a frozen shift offers the types of its own time
  fillTypeSelect(f.typeId, e.typeId, types);
  f.typeId.closest('label').hidden = !types.length; // nothing to pick until types exist
  f.noBreak.checked = !!e.noBreak; f.holiday.checked = !!e.holiday; f.pct.value = e.pct ?? ''; f.rate.value = e.rate ?? '';
  f.extra.value = e.extra || ''; f.note.value = e.note || '';
  updateEditView();
  editDlg.showModal();
}
$('#edit-delete').onclick = async () => {
  if (!(await ask('למחוק את הרשומה?'))) return;
  S.entries = S.entries.filter(x => x.id !== editing.id);
  editDlg.close(); persist(); render();
};
ef.onsubmit = ev => {
  if (ev.submitter?.value !== 'save') return;
  const e = formEntry();
  if (!e) { ev.preventDefault(); return toast('חסרים תאריך או שעות'); } // keep the dialog open with what was typed
  if (editing) S.entries = S.entries.map(x => (x.id === editing.id ? e : x));
  else S.entries.push({ ...e, id: crypto.randomUUID(), snap: freeze(S.settings) });
  persist(); render();
};
$('#add').onclick = () => openEdit(null);

// ---------- now / punch ----------
function renderNow() {
  const a = S.active;
  $('.clock').classList.toggle('live', !!a);
  $('#punch-label').textContent = a ? 'יציאה' : 'כניסה';
  $('#punch').classList.toggle('out', !!a);
  $('#nobreak-wrap').hidden = !a;
  if (!a) {
    $('#timer').textContent = '--:--:--'; $('#since').textContent = 'לא במשמרת';
    $('#now-info').textContent = 'לחיצה ארוכה על הכפתור לכניסה'; return;
  }
  const now = Date.now(), sec = Math.floor((now - a.start) / 1000);
  $('#timer').textContent = [sec / 3600, (sec % 3600) / 60, sec % 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':');
  $('#since').textContent = `נכנסת ב-${hm(a.start)}`;
  $('#now-nobreak').checked = !!a.noBreak;
  const p = shiftPay({ start: a.start, end: now, date: ymd(new Date(a.start)), noBreak: a.noBreak }, S.settings);
  $('#now-info').innerHTML = `${esc(pctLabel(p))}<br><b class="pay">${money(p.pay)} עד עכשיו</b>`;
}
$('#now-nobreak').onchange = e => { S.active.noBreak = e.target.checked; persist(); renderNow(); };
function punch() {
  if (!S.active) {
    S.active = { start: Date.now(), noBreak: false };
    toast('נכנסת למשמרת');
  } else {
    const { start, noBreak } = S.active, end = Date.now();
    const e = { id: crypto.randomUUID(), kind: 'shift', date: ymd(new Date(start)), start, end, noBreak, typeId: null, pct: null, rate: null, extra: 0, note: '', snap: freeze(S.settings) };
    S.entries.push(e); S.active = null;
    const p = shiftPay(e, S.settings);
    toast(`סיום משמרת: ${fmtMin(p.netMin)} שעות · ${money(p.pay)}`);
  }
  persist(); render();
}
let pressTimer;
const btn = $('#punch');
btn.onpointerdown = () => { btn.classList.add('pressing'); pressTimer = setTimeout(() => { btn.classList.remove('pressing'); punch(); }, 600); };
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, () => { clearTimeout(pressTimer); btn.classList.remove('pressing'); }));
btn.oncontextmenu = e => e.preventDefault();
setInterval(() => tab === 'now' && renderNow(), 1000);

// ---------- settings ----------
const getPath = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
function setPath(o, k, v) { const ps = k.split('.'), last = ps.pop(); ps.reduce((x, p) => x[p], o)[last] = v; }
document.querySelectorAll('[data-k]').forEach(el => {
  // Save on every keystroke too, so closing the app right after typing loses nothing.
  el.oninput = el.onchange = () => {
    if (el.value === '') return renderSettings(); // an emptied field keeps its old value
    const v = el.type === 'number' ? Number(el.value) || 0 : el.value;
    setPath(S.settings, el.dataset.k, el.dataset.k === 'monthStart' ? Math.min(28, Math.max(1, v)) : v);
    persist(); render();
  };
});
function renderSettings() {
  document.querySelectorAll('[data-k]').forEach(el => { if (document.activeElement !== el) el.value = getPath(S.settings, el.dataset.k); });
  $('#types').innerHTML = S.settings.types.map(t =>
    `<li data-id="${t.id}"><span><b>${esc(t.name)}</b><br><span class="sm">מ-${t.from} עד ${t.to} · ימים ${t.days.map(d => DAYS[d]).join(',')}</span></span><b class="pay">${t.pct}%</b></li>`).join('');
  $('#types').querySelectorAll('li').forEach(li => (li.onclick = () => openType(S.settings.types.find(t => t.id === li.dataset.id))));
}
const typeDlg = $('#type-edit'), tf = typeDlg.querySelector('form');
let editingType = null;
$('#type-days').innerHTML = DAYS.map((d, i) => `<label><input type="checkbox" value="${i}">${d}</label>`).join('');
function openType(t) {
  editingType = t || null;
  const v = t || { name: '', from: '15:00', to: '23:00', days: [0, 1, 2, 3, 4], pct: 125 };
  tf.elements.name.value = v.name; tf.elements.from.value = v.from; tf.elements.to.value = v.to; tf.elements.pct.value = v.pct;
  $('#type-days').querySelectorAll('input').forEach(c => (c.checked = v.days.includes(Number(c.value))));
  typeDlg.showModal();
}
$('#type-delete').onclick = async () => {
  if (!(await ask('למחוק את סוג המשמרת?'))) return;
  S.settings.types = S.settings.types.filter(t => t !== editingType);
  typeDlg.close(); persist(); render();
};
tf.onsubmit = ev => {
  if (ev.submitter?.value !== 'save') return;
  const types = S.settings.types, f = tf.elements;
  const t = { id: editingType?.id || crypto.randomUUID(), name: f.name.value.trim(), from: f.from.value, to: f.to.value, pct: Number(f.pct.value) || 100,
    days: [...$('#type-days').querySelectorAll('input:checked')].map(c => Number(c.value)) };
  if (!t.name || !HM.test(t.from) || !HM.test(t.to)) { ev.preventDefault(); return toast('חסרים שם או שעות'); }
  S.settings.types = editingType ? types.map(x => (x === editingType ? t : x)) : [...types, t];
  persist(); render();
};
$('#type-add').onclick = () => openType(null);

// ---------- backup ----------
// BOM so Excel reads the Hebrew correctly.
const csvFile = (rows, name) => new File(['﻿' + toCsv(rows)], name, { type: 'text/csv' });
$('#backup').onclick = () => shareFile(new File([JSON.stringify(S, null, 1)], `shiftclock-${ymd(new Date())}.json`, { type: 'application/json' }));
async function shareFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); // Safari cancels the download if revoked at once
}
$('#restore').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const next = parseBackup(await file.text());
    if (!(await ask(`לשחזר ${next.entries.length} רשומות? המידע הנוכחי יוחלף.`))) return;
    S = next; persist(); render(); toast('הגיבוי שוחזר');
  } catch (err) { toast(err.message); }
};

// ---------- share month ----------
const shareDlg = $('#share'), sf = shareDlg.querySelector('form');
function shareText() {
  const f = sf.elements, sum = monthSummary(S.entries, S.bonuses[monthKey()], S.settings, viewY, viewM);
  const rows = S.entries.filter(e => e.date >= sum.from && e.date <= sum.to).sort((a, b) => a.date.localeCompare(b.date) || (a.start || 0) - (b.start || 0));
  const lines = [`שעון נוכחות · ${MONTHS[viewM - 1]} ${viewY}`, ''];
  for (const e of rows) {
    let line = `${ddmm(e.date)} `;
    if (e.kind !== 'shift') line += e.kind === 'sick' ? 'מחלה' : 'חופש';
    else {
      const p = shiftPay(e, S.settings);
      line += p.type ? p.type.name : '';
      if (f.hours.checked) line += ` מ-${hm(e.start)} עד ${hm(e.end)} (${fmtMin(p.netMin)})`;
      if (f.pay.checked) line += ` ${money(p.pay)}`;
      if (f.bonus.checked && p.extra) line += ` +${money(p.extra)}`;
    }
    if (f.notes.checked && e.note) line += ` · ${e.note}`;
    lines.push(line);
  }
  lines.push('');
  if (f.hours.checked) lines.push(`סה״כ שעות: ${fmtMin(sum.netMin)} (ברוטו ${fmtMin(sum.grossMin)}) · נוספות ${fmtMin(sum.otMin)} · ${sum.shifts} משמרות`);
  if (f.bonus.checked) (S.bonuses[monthKey()] || []).forEach(b => lines.push(`${b.name}: ${money(Number(b.amount) || 0)}`));
  if (f.pay.checked) lines.push(`סה״כ ברוטו: ${money(sum.total)}`);
  return lines.join('\n');
}
sf.oninput = () => ($('#share-preview').textContent = shareText());
$('#share-open').onclick = () => { $('#share-preview').textContent = shareText(); shareDlg.showModal(); };
async function shareOrCopy(data) {
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  await navigator.clipboard.writeText(data.text || data.url);
  toast('הועתק — אפשר להדביק בוואטסאפ או במייל');
}
// Share straight from the tap: iOS only allows the share sheet during a user gesture.
$('#share-send').onclick = () => { shareOrCopy({ text: shareText() }); shareDlg.close(); };

// ---------- general ----------
if (FEEDBACK_EMAIL) $('#g-feedback button').onclick = () => (location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('שעון נוכחות - פידבק')}`);
else $('#g-feedback').hidden = true;
$('#g-share').onclick = () => shareOrCopy({ title: 'שעון נוכחות', text: 'אפליקציה לחישוב שעות ושכר', url: location.origin + location.pathname });

function render() {
  if (tab === 'shifts') renderShifts();
  if (tab === 'now') renderNow();
  if (tab === 'settings') renderSettings();
}
showTab(tab);
navigator.serviceWorker?.register('sw.js');
navigator.storage?.persist?.(); // ask the browser not to clear our data when space runs low
// When a new version takes over, reload once so the update shows right away (not on first install).
if (navigator.serviceWorker?.controller) navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
