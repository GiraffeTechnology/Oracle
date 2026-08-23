import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  APPROVED_SOURCE_AUTHORITIES,
  BIND_HOST,
  ConfigError,
  DEFAULT_PORT,
  EXTERNAL_WRITES_ENABLED,
  isApprovedSourceAuthority,
  loadServerConfig,
  resolvePort,
} from './config.ts';

describe('server configuration', () => {
  it('binds to loopback only', () => {
    assert.equal(BIND_HOST, '127.0.0.1');
    assert.equal(loadServerConfig({}).host, '127.0.0.1');
  });

  it('keeps external writes disabled', () => {
    assert.equal(EXTERNAL_WRITES_ENABLED, false);
  });

  it('defaults the port and accepts a valid override', () => {
    assert.equal(loadServerConfig({}).port, DEFAULT_PORT);
    assert.equal(resolvePort(undefined), DEFAULT_PORT);
    assert.equal(resolvePort(''), DEFAULT_PORT);
    assert.equal(resolvePort('9000'), 9000);
  });

  it('rejects a malformed or out-of-range port', () => {
    for (const value of ['0', '65536', '-1', '80.5', 'eight', '8080 ']) {
      assert.throws(() => resolvePort(value), ConfigError, `expected ${value} to be rejected`);
    }
  });
});

describe('approved source registry (ORACLE-001)', () => {
  it('accepts only approved authority identifiers', () => {
    for (const authority of APPROVED_SOURCE_AUTHORITIES) {
      assert.equal(isApprovedSourceAuthority(authority), true);
    }
    for (const value of [
      'https://example.invalid/registry',
      'UNKNOWN_AUTHORITY',
      '',
      null,
      undefined,
    ]) {
      assert.equal(isApprovedSourceAuthority(value), false);
    }
  });

  it('stores identifiers only, never endpoints or credentials', () => {
    for (const authority of APPROVED_SOURCE_AUTHORITIES) {
      assert.match(authority, /^[A-Z][A-Z_]*$/);
    }
  });
});
