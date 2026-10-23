import { MySqlReceiptJournal } from '../adapters/mysql-receipt-journal.js';
import { EvmReceiptProjectionSource } from '../adapters/evm-receipt-source.js';
import { SourceReceiptWriter } from '../adapters/source-receipt-writer.js';
import {
  SourceReceiptIngress,
  SOURCE_RECEIPT_SCHEMA,
  REGISTRATION_SOURCES,
  normalizeReceiptTarget,
} from '../services/source-receipt-ingress.js';

const REF = /^deployment:\/\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+$/;
const FIELDS = [
  'profileId',
  'sourceRoutes',
  'schemaVersion',
  'target',
  'rpcRef',
  'executionClientRef',
  'signerReference',
  'minConfirmations',
  'formatVerifierRef',
  'formatProfileId',
];
const SOURCE_PORTS = {
  REGISTRY: 'registrySource',
  CERTIFICATE_AUTHORITY: 'certificateSource',
  WAREHOUSE: 'warehouseSource',
};
const sourceIdValid = (value) => typeof value === 'string' && /^[a-z][a-z0-9-]{2,63}$/.test(value);

/** Optional, pinned-deployment-owned configuration. No key material or caller endpoints. */
export function validateSourceReceiptConfiguration(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== FIELDS.length ||
    FIELDS.some((field) => !Object.hasOwn(value, field))
  )
    throw new Error('SOURCE_RECEIPT_CONFIGURATION_INVALID');
  if (
    value.profileId !== 'oracle-source-receipt.v1' ||
    value.schemaVersion !== SOURCE_RECEIPT_SCHEMA ||
    !Array.isArray(value.sourceRoutes) ||
    value.sourceRoutes.length < 1 ||
    value.sourceRoutes.length > 3
  )
    throw new Error('SOURCE_RECEIPT_CONFIGURATION_INVALID');
  const seen = new Set();
  const sourceRoutes = value.sourceRoutes.map((route) => {
    if (
      !route ||
      Object.keys(route).length !== 2 ||
      !Object.hasOwn(route, 'registrationSource') ||
      !Object.hasOwn(route, 'sourceId') ||
      !REGISTRATION_SOURCES.includes(route.registrationSource) ||
      !sourceIdValid(route.sourceId) ||
      seen.has(route.registrationSource)
    )
      throw new Error('SOURCE_RECEIPT_SOURCE_ROUTE_INVALID');
    seen.add(route.registrationSource);
    return Object.freeze({
      registrationSource: route.registrationSource,
      sourceId: route.sourceId,
    });
  });
  for (const field of ['rpcRef', 'executionClientRef', 'signerReference', 'formatVerifierRef'])
    if (!REF.test(value[field] ?? ''))
      throw new Error('SOURCE_RECEIPT_REFERENCE_CONFIGURATION_INVALID');
  if (
    typeof value.formatProfileId !== 'string' ||
    !/^[a-z][a-z0-9._/-]{2,127}$/.test(value.formatProfileId)
  )
    throw new Error('SOURCE_RECEIPT_FORMAT_PROFILE_INVALID');
  if (
    !Number.isSafeInteger(value.minConfirmations) ||
    value.minConfirmations < 1 ||
    value.minConfirmations > 256
  )
    throw new Error('SOURCE_RECEIPT_CONFIRMATIONS_INVALID');
  return Object.freeze({
    ...value,
    sourceRoutes: Object.freeze(sourceRoutes),
    target: normalizeReceiptTarget(value.target),
  });
}

