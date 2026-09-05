import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createHttpShutdownCoordinator } from '../src/services/http-shutdown-coordinator.js';
import { createRepositoryExecutionScope } from '../src/services/repository-execution-scope.js';
import { MySqlOracleRepository } from '../src/adapters/mysql-repository.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(t, handler) {
  const scope = createRepositoryExecutionScope({
    repository: new MySqlOracleRepository({
      pool: {
        execute() {
          assert.fail('no database call');
        },
        getConnection() {
          assert.fail('no database call');
        },
      },
    }),
    isCompromised: () => false,
  });
  const lifecycle = {
    quiesce: (options) => scope.drain(options),
    snapshot: () => scope.snapshot(),
  };
  const coordinator = createHttpShutdownCoordinator({
    requestHandler: handler,
    repositoryLifecycle: lifecycle,
  });
  const server = coordinator.server;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  });
  return { coordinator, server, scope, lifecycle, port };
}

function request(port, { agent, path = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, agent }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

test('shutdown rejects invalid deadlines without closing admission', async (t) => {
  const f = await fixture(t, (_req, res) => res.end('ok'));
  for (const timeoutMs of [undefined, 0, -1, 1.5, Infinity, 2147483648]) {
    await assert.rejects(f.coordinator.shutdown({ timeoutMs }), /HTTP_SHUTDOWN_TIMEOUT_INVALID/);
    assert.equal(f.coordinator.snapshot().state, 'ACCEPTING');
  }
  assert.equal((await request(f.port)).status, 200);
  assert.equal((await f.coordinator.shutdown({ timeoutMs: 1000 })).state, 'DRAINED');
});

test('response finish and server close do not hide pending business or repository work', async (t) => {
  const hold = deferred();
  let f;
  f = await fixture(t, async (_req, res) => {
    return f.scope.run(async () => {
      res.end('early');
      await hold.promise;
    });
  });
  assert.equal((await request(f.port)).body, 'early');
  const drain = f.coordinator.shutdown({ timeoutMs: 1000 });
  let done = false;
  void drain.then(() => {
    done = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  assert.equal(f.coordinator.snapshot().businessInFlight, 1);
  assert.equal(f.coordinator.snapshot().repositoryInFlight, 1);
  hold.resolve();
  const result = await drain;
  assert.equal(result.state, 'DRAINED');
  assert.equal(result.poolCloseAllowed, false);
  assert.equal(result.writeResumptionAllowed, false);
});

test('client disconnect does not cancel or forget asynchronous business', async (t) => {
  const entered = deferred(),
    hold = deferred();
  const f = await fixture(t, async () => {
    entered.resolve();
    await hold.promise;
  });
  const req = http.get({ host: '127.0.0.1', port: f.port });
  req.on('error', () => {});
  await entered.promise;
  req.destroy();
  const result = await f.coordinator.shutdown({ timeoutMs: 10 });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.businessInFlight, 1);
  hold.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.coordinator.snapshot().businessInFlight, 0);
  assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
});

test('accepted detached children remain counted and escaped tracker is revoked', async (t) => {
  const hold = deferred();
  let escaped;
  const f = await fixture(t, (_req, res, { track }) => {
    escaped = track;
    void track(() => hold.promise);
    res.end('early');
  });
  await request(f.port);
  assert.throws(
    () => escaped(() => assert.fail('escaped child dispatched')),
    /HTTP_REQUEST_SCOPE_CLOSED/,
  );
  const result = await f.coordinator.shutdown({ timeoutMs: 10 });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.businessInFlight, 1);
  assert.equal(result.childOperationsInFlight, 1);
  hold.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.coordinator.snapshot().childOperationsInFlight, 0);
  assert.equal(f.coordinator.snapshot().businessInFlight, 0);
});

