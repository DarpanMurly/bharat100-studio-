# X (Twitter) account migration plan

**Status:** @Bharat_at_100 suspended 2026-09-15, appeal filed, no resolution yet.
X publishing has been paused in the pipeline since (`X_PUBLISHING_PAUSED = true`
in `pipeline/publish-to-buffer.mjs`). This plan sets up a fallback account so
X coverage can resume without waiting indefinitely on the appeal.

The appeal keeps running passively in the background — this plan does not
replace it. If the appeal succeeds first, the new account becomes redundant
and this plan is simply not executed (or the new account is kept dormant as
a backup/handle-reservation).

**New handle confirmed 2026-09-19: `@Bharat_at_100_`** (trailing underscore,
closest possible match to the original suspended handle for brand
continuity). Every `NEW_HANDLE` placeholder below refers to this.

## Step 1 — Claim the new handle ✅ DONE (2026-09-19)

`@Bharat_at_100_` claimed. Steps 2 and 3 below still need to happen (both
require a human logged into the new X account / Buffer dashboard) before
any code changes make sense — updating captions to point at an account
with no bio, no photo, and no Buffer connection yet would just be broken
in a different way.

## Step 2 — New account setup ✅ DONE (2026-09-19)

- Bio: reuse the drafted copy in `cross-link-bios.md`'s X section, updated
  for the new handle:
  ```
  India's growth story toward 2047 - daily, sourced, independent.
  Not affiliated with the Government of India.
  📺 youtube.com/@bharatat100 · 📸 @bharatat100
  ```
- Profile photo: same bio image already used everywhere
  (`out/Bharat@100 bio.jpeg`).
- Link: same as other platforms — youtube.com/@bharatat100.
- Pin a first post (once posting resumes) using the same "New here?" pinned
  copy pattern already used on YouTube.

## Step 3 — Buffer reconnection ✅ DONE (2026-09-19)

New channel id: `6aaeb5cbea19ca0bde89c618` (service: twitter, display
name: Bharat_at_100_). Replaced the old channel id in both `.env` and
the `BUFFER_CHANNEL_TWITTER` GitHub Actions secret.

## Step 4 — Code/doc updates ✅ DONE (2026-09-19)

Every hardcoded reference to `@Bharat_at_100` updated to `@Bharat_at_100_`:
- `pipeline/disclaimer.mjs` — both cross-platform CTA lines.
- `pipeline/substack-prepare.mjs` and `pipeline/medium-prepare.mjs` —
  the follow lines.
- `cross-link-bios.md` — bio section header, Instagram/Threads/YouTube
  cross-link mentions, and the setup checklist entry.
- `X_PUBLISHING_PAUSED` flipped back to `false` in
  `pipeline/publish-to-buffer.mjs`.

## Step 5 — Verification ✅ DONE (2026-09-19)

Ran `retry-failed-buffer.mjs` (which scans for missing Buffer platform
posts across recent cards) rather than a single one-off test — this
verified the whole automated path, not just manual posting. Result: 10
backfilled X posts (the Sept 17-18 gap accumulated while paused) went
out successfully on `@Bharat_at_100_`, confirmed via
`buffer-list-channels.mjs` that they landed on the correct account.
Re-ran `check-platform-coverage.mjs` — X is no longer treated as an
intentionally-paused platform and is now flagged/tracked like any other.
Remaining older gaps (Sept 16, and the rest of Sept 19) hit Buffer's
10-post X queue cap during the backfill and will clear automatically
via the existing scheduled `retry-buffer.yml` workflow — no action
needed.

**Migration complete.**

## Notes

- The old @Bharat_at_100 handle/account should NOT be referenced anywhere
  as "the" account going forward once migrated — but don't delete any
  local record of it (old posts stay linked from the archive as historical
  record, same as any other platform's post history).
- If the appeal on the OLD account eventually succeeds, decide then whether
  to run both accounts, redirect the old one to point at the new one, or
  quietly stop using the new one — that's a call for whenever it comes up,
  not now.
