"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const readline = tslib_1.__importStar(require("readline"));
const early_gate_1 = require("../monitor/early-gate");
const runtime_types_1 = require("./runtime-types");
const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
if (nodeMajor < 20) {
    process.stderr.write(`ARES Browser Worker benötigt Node.js 20 oder höher; gefunden: ${process.versions.node}.\n`);
    process.exit(20);
}
const { AresBrowserRuntime } = require("./ares-browser-runtime");
const { ShopifyTaskExecutor } = require("../shopify/shopify-task-executor");
const { ShopifyPurchaseReadyExecutor } = require("../shopify/shopify-purchase-ready-executor");
const { EarlyGateBrowserTaskExecutor } = require("./early-gate-task-executor");
const { BrowserGateMonitorExecutor } = require("../monitor/browser-gate-monitor-executor");
const { PokemonCenterReleaseJourney } = require("../commerce/pokemon-center/release-journey");
function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
const shops = new Map();
const profiles = new Map();
const browserCore = new AresBrowserRuntime();
const pokemonCenterJourney = new PokemonCenterReleaseJourney();
function stampProfileOwnedBrowserSession(task) {
    const handle = browserCore.getContext(task.id);
    const profileId = browserCore.getBoundProfileId(task.id);
    if (!handle || !profileId)
        return;
    const current = task.config?.data?.["browserSession"];
    task.config.data = { ...(task.config.data ?? {}), browserSession: { ...(current ?? {}), type: "ares-browser-runtime", engine: browserCore.engine, profileId, isolatedPerTask: false, isolatedPerProfile: true, userDataDir: handle.userDataDir } };
}
const emitTaskUpdate = (task) => { stampProfileOwnedBrowserSession(task); send({ type: "task-update", taskId: task.id, taskPatch: { config: task.config, lastError: task.lastError } }); };
const shopifyExecutor = new ShopifyTaskExecutor(shopId => { const shop = shops.get(shopId); return shop && (0, runtime_types_1.isShopifyRuntimeShop)(shop) ? shop : undefined; }, profileId => profiles.get(profileId), browserCore, undefined, emitTaskUpdate);
const shopifyPurchaseReadyExecutor = new ShopifyPurchaseReadyExecutor(shopifyExecutor, browserCore, emitTaskUpdate);
const earlyGateExecutor = new EarlyGateBrowserTaskExecutor(shopId => shops.get(shopId), profileId => profiles.get(profileId), shop => pokemonCenterJourney.supports(shop) ? pokemonCenterJourney : undefined, browserCore, emitTaskUpdate);
const browserGateMonitorExecutor = new BrowserGateMonitorExecutor(shopId => shops.get(shopId), profileId => profiles.get(profileId), browserCore);
browserGateMonitorExecutor.onTaskUpdate(emitTaskUpdate);
function takePaymentSession(request) {
    const data = { ...(request.task.config.data ?? {}) };
    const session = data["__paymentSession"];
    delete data["__paymentSession"];
    request.task.config = { ...request.task.config, data };
    return session;
}
async function handle(request) {
    try {
        if (request.type === "execute") {
            const paymentSession = takePaymentSession(request);
            shops.set(request.shop.id, request.shop);
            profiles.set(request.profile.id, request.profile);
            browserCore.bindTaskProfile(request.task.id, request.profile.id);
            browserCore.setTaskCookieSnapshot(request.task.id, request.cookieSnapshot);
            try {
                const gateMonitor = (0, early_gate_1.isEarlyGateMonitorTask)(request.task);
                const earlyGateChild = (0, early_gate_1.isEarlyGateChildTask)(request.task) && !gateMonitor;
                if (!gateMonitor && !earlyGateChild && !(0, runtime_types_1.isShopifyRuntimeShop)(request.shop))
                    throw new Error(`Für ${request.shop.platform} ist kein regulärer Browser-Executor registriert.`);
                let success;
                if (gateMonitor) {
                    const monitorSuccess = await browserGateMonitorExecutor.execute(request.task);
                    if (!monitorSuccess)
                        success = false;
                    else {
                        request.task.config.data = {
                            ...(request.task.config.data ?? {}),
                            earlyGateLane: {
                                ...(request.task.config.data?.["earlyGateLane"] ?? {}),
                                mode: "completion", handedOffAt: new Date().toISOString()
                            }
                        };
                        emitTaskUpdate(request.task);
                        success = await earlyGateExecutor.execute(request.task, paymentSession);
                    }
                }
                else if (earlyGateChild)
                    success = await earlyGateExecutor.execute(request.task, paymentSession);
                else
                    success = await shopifyPurchaseReadyExecutor.execute(request.task, request.profile, paymentSession);
                stampProfileOwnedBrowserSession(request.task);
                request.task.config.data = { ...(request.task.config.data ?? {}), browserWorker: { pid: process.pid, nodeVersion: process.versions.node, externalProcess: true, runtime: browserCore.runtimeId, engine: browserCore.engine } };
                await browserCore.closeContext(request.task.id).catch(() => undefined);
                browserCore.unbindTaskProfile(request.task.id);
                send({ type: "execute-result", requestId: request.requestId, success, taskPatch: { config: request.task.config, lastError: request.task.lastError } });
                return;
            }
            catch (error) {
                await browserCore.closeContext(request.task.id).catch(() => undefined);
                browserCore.unbindTaskProfile(request.task.id);
                throw error;
            }
        }
        if (request.type === "update-discovery-keywords") {
            const keywords = await earlyGateExecutor.updateDiscoveryKeywords(request.taskId, request.keywords);
            send({ type: "ack", requestId: request.requestId, keywords });
            return;
        }
        if (request.type === "set-final-purchase-permission") {
            await Promise.all([earlyGateExecutor.setFinalPurchaseAllowed(request.allowed === true), shopifyPurchaseReadyExecutor.setFinalPurchaseAllowed(request.allowed === true)]);
            send({ type: "ack", requestId: request.requestId, allowFinalPurchase: request.allowed === true });
            return;
        }
        if (request.type === "cancel") {
            await Promise.allSettled([browserGateMonitorExecutor.cancelTask(request.taskId), earlyGateExecutor.cancelTask(request.taskId), shopifyPurchaseReadyExecutor.cancelTask(request.taskId)]);
            browserCore.unbindTaskProfile(request.taskId);
            send({ type: "ack", requestId: request.requestId });
            return;
        }
        if (request.type === "health") {
            const health = await browserCore.health();
            send({ type: "health-result", requestId: request.requestId, health: { ...health, startedAt: health.startedAt.toISOString() }, pid: process.pid, nodeVersion: process.versions.node });
            return;
        }
        if (request.type === "shutdown") {
            await Promise.all([earlyGateExecutor.setFinalPurchaseAllowed(false), shopifyPurchaseReadyExecutor.setFinalPurchaseAllowed(false)]);
            await browserGateMonitorExecutor.close();
            await earlyGateExecutor.closeAll();
            await shopifyPurchaseReadyExecutor.closeAll();
            await browserCore.shutdown();
            send({ type: "ack", requestId: request.requestId });
            setImmediate(() => process.exit(0));
            return;
        }
        send({ type: "error", requestId: request.requestId, error: `Unbekannter Anfragetyp: ${request.type}` });
    }
    catch (error) {
        send({ type: "error", requestId: request.requestId, error: error instanceof Error ? error.message : String(error) });
    }
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", line => { if (!line.trim())
    return; try {
    const request = JSON.parse(line);
    void handle(request);
}
catch (error) {
    send({ type: "error", error: error instanceof Error ? error.message : String(error) });
} });
let shuttingDown = false;
async function shutdown() { if (shuttingDown)
    return; shuttingDown = true; await Promise.all([earlyGateExecutor.setFinalPurchaseAllowed(false).catch(() => undefined), shopifyPurchaseReadyExecutor.setFinalPurchaseAllowed(false).catch(() => undefined)]); await browserGateMonitorExecutor.close().catch(() => undefined); await earlyGateExecutor.closeAll().catch(() => undefined); await shopifyPurchaseReadyExecutor.closeAll().catch(() => undefined); await browserCore.shutdown().catch(() => undefined); process.exit(0); }
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("uncaughtException", error => { process.stderr.write(`Uncaught browser-worker error: ${error.stack ?? error.message}\n`); void shutdown(); });
process.on("unhandledRejection", reason => { process.stderr.write(`Unhandled browser-worker rejection: ${String(reason)}\n`); void shutdown(); });
send({ type: "ready", nodeVersion: process.versions.node, pid: process.pid });
//# sourceMappingURL=worker.js.map