test('concurrent shutdown calls close once and the shortest deadline is sticky', async (t) => {
  const entered = deferred(),
    hold = deferred();
  const f = await fixture(t, async (_req, res) => {
    entered.resolve();
    await hold.promise;
    res.end('late');
  });
  const response = request(f.port);
  await entered.promise;
  const close = f.server.close.bind(f.server);
  let closes = 0;
  f.server.close = (...args) => {
    closes += 1;
    return close(...args);
  };
  const long = f.coordinator.shutdown({ timeoutMs: 1000 });
  const short = f.coordinator.shutdown({ timeoutMs: 10 });
  assert.equal((await short).state, 'BLOCKED');
  assert.equal((await long).state, 'BLOCKED');
  assert.equal(closes, 1);
  hold.resolve();
  await response;
  assert.equal((await f.coordinator.shutdown({ timeoutMs: 1000 })).state, 'BLOCKED');
  assert.equal(closes, 1);
});

test('new connections stop and keep-alive requests cannot dispatch new business', async (t) => {
  const hold = deferred(),
    entered = deferred();
  let calls = 0;
  const f = await fixture(t, async (_req, res) => {
    calls += 1;
    entered.resolve();
    await hold.promise;
    res.end('done');
  });
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  const first = request(f.port, { agent });
  await entered.promise;
  const second = request(f.port, { agent }).catch(() => ({ status: 'closed' }));
  const drain = f.coordinator.shutdown({ timeoutMs: 1000 });
  const third = request(f.port).catch(() => ({ status: 'closed' }));
  hold.resolve();
  await first;
  assert.ok([503, 'closed'].includes((await second).status));
  assert.ok([503, 'closed'].includes((await third).status));
  assert.equal(calls, 1);
  assert.equal((await drain).state, 'DRAINED');
});

test('handler rejection closes admission without leaking its error or claiming recovery', async (t) => {
  const f = await fixture(t, async () => {
    throw new Error('synthetic sensitive dependency detail');
  });
  const response = await request(f.port);
  assert.equal(response.status, 500);
  assert.equal(response.body.includes('sensitive'), false);
  const result = await f.coordinator.shutdown({ timeoutMs: 1000 });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.blockers.includes('HTTP_HANDLER_FAILED'), true);
  assert.equal(result.poolCloseAllowed, false);
});

test('repository failure and asynchronous close failure never report clean shutdown', async (t) => {
  const f = await fixture(t, (_req, res) => res.end());
  await assert.rejects(
    f.scope.run(() => {
      throw new Error('synthetic failure');
    }),
  );
  const close = f.server.close.bind(f.server);
  f.server.close = (callback) => close(() => callback(new Error('synthetic close detail')));
  const result = await f.coordinator.shutdown({ timeoutMs: 1000 });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.poolCloseAllowed, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
});

test('handler completion is insufficient while the HTTP response remains open', async (t) => {
  const entered = deferred();
  let response;
  const f = await fixture(t, (_req, res) => {
    response = res;
    entered.resolve();
  });
  const received = request(f.port);
  await entered.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.coordinator.snapshot().businessInFlight, 0);
  assert.equal(f.coordinator.snapshot().httpInFlight, 1);
  const drain = f.coordinator.shutdown({ timeoutMs: 1000 });
  assert.equal(f.coordinator.snapshot().state, 'DRAINING');
  response.end('done');
  await received;
  const final = await drain;
  assert.equal(final.state, 'DRAINED', JSON.stringify(final));
});

test('swallowed child rejection is owned and cannot produce clean shutdown', async (t) => {
  const f = await fixture(t, async (_req, res, { track }) => {
    await track(() => Promise.reject(new Error('synthetic sensitive detail'))).catch(() => {});
    res.end('handled');
  });
  await request(f.port);
  const result = await f.coordinator.shutdown({ timeoutMs: 1000 });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.blockers.includes('HTTP_CHILD_FAILED'), true);
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});

