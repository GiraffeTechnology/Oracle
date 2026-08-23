const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);

function parsePort(raw) {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("CONFIG_INVALID_PORT");
  }
  return port;
}

function parseDisabledBoolean(raw) {
  if (raw === "false") return false;
  if (raw === "true") throw new Error("EXTERNAL_WRITES_NOT_IMPLEMENTED");
  throw new Error("CONFIG_INVALID_BOOLEAN");
}

export function loadConfig(env = process.env) {
  const runtimeEnvironment = env.GIRAFFE_ORACLE_ENV ?? "development";
  if (!ALLOWED_ENVIRONMENTS.has(runtimeEnvironment)) {
    throw new Error("PRODUCTION_MODE_NOT_AUTHORIZED");
  }

  const host = env.GIRAFFE_ORACLE_HOST ?? "localhost";
  if (host !== "localhost") {
    throw new Error("NON_LOOPBACK_BIND_NOT_AUTHORIZED");
  }

  return Object.freeze({
    environment: runtimeEnvironment,
    host,
    port: parsePort(env.GIRAFFE_ORACLE_PORT ?? "8780"),
    externalWritesEnabled: parseDisabledBoolean(
      env.GIRAFFE_ORACLE_EXTERNAL_WRITES ?? "false",
    ),
  });
}

