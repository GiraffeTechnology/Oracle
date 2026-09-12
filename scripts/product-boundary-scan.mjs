import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const roots = ["src", "schemas", "db/mysql"];
const files = ["docs/openapi.yaml", "docs/PRODUCTION_ADAPTER_CONTRACT.md"];
const excluded = new Set(["src/services/product-boundary.js"]);
const prohibited = /\b(?:kyc|aml|sanction|suitability|accredit|jurisdictionEligibility|licenseEligibility|valuation|marketPrice|pricePrediction|collateralRatio|liquidationPrice|creditScore|interestRate|yieldRate|liquidityCurve|investmentAdvice)\b/i;

async function walk(relativeDirectory) {
  const absolute = path.join(root, relativeDirectory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`REPARSE_OR_SYMLINK_REJECTED:${relativeDirectory}/${entry.name}`);
    const relative = `${relativeDirectory}/${entry.name}`.replaceAll("\\", "/");
    if (entry.isDirectory()) result.push(...await walk(relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

for (const directory of roots) files.push(...await walk(directory));
const findings = [];
for (const relative of files) {
  if (excluded.has(relative)) continue;
  const content = await readFile(path.join(root, relative), "utf8");
  if (prohibited.test(content)) findings.push(relative);
}
if (findings.length) {
  process.stderr.write(`product-boundary-scan: prohibited identifier in ${findings.join(", ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("product-boundary-scan: pass\n");
}
