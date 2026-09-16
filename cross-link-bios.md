# Bharat Varsh - cross-platform bio & pinned text drafts

Goal: each platform's profile should send new followers to the other 3, so growth on any one channel compounds across all four. All text below respects the "not government-affiliated" legal line and the house style rules (hyphen not em dash, no serial comma before and/or).

Handles today: Instagram/YouTube/Threads = @bharatat100 (placeholder - switches to this exact handle ~Sept 19 per the 14-day hold), X = @Bharat_at_100.

---

## Instagram bio

```
Bharat Varsh 🇮🇳
India's growth story, day by day
Independent · not affiliated with the Govt of India
👇 Daily video on all platforms
X: @Bharat_at_100 · YouTube: youtube.com/@bharatat100
```

(Instagram allows one clickable link - set it to the YouTube channel, since YouTube is where the fullest version of each video plus a Subscribe button lives. Swap to a future bharatat100.com link once that's built out.)

**UPDATED 2026-09-14: added the disclaimer line, replacing the original "History • sectors • mindset" line.** Found during a review that Instagram's and Threads' bios were the ONLY two of the project's always-visible surfaces with no disclaimer at all - captions bury it below Instagram/YouTube's ~125-char truncation point, which most viewers never expand past, meaning the bio is the actual primary, reliably-visible disclaimer surface, not a backup. This was a real gap between the safety design's intention and what viewers actually see.

## Threads bio

```
Bharat Varsh 🇮🇳
Independent, not affiliated with the Govt of India
Building toward India's 100th year of independence
Full videos: YouTube @bharatat100 · X @Bharat_at_100
```

**UPDATED 2026-09-14: same reason as Instagram's bio above** - added the disclaimer, replacing "On this day • sector growth • daily motivation" (already implied by the content itself).

## X (Bharat_at_100) bio

```
India's growth story toward 2047 - daily, sourced, independent.
Not affiliated with the Government of India.
📺 youtube.com/@bharatat100 · 📸 @bharatat100
```

## YouTube channel description

```
Bharat Varsh - India's growth story, one day at a time.

Every day: a piece of Indian history, a sector actually growing, and a
thought worth carrying into the next one. Independent citizen project,
not affiliated with the Government of India - sourced every time.

Follow on Instagram and Threads: @bharatat100
Follow on X: @Bharat_at_100
```

---

## Pinned comment (post under each platform's own first video of the day, or as a genuinely pinned comment where the platform supports it)

Use this on X (pin as a Tweet reply to your own top-performing post) and as a
YouTube pinned comment on each video once it's live:

```
New here? This channel posts daily - Indian history, a growing sector,
and a thought - across Instagram, Threads, X and YouTube.
Catch whichever you're missing: youtube.com/@bharatat100
```

---

## One-time setup checklist (not automatable - each platform requires logging into its own settings)

- [ ] Instagram: Settings -> Edit profile -> paste bio + link (RE-CHECK 2026-09-14: bio text above was updated to add the disclaimer - re-paste even if a bio already exists)
- [ ] Threads: uses Instagram's bio if linked, or set separately in Threads settings (RE-CHECK 2026-09-14: same update as Instagram)
- [ ] X: Settings -> Profile -> paste bio
- [ ] YouTube: Studio -> Customization -> Basic info -> Description
- [ ] YouTube: pin the "New here?" comment manually on today's video (repeat per video, or just do it on your best-performing one each week - not worth automating for the effort involved)
- [ ] Facebook Page "Bharatat100": Page Settings -> About -> Description - CHECK whether it currently has the disclaimer text; never explicitly verified in prior sessions
- [x] Mastodon (@bharatat100 on mastodon.social): Preferences -> Profile -> Bio - VERIFIED 2026-09-16 via API (`accounts/:id`'s `note` field) - already has "not affiliated with the Government of India." No action needed.
- [x] Bluesky (@bharatat100): Settings -> Edit profile -> Description - WAS completely empty (no display name, no bio at all) despite posting daily since Sept 8 - verified via public API (`getProfile`). FIXED 2026-09-16: display name "Bharat@100" and a full bio with the disclaimer set, verified live via API.
- [x] WordPress (bharatat100.wordpress.com): About page - WAS the default WordPress.com placeholder text ("This is an example of a page...") - never actually written. FIXED 2026-09-16: real About-page copy drafted and published, includes the disclaimer ("not affiliated with, funded by, or endorsed by the Government of India"), verified live via curl. Site-wide footer still not separately checked - WordPress.com's free themes often don't expose an editable footer at all, worth a quick look next time but not urgent since the About page and every post's own disclaimer line already cover this.
- [ ] Substack: Publication settings -> About page - CHECK, this is also where a reader lands before ever subscribing, so it's a real first-impression surface
- [ ] Medium: Profile -> Bio field - CHECK

**Suggested short disclaimer line for any of the above still missing one** (adapt to each platform's own character limit and existing bio content, don't just paste verbatim over something already good):
```
Independent citizen project. Not affiliated with the Government of India.
```

## Note on the pipeline (automatable part is separate - see the outro/caption CTA work)

This document is the one-time manual bio/description setup only. The
per-video cross-platform CTA baked into every future video's outro card
and caption is handled separately in the render pipeline, not here.
