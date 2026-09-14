import React from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./Background";
import { PlatformHandles } from "./PlatformHandles";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const INK = "#f2ede2";
const INK_SOFT = "#a9b3ac";
const SAFFRON = "#e08a45";

export type MotivationalShortProps = {
  thought: string;
  support: string;
  audioFile: string;
  durationInFrames: number;
};

// 1080x1920 (9:16) — YouTube Shorts format. Single scene: the thought
// animates in, holds, then the support line follows — narrated by the
// same TTS pipeline as the sector video, just much shorter (~15-20s).
// The trailing ~1.5s (already reserved past the narration's own length,
// see render-motivational-short.mjs's TAIL_SEC) fades in a follow
// prompt, matching the dedicated CTA screen every other pillar ends on.
export const MotivationalShort: React.FC<MotivationalShortProps> = ({
  thought,
  support,
  audioFile,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.6 }, durationInFrames: 18 });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const y = interpolate(enter, [0, 1], [24, 0]);

  const supportFrame = Math.round(fps * 2.5);
  const supportOpacity = interpolate(frame, [supportFrame, supportFrame + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Bumped from fps*2 to fps*4 on 2026-09-09 to match TAIL_SEC's increase
  // (render-motivational-short.mjs) — the CTA now holds the full 7-row
  // PlatformHandles list, not just a 2-handle line, so it needs to fade
  // in earlier within the reserved tail to leave real reading time.
  const ctaFrame = durationInFrames - Math.round(fps * 4);
  const ctaOpacity = interpolate(frame, [ctaFrame, ctaFrame + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ width: 1080, height: 1920, fontFamily: FONT_BODY }}>
      <Background theme="teal" />
      <Audio src={staticFile(audioFile)} />

      <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center", alignItems: "flex-start" }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 22,
            color: SAFFRON,
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 30,
            opacity,
          }}
        >
          Thought of the Day
        </div>

        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            // Increased 2026-09-08 for mobile readability.
            fontSize: 82,
            lineHeight: 1.2,
            color: INK,
            maxWidth: 860,
            textShadow: "0 4px 30px rgba(0,0,0,0.3)",
            opacity,
            transform: `translateY(${y}px)`,
          }}
        >
          {thought}
        </div>

        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 500,
            fontSize: 38,
            lineHeight: 1.5,
            color: INK_SOFT,
            maxWidth: 780,
            marginTop: 40,
            opacity: supportOpacity,
          }}
        >
          {support}
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          bottom: 90,
          left: 90,
          right: 90,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 24, color: INK }}>
          Bharat<span style={{ color: SAFFRON }}>@100</span>
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 16, color: INK_SOFT }}>
          @bharatat100 · X: @Bharat_at_100
        </div>
      </div>

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: ctaOpacity,
          backgroundColor: "#0c1211",
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 22,
            color: SAFFRON,
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 26,
          }}
        >
          Bharat@100
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: 46,
            color: INK,
            textAlign: "center",
            maxWidth: 700,
            padding: "0 60px",
            marginBottom: 32,
          }}
        >
          Follow for tomorrow's thought.
        </div>
        {/* Same Subscribe/Like pill treatment as Outro.tsx and
            OnThisDaySlide.tsx's cta slide — added 2026-09-15, this screen
            was missing them entirely. */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 30,
            transform: `scale(${1 + 0.03 * Math.sin(frame * 0.25)})`,
            transformOrigin: "center center",
          }}
        >
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 30,
              color: "#191410",
              background: SAFFRON,
              padding: "14px 30px",
              borderRadius: 999,
            }}
          >
            Subscribe
          </div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 30,
              color: INK,
              border: "2px solid rgba(242,237,226,0.18)",
              padding: "12px 28px",
              borderRadius: 999,
            }}
          >
            ♥ Like
          </div>
        </div>
        <PlatformHandles ink={INK} inkSoft={INK_SOFT} />
      </AbsoluteFill>

    </AbsoluteFill>
  );
};
