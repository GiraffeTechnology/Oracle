import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { BIND_HOST } from './config.ts';
import { ORACLE_STATUSES } from './oracle-status.ts';
import { createServer, parsePathname, route } from './server.ts';

describe('router', () => {
  it('answers the three exposed routes', () => {
    assert.equal(route('GET', '/healthz').statusCode, 200);
    assert.equal(route('GET', '/readyz').statusCode, 200);
    assert.equal(route('GET', '/v1/oracle/statuses').statusCode, 200);
  });

  it('returns 404 for anything else', () => {
    for (const path of ['/', '/v1/oracle', '/v1/rwa/assets/asset-1', '/../healthz']) {
      assert.equal(route('GET', path).statusCode, 404, `${path} must not be routed`);
    }
  });

  it('rejects write methods on every route', () => {
    for (const path of ['/healthz', '/readyz', '/v1/oracle/statuses']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = route(method, path);
        assert.equal(response.statusCode, 405, `${method} ${path} must be rejected`);
        assert.equal(response.headers?.['allow'], 'GET, HEAD');
      }
    }
  });

  it('ignores a trailing slash but not a different path', () => {
    assert.equal(route('GET', '/healthz/').statusCode, 200);
    assert.equal(route('GET', '/healthzz').statusCode, 404);
  });

  it('never lets a query string select a route', () => {
    assert.equal(
      parsePathname('/v1/oracle/statuses?source=https://example.invalid'),
      '/v1/oracle/statuses',
    );
    assert.equal(parsePathname(undefined), '/');
    assert.equal(parsePathname('not a url'), '/not%20a%20url');
  });
});

describe('http surface', () => {
  const server = createServer();
  let baseUrl = '';

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, BIND_HOST, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://${BIND_HOST}:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('serves healthz as json with no-store headers', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(await response.json(), {
      status: 'ok',
      service: 'giraffe-rwa-oracle',
      schemaVersion: 'v1',
    });
  });

  it('reports readiness with the security checks that must hold', async () => {
    const response = await fetch(`${baseUrl}/readyz`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      status: string;
      checks: { name: string; ok: boolean }[];
    };
    assert.equal(body.status, 'ready');
    assert.deepEqual(body.checks.map((check) => check.name).sort(), [
      'approved_source_registry_loaded',
      'caller_supplied_sources_rejected',
      'external_writes_disabled',
    ]);
    assert.equal(
      body.checks.every((check) => check.ok),
      true,
    );
  });

  it('serves the closed status vocabulary', async () => {
    const response = await fetch(`${baseUrl}/v1/oracle/statuses`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      schemaVersion: string;
      statuses: { status: string; blocksTransfer: boolean }[];
    };
    assert.equal(body.schemaVersion, 'v1');
    assert.deepEqual(
      body.statuses.map((entry) => entry.status),
      [...ORACLE_STATUSES],
    );
    assert.deepEqual(
      body.statuses.filter((entry) => !entry.blocksTransfer).map((entry) => entry.status),
      ['VALID'],
    );
  });

  it('exposes no write endpoint', async () => {
    const response = await fetch(`${baseUrl}/v1/oracle/statuses`, {
      method: 'POST',
      body: JSON.stringify({ source: 'https://example.invalid' }),
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  });

  it('returns 404 for an unknown path', async () => {
    const response = await fetch(`${baseUrl}/v1/rwa/attestations/does-not-exist`);
    assert.equal(response.status, 404);
  });
});
