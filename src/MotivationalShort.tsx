import React from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./Background";

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
};

// 1080x1920 (9:16) — YouTube Shorts format. Single scene: the thought
// animates in, holds, then the support line follows — narrated by the
// same TTS pipeline as the sector video, just much shorter (~15-20s).
export const MotivationalShort: React.FC<MotivationalShortProps> = ({ thought, support, audioFile }) => {
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
            fontSize: 66,
            lineHeight: 1.22,
            color: INK,
            maxWidth: 880,
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
            fontSize: 32,
            lineHeight: 1.5,
            color: INK_SOFT,
            maxWidth: 820,
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
        <div style={{ fontFamily: FONT_MONO, fontSize: 16, color: INK_SOFT }}>@bharatat100</div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 90,
          right: 90,
          fontFamily: FONT_BODY,
          fontSize: 15,
          color: INK_SOFT,
        }}
      >
        Independent citizen project — not affiliated with the Government of India
      </div>
    </AbsoluteFill>
  );
};
