import { readFile } from "node:fs/promises";
import { createReleaseManifest } from "../src/services/release-manifest.js";
const paths = ["Dockerfile", "README.md", "SECURITY.md", "sbom.cdx.json", "docs/openapi.yaml", "db/mysql/001_initial.sql"];
const files = await Promise.all(paths.map(async (path) => ({ path, bytes: await readFile(path) })));
const manifest = createReleaseManifest(files);
process.stdout.write(`${JSON.stringify(manifest)}\n`);

