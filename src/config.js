const ALLOWED_ENVIRONMENTS = new Set(["development", "test", "production"]);

function parsePort(raw) {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("CONFIG_INVALID_PORT");
  }
  return port;
}

function parseExternalWrites(raw, runtimeEnvironment, acknowledgement) {
  if (raw === "false") return false;
  if (raw === "true" && runtimeEnvironment === "test" && acknowledgement === "synthetic-only") return true;
  if (raw === "true" && runtimeEnvironment === "production" && acknowledgement === "authenticated-control-plane") return true;
  if (raw === "true") throw new Error("EXTERNAL_WRITES_NOT_AUTHORIZED");
  throw new Error("CONFIG_INVALID_BOOLEAN");
}

export function loadConfig(env = process.env) {
  const runtimeEnvironment = env.GIRAFFE_ORACLE_ENV ?? "development";
  if (!ALLOWED_ENVIRONMENTS.has(runtimeEnvironment)) {
    throw new Error("CONFIG_ENVIRONMENT_INVALID");
  }
  if (runtimeEnvironment === "production" && env.GIRAFFE_ORACLE_PRODUCTION_ACK !== "l2-l3-profile-locked") {
    throw new Error("PRODUCTION_MODE_NOT_AUTHORIZED");
  }

  const host = env.GIRAFFE_ORACLE_HOST ?? "localhost";
  if (host !== "localhost") {
    throw new Error("NON_LOOPBACK_BIND_NOT_AUTHORIZED");
  }

  const lifecycle = env.GIRAFFE_ORACLE_PROCESS_LIFECYCLE ?? "false";
  const projectionValues = [env.GIRAFFE_ORACLE_KIT_ROOT, env.GIRAFFE_ORACLE_KIT_BASE_URL, env.GIRAFFE_ORACLE_KIT_PROFILE_ID,
    env.GIRAFFE_ORACLE_KIT_REGISTER_ID, env.GIRAFFE_ORACLE_KIT_VERIFICATION_PROFILE];
  const projectionEnabled = projectionValues.some((value) => value !== undefined) || env.GIRAFFE_ORACLE_KIT_API_KEY !== undefined;
  if (projectionEnabled && !projectionValues.every((value) => typeof value === "string" && value.length > 0))
    throw new Error("PROJECTION_CONFIG_INCOMPLETE");
  if (!["false", "true"].includes(lifecycle)) throw new Error("CONFIG_PROCESS_LIFECYCLE_INVALID");
  if (lifecycle === "true" && runtimeEnvironment !== "production") throw new Error("PROCESS_LIFECYCLE_REQUIRES_PRODUCTION");
  const shutdownTimeout = env.GIRAFFE_ORACLE_SHUTDOWN_TIMEOUT_MS ?? "30000";
  if (env.GIRAFFE_ORACLE_SHUTDOWN_TIMEOUT_MS !== undefined && lifecycle !== "true") throw new Error("SHUTDOWN_TIMEOUT_REQUIRES_LIFECYCLE");
  if (lifecycle === "true" && (!/^[1-9][0-9]*$/.test(shutdownTimeout) || !Number.isSafeInteger(Number(shutdownTimeout)) || Number(shutdownTimeout) > 2147483647)) throw new Error("CONFIG_SHUTDOWN_TIMEOUT_INVALID");

  return Object.freeze({
    environment: runtimeEnvironment,
    host,
    port: parsePort(env.GIRAFFE_ORACLE_PORT ?? "8780"),
    ...(projectionEnabled ? { kitProjection: Object.freeze({
      kitRoot: env.GIRAFFE_ORACLE_KIT_ROOT,
      baseUrl: env.GIRAFFE_ORACLE_KIT_BASE_URL,
      profileId: env.GIRAFFE_ORACLE_KIT_PROFILE_ID,
      registerId: env.GIRAFFE_ORACLE_KIT_REGISTER_ID,
      verificationProfile: env.GIRAFFE_ORACLE_KIT_VERIFICATION_PROFILE,
      apiKey: env.GIRAFFE_ORACLE_KIT_API_KEY,
    }) } : {}),
    ...(lifecycle === "true" ? { processLifecycleEnabled: true, shutdownTimeoutMs: Number(shutdownTimeout) } : {}),
    externalWritesEnabled: parseExternalWrites(
      env.GIRAFFE_ORACLE_EXTERNAL_WRITES ?? "false",
      runtimeEnvironment,
      runtimeEnvironment === "production" ? env.GIRAFFE_ORACLE_PRODUCTION_WRITE_ACK : env.GIRAFFE_ORACLE_TEST_WRITE_ACK,
    ),
    ...(runtimeEnvironment === "production" ? {
      l2ProfileRef: env.GIRAFFE_ORACLE_L2_PROFILE_REF ?? "config/l2.production.json",
      l3ProfileRef: env.GIRAFFE_ORACLE_L3_PROFILE_REF ?? "config/l3.protocol.wd-0.1.1.json",
    } : {}),
  });
}
