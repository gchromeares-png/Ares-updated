"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommerceTaskExecutorRouter = void 0;
const commerce_monitor_service_1 = require("../monitor/commerce-monitor-service");
const early_gate_1 = require("../monitor/early-gate");
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function materializeEarlyGateLane(task) {
    const data = { ...(task.config.data ?? {}) };
    const action = asRecord(data["monitorAction"]);
    const strategy = (0, early_gate_1.getMonitorStrategy)(task);
    if (action?.["mode"] !== "auto-checkout" || strategy.mode !== "early-gate")
        return;
    const profileId = String(data["profileId"] ?? action["profileId"] ?? "").trim();
    const cookieSnapshotId = String(data["cookieSnapshotId"] ?? action["cookieSnapshotId"] ?? "").trim();
    const proxySelection = asRecord(data["proxySelection"]) ?? asRecord(action["proxySelection"]);
    const browserConfig = asRecord(data["browserConfig"]) ?? {};
    const triggerSource = asRecord(data["triggerSource"]) ?? {
        kind: "early-gate", parentTaskId: task.id, role: "browser-monitor-lane", observedAt: new Date().toISOString()
    };
    task.config.data = {
        ...data,
        ...(profileId ? { profileId } : {}),
        ...(proxySelection ? { proxySelection } : {}),
        ...(cookieSnapshotId ? { cookieSnapshotId } : {}),
        triggerSource,
        postQueueDiscovery: { productName: strategy.productName, keywords: [...strategy.discoveryKeywords] },
        browserConfig: {
            ...browserConfig,
            headless: typeof browserConfig["headless"] === "boolean" ? browserConfig["headless"] : Boolean(action["headless"])
        },
        earlyGateLane: { mode: "browser-monitor", monitorOnlyUntilRelease: true, proxyBound: true, profileId }
    };
}
class CommerceTaskExecutorRouter {
    constructor(getShop) {
        this.getShop = getShop;
        this.executors = new Map();
        this.taskOwners = new Map();
        this.runtimeListeners = new Set();
        this.runtimeUnsubscribers = new Map();
    }
    register(platform, executor) { this.executors.set(platform, executor); this.attachRuntimeUpdates(executor); }
    registerMonitorExecutor(executor) { this.monitorExecutor = executor; this.attachRuntimeUpdates(executor); }
    registerEarlyGateExecutor(executor) { this.earlyGateExecutor = executor; this.attachRuntimeUpdates(executor); }
    hasExecutor(platform) { return this.executors.has(platform); }
    hasMonitorExecutor() { return Boolean(this.monitorExecutor); }
    hasEarlyGateExecutor() { return Boolean(this.earlyGateExecutor); }
    listExecutorPlatforms() { return [...this.executors.keys()]; }
    onTaskUpdate(callback) { this.runtimeListeners.add(callback); return () => this.runtimeListeners.delete(callback); }
    async execute(task) {
        const shopId = task.config.shopId;
        if (!shopId) {
            task.lastError = "Task hat keine shopId.";
            return false;
        }
        const shop = this.getShop(shopId);
        if (!shop) {
            task.lastError = `Shop ${shopId} ist nicht registriert.`;
            return false;
        }
        const earlyGateMonitor = (0, early_gate_1.isEarlyGateMonitorTask)(task);
        if (earlyGateMonitor)
            materializeEarlyGateLane(task);
        const earlyGateBrowser = earlyGateMonitor || (0, early_gate_1.isEarlyGateChildTask)(task);
        const monitorTask = (0, commerce_monitor_service_1.isCommerceMonitorTask)(task) && !earlyGateBrowser;
        const executor = earlyGateBrowser ? this.earlyGateExecutor : monitorTask ? this.monitorExecutor : this.executors.get(shop.platform);
        if (!executor) {
            task.lastError = earlyGateBrowser ? "Für Early-Gate-Browser-Lanes ist noch kein Browser-Executor registriert." : monitorTask ? "Für Monitoring ist noch kein CommerceMonitorService registriert." : `Für ${shop.platform} ist noch kein Task-Executor registriert. Die Plattform ist bereits im Commerce-/Monitor-Modell vorbereitet.`;
            return false;
        }
        this.taskOwners.set(task.id, executor);
        try {
            return await executor.execute(task);
        }
        finally {
            this.taskOwners.delete(task.id);
        }
    }
    async updateDiscoveryKeywords(taskId, keywords) {
        const owner = this.taskOwners.get(taskId);
        if (!owner)
            throw new Error(`Laufende Browser-Lane ${taskId} wurde nicht gefunden.`);
        if (!owner.updateDiscoveryKeywords)
            throw new Error(`Task ${taskId} unterstützt keine Live-Discovery-Keywords.`);
        return owner.updateDiscoveryKeywords(taskId, keywords);
    }
    async setFinalPurchaseAllowed(allowed) { await Promise.all(this.uniqueExecutors().map(async (executor) => executor.setFinalPurchaseAllowed?.(allowed === true))); }
    async cancelTask(taskId) { await this.taskOwners.get(taskId)?.cancelTask?.(taskId); }
    async close() {
        for (const unsubscribe of this.runtimeUnsubscribers.values())
            unsubscribe();
        this.runtimeUnsubscribers.clear();
        this.runtimeListeners.clear();
        for (const executor of this.uniqueExecutors())
            await executor.close?.();
        this.taskOwners.clear();
    }
    uniqueExecutors() { return [...new Set([...this.executors.values(), ...(this.monitorExecutor ? [this.monitorExecutor] : []), ...(this.earlyGateExecutor ? [this.earlyGateExecutor] : [])])]; }
    attachRuntimeUpdates(executor) {
        const runtimeSource = executor;
        if (!runtimeSource.onTaskUpdate || this.runtimeUnsubscribers.has(executor))
            return;
        const unsubscribe = runtimeSource.onTaskUpdate(task => { for (const listener of this.runtimeListeners)
            listener(task); });
        this.runtimeUnsubscribers.set(executor, unsubscribe);
    }
}
exports.CommerceTaskExecutorRouter = CommerceTaskExecutorRouter;
//# sourceMappingURL=task-executor-router.js.map