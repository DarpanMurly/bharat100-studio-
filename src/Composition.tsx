import React from "react";
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { VideoTemplate, VideoScript, SceneTiming } from "./VideoTemplate";

type InputProps = {
  scriptId: string;
};

type ResolvedProps = InputProps & {
  script: VideoScript;
  timings: SceneTiming[];
  outroTiming: SceneTiming;
  audioFile: string;
};

type Manifest = {
  scriptId: string;
  audioFile: string;
  timings: SceneTiming[];
  outroTiming: SceneTiming;
  totalDurationInFrames: number;
  fps: number;
};

import budget from "./scripts/budget.json";
import semicon2 from "./scripts/semicon2.json";
import budget from "./scripts/budget.json";
import semicon2 from "./scripts/semicon2.json";
import budget from "./scripts/budget.json";
import semicon2 from "./scripts/semicon2.json";
import budget from "./scripts/budget.json";
import semicon2 from "./scripts/semicon2.json";
import budget from "./scripts/budget.json";
import semicon2 from "./scripts/semicon2.json";
import budget from "./scripts/budget.json";
import semicon2 from "./scripts/semicon2.json";
import budget from "./scripts/budget.json";
import defence26 from "./scripts/defence26.json";
import semicon2 from "./scripts/semicon2.json";
import budget from "./scripts/budget.json";
import defence26 from "./scripts/defence26.json";
import semicon2 from "./scripts/semicon2.json";
import semiconductors from "./scripts/semiconductors.json";
import skills2030 from "./scripts/skills2030.json";


const scriptRegistry: Record<string, VideoScript> = {
  budget: budget as VideoScript,
  defence26: defence26 as VideoScript,
  semicon2: semicon2 as VideoScript,
  semiconductors: semiconductors as VideoScript,
  skills2030: skills2030 as VideoScript,
};

const loadScript = (scriptId: string): VideoScript => {
  const script = scriptRegistry[scriptId];
  if (!script) throw new Error(`No script found for id "${scriptId}"`);
  return script;
};

const loadManifest = async (scriptId: string): Promise<Manifest> => {
  const res = await fetch(staticFile(`${scriptId}/timings.json`));
  if (!res.ok) {
    throw new Error(
      `No timings.json found for "${scriptId}". Run: node pipeline/build.mjs ${scriptId}`
    );
  }
  return res.json();
};

const calculateMetadata: CalculateMetadataFunction<InputProps> = async ({ props }) => {
  const manifest = await loadManifest(props.scriptId);
  const script = loadScript(props.scriptId);
  return {
    durationInFrames: manifest.totalDurationInFrames,
    fps: manifest.fps,
    props: {
      ...props,
      script,
      timings: manifest.timings,
      outroTiming: manifest.outroTiming,
      audioFile: manifest.audioFile,
    } satisfies ResolvedProps,
  };
};

export const Bharat100Composition = () => {
  return (
    <Composition
      id="Bharat100"
      component={Bharat100Video}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ scriptId: "semiconductors" } as ResolvedProps}
      calculateMetadata={calculateMetadata}
    />
  );
};

export const Bharat100Video: React.FC<ResolvedProps> = ({
  script,
  timings,
  outroTiming,
  audioFile,
}) => {
  return (
    <VideoTemplate
      script={script}
      timings={timings}
      outroTiming={outroTiming}
      audioFile={audioFile}
      musicFile={null}
    />
  );
};
