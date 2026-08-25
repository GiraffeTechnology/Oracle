import { evidenceHash } from "../domain/canonical-json.js";

export class Reconciler {
  reconcileAsset({ assetId, registry, certificate, warehouse, oracle }) {
    const findings = [];
    if (!registry || !certificate || !warehouse || !oracle) findings.push("DEPENDENCY_MISSING");
    if (certificate?.assetId !== assetId || warehouse?.assetId !== assetId || oracle?.assetId !== assetId) findings.push("ASSET_ID_MISMATCH");
    if (oracle?.certificateHash !== certificate?.certificateHash) findings.push("CERTIFICATE_HASH_MISMATCH");
    if (oracle?.warehouseReceiptHash !== warehouse?.warehouseReceiptHash) findings.push("WAREHOUSE_HASH_MISMATCH");
    if (oracle?.registryRefHash !== registry?.registryRefHash) findings.push("REGISTRY_REF_MISMATCH");
    const result = Object.freeze({ assetId, consistent: findings.length === 0, findings: Object.freeze([...new Set(findings)].sort()) });
    return Object.freeze({ ...result, reconciliationHash: evidenceHash(result) });
  }
}

