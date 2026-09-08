import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, ThemeName } from "./Background";

export type SceneData = {
  kind: "hook" | "stat" | "point" | "closer" | "cta";
  text: string;
  sub?: string;
  stat?: string;
  statLabel?: string;
  narration?: string;
};

const COLORS = {
  paper: "#f2ede2",
  ink: "#f2ede2",
  inkSoft: "#a9b3ac",
  saffron: "#e08a45",
  teal: "#5fc4a8",
  gold: "#e0b968",
  line: "rgba(242,237,226,0.18)",
};

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

export const Scene: React.FC<{
  scene: SceneData;
  index: number;
  total: number;
  theme: ThemeName;
  showDisclaimer?: boolean;
}> = ({ scene, index, total, theme, showDisclaimer }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.6 }, durationInFrames: 18 });
  const textOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const textY = interpolate(enter, [0, 1], [24, 0]);

  const accent =
    scene.kind === "hook" || scene.kind === "cta"
      ? COLORS.saffron
      : scene.kind === "stat"
      ? COLORS.gold
      : COLORS.teal;

  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT_BODY,
        color: COLORS.ink,
      }}
    >
      <Background theme={theme} />

      <AbsoluteFill style={{ padding: "0 90px", justifyContent: "center", alignItems: "flex-start" }}>
        {/* top brand row */}
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
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: 30,
              color: COLORS.ink,
            }}
          >
            Bharat<span style={{ color: accent }}>@100</span>
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 20,
              color: COLORS.inkSoft,
              letterSpacing: 1,
            }}
          >
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </div>
        </div>

        {/* progress bar */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 6,
            backgroundColor: COLORS.line,
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

        {/* content */}
        <div style={{ opacity: textOpacity, transform: `translateY(${textY}px)`, width: "100%" }}>
          {scene.kind === "stat" && scene.stat && (
            <div style={{ marginBottom: 28 }}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 172,
                  color: accent,
                  lineHeight: 1,
                  textShadow: "0 4px 40px rgba(0,0,0,0.35)",
                }}
              >
                {scene.stat}
              </div>
              {scene.statLabel && (
                <div
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 30,
                    color: COLORS.inkSoft,
                    marginTop: 10,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                  }}
                >
                  {scene.statLabel}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              // Increased 2026-09-08 for mobile readability — headline text
              // is the thing a scrolling viewer needs to read in under a
              // second, so it takes priority over fitting more per line.
              fontSize: scene.kind === "hook" ? 84 : 68,
              lineHeight: 1.15,
              maxWidth: 940,
              color: COLORS.ink,
              textShadow: "0 4px 30px rgba(0,0,0,0.3)",
            }}
          >
            {scene.text}
          </div>

          {scene.sub && (
            <div
              style={{
                fontFamily: FONT_BODY,
                fontWeight: 500,
                fontSize: 40,
                color: COLORS.inkSoft,
                marginTop: 22,
                maxWidth: 860,
              }}
            >
              {scene.sub}
            </div>
          )}
        </div>

        {showDisclaimer && (
          <div
            style={{
              position: "absolute",
              bottom: 40,
              left: 90,
              fontFamily: FONT_BODY,
              fontSize: 18,
              color: COLORS.inkSoft,
            }}
          >
            Independent citizen project — not affiliated with the Government of India
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
