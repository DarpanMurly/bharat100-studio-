import React from "react";
import { CalculateMetadataFunction, Still, staticFile } from "remotion";
import { MotivationalPost, MotivationalContent } from "./MotivationalPost";

type InputProps = { contentId: string };
type ResolvedProps = InputProps & { content: MotivationalContent };

const loadContent = async (contentId: string): Promise<MotivationalContent> => {
  const res = await fetch(staticFile(`motivational/${contentId}.json`));
  if (!res.ok) {
    throw new Error(
      `No content found for "${contentId}". Expected public/motivational/${contentId}.json`
    );
  }
  return res.json();
};

const calculateMetadata: CalculateMetadataFunction<InputProps> = async ({ props }) => {
  const content = await loadContent(props.contentId);
  return { props: { ...props, content } satisfies ResolvedProps };
};

export const MotivationalStillComposition = () => {
  return (
    <Still
      id="Motivational"
      component={MotivationalRender}
      width={1080}
      height={1350}
      defaultProps={{ contentId: "sample" } as ResolvedProps}
      calculateMetadata={calculateMetadata}
    />
  );
};

const MotivationalRender: React.FC<ResolvedProps> = ({ content }) => {
  return <MotivationalPost {...content} />;
};
