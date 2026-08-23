import { generateKeyPairSync } from "node:crypto";
import { AuditJournal } from "./domain/audit-journal.js";
import { AttestationService } from "./domain/attestation-service.js";
import { RecordStore } from "./domain/record-store.js";
import { RevocationRegistry } from "./domain/revocation-registry.js";
import { createDefaultSchemaRegistry } from "./domain/schema-registry.js";
import { SettlementCoordinator } from "./domain/settlement-coordinator.js";
import { SourceRegistry } from "./domain/source-registry.js";
import { StateEngine } from "./domain/state-engine.js";
import { TokenIndex } from "./domain/token-index.js";

export function createSyntheticRuntime({ clock = () => new Date() } = {}) {
  const sourceRegistry = new SourceRegistry([
    { id: "synthetic-registry", displayName: "Synthetic Registry", kind: "REGISTRY", keySetId: "synthetic-registry-keys", schemaVersions: ["asset-record.v1"], active: true },
    { id: "synthetic-certificates", displayName: "Synthetic Certificate Authority", kind: "CERTIFICATE_AUTHORITY", keySetId: "synthetic-certificate-keys", schemaVersions: ["certificate-record.v1"], active: true },
    { id: "synthetic-warehouse", displayName: "Synthetic Warehouse", kind: "WAREHOUSE", keySetId: "synthetic-warehouse-keys", schemaVersions: ["warehouse-record.v1"], active: true },
  ]);
  const schemaRegistry = createDefaultSchemaRegistry();
  const recordStore = new RecordStore();
  const stateEngine = new StateEngine();
  const auditJournal = new AuditJournal();
  const revocations = new RevocationRegistry();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const attestations = new AttestationService({ signerSetId: "synthetic-oracle-signers", privateKey, publicKey, revocations, clock });
  const settlements = new SettlementCoordinator({ recordStore, stateEngine, auditJournal, clock });
  const tokenIndex = new TokenIndex();
  return Object.freeze({ sourceRegistry, schemaRegistry, recordStore, stateEngine, auditJournal, revocations, attestations, settlements, tokenIndex });
}
