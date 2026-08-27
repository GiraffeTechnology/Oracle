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
import { BusinessCalendar } from "./services/business-calendar.js";
import { Outbox } from "./services/outbox.js";
import { ReviewQueue } from "./services/review-queue.js";

const SYNTHETIC_SETTLEMENT_PROFILE = Object.freeze({
  profileId: "giraffe-settlement/synthetic-v1",
  businessCalendarRef: "synthetic://calendar/wenbao-v1",
  targetBusinessDays: 3,
});

function createRuntimeComponents({ sourceRegistry, attestationService, settlementProfile, businessCalendar, clock, requireDurableOutbox = false }) {
  const schemaRegistry = createDefaultSchemaRegistry();
  const recordStore = new RecordStore();
  const stateEngine = new StateEngine();
  const auditJournal = new AuditJournal();
  const revocations = attestationService.revocations;
  const tokenIndex = new TokenIndex();
  const outbox = new Outbox({ requireDurable: requireDurableOutbox });
  const reviewQueue = new ReviewQueue();
  const settlements = new SettlementCoordinator({ recordStore, stateEngine, auditJournal, tokenIndex, attestations: attestationService, businessCalendar, settlementProfile, clock });
  const operationalState = { compromised: false, errorCode: null };
  return Object.freeze({ sourceRegistry, schemaRegistry, recordStore, stateEngine, auditJournal, revocations, attestations: attestationService, settlements, tokenIndex, outbox, reviewQueue, operationalState });
}

export function createProductionRuntime({ sources, signer, businessCalendar, settlementProfile, clock = () => new Date() }) {
  if (!Array.isArray(sources) || sources.length !== 3) throw new Error("PRODUCTION_SOURCES_INVALID");
  if (!signer || typeof signer.signBytes !== "function" || typeof signer.verifyBytes !== "function" || typeof signer.verifyHistoricalBytes !== "function" || typeof signer.signerSetId !== "string" || !signer.signerSetId) throw new Error("PRODUCTION_SIGNER_RUNTIME_INVALID");
  if (!signer.signerPolicy || signer.signerPolicy.record?.signerSetId !== signer.signerSetId || typeof signer.signerPolicy.assertActive !== "function") throw new Error("PRODUCTION_SIGNER_POLICY_INVALID");
  signer.signerPolicy.assertActive();
  if (!businessCalendar || !settlementProfile) throw new Error("PRODUCTION_SETTLEMENT_PROFILE_MISSING");
  const sourceRegistry = new SourceRegistry(sources);
  const revocations = new RevocationRegistry();
  const attestations = new AttestationService({ signerSetId: signer.signerSetId, signBytes: signer.signBytes, verifyBytes: signer.verifyBytes, verifyHistoricalBytes: signer.verifyHistoricalBytes, signerPolicy: signer.signerPolicy, revocations, clock });
  return createRuntimeComponents({ sourceRegistry, attestationService: attestations, settlementProfile, businessCalendar, clock, requireDurableOutbox: true });
}

export function createSyntheticRuntime({ clock = () => new Date() } = {}) {
  const sourceRegistry = new SourceRegistry([
    { id: "synthetic-registry", displayName: "Synthetic Registry", kind: "REGISTRY", keySetId: "synthetic-registry-keys", schemaVersions: ["asset-record.v1"], active: true },
    { id: "synthetic-certificates", displayName: "Synthetic Certificate Authority", kind: "CERTIFICATE_AUTHORITY", keySetId: "synthetic-certificate-keys", schemaVersions: ["certificate-record.v1"], active: true },
    { id: "synthetic-warehouse", displayName: "Synthetic Warehouse", kind: "WAREHOUSE", keySetId: "synthetic-warehouse-keys", schemaVersions: ["warehouse-record.v1"], active: true },
  ]);
  const revocations = new RevocationRegistry();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const attestations = new AttestationService({ signerSetId: "synthetic-oracle-signers", privateKey, publicKey, revocations, clock });
  const businessCalendar = new BusinessCalendar({ calendarId: "wenbao-v1", timeZone: "Asia/Shanghai" });
  return createRuntimeComponents({ sourceRegistry, attestationService: attestations, settlementProfile: SYNTHETIC_SETTLEMENT_PROFILE, businessCalendar, clock });
}
