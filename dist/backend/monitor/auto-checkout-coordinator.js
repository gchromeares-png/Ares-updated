"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitorAutoCheckoutCoordinator = exports.getMonitorAction = void 0;
const early_gate_1 = require("./early-gate");
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function initialQueueStatus(event) {
    if (event.type !== "queue-signal")
        return undefined;
    const detectedAt = event.observedAt.toISOString();
    return {
        active: true,
        phase: "waiting",
        source: "network",
        detectedAt,
        updatedAt: detectedAt,
        elapsedMs: 0,
        maxWaitMs: 60 * 60000,
        ...(typeof event.position === "number" ? { position: event.position } : {}),
        ...(typeof event.timeToWaitSeconds === "number" ? { timeToWaitSeconds: event.timeToWaitSeconds } : {}),
        ...(event.statusText ? { statusText: event.statusText } : {})
    };
}
function getMonitorAction(task) {
    const raw = asRecord(task.config.data?.["monitorAction"]);
    if (raw?.["mode"] !== "auto-checkout")
        return { mode: "monitor-only" };
    const profileId = String(raw["profileId"] ?? "").trim();
    const cookieSnapshotId = String(raw["cookieSnapshotId"] ?? "").trim();
    const proxySelection = asRecord(raw["proxySelection"]);
    return {
        mode: "auto-checkout",
        profileId,
        proxySelection,
        headless: Boolean(raw["headless"]),
        ...(cookieSnapshotId ? { cookieSnapshotId } : {})
    };
}
exports.getMonitorAction = getMonitorAction;
class MonitorAutoCheckoutCoordinator {
    constructor(orchestrator, options = {}) {
        this.orchestrator = orchestrator;
        this.options = options;
        this.triggeredParents = new Set();
    }
    async handleProductEvent(parentTaskId, event) {
        const parent = this.orchestrator.getTask(parentTaskId);
        if (!parent)
            return undefined;
        const action = getMonitorAction(parent);
        if (action.mode !== "auto-checkout")
            return undefined;
        if (!event.current.available)
            return undefined;
        if (!action.profileId) {
            this.markFailed(parent, event, "Auto-Checkout-Profil fehlt.");
            return undefined;
        }
        const existingRuntime = asRecord(parent.config.data?.["autoCheckoutRuntime"]);
        if (existingRuntime?.["childTaskId"] || this.triggeredParents.has(parent.id))
            return undefined;
        this.triggeredParents.add(parent.id);
        const triggeredAt = new Date().toISOString();
        const childTaskId = `${parent.id}__checkout_${Date.now()}`;
        parent.config.data = {
            ...(parent.config.data ?? {}),
            autoCheckoutRuntime: this.runtimeStatus("triggering", event, triggeredAt, childTaskId)
        };
        try {
            const childConfig = {
                id: childTaskId,
                name: `${parent.config.name} · Checkout`,
                shopId: parent.config.shopId,
                maxRetries: parent.config.maxRetries,
                data: {
                    searchTerm: event.current.url || event.current.title,
                    browserConfig: { headless: action.headless ?? false },
                    profileId: action.profileId,
                    proxySelection: action.proxySelection ?? { mode: "profile-default" },
                    ...(action.cookieSnapshotId ? { cookieSnapshotId: action.cookieSnapshotId } : {}),
                    triggerSource: {
                        kind: "product",
                        parentTaskId: parent.id,
                        eventType: event.type,
                        productKey: event.key,
                        productTitle: event.current.title,
                        productUrl: event.current.url,
                        observedAt: event.observedAt.toISOString(),
                        price: event.current.price ? { ...event.current.price } : undefined,
                        stock: event.current.stock
                    }
                }
            };
            const child = this.orchestrator.createTask(childConfig);
            this.copyPaymentSession(parent, child);
            parent.config.data = {
                ...(parent.config.data ?? {}),
                autoCheckoutRuntime: this.runtimeStatus("triggered", event, triggeredAt, child.id)
            };
            this.orchestrator.cancelTask(parent.id);
            void this.orchestrator.startTask(child.id);
            this.options.onTriggered?.(parent, child, event);
            return child;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.markFailed(parent, event, message, triggeredAt);
            this.triggeredParents.delete(parent.id);
            return undefined;
        }
    }
    async handleGateEvent(parentTaskId, event) {
        const parent = this.orchestrator.getTask(parentTaskId);
        if (!parent || this.triggeredParents.has(parent.id))
            return undefined;
        const strategy = (0, early_gate_1.getMonitorStrategy)(parent);
        if (strategy.mode !== "early-gate")
            return undefined;
        const action = getMonitorAction(parent);
        if (action.mode !== "auto-checkout" || !action.profileId) {
            parent.lastError = "Early-Gate benötigt eine Auto-Checkout-Session mit Profil.";
            return undefined;
        }
        const runtime = asRecord(parent.config.data?.["earlyGateRuntime"]);
        if (runtime?.["childTaskId"])
            return undefined;
        this.triggeredParents.add(parent.id);
        const childTaskId = `${parent.id}__gate_${Date.now()}`;
        const observedAt = event.observedAt.toISOString();
        const flowId = `early-gate:${parent.id}`;
        const queueStatus = initialQueueStatus(event);
        try {
            const childConfig = {
                id: childTaskId,
                name: `${parent.config.name} · Release`,
                shopId: parent.config.shopId,
                maxRetries: parent.config.maxRetries,
                data: {
                    browserConfig: {
                        headless: action.headless ?? false,
                        queueMaxWaitMs: 60 * 60000
                    },
                    profileId: action.profileId,
                    proxySelection: action.proxySelection ?? { mode: "profile-default" },
                    ...(action.cookieSnapshotId ? { cookieSnapshotId: action.cookieSnapshotId } : {}),
                    triggerSource: {
                        kind: "early-gate",
                        parentTaskId: parent.id,
                        gateType: event.type,
                        gateSource: event.source,
                        observedAt
                    },
                    ...(queueStatus ? { queueStatus } : {}),
                    postQueueDiscovery: {
                        productName: strategy.productName,
                        keywords: [...strategy.discoveryKeywords]
                    }
                }
            };
            const child = this.orchestrator.createTask(childConfig);
            (0, early_gate_1.setEarlyGateRuntime)(parent, {
                flowId,
                activeArea: "browser-child",
                stage: "gate-detected",
                childTaskId: child.id,
                gateDetectedAt: observedAt
            });
            (0, early_gate_1.setEarlyGateRuntime)(child, {
                flowId,
                activeArea: "browser-child",
                stage: "browser-child",
                parentTaskId: parent.id,
                childTaskId: child.id,
                productName: strategy.productName,
                keywords: strategy.discoveryKeywords,
                gateDetectedAt: observedAt,
                browserChildStartedAt: new Date().toISOString()
            });
            child.config.data = {
                ...(child.config.data ?? {}),
                earlyGateRuntime: child.config.data?.["earlyGateRuntime"]
            };
            this.copyPaymentSession(parent, child);
            this.orchestrator.cancelTask(parent.id);
            void this.orchestrator.startTask(child.id);
            this.options.onGateTriggered?.(parent, child, event);
            return child;
        }
        catch (error) {
            this.triggeredParents.delete(parent.id);
            parent.lastError = error instanceof Error ? error.message : String(error);
            return undefined;
        }
    }
    copyPaymentSession(parent, child) {
        const paymentSession = this.options.getPaymentSession?.(parent.id);
        if (!paymentSession)
            return;
        this.options.setPaymentSession?.(child.id, {
            ...paymentSession,
            card: paymentSession.card ? { ...paymentSession.card } : undefined
        });
    }
    markFailed(parent, event, error, triggeredAt = new Date().toISOString()) {
        parent.config.data = {
            ...(parent.config.data ?? {}),
            autoCheckoutRuntime: {
                ...this.runtimeStatus("failed", event, triggeredAt),
                error
            }
        };
        parent.lastError = error;
    }
    runtimeStatus(status, event, triggeredAt, childTaskId) {
        return {
            status,
            childTaskId,
            triggeredAt,
            eventType: event.type,
            productKey: event.key,
            productTitle: event.current.title,
            productUrl: event.current.url
        };
    }
}
exports.MonitorAutoCheckoutCoordinator = MonitorAutoCheckoutCoordinator;
//# sourceMappingURL=auto-checkout-coordinator.js.map