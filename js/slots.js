import { FIRST_HOUR, LAST_HOUR, TIME_ZONE } from './config.js?v=20261116c';

// A "slot" is one hour of the tournament week: day_index * 24 + hour.
// Day 0 is the tournament's week_start date. Hours are Pacific Time.
// Players can view everything in their own zone; see the time zone section.

export const DAYS = 7;
export const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);

export const slotOf = (day, hour) => day * 24 + hour;
export const dayOf = (slot) => Math.floor(slot / 24);
export const hourOf = (slot) => slot % 24;

function utcDate(isoDate, addDays = 0) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + addDays));
}

export function dayName(weekStart, day, style = 'long') {
  return utcDate(weekStart, day).toLocaleDateString('en-US', { weekday: style, timeZone: 'UTC' });
}

export function dayLabel(weekStart, day) {
  return utcDate(weekStart, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export function shortDayLabel(weekStart, day) {
  return utcDate(weekStart, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export function hourLabel(hour) {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

export function hourRangeLabel(hour, length = 1) {
  return `${hourLabel(hour)} to ${hourLabel(hour + length)}`;
}

// ---------- time zones ----------
// Slots are always stored in Pacific Time (TIME_ZONE). Each viewer picks the
// zone they want to see; labels and the availability grid are converted.
// Only zones that are a whole number of hours from Pacific are offered, so
// every local hour lines up with exactly one stored hour.

export const TIME_ZONES = [
  { id: 'America/Los_Angeles', label: 'Pacific (Spokane, Seattle, Los Angeles)' },
  { id: 'America/Denver', label: 'Mountain (Boise, Denver)' },
  { id: 'America/Phoenix', label: 'Arizona' },
  { id: 'America/Chicago', label: 'Central (Chicago, Dallas)' },
  { id: 'America/New_York', label: 'Eastern (New York, Atlanta)' },
  { id: 'America/Halifax', label: 'Atlantic (Halifax)' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
  { id: 'Europe/London', label: 'UK and Ireland' },
  { id: 'Europe/Berlin', label: 'Central Europe' },
  { id: 'UTC', label: 'UTC' },
];

let viewTz = TIME_ZONE;
export const viewTimeZone = () => viewTz;
export function setViewTimeZone(tz) {
  viewTz = TIME_ZONES.some((z) => z.id === tz) ? tz : TIME_ZONE;
}

// The browser's own zone, if it's one we offer.
export function detectTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIME_ZONES.some((z) => z.id === tz)) return tz;
    // Same offset as a listed zone right now? Use that one.
    const now = Date.now();
    const off = offsetMs(tz, now);
    return TIME_ZONES.find((z) => offsetMs(z.id, now) === off)?.id || TIME_ZONE;
  } catch { return TIME_ZONE; }
}

const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    }));
  }
  return fmtCache.get(tz);
}
function partsIn(tz, ms) {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
}
function offsetMs(tz, ms) {
  const p = partsIn(tz, ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60000) * 60000;
}
// The moment when the clock in `tz` reads the given date and hour.
function zonedToUtc(tz, y, m, d, h) {
  const guess = Date.UTC(y, m - 1, d, h);
  let t = guess - offsetMs(tz, guess);
  const again = guess - offsetMs(tz, t);
  if (again !== t) t = again;
  return t;
}

function weekParts(weekStart) {
  const [y, m, d] = weekStart.split('-').map(Number);
  return { y, m, d };
}

export function slotToInstant(weekStart, slot) {
  const w = weekParts(weekStart);
  return zonedToUtc(TIME_ZONE, w.y, w.m, w.d + dayOf(slot), hourOf(slot));
}

// The stored slot for a local day/hour in `tz`, or null if it falls outside
// the tournament week.
export function localToSlot(weekStart, day, hour, tz = viewTz) {
  const w = weekParts(weekStart);
  const p = partsIn(TIME_ZONE, zonedToUtc(tz, w.y, w.m, w.d + day, hour));
  if (p.min !== 0) return null;
  const days = Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(w.y, w.m - 1, w.d)) / 86400000);
  const slot = days * 24 + p.h;
  return slot >= 0 && slot <= 167 ? slot : null;
}

// Every hour on the availability grid in the viewer's zone:
// [{ day, hour, slot }] with day/hour in local time.
export function gridCells(weekStart, tz = viewTz) {
  const cells = [];
  for (let d = 0; d < DAYS; d++) {
    for (const hr of HOURS) {
      const slot = localToSlot(weekStart, d, hr, tz);
      if (slot != null) cells.push({ day: d, hour: hr, slot });
    }
  }
  return cells;
}

export function zoneAbbr(tz = viewTz, ms = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}

export function slotLabel(weekStart, slot, tz = viewTz) {
  const ms = slotToInstant(weekStart, slot);
  const p = partsIn(tz, ms);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  return `${day} at ${hourLabel(p.h)} ${zoneAbbr(tz, ms)}`.trim();
}

export function localHourOfSlot(weekStart, slot, tz = viewTz) {
  return partsIn(tz, slotToInstant(weekStart, slot)).h;
}

// "Sat, Nov 21 at 1 pm to 5 pm PST" for a run of hours starting at slot.
export function slotRangeLabel(weekStart, slot, hours, tz = viewTz) {
  const endMs = slotToInstant(weekStart, slot) + hours * 3600000;
  return `${slotLabel(weekStart, slot, tz).replace(/ [A-Z]{2,5}$|\s(GMT|UTC)[+-]?\d*$/, '')} to ${hourLabel(partsIn(tz, endMs).h)} ${zoneAbbr(tz, endMs)}`.trim();
}

export function weekRangeLabel(weekStart) {
  const a = utcDate(weekStart, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const b = utcDate(weekStart, 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${a} to ${b}`;
}

// The slot for "right now" in Pacific Time, relative to weekStart.
// Can be negative (week hasn't started) or above 167 (week is over).
export function nowSlot(weekStart, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const today = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const days = Math.round((today - utcDate(weekStart).getTime()) / 86400000);
  return days * 24 + (Number(parts.hour) % 24);
}

export function todayIso(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDaysIso(isoDate, n) {
  return utcDate(isoDate, n).toISOString().slice(0, 10);
}

// Next Monday on or after today (Pacific).
export function nextMondayIso(now = new Date()) {
  const today = todayIso(now);
  const dow = utcDate(today).getUTCDay(); // 0 Sun .. 6 Sat
  const add = dow === 1 ? 0 : (8 - dow) % 7;
  return addDaysIso(today, add);
}
