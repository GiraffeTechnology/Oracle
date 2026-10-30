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
import { createRepositoryExecutionScope } from "../services/repository-execution-scope.js";
import { assembleReceiptRead } from "./receipt-read.js";

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
    alerting: await resolver.resolve(l2.operations.alertingRef, "alerting"),
    backup: await resolver.resolve(l2.operations.backupRef, "backup"),
    disasterRecovery: await resolver.resolve(l2.operations.disasterRecoveryRef, "disaster-recovery"),
  });
  assertProductionPorts(resolved);
  for (const [name, value] of Object.entries(resolved)) {
    if (!value) throw new Error(`DEPLOYMENT_REFERENCE_UNRESOLVED:${name}`);
  }
  return Object.freeze({ l2, l3, ports: resolved });
}

export async function assembleProductionApplication({ config, l2Profile, l3Profile, resolver, settlementConfiguration, receiptReadConfiguration, clock = () => new Date(), repositoryDrainEnabled = false }) {
  if (config?.environment !== "production") throw new Error("PRODUCTION_ASSEMBLY_ENVIRONMENT_REJECTED");
  if (typeof repositoryDrainEnabled !== "boolean") throw new Error("REPOSITORY_LIFECYCLE_OPTION_INVALID");
  let assembled = await assembleProductionConfiguration({ l2Profile, l3Profile, resolver });
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
  // Explicit opt-in from the production bootstrap; deployment enablement is separate.
  const repositoryExecution = repositoryDrainEnabled
    ? createRepositoryExecutionScope({ repository: assembled.ports.repository, isCompromised: () => runtime.operationalState.compromised === true })
    : null;
  if (repositoryExecution) assembled = Object.freeze({ ...assembled, ports: Object.freeze({ ...assembled.ports, repository: repositoryExecution.repository }) });
  const inRepositoryScope = (operation) => repositoryExecution ? repositoryExecution.run(operation) : operation();
  const receiptRead = await assembleReceiptRead({ receiptReadConfiguration, resolver, runInScope: inRepositoryScope,
    guardRead: (operation) => {
      if (runtime.operationalState.compromised === true) throw new Error('DURABLE_STATE_COMPROMISED');
      return repositoryExecution ? repositoryExecution.guardSideEffect(operation) : operation();
    } });
  const dualControl = new DualControlQueue();
  const rawSigner = assembled.ports.signer;
  if (typeof rawSigner.rotate !== "function" || typeof rawSigner.reconcile !== "function" || typeof rawSigner.activateRuntime !== "function") throw new Error("PRODUCTION_SIGNER_ROTATION_BROKER_INVALID");
  // The raw signer stays assembly-private. Recheck every callable dispatch,
  // including activation after an awaited broker reply; public port consumers
  // cannot sign or rotate outside an admitted repository execution scope.
  const signer = repositoryExecution ? Object.freeze({
    signerSetId: rawSigner.signerSetId,
    signerPolicy: rawSigner.signerPolicy,
    ...Object.fromEntries(
      ["signBytes", "verifyBytes", "verifyHistoricalBytes", "rotate", "reconcile", "activateRuntime"].map((method) => [method,
        (...args) => repositoryExecution.guardSideEffect(() => rawSigner[method](...args)),
      ]),
    ),
  }) : rawSigner;
  const signerRotationBroker = signer;
  if (repositoryExecution) assembled = Object.freeze({ ...assembled, ports: Object.freeze({ ...assembled.ports, signer }) });
  if (typeof assembled.ports.repository.loadStateSnapshot !== "function") throw new Error("PRODUCTION_STATE_RESTORE_UNAVAILABLE");
  if (["recordOutboxAttempt", "recordOutboxDeliveryStateAttempt", "recordOutboxDeadLetterAttempt", "recordOutboxDeadLetterStateAttempt", "markOutboxPublished", "markOutboxDeadLettered"].some((method) => typeof assembled.ports.repository[method] !== "function")) throw new Error("PRODUCTION_OUTBOX_DELIVERY_STORE_INVALID");
  restoreProductionState(runtime, dualControl, await inRepositoryScope(() => assembled.ports.repository.loadStateSnapshot()));
  const baseControlPlane = new OracleControlPlane({ runtime, authorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox, signerRotationBroker, clock });
  const admittedControlPlane = repositoryExecution ? Object.freeze(Object.fromEntries(
    Object.getOwnPropertyNames(OracleControlPlane.prototype).filter((method) => method !== "constructor").map((method) => [method,
      (...args) => method === "authorizeCommand" ? baseControlPlane[method](...args)
        : repositoryExecution.guardSideEffect(() => baseControlPlane[method](...args)),
    ]),
  )) : baseControlPlane;
  const durableControlPlane = new DurableOracleControlPlane({ controlPlane: admittedControlPlane, repository: assembled.ports.repository, runtime, dualControl });
  if (repositoryExecution) {
    const guardedSources = Object.fromEntries(["registrySource", "certificateSource", "warehouseSource"].map((name) => {
      const source = assembled.ports[name];
      return [name, Object.freeze({ fetchByFixedReference: (...args) => repositoryExecution.guardSideEffect(() => source.fetchByFixedReference(...args)) })];
    }));
    assembled = Object.freeze({ ...assembled, ports: Object.freeze({ ...assembled.ports, ...guardedSources }) });
  }
  const authoritativeControlPlane = new AuthoritativeOracleControlPlane({ controlPlane: durableControlPlane, sourcePorts: assembled.ports, sourceDefinitions });
  // Keep one shared Durable instance, writeTail and same-key inFlight map.
  const controlPlane = repositoryExecution ? Object.freeze(Object.fromEntries(
    Object.getOwnPropertyNames(AuthoritativeOracleControlPlane.prototype)
      .filter((method) => method !== "constructor" && method !== "inspectCommandRecovery")
      .map((method) => [method, (input) => {
        if (typeof input?.idempotencyKey !== "string" || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128) return Promise.reject(new Error("IDEMPOTENCY_KEY_REQUIRED"));
        if (method === "exportAudit") {
          if (input.adminOperations !== undefined && input.adminOperations !== adminOperations) return Promise.reject(new Error("ADMIN_EXPORT_CAPABILITY_INVALID"));
          // Only the durable command gets the mutating server-owned capability.
          // Public dashboard readers cannot append unpersisted export events.
          input = { ...input, adminOperations: rawAdminOperations };
        }
        try { baseControlPlane.authorizeCommand(method, input); }
        catch (error) { return Promise.reject(error); }
        return inRepositoryScope(() => authoritativeControlPlane[method](input));
      }]),
  )) : authoritativeControlPlane;
  const rawAdminOperations = new AdminOperations({ runtime, sourceRegistry: runtime.sourceRegistry, authorizer, reviewQueue: runtime.reviewQueue, dualControl, clock });
  const adminOperations = repositoryExecution ? Object.freeze({
    snapshot: (...args) => rawAdminOperations.snapshot(...args),
    authorizeExport: (...args) => rawAdminOperations.authorizeExport(...args),
    async exportAudit() { throw new Error("ADMIN_EXPORT_DURABLE_COMMAND_REQUIRED"); },
  }) : rawAdminOperations;
  if (typeof assembled.ports.monitoring?.checkReadiness !== "function") throw new Error("PRODUCTION_READINESS_BOUNDARY_INVALID");
  if (typeof assembled.ports.alerting?.reportFailure !== "function" || typeof assembled.ports.alerting.reportEvent !== "function") throw new Error("PRODUCTION_ALERTING_BOUNDARY_INVALID");
  const readinessCheck = async () => {
    if (repositoryExecution && repositoryExecution.snapshot().state !== "ACCEPTING") return Object.freeze({ ok: false });
    if (runtime.operationalState.compromised || runtime.operationalState.alertingFailed || runtime.operationalState.signerRecoveryRequired) return Object.freeze({ ok: false });
    const result = await assembled.ports.monitoring.checkReadiness();
    return Object.freeze({ ok: result?.ok === true && (!repositoryExecution || repositoryExecution.snapshot().state === "ACCEPTING") });
  };
  if (typeof assembled.ports.eventPublisher.publish !== "function" || typeof assembled.ports.eventPublisher.publishDeadLetter !== "function") throw new Error("PRODUCTION_EVENT_PUBLISHER_INVALID");
  if (repositoryExecution) {
    const publisher = assembled.ports.eventPublisher;
    const guardedPublisher = Object.freeze(Object.fromEntries(["publish", "publishDeadLetter"].map((method) => [method,
      (...args) => repositoryExecution.guardSideEffect(() => publisher[method](...args)),
    ])));
    assembled = Object.freeze({ ...assembled, ports: Object.freeze({ ...assembled.ports, eventPublisher: guardedPublisher }) });
  }
  const rawOutboxDispatcher = new OutboxDispatcher({ outbox: runtime.outbox, publisher: assembled.ports.eventPublisher, deliveryStore: assembled.ports.repository, clock });
  const outboxDispatcher = repositoryExecution ? Object.freeze({ drain: (...args) => inRepositoryScope(() => rawOutboxDispatcher.drain(...args)) }) : rawOutboxDispatcher;
  let backgroundWorker = null;
  let activeBackground = Promise.resolve();
  let backgroundInFlight = false;
  let backgroundDrainTimedOut = false;
  const startBackgroundWorkers = ({ intervalMs = 1000 } = {}) => {
    if (!Number.isInteger(intervalMs) || intervalMs < 100) throw new Error("PRODUCTION_WORKER_INTERVAL_INVALID");
    if (repositoryExecution && repositoryExecution.snapshot().state !== "ACCEPTING") throw new Error("REPOSITORY_ADMISSION_CLOSED");
    if (backgroundWorker) return backgroundWorker;
    let stopped = false;
    let draining = false;
    const failedAlertBoundaries = new Map();
    const reportAlert = async (method, code) => {
      const boundary = method + ":" + code;
      try {
        await assembled.ports.alerting[method](code);
        failedAlertBoundaries.delete(boundary);
      } catch {
        failedAlertBoundaries.set(boundary, Object.freeze({ method, code }));
      }
      runtime.operationalState.alertingFailed = failedAlertBoundaries.size > 0;
    };
    const drain = () => {
      if (stopped || draining) return;
      draining = true;
      backgroundInFlight = true;
      activeBackground = (async () => {
        try {
          await inRepositoryScope(async () => {
            for (const { method, code } of [...failedAlertBoundaries.values()]) await reportAlert(method, code);
            const results = await rawOutboxDispatcher.drain();
            for (const result of results) {
              if (result.status === "DEAD_LETTER_RETRY") await reportAlert("reportFailure", "OUTBOX_DEAD_LETTER_FAILED");
              if (result.status === "DEAD_LETTER_STATE_RETRY") await reportAlert("reportFailure", "OUTBOX_DEAD_LETTER_STATE_FAILED");
              if (result.status === "DELIVERY_STATE_RETRY") await reportAlert("reportFailure", "OUTBOX_DELIVERY_STATE_FAILED");
              if (result.status === "DEAD_LETTERED") await reportAlert("reportEvent", "OUTBOX_EVENT_DEAD_LETTERED");
            }
          });
        } catch {
          if (repositoryExecution?.snapshot().state === "BLOCKED") {
            // The repository coordinator has already notified the application.
            // Stop scheduling before an independent alerting port can stall.
            stopped = true;
            clearInterval(timer);
          }
          await reportAlert("reportFailure", "OUTBOX_DISPATCH_FAILED");
        } finally {
          draining = false;
          backgroundInFlight = false;
        }
      })();
      return activeBackground;
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
  const lifecycleSnapshot = () => Object.freeze({ ...repositoryExecution.snapshot(), backgroundInFlight,
    ...(backgroundDrainTimedOut ? { state: "BLOCKED", blockers: Object.freeze([...repositoryExecution.snapshot().blockers, "BACKGROUND_DRAIN_TIMEOUT"]) } : {}),
  });
  const repositoryLifecycle = repositoryExecution ? Object.freeze({
    snapshot: lifecycleSnapshot,
    observeBlocked: (observer) => repositoryExecution.observeBlocked(observer),
    async quiesce({ timeoutMs } = {}) {
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new Error("REPOSITORY_DRAIN_TIMEOUT_INVALID");
      const deadline = Date.now() + timeoutMs;
      backgroundWorker?.stop();
      const result = await repositoryExecution.drain({ timeoutMs });
      if (result.state !== "DRAINED") return lifecycleSnapshot();
      let timer;
      try {
        const completed = await Promise.race([activeBackground.then(() => true), new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
        })]);
        if (!completed) backgroundDrainTimedOut = true;
      } finally { clearTimeout(timer); }
      return lifecycleSnapshot();
    },
  }) : null;
  const authenticateAdmin = async (request) => {
    if (typeof assembled.ports.adminAuthenticator?.authenticate !== "function") throw new Error("PRODUCTION_ADMIN_AUTHENTICATOR_INVALID");
    const identity = await assembled.ports.adminAuthenticator.authenticate(request);
    if (!identity?.actorId || !Array.isArray(identity.roles)) return null;
    authorizer.registerActor(identity.actorId, identity.roles);
    return identity.actorId;
  };
  // Supported operator API: authenticate afresh, never trust a submitted actor,
  // and retain the durable command's authorization and method allowlist.
  const inspectCommandRecovery = async (request, method, commandInput) => {
    let actorId;
    const requestAuthorizer = new Authorizer();
    try {
      const identity = await assembled.ports.adminAuthenticator.authenticate(request);
      actorId = identity?.actorId;
      requestAuthorizer.registerActor(actorId, identity?.roles);
    }
    catch { throw new Error("ADMIN_AUTHENTICATION_REQUIRED"); }
    if (!commandInput || typeof commandInput !== "object" || Array.isArray(commandInput) || "actorId" in commandInput || "adminOperations" in commandInput) throw new Error("RECOVERY_INPUT_INVALID");
    // Each observation owns its immutable role snapshot; neither authentication
    // nor authorization reads or updates the shared HTTP actor registry.
    const requestBase = new OracleControlPlane({ runtime, authorizer: requestAuthorizer, dualControl, commandJournal: new CommandJournal(), outbox: runtime.outbox, signerRotationBroker, clock });
    const requestDurable = new DurableOracleControlPlane({ controlPlane: requestBase, repository: repositoryExecution?.recoveryRepository ?? assembled.ports.repository, runtime, dualControl });
    const requestControlPlane = new AuthoritativeOracleControlPlane({ controlPlane: requestDurable, sourcePorts: assembled.ports, sourceDefinitions });
    const input = { ...commandInput, actorId };
    if (method === "exportAudit") input.adminOperations = new AdminOperations({ runtime, sourceRegistry: runtime.sourceRegistry, authorizer: requestAuthorizer, reviewQueue: runtime.reviewQueue, dualControl, clock });
    return requestControlPlane.inspectCommandRecovery(method, input);
  };
  return Object.freeze({ ...assembled, ...receiptRead, runtime, sourceRegistry: runtime.sourceRegistry, controlPlane, adminOperations, authenticateAdmin, inspectCommandRecovery, readinessCheck, outboxDispatcher, startBackgroundWorkers, repositoryLifecycle });
}


