// Shared slot-time logic so every platform (Buffer's Instagram/X/Threads
// AND YouTube's native scheduled publish) lands at the exact same instant
// for a given content type. Single source of truth — do not duplicate
// this math in publish-to-buffer.mjs or youtube-upload.mjs again.

export const SLOT_HOURS_IST = {
  motivational: 8,
  "motivational-short": 8,
  "on-this-day": 13,
  "on-this-day-short": 13,
  video: 19,
  // Weekly recap is a 4th package on top of the normal 3, on the same
  // day as that day's own On This Day post — gets its own slot an hour
  // after the 7pm sector video, closing out the day as a distinct
  // "week wrap" moment rather than colliding with any regular slot.
  "weekly-recap": 20,
  // Diaspora-targeted pillars (added 2026-09-07): timed for US audiences,
  // not IST peak scroll time. 6am IST = ~8:30pm US Eastern / 5:30pm
  // Pacific (evening scroll); reuses the on-this-day-short pipeline/format,
  // just diaspora-subject-filtered.
  "global-bharat": 6,
  // 10:30pm IST = ~1pm US Eastern / 10am Pacific (midday scroll), spread
  // well apart from both the 6am global-bharat slot and the existing 7pm
  // IST sector-video slot; reuses the sector-video pipeline/format.
  "diaspora-dividend": 22.5,
};

export function nextSlotUtc(hourIst, targetDate) {
  const now = new Date();
  const istOffsetMinutes = 5.5 * 60;
  const utcHour = hourIst - istOffsetMinutes / 60;

  if (targetDate) {
    const [y, m, d] = targetDate.split("-").map(Number);
    const target = new Date(Date.UTC(y, m - 1, d, Math.floor(utcHour), (utcHour % 1) * 60, 0));
    return target.toISOString();
  }

  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Math.floor(utcHour), (utcHour % 1) * 60, 0)
  );
  if (target <= now) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.toISOString();
}
