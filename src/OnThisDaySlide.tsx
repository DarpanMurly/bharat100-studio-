import React from "react";
import { AbsoluteFill } from "remotion";
import { Background, ThemeName } from "./Background";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const INK = "#f2ede2";
const INK_SOFT = "#a9b3ac";
const SAFFRON = "#e08a45";

export type SlideData = {
  kind: "cover" | "context" | "detail" | "closer" | "recap-list" | "cta";
  // Standing convention: the closer slide's eyebrow is always
  // "Why it matters for Viksit Bharat 2047" — not "...at 100" or any other
  // variant — so every carousel ties back to the same explicit mission line.
  eyebrow?: string;
  year?: string;
  headline: string;
  body?: string;
  // Only used by "recap-list" — one line per item, e.g. the week's
  // headlines. Rendered as a numbered list instead of a single story.
  listItems?: string[];
};

// 1080x1350 (4:5), matching the motivational post so the whole daily
// output set shares one canvas shape across every platform.
export const OnThisDaySlide: React.FC<{
  slide: SlideData;
  index: number;
  total: number;
  theme: ThemeName;
  // Top-left brand/series label — defaults to "On This Day" since that's
  // this component's original and most common use, but a reused pillar
  // (e.g. "Global Bharat") must override it rather than silently showing
  // the wrong series name.
  seriesLabel?: string;
}> = ({ slide, index, total, theme, seriesLabel = "On This Day" }) => {
  const accent = slide.kind === "closer" || slide.kind === "cta" ? SAFFRON : "#d98aab";

  return (
    <AbsoluteFill style={{ fontFamily: FONT_BODY }}>
      <Background theme={theme} />

      <AbsoluteFill
        style={{
          padding: "0 90px",
          justifyContent: "center",
          alignItems: "flex-start",
        }}
      >
        {/* top row: brand + slide counter */}
        <div
          style={{
            position: "absolute",
            top: 56,
            left: 90,
            right: 90,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 26, color: INK }}>
            {seriesLabel}
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 18, color: INK_SOFT, letterSpacing: 1 }}>
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </div>
        </div>

        {slide.year && (
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 120,
              color: accent,
              lineHeight: 1,
              marginBottom: 24,
              textShadow: "0 4px 30px rgba(0,0,0,0.3)",
            }}
          >
            {slide.year}
          </div>
        )}

        {slide.eyebrow && (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 18,
              color: accent,
              textTransform: "uppercase",
              letterSpacing: 2,
              marginBottom: 18,
            }}
          >
            {slide.eyebrow}
          </div>
        )}

        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            // Increased 2026-09-08 for mobile readability.
            fontSize: slide.kind === "cover" ? 74 : 60,
            lineHeight: 1.2,
            color: INK,
            maxWidth: 840,
            textShadow: "0 4px 30px rgba(0,0,0,0.3)",
          }}
        >
          {slide.headline}
        </div>

        {slide.body && (
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 500,
              fontSize: 34,
              lineHeight: 1.5,
              color: INK_SOFT,
              marginTop: 26,
              maxWidth: 760,
            }}
          >
            {slide.body}
          </div>
        )}

        {slide.kind === "cta" && (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 24,
              color: accent,
              letterSpacing: 1,
              marginTop: 30,
            }}
          >
            @bharatat100 &middot; X: @Bharat_at_100
          </div>
        )}

        {slide.kind === "recap-list" && slide.listItems && (
          <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 32, maxWidth: 860 }}>
            {slide.listItems.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
                <div
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 24,
                    color: accent,
                    flexShrink: 0,
                    width: 36,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div
                  style={{
                    fontFamily: FONT_BODY,
                    fontWeight: 500,
                    fontSize: 30,
                    lineHeight: 1.4,
                    color: INK,
                  }}
                >
                  {item}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* progress bar */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 6,
            backgroundColor: "rgba(242,237,226,0.18)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${((index + 1) / total) * 100}%`,
              backgroundColor: accent,
            }}
          />
        </div>

        {index === total - 1 && (
          <div
            style={{
              position: "absolute",
              bottom: 40,
              left: 90,
              fontFamily: FONT_MONO,
              fontSize: 16,
              color: INK_SOFT,
              letterSpacing: 0.5,
            }}
          >
            @bharatat100 · X: @Bharat_at_100
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
