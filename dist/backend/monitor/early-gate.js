"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setEarlyGateRuntime = exports.getEarlyGateRuntime = exports.isEarlyGateChildTask = exports.isEarlyGateMonitorTask = exports.getMonitorStrategy = exports.normalizeDiscoveryKeywords = void 0;
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function normalizeDiscoveryKeywords(values) {
    if (!Array.isArray(values))
        return [];
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
        if (!normalized)
            continue;
        const key = normalized.toLocaleLowerCase("de-DE");
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(normalized.slice(0, 160));
        if (result.length >= 24)
            break;
    }
    return result;
}
exports.normalizeDiscoveryKeywords = normalizeDiscoveryKeywords;
function getMonitorStrategy(task) {
    const raw = asRecord(task.config.data?.["monitorStrategy"]);
    if (raw?.["mode"] !== "early-gate")
        return { mode: "product-monitor" };
    return {
        mode: "early-gate",
        productName: String(raw["productName"] ?? "").trim().slice(0, 240),
        discoveryKeywords: normalizeDiscoveryKeywords(raw["discoveryKeywords"])
    };
}
exports.getMonitorStrategy = getMonitorStrategy;
function isEarlyGateMonitorTask(task) {
    return getMonitorStrategy(task).mode === "early-gate";
}
exports.isEarlyGateMonitorTask = isEarlyGateMonitorTask;
function isEarlyGateChildTask(task) {
    const trigger = asRecord(task.config.data?.["triggerSource"]);
    return trigger?.["kind"] === "early-gate" && Boolean(trigger["parentTaskId"]);
}
exports.isEarlyGateChildTask = isEarlyGateChildTask;
function getEarlyGateRuntime(task) {
    return asRecord(task.config.data?.["earlyGateRuntime"]);
}
exports.getEarlyGateRuntime = getEarlyGateRuntime;
function setEarlyGateRuntime(task, patch) {
    const existing = getEarlyGateRuntime(task);
    const strategy = getMonitorStrategy(task);
    const trigger = asRecord(task.config.data?.["triggerSource"]);
    const postQueue = asRecord(task.config.data?.["postQueueDiscovery"]);
    const parentTaskId = String(patch.parentTaskId ?? existing?.parentTaskId ?? trigger?.["parentTaskId"] ?? task.id);
    const productName = String(patch.productName ?? existing?.productName ?? postQueue?.["productName"] ?? (strategy.mode === "early-gate" ? strategy.productName : ""));
    const keywords = normalizeDiscoveryKeywords(patch.keywords ?? existing?.keywords ?? postQueue?.["keywords"] ?? (strategy.mode === "early-gate" ? strategy.discoveryKeywords : []));
    const runtime = {
        flowId: String(patch.flowId ?? existing?.flowId ?? `early-gate:${parentTaskId}`),
        activeArea: patch.activeArea ?? existing?.activeArea ?? "monitor",
        stage: patch.stage ?? existing?.stage ?? "monitoring",
        parentTaskId,
        childTaskId: patch.childTaskId ?? existing?.childTaskId,
        productName,
        keywords,
        monitoringAt: patch.monitoringAt ?? existing?.monitoringAt,
        gateDetectedAt: patch.gateDetectedAt ?? existing?.gateDetectedAt,
        browserChildStartedAt: patch.browserChildStartedAt ?? existing?.browserChildStartedAt,
        queueEnteredAt: patch.queueEnteredAt ?? existing?.queueEnteredAt,
        queueReleasedAt: patch.queueReleasedAt ?? existing?.queueReleasedAt,
        postQueueDiscoveryAt: patch.postQueueDiscoveryAt ?? existing?.postQueueDiscoveryAt,
        productFoundAt: patch.productFoundAt ?? existing?.productFoundAt,
        cartAt: patch.cartAt ?? existing?.cartAt,
        checkoutAt: patch.checkoutAt ?? existing?.checkoutAt
    };
    task.config.data = {
        ...(task.config.data ?? {}),
        earlyGateRuntime: runtime
    };
    return runtime;
}
exports.setEarlyGateRuntime = setEarlyGateRuntime;
//# sourceMappingURL=early-gate.js.map