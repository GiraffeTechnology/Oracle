import { readFile } from "node:fs/promises";
import { validateI12Evidence } from "../src/services/i12-evidence.js";
const files = {
  "security-scans": "evidence/acceptance/i12-security-scans.json",
  "performance-capacity": "evidence/acceptance/i12-performance-capacity.json",
  "72h-stability": "evidence/acceptance/i12-72h-stability.json",
  "restore-drill": "evidence/acceptance/i12-restore-drill.json",
  "signer-rotation": "evidence/acceptance/i12-signer-rotation.json",
  "data-protection-response": "evidence/acceptance/i12-data-protection-response.json",
  "reproducible-build": "evidence/acceptance/i12-reproducible-build.json",
  "independent-reviews": "evidence/acceptance/i12-independent-reviews.json",
};
for (const [type, file] of Object.entries(files)) validateI12Evidence(type, JSON.parse(await readFile(file, "utf8")));
process.stdout.write("i12-evidence: pass\n");
