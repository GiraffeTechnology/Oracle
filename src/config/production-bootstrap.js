import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadL2DeploymentProfile } from "./deployment-profile.js";
import { loadProtocolProfile } from "../protocol/protocol-profile.js";
import { assembleProductionApplication } from "./production-assembly.js";

const SHA256 = /^[a-f0-9]{64}$/i;

export async function loadPinnedDeploymentModule({ modulePath, expectedSha256 }) {
  if (!path.isAbsolute(modulePath ?? "") || !SHA256.test(expectedSha256 ?? "")) throw new Error("PRODUCTION_DEPLOYMENT_MODULE_PIN_REQUIRED");
  const metadata = await lstat(modulePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("PRODUCTION_DEPLOYMENT_MODULE_FILE_INVALID");
  const resolved = await realpath(modulePath);
  const bytes = await readFile(resolved);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256.toLowerCase()) throw new Error("PRODUCTION_DEPLOYMENT_MODULE_HASH_MISMATCH");
  const deployment = await import(`${pathToFileURL(resolved).href}?sha256=${actual}`);
  if (typeof deployment.createDeploymentResolver !== "function" || !deployment.settlementConfiguration) throw new Error("PRODUCTION_DEPLOYMENT_MODULE_CONTRACT_INVALID");
  return Object.freeze({ resolver: await deployment.createDeploymentResolver(), settlementConfiguration: deployment.settlementConfiguration, moduleSha256: actual });
}

export async function bootstrapProductionApplication({ config, env = process.env, clock = () => new Date() }) {
  const deployment = await loadPinnedDeploymentModule({ modulePath: env.GIRAFFE_ORACLE_DEPLOYMENT_MODULE, expectedSha256: env.GIRAFFE_ORACLE_DEPLOYMENT_MODULE_SHA256 });
  const [l2Profile, l3Profile] = await Promise.all([loadL2DeploymentProfile(config.l2ProfileRef), loadProtocolProfile(config.l3ProfileRef)]);
  return assembleProductionApplication({ config, l2Profile, l3Profile, resolver: deployment.resolver, settlementConfiguration: deployment.settlementConfiguration, clock });
}
