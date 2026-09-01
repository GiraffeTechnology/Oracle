import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadExternalConsumerStateContract,
  loadLayerStateMapping,
  verifyLayerStateConsistency,
} from '../src/protocol/layer-state-contract.js';
import { validateProtocolProfile } from '../src/protocol/protocol-profile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return path.join(root, fallback);
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`LAYER_CHECK_OPTION_INVALID:${name}`);
  return path.resolve(value);
}

async function loadJson(fileName) {
  return JSON.parse(await readFile(fileName, { encoding: 'utf8', flag: 'r' }));
}

const files = {
  mapping: option('--mapping', 'config/layer-state-mapping.v1.json'),
  external: option('--external', 'config/external-consumer-state-contract.v1.json'),
  protocol: option('--protocol', 'config/l3.protocol.wd-0.1.1.json'),
  wenbao: option('--wenbao', 'config/settlement.wenbao-sandbox.json'),
};

const mapping = await loadLayerStateMapping(files.mapping);
const externalConsumer = await loadExternalConsumerStateContract(files.external);
const protocolProfile = validateProtocolProfile(await loadJson(files.protocol));
const wenbaoProfile = await loadJson(files.wenbao);
verifyLayerStateConsistency({ mapping, externalConsumer, protocolProfile, wenbaoProfile });

process.stdout.write('layer-state-consistency: pass\n');
