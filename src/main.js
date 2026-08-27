import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { SourceRegistry } from "./domain/source-registry.js";
import { assembleIsolatedTestApplication } from "./config/test-assembly.js";
import { bootstrapProductionApplication } from "./config/production-bootstrap.js";

const config = loadConfig();
const assembly = config.environment === "production"
  ? await bootstrapProductionApplication({ config })
  : config.environment === "test" ? assembleIsolatedTestApplication({ config }) : null;
const runtime = assembly?.runtime ?? null;
const sourceRegistry = assembly?.sourceRegistry ?? new SourceRegistry();
const server = createApp({ config, sourceRegistry, runtime, controlPlane: assembly?.controlPlane, adminOperations: assembly?.adminOperations, authenticateAdmin: assembly?.authenticateAdmin, l2Profile: assembly?.l2 ?? null, protocolProfile: assembly?.l3 ?? null });

server.listen(config.port, config.host, () => {
  assembly?.startBackgroundWorkers?.();
  process.stdout.write(
    `${JSON.stringify({
      event: "server.started",
      service: "giraffe-rwa-oracle",
      environment: config.environment,
      externalWritesEnabled: config.externalWritesEnabled,
    })}\n`,
  );
});
