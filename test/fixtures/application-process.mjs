// Owned synthetic child process. IPC emits the JS signal handler cross-platform;
// this is not proof of OS/service-manager signal handling on the target Linux host.
import http from 'node:http';
import { once } from 'node:events';
import { startApplication } from '../../src/main.js';
import { assembleProductionApplication } from '../../src/config/production-assembly.js';
import { loadL2DeploymentProfile } from '../../src/config/deployment-profile.js';
import { loadProtocolProfile } from '../../src/protocol/protocol-profile.js';
import { createDeploymentResolver, settlementConfiguration } from './application-deployment.mjs';

const scenario = process.argv[2];
const events = [];
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
const send = (message) => process.send?.(message);
const reservation = http.createServer();
reservation.listen(0, 'localhost');
await once(reservation, 'listening');
const port = reservation.address().port;
reservation.close();
await once(reservation, 'close');
const config = {
  environment: 'production',
  host: 'localhost',
  port,
  externalWritesEnabled: true,
  processLifecycleEnabled: true,
  shutdownTimeoutMs: 2000,
};
let assembly;
const app = startApplication({
  config,
  report: (event) => send({ type: 'report', value: event }),
  bootstrapProduction: async ({ config: provided }) => {
    if (scenario === 'startup') {
      send({ type: 'bootstrapping' });
      await gate;
    }
    const l2Profile = structuredClone(await loadL2DeploymentProfile('config/l2.production.json'));
    l2Profile.service.port = port; // synthetic loopback only, no deployment file mutation
    assembly = await assembleProductionApplication({
      config: provided,
      l2Profile,
      l3Profile: await loadProtocolProfile('config/l3.protocol.wd-0.1.1.json'),
      settlementConfiguration,
      repositoryDrainEnabled: true,
      resolver: createDeploymentResolver({
        events,
        readiness: async () => {
          send({ type: 'business-entered' });
          await gate;
          return { ok: true };
        },
        commit:
          scenario === 'unknown'
            ? async () => {
                send({ type: 'commit-entered' });
                await gate;
                throw new Error('synthetic-lost-ack');
              }
            : undefined,
      }),
    });
    const start = assembly.startBackgroundWorkers;
    return {
      ...assembly,
      startBackgroundWorkers() {
        events.push('worker');
        return start();
      },
    };
  },
});
process.on('message', (message) => {
  if (message.action === 'server-error') {
    app.server.emit('error', new Error('synthetic-runtime-error'));
    setImmediate(() =>
      send({
        type: 'runtime-failed',
        exitCode: process.exitCode,
        listening: app.server.listening,
        repository: assembly.repositoryLifecycle.snapshot(),
        events,
      }),
    );
    // No app.snapshot() call: failure handling must be proactive.
  }
  if (message.action === 'signal') {
    process.emit(message.signal);
    send({ type: 'signalled', value: app.snapshot() });
  }
  if (message.action === 'release') {
    release();
    send({ type: 'released' });
  }
  if (message.action === 'snapshot') send({ type: 'snapshot', value: app.snapshot(), events });
  if (message.action === 'shutdown')
    void app
      .shutdown({ timeoutMs: message.timeoutMs })
      .then((value) => send({ type: 'shutdown', value, events }));
  if (message.action === 'disconnect') process.disconnect();
});
await app.ready;
send({ type: 'ready', port, value: app.snapshot(), events });
