import "./index.css";
import { Still } from "remotion";
import { Bharat100Composition } from "./Composition";
import { Banner } from "./Banner";
import { Watermark } from "./Watermark";
import { XBanner } from "./XBanner";
import { MotivationalStillComposition } from "./MotivationalComposition";
import { OnThisDayStillComposition } from "./OnThisDayComposition";
import { MotivationalShortCompositionDef } from "./MotivationalShortComposition";
import { OnThisDayShortCompositionDef } from "./OnThisDayShortComposition";
import { AppIconCompositionDef } from "./AppIcon";
import { BlogCoverCompositionDef } from "./BlogCover";
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

loadFraunces("normal", { weights: ["600", "700"], subsets: ["latin"] });
loadInter("normal", { weights: ["500", "600"], subsets: ["latin"] });
loadMono("normal", { weights: ["500", "600"], subsets: ["latin"] });

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Bharat100Composition />
      <Still id="Banner" component={Banner} width={2048} height={1152} />
      <Still id="Watermark" component={Watermark} width={200} height={200} />
      <Still id="XBanner" component={XBanner} width={1500} height={500} />
      <MotivationalStillComposition />
      <OnThisDayStillComposition />
      <MotivationalShortCompositionDef />
      <OnThisDayShortCompositionDef />
      <AppIconCompositionDef />
      <BlogCoverCompositionDef />
    </>
  );
};
