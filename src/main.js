import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { SourceRegistry } from "./domain/source-registry.js";
import { assembleIsolatedTestApplication } from "./config/test-assembly.js";

const config = loadConfig();
if (config.environment === "production") {
  throw new Error("PRODUCTION_BOOTSTRAP_REQUIRED");
}
const testAssembly = config.environment === "test" ? assembleIsolatedTestApplication({ config }) : null;
const runtime = testAssembly?.runtime ?? null;
const sourceRegistry = testAssembly?.sourceRegistry ?? new SourceRegistry();
const server = createApp({ config, sourceRegistry, runtime, controlPlane: testAssembly?.controlPlane, adminOperations: testAssembly?.adminOperations, authenticateAdmin: testAssembly?.authenticateAdmin });

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({
      event: "server.started",
      service: "giraffe-rwa-oracle",
      environment: config.environment,
      externalWritesEnabled: config.externalWritesEnabled,
    })}\n`,
  );
});
