import { assertProductionPorts } from "../ports/production-ports.js";
import { validateL2DeploymentProfile } from "./deployment-profile.js";
import { validateProtocolProfile } from "../protocol/protocol-profile.js";
import { createProductionRuntime } from "../oracle-runtime.js";
import { Authorizer } from "../services/authorizer.js";
import { CommandJournal } from "../services/command-journal.js";
import { DualControlQueue } from "../services/dual-control.js";
import { OracleControlPlane } from "../services/oracle-control-plane.js";
import { DurableOracleControlPlane } from "../services/durable-control-plane.js";
import { AuthoritativeOracleControlPlane } from "../services/authoritative-control-plane.js";
import { AdminOperations } from "../services/admin-operations.js";
import { BusinessCalendar } from "../services/business-calendar.js";
import { restoreProductionState } from "../services/production-state.js";
import { OutboxDispatcher } from "../services/outbox-dispatcher.js";

export async function assembleProductionConfiguration({ l2Profile, l3Profile, resolver }) {
  const l2 = validateL2DeploymentProfile(l2Profile);
  const l3 = validateProtocolProfile(l3Profile);
  if (!resolver || typeof resolver.resolve !== "function") throw new Error("DEPLOYMENT_RESOLVER_MISSING");

  const resolved = Object.freeze({
    repository: await resolver.resolve(l2.database.connectionRef, "repository"),
    signer: await resolver.resolve(l2.signer.signerSetRef, "signer"),
    registrySource: await resolver.resolve(l2.sources.find(({ kind }) => kind === "REGISTRY").transportRef, "source"),
    certificateSource: await resolver.resolve(l2.sources.find(({ kind }) => kind === "CERTIFICATE_AUTHORITY").transportRef, "source"),
    warehouseSource: await resolver.resolve(l2.sources.find(({ kind }) => kind === "WAREHOUSE").transportRef, "source"),
    eventPublisher: await resolver.resolve(l2.events.publisherRef, "event-publisher"),
    adminAuthenticator: await resolver.resolve(l2.security.adminAuthenticationRef, "admin-authenticator"),
    monitoring: await resolver.resolve(l2.operations.healthRef, "monitoring"),
    backup: await resolver.resolve(l2.operations.backupRef, "backup"),
    disasterRecovery: await resolver.resolve(l2.operations.disasterRecoveryRef, "disaster-recovery"),
  });
  assertProductionPorts(resolved);
  for (const [name, value] of Object.entries(resolved)) {
    if (!value) throw new Error(`DEPLOYMENT_REFERENCE_UNRESOLVED:${name}`);
  }
  return Object.freeze({ l2, l3, ports: resolved });
}

