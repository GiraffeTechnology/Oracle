import { readFile } from "node:fs/promises";
import { validateI12Evidence } from "../src/services/i12-evidence.js";
const files = {
  "72h-stability": "evidence/acceptance/i12-72h-stability.json",
  "restore-drill": "evidence/acceptance/i12-restore-drill.json",
  "signer-rotation": "evidence/acceptance/i12-signer-rotation.json",
  "independent-reviews": "evidence/acceptance/i12-independent-reviews.json",
};
for (const [type, file] of Object.entries(files)) validateI12Evidence(type, JSON.parse(await readFile(file, "utf8")));
process.stdout.write("i12-evidence: pass\n");

