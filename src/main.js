import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { SourceRegistry } from "./domain/source-registry.js";
import { createSyntheticRuntime } from "./oracle-runtime.js";

const config = loadConfig();
if (config.environment === "production") {
  throw new Error("PRODUCTION_BOOTSTRAP_REQUIRED");
}
const runtime = config.environment === "test" ? createSyntheticRuntime() : null;
const sourceRegistry = runtime?.sourceRegistry ?? new SourceRegistry();
const server = createApp({ config, sourceRegistry, runtime });

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

