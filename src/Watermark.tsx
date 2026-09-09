import React from "react";
import { AbsoluteFill } from "remotion";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const INK = "#f2ede2";
const SAFFRON = "#c9722c";
const RING = "#c9722c";

// 200x200 square, transparent background, PNG. YouTube overlays its own
// subscribe ring in the middle ~60% of a watermark, so the mark itself
// is a thin outer ring with the wordmark's initial only — nothing sits
// in the center that a subscribe button would obscure.
export const Watermark: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        width: 200,
        height: 200,
        background: "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 176,
          height: 176,
          borderRadius: "50%",
          border: `5px solid ${RING}`,
          background: "rgba(22,35,29,0.82)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 44,
            color: INK,
            lineHeight: 1,
            letterSpacing: -1,
          }}
        >
          <span style={{ color: SAFFRON }}>@</span>100
        </div>
      </div>
    </AbsoluteFill>
  );
};
