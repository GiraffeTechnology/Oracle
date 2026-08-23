import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const excludedDirectories = new Set([".git", "node_modules", "coverage", "dist"]);
const forbidden = [
  { name: "private-key-block", pattern: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: "seed-phrase-label", pattern: /(?:mnemonic|seed phrase)\s*[:=]/i },
  { name: "credential-assignment", pattern: /(?:password|secret|access[_-]?key)\s*[:=]\s*["'][^"']+/i },
  { name: "non-loopback-ipv4", pattern: /\b(?!127\.)(?:\d{1,3}\.){3}\d{1,3}\b/ },
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`REPARSE_OR_SYMLINK_REJECTED:${entry.name}`);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...(await walk(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

const findings = [];
for (const file of await walk(root)) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (relative === "scripts/repository-scan.mjs") continue;
  const content = await readFile(file, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) findings.push(`${rule.name}:${relative}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("repository-scan: pass\n");
}
