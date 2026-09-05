import React from "react";
import { AbsoluteFill } from "remotion";
import { Background } from "./Background";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const INK = "#f2ede2";
const INK_SOFT = "#a9b3ac";
const SAFFRON = "#e08a45";

// Full canvas: 2048x1152 — YouTube's recommended minimum for best results
// on all devices (still 16:9, so the safe-zone proportions below scale
// down from the 2560x1440 spec unchanged). Safe zone at this size is
// 1237x338, centered — every critical element must sit inside it, since
// mobile crops everything outside that box.
export const Banner: React.FC = () => {
  return (
    <AbsoluteFill style={{ width: 2048, height: 1152, fontFamily: FONT_BODY }}>
      <Background theme="saffron" />

      {/* safe-zone-centered content */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 86,
              color: INK,
              letterSpacing: -1,
              textShadow: "0 5px 32px rgba(0,0,0,0.35)",
            }}
          >
            Bharat<span style={{ color: SAFFRON }}>@100</span>
          </div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 500,
              fontSize: 27,
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
              fontSize: 16,
              color: INK_SOFT,
              marginTop: 21,
              letterSpacing: 1.6,
              textTransform: "uppercase",
            }}
          >
            New videos weekly · @bharatat100
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
