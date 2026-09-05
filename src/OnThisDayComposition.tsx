import React from "react";
import { CalculateMetadataFunction, Still, staticFile } from "remotion";
import { OnThisDaySlide, SlideData } from "./OnThisDaySlide";
import { ThemeName } from "./Background";

type OnThisDayContent = {
  theme: ThemeName;
  slides: SlideData[];
};

type InputProps = { contentId: string; slideIndex: number };
type ResolvedProps = InputProps & { slides: SlideData[]; theme: ThemeName };

const loadContent = async (contentId: string): Promise<OnThisDayContent> => {
  const res = await fetch(staticFile(`on-this-day/${contentId}.json`));
  if (!res.ok) {
    throw new Error(
      `No content found for "${contentId}". Expected public/on-this-day/${contentId}.json`
    );
  }
  return res.json();
};

const calculateMetadata: CalculateMetadataFunction<InputProps> = async ({ props }) => {
  const content = await loadContent(props.contentId);
  return {
    props: {
      ...props,
      slides: content.slides,
      theme: content.theme,
    } satisfies ResolvedProps,
  };
};

export const OnThisDayStillComposition = () => {
  return (
    <Still
      id="OnThisDay"
      component={OnThisDayRender}
      width={1080}
      height={1350}
      defaultProps={{ contentId: "sample", slideIndex: 0 } as ResolvedProps}
      calculateMetadata={calculateMetadata}
    />
  );
};

const OnThisDayRender: React.FC<ResolvedProps> = ({ slides, slideIndex, theme }) => {
  const slide = slides[slideIndex];
  if (!slide) return null;
  return <OnThisDaySlide slide={slide} index={slideIndex} total={slides.length} theme={theme} />;
};
