import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
} from "remotion";
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { Scene, SceneData } from "./Scene";
import { Outro } from "./Outro";
import { ThemeName } from "./Background";

loadFraunces("normal", { weights: ["600", "700"], subsets: ["latin"] });
loadInter("normal", { weights: ["500", "600"], subsets: ["latin"] });
loadMono("normal", { weights: ["500", "600"], subsets: ["latin"] });

const PILLAR_THEME: Record<string, ThemeName> = {
  "Sector Futures": "saffron",
  "Civic Literacy": "teal",
  "Personal Growth": "gold",
  "Builder Story": "saffron",
};

export type VideoScript = {
  id: string;
  title: string;
  pillar: string;
  voice: string;
  musicVolume?: number;
  outroCta?: string;
  scenes: SceneData[];
};

export type SceneTiming = {
  startFrame: number;
  durationInFrames: number;
};

export const VideoTemplate: React.FC<{
  script: VideoScript;
  timings: SceneTiming[];
  outroTiming: SceneTiming;
  audioFile: string;
  musicFile?: string | null;
}> = ({ script, timings, outroTiming, audioFile, musicFile }) => {
  const theme = PILLAR_THEME[script.pillar] ?? "saffron";

  return (
    <AbsoluteFill>
      <Audio src={staticFile(audioFile)} />
      {musicFile && <Audio src={staticFile(musicFile)} volume={script.musicVolume ?? 0.08} loop />}
      {script.scenes.map((scene, i) => {
        const t = timings[i];
        if (!t) return null;
        return (
          <Sequence key={i} from={t.startFrame} durationInFrames={t.durationInFrames}>
            <Scene scene={scene} index={i} total={script.scenes.length} theme={theme} />
          </Sequence>
        );
      })}
      <Sequence from={outroTiming.startFrame} durationInFrames={outroTiming.durationInFrames}>
        <Outro theme={theme} ctaLine={script.outroCta ?? "Follow Bharat@100"} />
      </Sequence>
    </AbsoluteFill>
  );
};
