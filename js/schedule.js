import { dayOf, hourOf } from './slots.js';

export function inGroupSession(slot, t) {
  if (!t || t.group_day == null || t.group_start_hour == null || t.group_end_hour == null) return false;
  return dayOf(slot) === t.group_day && hourOf(slot) >= t.group_start_hour && hourOf(slot) < t.group_end_hour;
}

export function groupSessionSlots(t) {
  if (!t || t.group_day == null || t.group_start_hour == null || t.group_end_hour == null) return [];
  const out = [];
  for (let h = t.group_start_hour; h < t.group_end_hour; h++) out.push(t.group_day * 24 + h);
  return out;
}

// Hours both players marked free, still in the future and before the deadline.
export function sharedSlots(mine, theirs, { now = -Infinity, deadline = 168 } = {}) {
  const other = new Set(theirs || []);
  const end = Math.min(deadline ?? 168, 168);
  return [...new Set(mine || [])]
    .filter((s) => other.has(s) && s > now && s < end)
    .sort((a, b) => a - b);
}

// Groups consecutive hours into windows: [{ start, hours }]
export function windowsOf(slots) {
  const out = [];
  for (const s of slots) {
    const last = out[out.length - 1];
    if (last && s === last.start + last.hours) last.hours += 1;
    else out.push({ start: s, hours: 1 });
  }
  return out;
}

// Suggested start times for a match, best first.
// Prefers windows of 2+ hours (room for a full best of three), then the
// Saturday group session, then the earliest time.
export function suggestTimes(mine, theirs, { now, deadline, tournament, max = 5 } = {}) {
  const wins = windowsOf(sharedSlots(mine, theirs, { now, deadline }));
  const candidates = [];
  for (const w of wins) {
    candidates.push({ slot: w.start, hours: w.hours, group: inGroupSession(w.start, tournament) });
    // A long free stretch on a different part of the day is worth offering too.
    if (w.hours >= 5) {
      const later = w.start + w.hours - 2;
      candidates.push({ slot: later, hours: 2, group: inGroupSession(later, tournament) });
    }
  }
  candidates.sort((a, b) =>
    (b.hours >= 2) - (a.hours >= 2) ||
    (b.group - a.group) ||
    a.slot - b.slot);
  return candidates.slice(0, max);
}