export async function assembleProductionApplication({ config, l2Profile, l3Profile, resolver, settlementConfiguration, clock = () => new Date() }) {
  if (config?.environment !== "production") throw new Error("PRODUCTION_ASSEMBLY_ENVIRONMENT_REJECTED");
  const assembled = await assembleProductionConfiguration({ l2Profile, l3Profile, resolver });
  if (config.host !== undefined && config.host !== assembled.l2.service.bindHost) throw new Error("PRODUCTION_BIND_PROFILE_MISMATCH");
  if (config.port !== undefined && config.port !== assembled.l2.service.port) throw new Error("PRODUCTION_PORT_PROFILE_MISMATCH");
  const settlement = settlementConfiguration;
  if (settlement?.profileId !== "giraffe-settlement/production-v1" || typeof settlement.businessCalendarRef !== "string" || !Number.isInteger(settlement.targetBusinessDays) || settlement.targetBusinessDays < 1 || settlement.targetBusinessDays > 30 || settlement.timeZone !== "Asia/Shanghai") throw new Error("PRODUCTION_SETTLEMENT_CONFIGURATION_INVALID");
  const sourceDefinitions = assembled.l2.sources;
  const runtime = createProductionRuntime({
    sources: sourceDefinitions.map((source) => ({ id: source.sourceId, displayName: source.sourceId, kind: source.kind, keySetId: `${source.sourceId}-keys`, schemaVersions: source.schemaVersions, active: true })),
    signer: assembled.ports.signer,
    businessCalendar: new BusinessCalendar({ calendarId: settlement.businessCalendarRef, timeZone: settlement.timeZone, holidays: settlement.holidays ?? [] }),
    settlementProfile: Object.freeze({ profileId: settlement.profileId, businessCalendarRef: settlement.businessCalendarRef, targetBusinessDays: settlement.targetBusinessDays }),
    clock,
  });
  const authorizer = new Authorizer();
  const dualControl = new DualControlQueue();
  const signerRotationBroker = assembled.ports.signer;
  if (typeof signerRotationBroker.rotate !== "function" || typeof signerRotationBroker.reconcile !== "function" || typeof signerRotationBroker.activateRuntime !== "function") throw new Error("PRODUCTION_SIGNER_ROTATION_BROKER_INVALID");
  if (typeof assembled.ports.repository.loadStateSnapshot !== "function") throw new Error("PRODUCTION_STATE_RESTORE_UNAVAILABLE");
  restoreProductionState(runtime, dualControl, await assembled.ports.repository.loadStateSnapshot());
  const baseControlPlane = new OracleControlPlane({ runtime, authorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox, signerRotationBroker, clock });
  const durableControlPlane = new DurableOracleControlPlane({ controlPlane: baseControlPlane, repository: assembled.ports.repository, runtime, dualControl });
  const controlPlane = new AuthoritativeOracleControlPlane({ controlPlane: durableControlPlane, sourcePorts: assembled.ports, sourceDefinitions });
  const adminOperations = new AdminOperations({ runtime, sourceRegistry: runtime.sourceRegistry, authorizer, reviewQueue: runtime.reviewQueue, dualControl, clock });
  if (typeof assembled.ports.monitoring?.checkReadiness !== "function") throw new Error("PRODUCTION_READINESS_BOUNDARY_INVALID");
  const readinessCheck = async () => {
    if (runtime.operationalState.compromised) return Object.freeze({ ok: false });
    const result = await assembled.ports.monitoring.checkReadiness();
    return Object.freeze({ ok: result?.ok === true });
  };
  if (typeof assembled.ports.eventPublisher.publish !== "function") throw new Error("PRODUCTION_EVENT_PUBLISHER_INVALID");
  const outboxDispatcher = new OutboxDispatcher({ outbox: runtime.outbox, publisher: assembled.ports.eventPublisher, clock });
  let backgroundWorker = null;
  const startBackgroundWorkers = ({ intervalMs = 1000 } = {}) => {
    if (!Number.isInteger(intervalMs) || intervalMs < 100) throw new Error("PRODUCTION_WORKER_INTERVAL_INVALID");
    if (backgroundWorker) return backgroundWorker;
    let stopped = false;
    let draining = false;
    const drain = async () => {
      if (stopped || draining) return;
      draining = true;
      try {
        await outboxDispatcher.drain();
      } catch {
        assembled.ports.monitoring?.reportFailure?.("OUTBOX_DISPATCH_FAILED");
      } finally {
        draining = false;
      }
    };
    const timer = setInterval(drain, intervalMs);
    timer.unref?.();
    void drain();
    backgroundWorker = Object.freeze({
      stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
      },
    });
    return backgroundWorker;
  };
  const authenticateAdmin = async (request) => {
    if (typeof assembled.ports.adminAuthenticator?.authenticate !== "function") throw new Error("PRODUCTION_ADMIN_AUTHENTICATOR_INVALID");
    const identity = await assembled.ports.adminAuthenticator.authenticate(request);
    if (!identity?.actorId || !Array.isArray(identity.roles)) return null;
    authorizer.registerActor(identity.actorId, identity.roles);
    return identity.actorId;
  };
  return Object.freeze({ ...assembled, runtime, sourceRegistry: runtime.sourceRegistry, controlPlane, adminOperations, authenticateAdmin, readinessCheck, outboxDispatcher, startBackgroundWorkers });
}
