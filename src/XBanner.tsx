import React from "react";
import { AbsoluteFill } from "remotion";
import { Background } from "./Background";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const INK = "#f2ede2";
const INK_SOFT = "#a9b3ac";
const SAFFRON = "#e08a45";

// 1500x500 (3:1). ~60px can crop top/bottom on some clients, and X's own
// profile-picture circle overlaps the bottom-left corner — so content sits
// clear of both: vertically centered with margin, and shifted right of the
// bottom-left profile-photo zone.
export const XBanner: React.FC = () => {
  return (
    <AbsoluteFill style={{ width: 1500, height: 500, fontFamily: FONT_BODY }}>
      <Background theme="teal" />

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: 30,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 84,
              color: INK,
              letterSpacing: -1,
              textShadow: "0 6px 30px rgba(0,0,0,0.35)",
            }}
          >
            Bharat<span style={{ color: SAFFRON }}>@100</span>
          </div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 500,
              fontSize: 26,
              color: INK_SOFT,
              marginTop: 14,
              letterSpacing: 0.3,
            }}
          >
            India's next 20 years, explained
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 15,
              color: INK_SOFT,
              marginTop: 18,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Careers · Economy · Sectors · @Bharat_at_100
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
