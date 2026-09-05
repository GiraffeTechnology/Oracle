import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { SourceRegistry } from '../src/domain/source-registry.js';

// Ephemeral loopback HTTP only; no database, deployment or publisher exists.
async function requestCommand(error, { enabled = true, authenticated = true } = {}) {
  let calls = 0;
  const server = createApp({
    config: { environment: 'test', externalWritesEnabled: enabled },
    sourceRegistry: new SourceRegistry(),
    authenticateAdmin: async () => (authenticated ? 'synthetic-operator' : null),
    controlPlane: {
      async requestSourceDisable() {
        calls += 1;
        throw error;
      },
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/v1/rwa/admin/sources/disable/request`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'GiraffeOracleAdmin',
          'idempotency-key': 'synthetic-command',
        },
        body: '{}',
      },
    );
    return {
      status: response.status,
      body: await response.json(),
      retryAfter: response.headers.get('retry-after'),
      calls,
    };
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

for (const code of ['REPOSITORY_ADMISSION_CLOSED', 'REPOSITORY_SCOPE_CLOSED']) {
  test(`HTTP ${code} reports unavailable without retrying or promising recovery`, async () => {
    const result = await requestCommand(new Error(code));
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { ok: false, errorCode: code });
    assert.equal(result.calls, 1);
    assert.equal(result.retryAfter, null);
  });
}

for (const [code, status] of [
  ['SOURCE_DISABLE_REASON_HASH_INVALID', 400],
  ['PERMISSION_DENIED:source:disable', 403],
  ['COMMAND_IDEMPOTENCY_CONFLICT', 409],
  ['SYNTHETIC_UNRELATED_REPOSITORY_ERROR', 400],
]) {
  test(`HTTP admission mapping preserves ${code}`, async () => {
    const result = await requestCommand(new Error(code));
    assert.equal(result.status, status);
    assert.equal(result.body.errorCode, code);
    assert.equal(result.calls, 1);
  });
}

test('HTTP unavailable mapping does not open disabled writes or bypass authentication', async () => {
  const disabled = await requestCommand(new Error('REPOSITORY_ADMISSION_CLOSED'), {
    enabled: false,
  });
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.errorCode, 'ADMIN_WRITES_DISABLED');
  assert.equal(disabled.calls, 0);
  const unauthenticated = await requestCommand(new Error('REPOSITORY_ADMISSION_CLOSED'), {
    authenticated: false,
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.calls, 0);
});

test('HTTP unavailable mapping does not expose unsafe dependency error details', async () => {
  const result = await requestCommand(new Error('synthetic-private-detail /internal/path'));
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { ok: false, errorCode: 'ADMIN_OPERATION_FAILED' });
});
