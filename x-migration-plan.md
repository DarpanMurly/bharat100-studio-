# X (Twitter) account migration plan

**Status:** @Bharat_at_100 suspended 2026-09-15, appeal filed, no resolution yet.
X publishing has been paused in the pipeline since (`X_PUBLISHING_PAUSED = true`
in `pipeline/publish-to-buffer.mjs`). This plan sets up a fallback account so
X coverage can resume without waiting indefinitely on the appeal.

The appeal keeps running passively in the background — this plan does not
replace it. If the appeal succeeds first, the new account becomes redundant
and this plan is simply not executed (or the new account is kept dormant as
a backup/handle-reservation).

## Step 1 — Claim the new handle (you, manually — cannot be automated)

X requires a live, logged-in browser session to check handle availability
and complete signup (phone/email verification, CAPTCHA). Candidates, in
priority order:

1. `@bharatat100` — try the exact original handle on a brand-new account
   first. X sometimes releases a suspended account's handle after a period,
   or the handle itself was never actually the violating asset.
2. `@bharatat100hq` — safe fallback if the original is still locked.
3. `@viksitbharat100` — distinct enough to avoid any association with the
   suspended account, leans on the "Viksit Bharat 2047" framing already
   used in disclaimers.

Once you've claimed one, tell me which — everything below assumes a
placeholder `NEW_HANDLE`.

## Step 2 — New account setup (you, manually)

- Bio: reuse the drafted copy in `cross-link-bios.md`'s X section, updated
  for the new handle.
- Profile photo: same bio image already used everywhere
  (`out/Bharat@100 bio.jpeg`).
- Link: same as other platforms — youtube.com/@bharatat100.
- Pin a first post (once posting resumes) using the same "New here?" pinned
  copy pattern already used on YouTube.

## Step 3 — Buffer reconnection (you, manually)

Buffer's X channel is tied to the old, suspended account's OAuth
connection. This needs to be:
- Disconnected from the suspended account in Buffer's own dashboard.
- Reconnected to `NEW_HANDLE` (Buffer's own "Connect a channel" flow,
  X/Twitter OAuth — requires being logged into the new X account in the
  same browser session).
- The new channel ID this produces must replace `BUFFER_CHANNEL_TWITTER`
  in both `.env` (local) and the GitHub Actions secret (`gh secret set
  BUFFER_CHANNEL_TWITTER`).

## Step 4 — Code/doc updates (me, once Steps 1-3 are done)

Every hardcoded reference to `@Bharat_at_100` needs updating to
`NEW_HANDLE`:
- `pipeline/disclaimer.mjs` — 2 occurrences, the "Also on X: @Bharat_at_100"
  cross-platform CTA lines baked into every video's caption/outro.
- `pipeline/substack-prepare.mjs` — 1 occurrence, the daily/weekly
  cross-platform follow line.
- `pipeline/medium-prepare.mjs` — 1 occurrence, same follow line (once
  this script exists — see check-weekly-cadence.mjs work, 2026-09-19).
- `cross-link-bios.md` — the X bio section itself, plus every other
  platform's bio text that mentions "X: @Bharat_at_100" as a cross-link.
- Flip `X_PUBLISHING_PAUSED` back to `false` in
  `pipeline/publish-to-buffer.mjs` once the new Buffer channel is
  confirmed working end-to-end on a single test post.

## Step 5 — Verification (me)

- Publish one test card to the new X account via the normal pipeline,
  confirm it lands correctly (not scheduled into the past, correct
  caption, correct handle mentioned).
- Re-run `check-platform-coverage.mjs` to confirm X stops showing as an
  intentionally-paused platform and starts recording real post IDs again.

## Notes

- The old @Bharat_at_100 handle/account should NOT be referenced anywhere
  as "the" account going forward once migrated — but don't delete any
  local record of it (old posts stay linked from the archive as historical
  record, same as any other platform's post history).
- If the appeal on the OLD account eventually succeeds, decide then whether
  to run both accounts, redirect the old one to point at the new one, or
  quietly stop using the new one — that's a call for whenever it comes up,
  not now.
