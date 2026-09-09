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
  // day as that day's own On This Day post — gets its own slot 2 hours
  // after the 7pm sector video (moved from 20:00 on 2026-09-09: that only
  // gave a 1-hour gap from the video slot on the day it fires, too tight
  // for reach given they're separate posts to the same audience), closing
  // out the day as a distinct "week wrap" moment.
  "weekly-recap": 21,
  // Diaspora-targeted pillars (added 2026-09-07): timed for US audiences,
  // not IST peak scroll time. Moved 6:00 -> 5:00 IST on 2026-09-09: only
  // gave a 2-hour gap to Personal Growth's 8:00 IST slot, tight compared
  // to every other daily gap (5-6 hours); this still lands squarely in
  // the US evening window (~7:30pm Eastern / 4:30pm Pacific) while
  // opening up a 3-hour gap to Personal Growth.
  "global-bharat": 5,
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
