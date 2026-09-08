import React from "react";
import { AbsoluteFill, Composition } from "remotion";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const SAFFRON = "#e08a45";
const INK = "#f2ede2";

// One-off 1024x1024 app icon for the Meta App Review submission form —
// not part of the daily content pipeline, just a still asset. Matches
// the site's dark heritage-gradient background and saffron accent.
export const AppIcon: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(155deg, #12191a 0%, #1c1013 55%, #150a0d 100%)",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 78% 78%, ${SAFFRON}29, transparent 42%)`,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 340, color: INK, lineHeight: 1 }}>
          B
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 140, color: SAFFRON, marginTop: -10 }}>
          @100
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const AppIconCompositionDef = () => {
  return <Composition id="AppIcon" component={AppIcon} width={1024} height={1024} fps={30} durationInFrames={1} />;
};