test('blocked active handler cannot dispatch a new tracked child', async (t) => {
  const entered = deferred(),
    hold = deferred();
  let dispatched = false;
  const f = await fixture(t, async (_req, res, { track }) => {
    entered.resolve();
    await hold.promise;
    assert.throws(
      () =>
        track(() => {
          dispatched = true;
        }),
      /HTTP_ADMISSION_CLOSED/,
    );
    res.end('blocked');
  });
  const received = request(f.port);
  await entered.promise;
  assert.equal((await f.coordinator.shutdown({ timeoutMs: 10 })).state, 'BLOCKED');
  hold.resolve();
  await received;
  assert.equal(dispatched, false);
});

test('synchronous cleanup failures remain blocked and are never retried', async (t) => {
  const f = await fixture(t, (_req, res) => res.end());
  const close = f.server.close;
  let closes = 0,
    quiesces = 0;
  f.server.close = () => {
    closes += 1;
    throw new Error('synthetic private close failure');
  };
  f.lifecycle.quiesce = () => {
    quiesces += 1;
    throw new Error('synthetic private quiesce failure');
  };
  try {
    assert.equal((await f.coordinator.shutdown({ timeoutMs: 1000 })).state, 'BLOCKED');
    await new Promise((resolve) => setImmediate(resolve));
    const result = await f.coordinator.shutdown({ timeoutMs: 1 });
    assert.equal(result.state, 'BLOCKED');
    assert.equal(closes, 1);
    assert.equal(quiesces, 1);
    assert.equal(JSON.stringify(result).includes('private'), false);
  } finally {
    f.server.close = close;
  }
});

test('missing or malformed lifecycle facts cannot authorize a clean shutdown', async (t) => {
  assert.throws(() => createHttpShutdownCoordinator(), /HTTP_SHUTDOWN_DEPENDENCY_INVALID/);
  const f = await fixture(t, (_req, res) => res.end());
  f.lifecycle.snapshot = () => ({ state: 'DRAINED', inFlight: 0, poolCloseAllowed: true });
  assert.equal((await f.coordinator.shutdown({ timeoutMs: 1000 })).state, 'BLOCKED');
  assert.equal(f.coordinator.snapshot().poolCloseAllowed, false);
});

test('idle-connection cleanup failure is observed before any clean completion', async (t) => {
  const entered = deferred(),
    hold = deferred();
  const f = await fixture(t, async (_req, res) => {
    entered.resolve();
    await hold.promise;
    res.end('done');
  });
  const received = request(f.port);
  await entered.promise;
  const drain = f.coordinator.shutdown({ timeoutMs: 1000 });
  const idleClose = f.server.closeIdleConnections;
  f.server.closeIdleConnections = () => {
    throw new Error('synthetic idle cleanup failure');
  };
  try {
    hold.resolve();
    await received;
    const result = await drain;
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.blockers.includes('HTTP_IDLE_CLOSE_FAILED'), true);
    assert.equal(result.idleCleanupInFlight, 0);
  } finally {
    f.server.closeIdleConnections = idleClose;
  }
});

test('a shorter shutdown deadline also blocks the actual repository scope', async (t) => {
  const entered = deferred(),
    hold = deferred();
  let f;
  f = await fixture(t, async (_req, res) => {
    await f.scope.run(async () => {
      entered.resolve();
      await hold.promise;
    });
    res.end('done');
  });
  const received = request(f.port);
  await entered.promise;
  const long = f.coordinator.shutdown({ timeoutMs: 1000 });
  const short = f.coordinator.shutdown({ timeoutMs: 10 });
  assert.equal((await short).state, 'BLOCKED');
  assert.equal((await long).state, 'BLOCKED');
  assert.equal((await f.scope.drain({ timeoutMs: 100 })).state, 'BLOCKED');
  assert.equal(f.scope.snapshot().inFlight, 1);
  hold.resolve();
  await received;
  assert.equal(f.coordinator.snapshot().state, 'BLOCKED');
});
