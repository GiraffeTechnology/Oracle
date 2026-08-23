import { loadServerConfig } from './config.ts';
import { createServer } from './server.ts';

const { host, port } = loadServerConfig();
const server = createServer();

server.listen(port, host, () => {
  process.stdout.write(`giraffe-rwa-oracle listening on http://${host}:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
