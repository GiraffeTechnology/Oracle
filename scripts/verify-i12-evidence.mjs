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
const records = [];
for (const [type, file] of Object.entries(files)) {
  const record = JSON.parse(await readFile(file, "utf8"));
  validateI12Evidence(type, record);
  records.push(record);
}
if (new Set(records.map((record) => record.candidateCommit)).size !== 1) throw new Error("I12_CANDIDATE_COMMIT_MISMATCH");
process.stdout.write("i12-evidence: pass\n");
