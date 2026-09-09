import React from "react";
import { AbsoluteFill, Composition, staticFile } from "remotion";
import { Background, ThemeName } from "./Background";

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const INK = "#f2ede2";
const INK_SOFT = "#a9b3ac";
const SAFFRON = "#e08a45";

export type BlogCoverProps = {
  date: string; // e.g. "September 8, 2026"
  headlines: string[]; // that day's 5 pillar headlines, in pillar order
};

// 1200x630 — the standard blog/social share-card size (matches Open
// Graph image conventions), so this doubles as the featured image AND
// looks right if WordPress/social previews crop or embed it directly.
export const BlogCover: React.FC<BlogCoverProps> = ({ date, headlines }) => {
  return (
    <AbsoluteFill style={{ width: 1200, height: 630, fontFamily: FONT_BODY }}>
      <Background theme="saffron" />

      <AbsoluteFill style={{ padding: "56px 64px", justifyContent: "center" }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 18,
            color: SAFFRON,
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 14,
          }}
        >
          Bharat@100 &middot; Daily Digest &middot; {date}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 1000 }}>
          {headlines.slice(0, 5).map((h, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 18,
                  color: SAFFRON,
                  flexShrink: 0,
                  width: 22,
                  marginTop: 3,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 600,
                  fontSize: 26,
                  lineHeight: 1.28,
                  color: INK,
                  textShadow: "0 3px 20px rgba(0,0,0,0.3)",
                }}
              >
                {h}
              </div>
            </div>
          ))}
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          bottom: 32,
          left: 64,
          fontFamily: FONT_DISPLAY,
          fontWeight: 600,
          fontSize: 22,
          color: INK,
        }}
      >
        Bharat<span style={{ color: SAFFRON }}>@100</span>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 36,
          right: 64,
          fontFamily: FONT_MONO,
          fontSize: 14,
          color: INK_SOFT,
        }}
      >
        bharatat100.com
      </div>
    </AbsoluteFill>
  );
};

export const BlogCoverCompositionDef = () => {
  return (
    <Composition
      id="BlogCover"
      component={BlogCoverRender}
      width={1200}
      height={630}
      fps={30}
      durationInFrames={1}
      defaultProps={{ contentId: "sample" } as { contentId: string }}
      calculateMetadata={async ({ props }) => {
        const contentId = (props as { contentId: string }).contentId;
        const res = await fetch(staticFile(`wordpress/${contentId}.json`));
        if (!res.ok) throw new Error(`No article found for "${contentId}" — run wordpress-cover.mjs after writing the article JSON.`);
        const article = await res.json();
        return {
          props: {
            date: article.coverDate,
            headlines: article.coverHeadlines,
          } as BlogCoverProps,
        };
      }}
    />
  );
};

const BlogCoverRender: React.FC<BlogCoverProps> = ({ date, headlines }) => {
  return <BlogCover date={date} headlines={headlines} />;
};
