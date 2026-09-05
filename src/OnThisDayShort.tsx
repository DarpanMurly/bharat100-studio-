import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { OnThisDaySlide, SlideData } from "./OnThisDaySlide";
import { SceneTiming } from "./VideoTemplate";

export type OnThisDayShortProps = {
  slides: SlideData[];
  timings: SceneTiming[];
  audioFile: string;
};

// 1080x1920 (9:16) — the carousel's 4 slides sequenced as a short video
// instead of static images, narrated by the same per-slide TTS approach
// as the sector video. Reuses OnThisDaySlide directly so the visual design
// stays identical to the carousel version — same heritage theme, same
// progress bar and disclaimer logic.
export const OnThisDayShort: React.FC<OnThisDayShortProps> = ({ slides, timings, audioFile }) => {
  return (
    <AbsoluteFill>
      <Audio src={staticFile(audioFile)} />
      {slides.map((slide, i) => {
        const t = timings[i];
        if (!t) return null;
        return (
          <Sequence key={i} from={t.startFrame} durationInFrames={t.durationInFrames}>
            <OnThisDaySlide slide={slide} index={i} total={slides.length} theme="heritage" />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
