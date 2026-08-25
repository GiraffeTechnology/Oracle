import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hardhatPackage = require.resolve("hardhat/package.json");
const hardhatCli = path.join(path.dirname(hardhatPackage), "internal", "cli", "cli.js");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = {
  ...process.env,
  APPDATA: path.join(repositoryRoot, ".hardhat-appdata"),
  LOCALAPPDATA: path.join(repositoryRoot, ".hardhat-localappdata")
};

const result = spawnSync(process.execPath, [hardhatCli, "test", "--no-compile"], {
  cwd: repositoryRoot,
  env,
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
