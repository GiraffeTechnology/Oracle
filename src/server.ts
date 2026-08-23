import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import {
  APPROVED_SOURCE_AUTHORITIES,
  EXTERNAL_WRITES_ENABLED,
  SCHEMA_VERSION,
  SERVICE_NAME,
} from './config.ts';
import { listOracleStatuses } from './oracle-status.ts';

export type RouteResponse = {
  statusCode: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** Read-only surface for this iteration; every route is a GET (README security defaults). */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);

const ROUTES = new Set(['/healthz', '/readyz', '/v1/oracle/statuses']);

function healthz(): RouteResponse {
  return {
    statusCode: 200,
    body: { status: 'ok', service: SERVICE_NAME, schemaVersion: SCHEMA_VERSION },
  };
}

function readyz(): RouteResponse {
  const checks = [
    {
      name: 'approved_source_registry_loaded',
      ok: APPROVED_SOURCE_AUTHORITIES.length > 0,
      detail: `${APPROVED_SOURCE_AUTHORITIES.length} approved authority identifiers`,
    },
    {
      name: 'external_writes_disabled',
      ok: EXTERNAL_WRITES_ENABLED === false,
      detail: 'no write path is exposed in this iteration',
    },
    {
      name: 'caller_supplied_sources_rejected',
      ok: true,
      detail: 'no source endpoint is read from the request',
    },
  ];
  const ready = checks.every((check) => check.ok);
  return { statusCode: ready ? 200 : 503, body: { status: ready ? 'ready' : 'not_ready', checks } };
}

function oracleStatuses(): RouteResponse {
  return {
    statusCode: 200,
    body: { schemaVersion: SCHEMA_VERSION, statuses: listOracleStatuses() },
  };
}

/**
 * Pure router. `pathname` must already be separated from the query string so a query string
 * can never select a route.
 */
export function route(method: string | undefined, pathname: string): RouteResponse {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (!ROUTES.has(normalized)) {
    return { statusCode: 404, body: { error: 'not_found', path: normalized } };
  }

  if (method === undefined || !READ_ONLY_METHODS.has(method)) {
    return {
      statusCode: 405,
      body: { error: 'method_not_allowed', allowed: ['GET', 'HEAD'] },
      headers: { allow: 'GET, HEAD' },
    };
  }

  switch (normalized) {
    case '/healthz':
      return healthz();
    case '/readyz':
      return readyz();
    case '/v1/oracle/statuses':
      return oracleStatuses();
    default:
      return { statusCode: 404, body: { error: 'not_found', path: normalized } };
  }
}

export function parsePathname(rawUrl: string | undefined): string {
  if (rawUrl === undefined || rawUrl === '') {
    return '/';
  }
  try {
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

export function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  const { statusCode, body, headers } = route(request.method, parsePathname(request.url));
  const payload = `${JSON.stringify(body)}\n`;

  response.writeHead(statusCode, {
    ...BASE_HEADERS,
    ...headers,
    'content-length': Buffer.byteLength(payload),
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  response.end(payload);
}

export function createServer(): Server {
  return createHttpServer(handleRequest);
}
