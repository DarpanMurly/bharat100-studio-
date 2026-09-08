import React from "react";
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { MotivationalShort } from "./MotivationalShort";

type InputProps = { contentId: string };
type ResolvedProps = InputProps & {
  thought: string;
  support: string;
  audioFile: string;
  durationInFrames: number;
};

type Manifest = {
  audioFile: string;
  totalDurationInFrames: number;
  fps: number;
};

const loadContent = async (contentId: string) => {
  const res = await fetch(staticFile(`motivational/${contentId}.json`));
  if (!res.ok) throw new Error(`No content found for "${contentId}"`);
  return res.json();
};

const loadManifest = async (contentId: string): Promise<Manifest> => {
  const res = await fetch(staticFile(`motivational-short/${contentId}.json`));
  if (!res.ok) {
    throw new Error(
      `No manifest for "${contentId}". Run: node pipeline/render-motivational-short.mjs ${contentId}`
    );
  }
  return res.json();
};

const calculateMetadata: CalculateMetadataFunction<InputProps> = async ({ props }) => {
  const [content, manifest] = await Promise.all([loadContent(props.contentId), loadManifest(props.contentId)]);
  return {
    durationInFrames: manifest.totalDurationInFrames,
    fps: manifest.fps,
    props: {
      ...props,
      thought: content.thought,
      support: content.support,
      audioFile: manifest.audioFile,
      durationInFrames: manifest.totalDurationInFrames,
    } satisfies ResolvedProps,
  };
};

export const MotivationalShortCompositionDef = () => {
  return (
    <Composition
      id="MotivationalShort"
      component={MotivationalShortRender}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={450}
      defaultProps={{ contentId: "sample" } as ResolvedProps}
      calculateMetadata={calculateMetadata}
    />
  );
};

const MotivationalShortRender: React.FC<ResolvedProps> = ({ thought, support, audioFile, durationInFrames }) => {
  return (
    <MotivationalShort thought={thought} support={support} audioFile={audioFile} durationInFrames={durationInFrames} />
  );
};
