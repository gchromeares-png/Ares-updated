"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommerceMonitorService = exports.isCommerceMonitorTask = exports.getTaskProductCriteria = void 0;
const product_matcher_1 = require("./product-matcher");
const product_monitor_1 = require("./product-monitor");
const early_gate_1 = require("./early-gate");
const browser_product_fallback_registry_1 = require("./browser-product-fallback-registry");
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function getTaskProductCriteria(task) {
    const raw = asRecord(task.config.data?.["productCriteria"]);
    if (!raw)
        return undefined;
    const criteria = {};
    if (typeof raw["searchTerm"] === "string")
        criteria.searchTerm = raw["searchTerm"];
    if (typeof raw["sku"] === "string")
        criteria.sku = raw["sku"];
    if (typeof raw["gtin"] === "string")
        criteria.gtin = raw["gtin"];
    if (typeof raw["url"] === "string")
        criteria.url = raw["url"];
    if (typeof raw["requireAvailable"] === "boolean")
        criteria.requireAvailable = raw["requireAvailable"];
    if (typeof raw["minStock"] === "number")
        criteria.minStock = raw["minStock"];
    if (typeof raw["minPrice"] === "number")
        criteria.minPrice = raw["minPrice"];
    if (typeof raw["maxPrice"] === "number")
        criteria.maxPrice = raw["maxPrice"];
    if (typeof raw["minimumScore"] === "number")
        criteria.minimumScore = raw["minimumScore"];
    return criteria;
}
exports.getTaskProductCriteria = getTaskProductCriteria;
function isCommerceMonitorTask(task) {
    return Boolean(asRecord(task.config.data?.["productCriteria"])) || (0, early_gate_1.getMonitorStrategy)(task).mode === "early-gate";
}
exports.isCommerceMonitorTask = isCommerceMonitorTask;
function isRelevantChange(event) {
    return event.type !== "unchanged";
}
function abortableDelay(ms, signal) {
    if (signal.aborted)
        return Promise.resolve();
    return new Promise(resolve => {
        const timer = setTimeout(done, ms);
        function done() {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        }
        signal.addEventListener("abort", done, { once: true });
    });
}
function monitorMessage(event) {
    const product = event.current.variantTitle
        ? `${event.current.title} · ${event.current.variantTitle}`
        : event.current.title;
    const stock = typeof event.current.stock === "number" ? ` · Bestand ${event.current.stock}` : "";
    const price = event.current.price ? ` · ${event.current.price.amount} ${event.current.price.currency ?? ""}`.trimEnd() : "";
    return `${product} · ${event.type}${stock}${price}`;
}
function browserFallbackNeeded(ranked) {
    if (!ranked.length)
        return true;
    return ranked.every(candidate => {
        const source = String(candidate.observation.attributes?.["source"] ?? "");
        const signal = String(candidate.observation.attributes?.["availabilitySignal"] ?? "");
        return source === "generic-html" && signal === "unknown";
    });
}
class CommerceMonitorService {
    constructor(getShop, productApiRouter, repository, options = {}) {
        this.getShop = getShop;
        this.productApiRouter = productApiRouter;
        this.repository = repository;
        this.options = options;
        this.matcher = new product_matcher_1.ProductMatcher();
        this.monitors = new Map();
        this.activeRuns = new Map();
        this.gateSignaled = new Set();
        this.runtimeListeners = new Set();
        this.defaultIntervalMs = Math.max(1, options.defaultIntervalMs ?? 30000);
        this.minimumIntervalMs = Math.max(1, options.minimumIntervalMs ?? 1000);
        this.searchLimit = Math.min(250, Math.max(1, options.searchLimit ?? 50));
        this.browserFallback = options.browserFallback ?? (0, browser_product_fallback_registry_1.getDefaultBrowserProductFallback)();
    }
    onTaskUpdate(callback) {
        this.runtimeListeners.add(callback);
        return () => this.runtimeListeners.delete(callback);
    }
    async execute(task) {
        const shopId = task.config.shopId;
        if (!shopId) {
            task.lastError = "Monitoring-Task hat keine shopId.";
            return false;
        }
        const shop = this.getShop(shopId);
        if (!shop) {
            task.lastError = `Shop ${shopId} ist nicht registriert.`;
            return false;
        }
        const strategy = (0, early_gate_1.getMonitorStrategy)(task);
        const criteria = getTaskProductCriteria(task);
        if (strategy.mode !== "early-gate" && !criteria) {
            task.lastError = "Monitoring-Task hat keine productCriteria.";
            return false;
        }
        if (strategy.mode === "early-gate" && !this.options.preCheckoutGate) {
            task.lastError = "Early-Gate ist konfiguriert, aber kein passiver PreCheckoutGate-Adapter registriert.";
            return false;
        }
        if (this.activeRuns.has(task.id)) {
            task.lastError = `Monitoring für Task ${task.id} läuft bereits.`;
            return false;
        }
        const controller = new AbortController();
        const run = { controller };
        this.activeRuns.set(task.id, run);
        if (strategy.mode === "early-gate") {
            (0, early_gate_1.setEarlyGateRuntime)(task, {
                activeArea: "monitor",
                stage: "monitoring",
                productName: strategy.productName,
                keywords: strategy.discoveryKeywords,
                monitoringAt: new Date().toISOString()
            });
            this.emitTaskUpdate(task);
        }
        try {
            while (!controller.signal.aborted) {
                if (strategy.mode === "early-gate") {
                    await this.runGateCycle(task, shop, controller.signal);
                }
                else {
                    await this.runCycle(task, shop, criteria, controller.signal);
                }
                task.lastError = undefined;
                if (controller.signal.aborted)
                    break;
                await abortableDelay(this.intervalFor(task), controller.signal);
            }
            task.lastError = undefined;
            return true;
        }
        catch (error) {
            if (controller.signal.aborted)
                return true;
            task.lastError = error instanceof Error ? error.message : String(error);
            this.emitTaskUpdate(task);
            return false;
        }
        finally {
            if (this.activeRuns.get(task.id) === run)
                this.activeRuns.delete(task.id);
            await this.browserFallback?.cancelTask(task.id).catch(() => undefined);
        }
    }
    async runGateCycle(task, shop, signal) {
        if (this.gateSignaled.has(task.id))
            return undefined;
        const shopId = task.config.shopId;
        if (!shopId)
            throw new Error("Early-Gate-Task hat keine shopId.");
        const resolvedShop = shop ?? this.getShop(shopId);
        if (!resolvedShop)
            throw new Error(`Shop ${shopId} ist nicht registriert.`);
        const gate = this.options.preCheckoutGate;
        if (!gate)
            throw new Error("Kein passiver PreCheckoutGate-Adapter registriert.");
        const event = await gate.evaluate(task, resolvedShop, signal);
        if (!event || signal?.aborted)
            return undefined;
        this.gateSignaled.add(task.id);
        const gateDetectedAt = event.observedAt.toISOString();
        (0, early_gate_1.setEarlyGateRuntime)(task, {
            activeArea: "gate",
            stage: "gate-detected",
            gateDetectedAt
        });
        task.config.data = {
            ...(task.config.data ?? {}),
            gateTelemetry: {
                source: event.source,
                position: event.position,
                timeToWaitSeconds: event.timeToWaitSeconds,
                statusText: event.statusText,
                observedAt: gateDetectedAt
            }
        };
        this.emitTaskUpdate(task);
        this.options.onGateEvent?.(task.id, event);
        return event;
    }
    async runCycle(task, shop, criteria, signal) {
        const resolvedShopId = task.config.shopId;
        if (!resolvedShopId)
            throw new Error("Monitoring-Task hat keine shopId.");
        const resolvedShop = shop ?? this.getShop(resolvedShopId);
        if (!resolvedShop)
            throw new Error(`Shop ${resolvedShopId} ist nicht registriert.`);
        const resolvedCriteria = criteria ?? getTaskProductCriteria(task);
        if (!resolvedCriteria)
            throw new Error("Monitoring-Task hat keine productCriteria.");
        let observations = await this.productApiRouter.search(resolvedShop, resolvedCriteria, this.searchLimit);
        if (signal?.aborted)
            return [];
        let ranked = observations
            .map(observation => ({ observation, match: this.matcher.match(observation, resolvedCriteria) }))
            .filter(candidate => candidate.match.matched)
            .sort((a, b) => b.match.score - a.match.score);
        if (this.browserFallback && browserFallbackNeeded(ranked) && !signal?.aborted) {
            const rendered = await this.browserFallback.search(task, resolvedShop, resolvedCriteria, this.searchLimit, signal);
            if (signal?.aborted)
                return [];
            if (rendered.length) {
                observations = rendered;
                ranked = observations
                    .map(observation => ({ observation, match: this.matcher.match(observation, resolvedCriteria) }))
                    .filter(candidate => candidate.match.matched)
                    .sort((a, b) => b.match.score - a.match.score);
            }
        }
        const monitor = this.monitorFor(task.id);
        const relevantEvents = [];
        for (const candidate of ranked) {
            if (signal?.aborted)
                break;
            const event = monitor.observe(candidate.observation, resolvedCriteria);
            if (!event || !isRelevantChange(event))
                continue;
            await this.repository.recordProductMonitorEvent(task.id, event);
            if (this.repository.appendLog) {
                await this.repository.appendLog({
                    taskId: task.id,
                    event: `product:${event.type}`,
                    state: task.state,
                    level: "info",
                    message: monitorMessage(event),
                    createdAt: new Date(event.observedAt)
                });
            }
            relevantEvents.push(event);
            this.options.onEvent?.(task.id, event);
        }
        return relevantEvents;
    }
    async cancelTask(taskId) {
        this.activeRuns.get(taskId)?.controller.abort();
        await this.browserFallback?.cancelTask(taskId).catch(() => undefined);
    }
    resetTask(taskId) {
        this.monitors.delete(taskId);
        this.gateSignaled.delete(taskId);
    }
    async close() {
        for (const run of this.activeRuns.values())
            run.controller.abort();
        this.activeRuns.clear();
        this.monitors.clear();
        this.gateSignaled.clear();
        this.runtimeListeners.clear();
        await this.browserFallback?.close().catch(() => undefined);
    }
    emitTaskUpdate(task) {
        for (const listener of this.runtimeListeners)
            listener(task);
    }
    monitorFor(taskId) {
        let monitor = this.monitors.get(taskId);
        if (!monitor) {
            monitor = new product_monitor_1.ProductMonitor(this.matcher);
            this.monitors.set(taskId, monitor);
        }
        return monitor;
    }
    intervalFor(task) {
        const configured = Number(task.config.data?.["monitorIntervalMs"] ?? this.defaultIntervalMs);
        if (!Number.isFinite(configured))
            return this.defaultIntervalMs;
        return Math.max(this.minimumIntervalMs, Math.floor(configured));
    }
}
exports.CommerceMonitorService = CommerceMonitorService;
//# sourceMappingURL=commerce-monitor-service.js.map