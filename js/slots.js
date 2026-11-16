import { FIRST_HOUR, LAST_HOUR, TIME_ZONE } from './config.js?v=20261116b';

// A "slot" is one hour of the tournament week: day_index * 24 + hour.
// Day 0 is the tournament's week_start date. Hours are Pacific Time.

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

export function slotLabel(weekStart, slot) {
  return `${shortDayLabel(weekStart, dayOf(slot))} at ${hourLabel(hourOf(slot))}`;
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
