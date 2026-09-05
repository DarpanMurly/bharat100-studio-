// Bharat@100 video pipeline
// Usage: node pipeline/build.mjs <scriptId>
// Reads src/scripts/<scriptId>.json, generates per-scene TTS narration
// (text normalized for correct pronunciation — see normalize.mjs), measures
// each clip's real duration, stitches narration + a closing outro clip,
// computes frame timings, and writes public/<scriptId>/timings.json.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFile } from "music-metadata";
import { normalizeForSpeech } from "./normalize.mjs";
import { syncRegistry } from "./registry.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FPS = 30;
const SCENE_PAUSE_SEC = 0.45; // breathing room after each line before the next starts
const OUTRO_HOLD_SEC = 3.5; // extra silent hold on the outro card for reading handles
const TAIL_SEC = 1.2; // hold last frame before video ends

async function narrate(text, voice, outPath) {
  await execFileAsync("python", [
    "-m",
    "edge_tts",
    "--voice",
    voice,
    "--text",
    text,
    "--write-media",
    outPath,
  ]);
  const meta = await parseFile(outPath);
  return meta.format.duration ?? 2;
}

async function main() {
  const scriptId = process.argv[2];
  if (!scriptId) {
    console.error("Usage: node pipeline/build.mjs <scriptId>");
    process.exit(1);
  }

  const scriptPath = path.join(ROOT, "src", "scripts", `${scriptId}.json`);
  const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

  await syncRegistry();

  const outDir = path.join(ROOT, "public", scriptId);
  await fs.mkdir(outDir, { recursive: true });

  console.log(`\nBharat@100 pipeline — building "${script.title}"`);
  console.log(`Voice: ${script.voice} | Scenes: ${script.scenes.length}`);
  if (script.sources?.length) {
    console.log(`Sources:`);
    for (const s of script.sources) console.log(`  - ${s}`);
  }
  console.log("");

  const clipPaths = [];
  const durationsSec = [];

  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    const rawText = scene.narration ?? [scene.text, scene.sub].filter(Boolean).join(". ");
    const text = normalizeForSpeech(rawText);
    const clipPath = path.join(outDir, `clip_${i}.mp3`);
    process.stdout.write(`  [${i + 1}/${script.scenes.length}] narrating: "${text.slice(0, 60)}..." `);
    const dur = await narrate(text, script.voice, clipPath);
    durationsSec.push(dur);
    clipPaths.push(clipPath);
    console.log(`${dur.toFixed(2)}s`);
  }

  // Dedicated outro clip: short spoken CTA, then a silent hold while the
  // subscribe/like/handles card sits on screen.
  const outroText = normalizeForSpeech(
    script.outroNarration ?? script.outroCta ?? "Follow Bharat, at, one hundred."
  );
  const outroClipPath = path.join(outDir, "clip_outro.mp3");
  process.stdout.write(`  [outro] narrating: "${outroText.slice(0, 60)}..." `);
  const outroSpokenDur = await narrate(outroText, script.voice, outroClipPath);
  console.log(`${outroSpokenDur.toFixed(2)}s`);

  // silence clips: inter-scene pause + outro reading hold
  const silencePath = path.join(outDir, "silence.mp3");
  const outroHoldPath = path.join(outDir, "outro_hold.mp3");
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-t", String(SCENE_PAUSE_SEC), "-q:a", "9", silencePath,
  ]);
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-t", String(OUTRO_HOLD_SEC), "-q:a", "9", outroHoldPath,
  ]);

  const concatListPath = path.join(outDir, "concat.txt");
  const concatLines = [];
  for (let i = 0; i < clipPaths.length; i++) {
    concatLines.push(`file '${path.basename(clipPaths[i])}'`);
    concatLines.push(`file 'silence.mp3'`);
  }
  concatLines.push(`file 'clip_outro.mp3'`);
  concatLines.push(`file 'outro_hold.mp3'`);
  await fs.writeFile(concatListPath, concatLines.join("\n"), "utf-8");

  const narrationPath = path.join(outDir, "narration.mp3");
  await execFileAsync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", narrationPath,
  ]);

  // Compute frame timings for each scene
  const timings = [];
  let cursorSec = 0;
  for (let i = 0; i < durationsSec.length; i++) {
    const startFrame = Math.round(cursorSec * FPS);
    const durationInFrames = Math.round((durationsSec[i] + SCENE_PAUSE_SEC) * FPS);
    timings.push({ startFrame, durationInFrames });
    cursorSec += durationsSec[i] + SCENE_PAUSE_SEC;
  }

  const outroStartFrame = Math.round(cursorSec * FPS);
  const outroDurationInFrames = Math.round((outroSpokenDur + OUTRO_HOLD_SEC + TAIL_SEC) * FPS);
  const outroTiming = { startFrame: outroStartFrame, durationInFrames: outroDurationInFrames };
  const totalDurationInFrames = outroStartFrame + outroDurationInFrames;

  const manifest = {
    scriptId,
    audioFile: `${scriptId}/narration.mp3`,
    timings,
    outroTiming,
    totalDurationInFrames,
    fps: FPS,
  };
  await fs.writeFile(path.join(outDir, "timings.json"), JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`\nDone. Total video length: ${(totalDurationInFrames / FPS).toFixed(1)}s`);
  console.log(`Manifest written to public/${scriptId}/timings.json`);
  console.log(`\nNext: npx remotion render Bharat100 out/${scriptId}.mp4 --props='{"scriptId":"${scriptId}"}'\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
