import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test(
  'runtime HTTP failure proactively drains actual assembly while keeping child business in flight',
  { timeout: 10000 },
  async (t) => {
    const f = childFixture(t, 'runtime');
    const { port } = await f.next('ready');
    const { response } = request(port, '/readyz');
    await f.next('business-entered');
    f.send({ action: 'server-error' });
    const failed = await f.next('runtime-failed');
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.listening, false);
    assert.equal(failed.repository.state, 'DRAINED');
    f.send({ action: 'snapshot' });
    const pending = await f.next('snapshot');
    assert.equal(pending.value.state, 'BLOCKED');
    assert.equal(pending.value.http.businessInFlight, 1);
    f.send({ action: 'release' });
    await f.next('released');
    await response;
    f.send({ action: 'shutdown', timeoutMs: 2000 });
    assert.equal((await f.next('shutdown')).value.state, 'BLOCKED');
    f.send({ action: 'disconnect' });
    assert.deepEqual(await f.exit, { code: 1, signal: null, stderr: '' });
  },
);

function childFixture(t, scenario) {
  const child = fork(
    fileURLToPath(new URL('./fixtures/application-process.mjs', import.meta.url)),
    [scenario],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true },
  );
  const messages = [],
    waiters = new Set();
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.resume();
  child.on('message', (message) => {
    messages.push(message);
    for (const waiter of waiters) waiter();
  });
  const exit = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal, stderr })),
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }); // failed synthetic test cleanup only
  const next = (type) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(new Error(`CHILD_MESSAGE_TIMEOUT:${type}:${stderr}`));
      }, 7000);
      const check = () => {
        const index = messages.findIndex((message) => message.type === type);
        if (index < 0) return;
        clearTimeout(timer);
        waiters.delete(check);
        resolve(messages.splice(index, 1)[0]);
      };
      waiters.add(check);
      check();
    });
  return { next, exit, send: (message) => child.send(message) };
}
function request(port, pathname, body) {
  let req;
  const response = new Promise((resolve, reject) => {
    req = http.request(
      {
        host: 'localhost',
        port,
        path: pathname,
        agent: false,
        method: body ? 'POST' : 'GET',
        headers: body
          ? {
              'content-type': 'application/json',
              origin: `http://localhost:${port}`,
              'x-requested-with': 'GiraffeOracleAdmin',
              'idempotency-key': 'synthetic-process-command',
            }
          : {},
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  return { req, response };
}

test(
  'synthetic subprocess startup signal uses real main and same assembled drain; no late worker',
  { timeout: 10000 },
  async (t) => {
    const f = childFixture(t, 'startup');
    await f.next('bootstrapping');
    f.send({ action: 'signal', signal: 'SIGTERM' });
    assert.equal((await f.next('signalled')).value.initializing, true);
    f.send({ action: 'release' });
    await f.next('released');
    await f.next('ready');
    f.send({ action: 'shutdown', timeoutMs: 2000 });
    const done = await f.next('shutdown');
    assert.equal(done.value.state, 'DRAINED');
    assert.equal(done.events.includes('worker'), false);
    assert.equal(done.value.http.repositoryState, 'DRAINED');
    assert.equal(done.value.poolCloseAllowed, false);
    f.send({ action: 'disconnect' });
    assert.deepEqual(await f.exit, { code: 0, signal: null, stderr: '' });
  },
);

test(
  'synthetic subprocess disconnect keeps actual readiness business owned until natural completion',
  { timeout: 10000 },
  async (t) => {
    const f = childFixture(t, 'readiness');
    const { port } = await f.next('ready');
    const { req, response } = request(port, '/readyz');
    const disconnected = response.catch(() => null);
    await f.next('business-entered');
    req.destroy();
    await disconnected;
    f.send({ action: 'signal', signal: 'SIGTERM' });
    await f.next('signalled');
    f.send({ action: 'signal', signal: 'SIGINT' });
    await f.next('signalled');
    f.send({ action: 'snapshot' });
    const pending = await f.next('snapshot');
    assert.equal(pending.value.state, 'DRAINING');
    assert.equal(pending.value.http.businessInFlight, 1);
    f.send({ action: 'release' });
    await f.next('released');
    f.send({ action: 'shutdown', timeoutMs: 2000 });
    const done = await f.next('shutdown');
    assert.equal(done.value.state, 'DRAINED');
    assert.equal(done.value.http.businessInFlight, 0);
    assert.equal(done.value.http.repositoryInFlight, 0);
    assert.equal(done.events.filter((e) => e === 'worker').length, 1);
    f.send({ action: 'disconnect' });
    assert.deepEqual(await f.exit, { code: 0, signal: null, stderr: '' });
  },
);

test(
  'synthetic subprocess UNKNOWN commit stays BLOCKED, no retry or forced success exit',
  { timeout: 10000 },
  async (t) => {
    const f = childFixture(t, 'unknown');
    const { port } = await f.next('ready');
    const denied = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: 'localhost',
          port,
          path: '/v1/rwa/admin/sources/disable/request',
          method: 'POST',
          agent: false,
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(denied, 400); // existing missing-CSRF-header contract, ahead of any command
    f.send({ action: 'snapshot' });
    assert.equal((await f.next('snapshot')).events.includes('authenticate'), false);
    const { response } = request(port, '/v1/rwa/admin/sources/disable/request', {
      actionId: 'synthetic-action',
      sourceId: 'authoritative-registry',
      reasonHash: 'a'.repeat(64),
    });
    await f.next('commit-entered');
    f.send({ action: 'signal', signal: 'SIGTERM' });
    await f.next('signalled');
    f.send({ action: 'release' });
    await f.next('released');
    assert.notEqual((await response).status, 200);
    f.send({ action: 'shutdown', timeoutMs: 2000 });
    const done = await f.next('shutdown');
    assert.equal(done.value.state, 'BLOCKED');
    assert.equal(done.value.http.repositoryState, 'BLOCKED');
    assert.equal(done.events.filter((e) => e === 'commit').length, 1);
    assert.equal(done.events.filter((e) => e === 'acquire').length, 1);
    assert.equal(done.value.poolCloseAllowed, false);
    assert.equal(done.value.writeResumptionAllowed, false);
    f.send({ action: 'disconnect' });
    assert.deepEqual(await f.exit, { code: 1, signal: null, stderr: '' });
  },
);