export async function assembleSourceReceipt({
  receiptConfiguration,
  l2,
  ports,
  runtime,
  resolver,
  config,
  clock = () => new Date(),
  guardSideEffect = (operation) => operation(),
  runInScope = (operation) => operation(),
}) {
  if (receiptConfiguration === undefined || receiptConfiguration === null)
    return Object.freeze({
      sourceReceiptIngress: null,
      receiptProjectionSource: null,
      receiptProjectionBinding: null,
    });
  const profile = validateSourceReceiptConfiguration(receiptConfiguration);
  const definitions = profile.sourceRoutes.map((route) => {
    const definition = l2.sources.find(({ sourceId }) => sourceId === route.sourceId);
    if (!definition || !definition.schemaVersions.includes(SOURCE_RECEIPT_SCHEMA))
      throw new Error('SOURCE_RECEIPT_SOURCE_PROFILE_NOT_APPROVED');
    return { route, definition };
  });
  if (
    !resolver ||
    typeof resolver.resolve !== 'function' ||
    typeof ports.repository?.transaction !== 'function'
  )
    throw new Error('SOURCE_RECEIPT_ASSEMBLY_DEPENDENCY_INVALID');
  const [rpc, executionClient, formatVerifier] = await Promise.all([
    resolver.resolve(profile.rpcRef, 'receipt-rpc'),
    resolver.resolve(profile.executionClientRef, 'receipt-execution'),
    resolver.resolve(profile.formatVerifierRef, 'receipt-format-verifier'),
  ]);
  if (
    formatVerifier?.profileId !== profile.formatProfileId ||
    typeof formatVerifier?.verifyOriginalRegistration !== 'function'
  )
    throw new Error('SOURCE_RECEIPT_FORMAT_VERIFIER_UNAVAILABLE');
  if (
    typeof rpc?.request !== 'function' ||
    typeof executionClient?.submit !== 'function' ||
    typeof executionClient?.lookup !== 'function'
  )
    throw new Error('SOURCE_RECEIPT_DEPLOYMENT_CAPABILITY_UNAVAILABLE');
  const readProjection = new EvmReceiptProjectionSource({
    rpc,
    binding: profile.target,
    minConfirmations: profile.minConfirmations,
    guardSideEffect,
  });
  const writesAllowed = () =>
    config.externalWritesEnabled === true &&
    runtime.operationalState.compromised !== true &&
    runtime.operationalState.signerRecoveryRequired !== true;
  const journal = new MySqlReceiptJournal({ repository: ports.repository });
  const routes = {};
  for (const { route, definition } of definitions) {
    const keySetRegistry = await resolver.resolve(definition.keySetRef, 'source-keyset');
    if (typeof keySetRegistry?.requireValid !== 'function')
      throw new Error('SOURCE_RECEIPT_DEPLOYMENT_CAPABILITY_UNAVAILABLE');
    const source = runtime.sourceRegistry.requireActive(route.sourceId, SOURCE_RECEIPT_SCHEMA);
    keySetRegistry.requireValid(source.keySetId, clock());
    let ingress;
    const writer = new SourceReceiptWriter({
      projection: readProjection,
      executionClient,
      signerReference: profile.signerReference,
      guardSideEffect,
      beforeSubmit() {
        ingress.assertAdmission();
      },
    });
    ingress = new SourceReceiptIngress({
      ...route,
      sourcePort: ports[SOURCE_PORTS[definition.kind]],
      sourceRegistry: runtime.sourceRegistry,
      keySetRegistry,
      target: profile.target,
      journal,
      writer,
      formatVerifier,
      formatProfileId: profile.formatProfileId,
      clock,
      guardSideEffect,
      writesAllowed,
    });
    // Separate server-owned capabilities select the route. Business input contains only recordRef.
    routes[route.registrationSource] = Object.freeze({
      ingest: (input) => runInScope(() => ingress.ingest(input)),
      reconcile: (input) => runInScope(() => ingress.reconcile(input)),
    });
  }
  // No HTTP write route is installed and the read capability cannot reach a signer.
  const receiptProjectionSource = Object.freeze({
    receiptSnapshot: (...args) => runInScope(() => readProjection.receiptSnapshot(...args)),
  });
  return Object.freeze({
    sourceReceiptIngress: Object.freeze(routes),
    receiptProjectionSource,
    receiptProjectionBinding: profile.target,
  });
}
