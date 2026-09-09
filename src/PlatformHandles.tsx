import React from "react";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_MONO = "'JetBrains Mono', monospace";

// Single source of truth for the CTA-frame handle list, shared across
// every video format's dedicated "follow us" screen (Outro.tsx for
// sector videos, MotivationalShort.tsx and OnThisDaySlide.tsx for their
// own CTA frames). All 7 live platforms (2026-09-09) — Pinterest
// excluded since it's still sandboxed pending Standard-access review,
// same rule as the homepage's platform grid. WordPress is left out here
// too: this list is specifically "accounts to follow," and WordPress is
// a blog to read rather than a handle to follow.
export const PLATFORM_HANDLES = [
  { label: "Instagram", value: "@bharatat100" },
  { label: "YouTube", value: "@bharatat100" },
  { label: "X", value: "@Bharat_at_100" },
  { label: "Threads", value: "@bharatat100" },
  { label: "Facebook", value: "Bharat@100" },
  { label: "Bluesky", value: "@bharatat100.bsky.social" },
  { label: "Mastodon", value: "@bharatat100@mastodon.social" },
];

export const PlatformHandles: React.FC<{ ink: string; inkSoft: string }> = ({ ink, inkSoft }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {PLATFORM_HANDLES.map((h) => (
      <div key={h.label} style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 18,
            color: inkSoft,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            width: 150,
            flexShrink: 0,
          }}
        >
          {h.label}
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 28, color: ink }}>
          {h.value}
        </div>
      </div>
    ))}
  </div>
);
