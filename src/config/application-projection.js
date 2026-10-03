import { KitProjectionSource } from '../adapters/kit-projection-source.js';
import { ADDRESS, BYTES32, assertUint256 } from '../ports/projection-source.js';

/** Static server-owned configuration. No request can select the upstream. */
export function loadApplicationProjectionConfig(env) {
  const baseUrl = env.GIRAFFE_ORACLE_KIT_READ_API_URL;
  const chainId = env.GIRAFFE_ORACLE_PROJECTION_CHAIN_ID;
  const contract = env.GIRAFFE_ORACLE_PROJECTION_CONTRACT;
  const registerId = env.GIRAFFE_ORACLE_PROJECTION_REGISTER_ID;
  // Existing installations keep working. A partial binding must never guess.
  if (![baseUrl, chainId, contract, registerId].every((value) => typeof value === 'string' && value.length > 0)) return null;
  return validateApplicationProjectionConfig({ baseUrl, chainId, contract, registerId });
}

export function validateApplicationProjectionConfig(value) {
  try {
    assertUint256(value.chainId, 'PROJECTION_BINDING_INVALID');
    if (value.chainId === '0' || !ADDRESS.test(value.contract) || !BYTES32.test(value.registerId)) throw new Error();
    // Constructor validation checks the configured URL without making a call.
    new KitProjectionSource({ baseUrl: value.baseUrl });
    return Object.freeze({ baseUrl: value.baseUrl, chainId: value.chainId, contract: value.contract.toLowerCase(), registerId: value.registerId.toLowerCase() });
  } catch { throw new Error('PROJECTION_BINDING_INVALID'); }
}

/** Used by the real startApplication path, including production bootstrap. */
export function assembleApplicationProjection(config) {
  if (!config) return { projectionSource: null, projectionBinding: null };
  const binding = validateApplicationProjectionConfig(config);
  return {
    projectionSource: new KitProjectionSource({ baseUrl: binding.baseUrl }),
    projectionBinding: Object.freeze({ chainId: binding.chainId, contract: binding.contract, registerId: binding.registerId }),
  };
}
