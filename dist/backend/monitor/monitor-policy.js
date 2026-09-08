"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMonitorPolicy = void 0;
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function bool(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function resolveMonitorPolicy(task, shop) {
    const taskData = task.config.data ?? {};
    const taskPolicy = record(taskData["monitorPolicy"]);
    const shopPolicy = record(shop.config?.["monitorPolicy"]);
    const legacyTaskMode = String(taskData["monitorNetworkMode"] ?? "").trim().toLowerCase();
    const legacyShopMode = String(shop.config?.["monitorNetworkMode"] ?? "").trim().toLowerCase();
    const configuredMode = String(taskPolicy?.["networkMode"]
        ?? (legacyTaskMode || undefined)
        ?? shopPolicy?.["networkMode"]
        ?? legacyShopMode).trim().toLowerCase();
    const networkMode = configuredMode === "browser-only" || configuredMode === "strict" || configuredMode === "high-security"
        ? "browser-only"
        : "session-http-preferred";
    return {
        networkMode,
        allowPassiveNetwork: bool(taskPolicy?.["allowPassiveNetwork"], bool(shopPolicy?.["allowPassiveNetwork"], true)),
        allowPassiveDom: bool(taskPolicy?.["allowPassiveDom"], bool(shopPolicy?.["allowPassiveDom"], true)),
        allowActiveBrowserFallback: bool(taskPolicy?.["allowActiveBrowserFallback"], bool(shopPolicy?.["allowActiveBrowserFallback"], true))
    };
}
exports.resolveMonitorPolicy = resolveMonitorPolicy;
//# sourceMappingURL=monitor-policy.js.map