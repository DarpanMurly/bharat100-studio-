# Bharat@100

Independent, non-government-affiliated daily content project about India's growth story toward its 100th year of independence in 2047. Five content pillars, rendered via Remotion, narrated via free Microsoft edge-tts, published daily across 8 platforms.

**Every piece of content must carry the disclaimer**: "Independent citizen project. Not affiliated with the Government of India." (`pipeline/disclaimer.mjs`). Never remove this.

## The five daily pillars and their slots (IST)

| Slot | Pillar | Format | Render script |
|---|---|---|---|
| 5:00 | Global Bharat (diaspora biography) | video | `render-global-bharat.mjs <date>` |
| 8:00 | Personal Growth (motivational) | video | `render-motivational-short.mjs <date>` |
| 13:00 | Builder Story (on this day) | video | `render-on-this-day-short.mjs <date>` |
| 19:00 | Sector Futures | video | `daily-publish.mjs <scriptId> [date]` |
| 21:00 | Weekly Recap (once/week only) | video | `render-weekly-recap.mjs <date>` |
| 22:30 | Diaspora Dividend | video | `daily-publish.mjs <scriptId> [date]` (type: `diaspora-dividend`) |

Slot times live in `pipeline/slots.mjs` (`SLOT_HOURS_IST`) — the single source of truth every publish script reads from. **Global Bharat's 5:00 IST slot crosses the UTC midnight boundary** (= 23:30 UTC the *previous* day) — this bit a real bug once (see `bluesky-slot-runner.mjs`'s header comment), so any script computing "today's folder date" for this pillar must account for it, not assume `new Date().toISOString().slice(0,10)`.

## Daily cycle

1. **Generate** — run the render script for each pillar due that day. Output lands in `content-queue/pending/<date>_<id>/` with a `card.json` (status: `pending`).
2. **Approve** — review via the Content Desk dashboard (Claude Artifact, see project memory for the URL) or manually flip `card.json`'s `status` to `"approved"`.
3. **Publish** — run `node pipeline/publish-all.mjs <date>_<id>`. This schedules the post to Instagram/Threads/X (via Buffer), YouTube (direct API), Facebook (direct API), Mastodon (direct API, native `scheduled_at`), and Pinterest (direct API) — all for the same future slot instant, so every platform goes live together. Bluesky has no native scheduling; it's handled separately (below).
4. **Bluesky** fires via `.github/workflows/bluesky-schedule.yml`, a cron-triggered GitHub Action that calls `bluesky-slot-runner.mjs` at each slot's actual instant — this is a workaround for Bluesky's API having no "publish later."
5. **Facebook first comment** fires via `.github/workflows/facebook-first-comment.yml` shortly after each slot, posting an auto-generated engagement question once the post is actually live (not at schedule time — see that workflow's header for why).
6. **Homepage sync** fires via `.github/workflows/homepage-sync.yml` shortly after each slot, rebuilding bharatat100.com's archive from whatever's now live and pushing — Netlify is Git-linked to this repo and auto-deploys on push.

Steps 4-6 all run independently on cron, all push to `main`, and all `git pull --rebase` before pushing to avoid stepping on each other (see comments in each workflow).

## One-time auth setup (per platform)

Each of these opens a local browser OAuth flow and saves a token file to the repo root (all gitignored — see `.gitignore` and `feedback_secret_handling` in project memory: never `cat`/`Read`/unredacted-`grep` these files). Only needed once per platform, or if a token is revoked:

- `node pipeline/youtube-auth.mjs` → `youtube-token.json`
- `node pipeline/facebook-auth.mjs` → `facebook-token.json`
- `node pipeline/wordpress-auth.mjs` → (WordPress OAuth, see script header)
- `node pipeline/pinterest-auth.mjs [--sandbox]` → `pinterest-token.json`
- Bluesky and Mastodon use simple API tokens/app passwords in `.env`, no OAuth flow.

GitHub Actions workflows that need these tokens read them from **repo secrets** (Settings → Secrets and variables → Actions), reconstructed into the gitignored file at runtime — see `facebook-first-comment.yml` for the pattern. Any workflow needing `pages_manage_engagement` or similar was re-authed after adding the new scope; check each script's SCOPES constant if a permissions error (`(#200)` etc.) shows up.

## Repo layout

- `pipeline/` — all Node scripts (render, publish, auth). ~44 files with unusually detailed header comments explaining *why*, not just what — read the header before changing a script's behavior.
- `src/` — Remotion React components (video compositions).
- `content-queue/{pending,approved}/<date>_<id>/` — one folder per content package; `card.json` is tracked in git (media files are not — see `.gitignore`).
- `.github/workflows/` — the 3 cron-scheduled automation workflows described above.
- `netlify-deploy/` — the actual published site content; auto-deployed by Netlify on push (Git-linked, not manual upload).
- `homepage.html` — the editable homepage source (has an `__ARCHIVE_DATA__` placeholder); never publish this directly, always run `pipeline/deploy-homepage.mjs` which builds and deploys it.

## Platforms (7 live, 1 sandboxed)

Instagram, YouTube, X, Threads, Facebook, Bluesky, WordPress, Mastodon are live. Pinterest is built and working but still Meta-equivalent "sandboxed" (pins only visible to this account) pending Pinterest's own Standard-access review — see `project_pinterest_pending` in project memory.

## Known structural limits (not bugs, just platform reality)

- **Instagram/Threads are published via Buffer**, not this project's own API credentials — meaning we can't act on their post IDs afterward (no auto-commenting, no reading engagement) without replacing Buffer with a direct integration, which is its own multi-week project (Meta app review for both, X's free-tier API access is uncertain). Facebook and everything else use direct API integrations.
- **Instagram/Threads Story polls cannot be automated at all** — Meta's own API docs confirm interactive stickers (polls, quizzes) are not exposed to third-party apps, full stop. Not a permissions gap; there is no supported path.
