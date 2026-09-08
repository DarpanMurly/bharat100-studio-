import React from "react";
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { OnThisDayShort } from "./OnThisDayShort";
import { SlideData } from "./OnThisDaySlide";
import { SceneTiming } from "./VideoTemplate";

type InputProps = { contentId: string; seriesLabel?: string };
type ResolvedProps = InputProps & { slides: SlideData[]; timings: SceneTiming[]; audioFile: string };

type Manifest = {
  audioFile: string;
  timings: SceneTiming[];
  totalDurationInFrames: number;
  fps: number;
};

const loadContent = async (contentId: string) => {
  const res = await fetch(staticFile(`on-this-day/${contentId}.json`));
  if (!res.ok) throw new Error(`No content found for "${contentId}"`);
  return res.json();
};

const loadManifest = async (contentId: string): Promise<Manifest> => {
  const res = await fetch(staticFile(`on-this-day-short/${contentId}.json`));
  if (!res.ok) {
    throw new Error(
      `No manifest for "${contentId}". Run: node pipeline/render-on-this-day-short.mjs ${contentId}`
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
      slides: content.slides,
      timings: manifest.timings,
      audioFile: manifest.audioFile,
    } satisfies ResolvedProps,
  };
};

export const OnThisDayShortCompositionDef = () => {
  return (
    <Composition
      id="OnThisDayShort"
      component={OnThisDayShortRender}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={600}
      defaultProps={{ contentId: "sample" } as ResolvedProps}
      calculateMetadata={calculateMetadata}
    />
  );
};

const OnThisDayShortRender: React.FC<ResolvedProps> = ({ slides, timings, audioFile, seriesLabel }) => {
  return <OnThisDayShort slides={slides} timings={timings} audioFile={audioFile} seriesLabel={seriesLabel} />;
};
