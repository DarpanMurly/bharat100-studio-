import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, ThemeName } from "./Background";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const INK = "#f2ede2";
const INK_SOFT = "#a9b3ac";
const LINE = "rgba(242,237,226,0.18)";

const HANDLES = [
  { label: "Instagram", value: "@bharatat100" },
  { label: "YouTube", value: "@bharatat100" },
  { label: "X", value: "@Bharat_at_100" },
  { label: "Threads", value: "@bharatat100" },
];

export const Outro: React.FC<{ theme: ThemeName; ctaLine: string }> = ({ theme, ctaLine }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.6 }, durationInFrames: 18 });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const y = interpolate(enter, [0, 1], [24, 0]);

  const pulse = 1 + 0.03 * Math.sin(frame * 0.25);

  return (
    <AbsoluteFill style={{ fontFamily: FONT_BODY, color: INK }}>
      <Background theme={theme} />
      <AbsoluteFill
        style={{
          padding: "0 90px",
          justifyContent: "center",
          alignItems: "flex-start",
        }}
      >
        <div style={{ opacity, transform: `translateY(${y}px)`, width: "100%" }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 56,
              lineHeight: 1.15,
              marginBottom: 14,
              textShadow: "0 4px 30px rgba(0,0,0,0.3)",
            }}
          >
            {ctaLine}
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              marginTop: 8,
              marginBottom: 44,
              transform: `scale(${pulse})`,
              transformOrigin: "left center",
            }}
          >
            <div
              style={{
                fontFamily: FONT_BODY,
                fontWeight: 700,
                fontSize: 30,
                color: "#191410",
                background: "#e08a45",
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
                border: `2px solid ${LINE}`,
                padding: "12px 28px",
                borderRadius: 999,
              }}
            >
              ♥ Like
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {HANDLES.map((h) => (
              <div
                key={h.label}
                style={{ display: "flex", alignItems: "baseline", gap: 16 }}
              >
                <div
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 20,
                    color: INK_SOFT,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    width: 150,
                  }}
                >
                  {h.label}
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 32 }}>
                  {h.value}
                </div>
              </div>
            ))}
          </div>
        </div>

      </AbsoluteFill>
    </AbsoluteFill>
  );
};
