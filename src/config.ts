/**
 * Service configuration.
 *
 * Two constraints are structural rather than configurable:
 *  - ORACLE-001: authoritative sources come from an approved registry. A caller may not pass a
 *    URL, RPC endpoint or database address, so no source endpoint is read from the request.
 *  - README security defaults: the development server binds to localhost and external writes
 *    are disabled in this iteration.
 */

export const SERVICE_NAME = 'giraffe-rwa-oracle';

/** Attestation schema version carried by every future OracleAttestation (ORACLE-003). */
export const SCHEMA_VERSION = 'v1';

/** Loopback-only bind address. Not configurable in this iteration. */
export const BIND_HOST = '127.0.0.1';

export const DEFAULT_PORT = 8787;

/** External writes stay off for the whole iteration; there is no toggle. */
export const EXTERNAL_WRITES_ENABLED = false as const;

/**
 * Approved authority identifiers (ORACLE-001). Identifiers only: no endpoints, credentials or
 * connection strings live in this repository. Adapters bind an identifier to a deployment-time
 * endpoint outside of source control.
 */
export const APPROVED_SOURCE_AUTHORITIES = [
  'ZHONGCHUANG_WENMAO',
  'WENBAO_CHAIN',
  'APPROVED_WAREHOUSE',
] as const;

export type SourceAuthority = (typeof APPROVED_SOURCE_AUTHORITIES)[number];

export function isApprovedSourceAuthority(value: unknown): value is SourceAuthority {
  return (
    typeof value === 'string' && (APPROVED_SOURCE_AUTHORITIES as readonly string[]).includes(value)
  );
}

export type ServerConfig = {
  host: string;
  port: number;
};

export class ConfigError extends Error {}

export function resolvePort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort === '') {
    return DEFAULT_PORT;
  }
  if (!/^\d+$/.test(rawPort)) {
    throw new ConfigError(`ORACLE_PORT must be an integer, received: ${rawPort}`);
  }
  const port = Number(rawPort);
  if (port < 1 || port > 65535) {
    throw new ConfigError(`ORACLE_PORT must be between 1 and 65535, received: ${rawPort}`);
  }
  return port;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return { host: BIND_HOST, port: resolvePort(env['ORACLE_PORT']) };
}
