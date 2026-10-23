const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

describe('Optional authenticated source receipt pipeline', function () {
  it('passes ABI, RPC, checked writer and assembled local-chain regressions', async function () {
    this.timeout(120000);
    // These tests use the same installed contract dependencies as this suite.
    // Keep the repository's dependency-free Node unit suite dependency-free.
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        '--test',
        'test/receipt-chain/evm-receipt-source.test.mjs',
        'test/receipt-chain/source-receipt-writer.test.mjs',
        'test/receipt-chain/source-receipt-assembly.test.mjs',
      ],
      { cwd: path.resolve(__dirname, '../..'), maxBuffer: 4 * 1024 * 1024 },
    );
    process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  });
});
