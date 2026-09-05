// Keeps src/Composition.tsx's static script registry in sync with
// src/scripts/*.json, so adding a new daily script never requires a
// hand-edit to the composition file.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRIPTS_DIR = path.join(ROOT, "src", "scripts");
const COMPOSITION_PATH = path.join(ROOT, "src", "Composition.tsx");

export async function syncRegistry() {
  const files = (await fs.readdir(SCRIPTS_DIR)).filter((f) => f.endsWith(".json"));
  const ids = files.map((f) => f.replace(/\.json$/, "")).sort();

  const imports = ids.map((id) => `import ${id} from "./scripts/${id}.json";`).join("\n");
  const registryEntries = ids.map((id) => `  ${id}: ${id} as VideoScript,`).join("\n");

  let content = await fs.readFile(COMPOSITION_PATH, "utf-8");

  content = content.replace(
    /import semiconductors from[\s\S]*?(?=\n\nconst scriptRegistry)/,
    `${imports}\n`
  );
  content = content.replace(
    /const scriptRegistry: Record<string, VideoScript> = \{[\s\S]*?\};/,
    `const scriptRegistry: Record<string, VideoScript> = {\n${registryEntries}\n};`
  );

  await fs.writeFile(COMPOSITION_PATH, content, "utf-8");
  return ids;
}

const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  syncRegistry().then((ids) => {
    console.log(`Registry synced: ${ids.join(", ")}`);
  });
}
