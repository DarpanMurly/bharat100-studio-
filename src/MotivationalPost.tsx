import React from "react";
import { AbsoluteFill } from "remotion";
import { Background } from "./Background";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const INK = "#f2ede2";
const INK_SOFT = "#a9b3ac";
const SAFFRON = "#e08a45";
const LINE = "rgba(242,237,226,0.18)";

export type MotivationalContent = {
  thought: string;
  support: string;
  attribution?: string;
};

// 1080x1350 (4:5) — the best-supported "large" aspect ratio across
// Instagram, Threads and X feeds, so one asset works everywhere without
// letterboxing. Background is intentionally the same static frame every
// day (no animation) so the daily series reads as one consistent object.
export const MotivationalPost: React.FC<MotivationalContent> = ({
  thought,
  support,
  attribution,
}) => {
  return (
    <AbsoluteFill style={{ width: 1080, height: 1350, fontFamily: FONT_BODY }}>
      <Background theme="teal" />

      <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center", alignItems: "flex-start" }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 20,
            color: SAFFRON,
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 28,
          }}
        >
          Thought of the Day
        </div>

        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: 58,
            lineHeight: 1.22,
            color: INK,
            maxWidth: 880,
            textShadow: "0 4px 30px rgba(0,0,0,0.3)",
          }}
        >
          {thought}
        </div>

        <div
          style={{
            width: 64,
            height: 3,
            background: SAFFRON,
            margin: "34px 0",
          }}
        />

        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 500,
            fontSize: 30,
            lineHeight: 1.5,
            color: INK_SOFT,
            maxWidth: 780,
          }}
        >
          {support}
        </div>

        {attribution && (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 20,
              color: INK_SOFT,
              marginTop: 30,
              letterSpacing: 0.5,
            }}
          >
            — {attribution}
          </div>
        )}
      </AbsoluteFill>

      {/* brand watermark, bottom-right, consistent across every post */}
      <div
        style={{
          position: "absolute",
          bottom: 44,
          right: 60,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: `2px solid ${SAFFRON}`,
            background: "rgba(22,35,29,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: INK }}>
            B<span style={{ color: SAFFRON }}>V</span>
          </div>
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 16,
            color: INK_SOFT,
            letterSpacing: 1,
          }}
        >
          @bharatat100
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 44,
          left: 60,
          fontFamily: FONT_BODY,
          fontSize: 14,
          color: INK_SOFT,
          maxWidth: 400,
        }}
      >
        Independent citizen project — not affiliated with the Government of India
      </div>
    </AbsoluteFill>
  );
};
