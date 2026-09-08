"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const orchestrator_1 = require("../orchestrator");
const mocks_1 = require("../mocks");
const client_1 = require("../browser-worker/client");
const profile_session_manager_1 = require("../browser-worker/profile-session-manager");
const models_1 = require("../models");
const profile_repository_1 = require("../profiles/profile-repository");
const proxy_repository_1 = require("../proxies/proxy-repository");
const proxy_health_service_1 = require("../proxies/proxy-health-service");
const payment_session_normalizer_1 = require("../payments/payment-session-normalizer");
const ephemeral_payment_executor_1 = require("../payments/ephemeral-payment-executor");
const sqlite_task_store_1 = require("../persistence/sqlite-task-store");
const task_persistence_coordinator_1 = require("../persistence/task-persistence-coordinator");
const platforms_1 = require("../commerce/platforms");
const task_executor_router_1 = require("../commerce/task-executor-router");
const router_1 = require("../commerce/product-api/router");
const commerce_monitor_service_1 = require("../monitor/commerce-monitor-service");
const auto_checkout_coordinator_1 = require("../monitor/auto-checkout-coordinator");
const pre_checkout_gate_1 = require("../monitor/pre-checkout-gate");
const early_gate_1 = require("../monitor/early-gate");
const capmonster_api_key_health_1 = require("./capmonster-api-key-health");
const profile_browser_controller_1 = require("./profile-browser-controller");
const profile_payment_controller_1 = require("./profile-payment-controller");
let mainWindow = null;
let orchestrator;
let browserWorker;
let profileBrowserController;
let profilePaymentVault;
let browserProfileRoot = "";
let commerceExecutor;
let commerceMonitor;
let autoCheckoutCoordinator;
let taskStore;
let persistenceCoordinator;
let quitting = false;
let allowFinalPurchase = false;
function broadcastTaskUpdate(task) {
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send("task-status-update", task);
        }
    }
}
function broadcastMonitorUpdate(payload) {
    for (const win of electron_1.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send("product-monitor-update", payload);
        }
    }
}
const shops = new Map();
const profileRepository = new profile_repository_1.ProfileRepository();
const proxyRepository = new proxy_repository_1.ProxyRepository();
const proxyHealthService = new proxy_health_service_1.ProxyHealthService();
const paymentSessions = new Map();
const visibleMonitorBrowserProfiles = new Map();
function normalizeStoredShop(input) {
    if (!input?.id || !input?.baseUrl)
        return undefined;
    const platform = (0, platforms_1.normalizeCommercePlatform)(input.platform ?? "shopify");
    if (!platform)
        return undefined;
    return {
        id: String(input.id).trim(),
        name: String(input.name || input.id).trim(),
        baseUrl: String(input.baseUrl).trim(),
        platform,
        config: input.config && typeof input.config === "object" ? input.config : {}
    };
}
function getShopsFilePath() {
    try {
        const userData = electron_1.app?.getPath ? electron_1.app.getPath("userData") : undefined;
        return userData ? path.join(userData, "shops.json") : undefined;
    }
    catch {
        return undefined;
    }
}
function persistShops() {
    const filePath = getShopsFilePath();
    if (!filePath)
        return;
    try {
        fs.writeFileSync(filePath, JSON.stringify([...shops.values()], null, 2), "utf8");
    }
    catch { }
}
function loadShops() {
    const filePath = getShopsFilePath();
    if (!filePath)
        return;
    try {
        if (fs.existsSync(filePath)) {
            const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (Array.isArray(items)) {
                for (const item of items) {
                    const shop = normalizeStoredShop(item);
                    if (shop)
                        shops.set(shop.id, shop);
                }
            }
        }
    }
    catch { }
}
function parseNodeMajor(versionText) {
    const match = versionText.trim().match(/^v?(\d+)/);
    return match ? Number(match[1]) : undefined;
}
function readSystemNodeStatus() {
    const executable = process.env["ARES_NODE_EXECUTABLE"]?.trim() || "node";
    try {
        const version = (0, child_process_1.execFileSync)(executable, ["-v"], {
            encoding: "utf8",
            timeout: 4000,
            windowsHide: true
        }).trim();
        const major = parseNodeMajor(version);
        return {
            executable,
            version,
            major,
            ok: typeof major === "number" && major >= 20,
            error: typeof major === "number" && major >= 20
                ? undefined
                : `System Node muss mindestens v20 sein, aktuell: ${version || "unbekannt"}.`
        };
    }
    catch (error) {
        return {
            executable,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
function monitorAction(task) {
    const value = task?.config?.data?.["monitorAction"];
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
async function openVisibleProductMonitorBrowser(task) {
    if (!task || (0, early_gate_1.getMonitorStrategy)(task).mode === "early-gate")
        return;
    const action = monitorAction(task);
    // New monitor tasks carry runtimeProfileId and let CommerceMonitorService's
    // SeleniumBase fallback own the monitor browser. Older persisted tasks keep
    // the previous visible profile-browser path for backward compatibility.
    if (action?.runtimeProfileId)
        return;
    if (action?.mode !== "auto-checkout" || action.headless === true)
        return;
    if (visibleMonitorBrowserProfiles.has(String(task.id)))
        return;
    const profileId = String(task.config?.data?.["profileId"] ?? action.profileId ?? "").trim();
    if (!profileId)
        throw new Error("Sichtbarer Monitor-Browser benötigt ein Profil.");
    const profile = profileRepository.get(profileId);
    if (!profile)
        throw new Error(`Monitor-Profil ${profileId} wurde nicht gefunden.`);
    if (profileBrowserController.isOpen(profileId)) {
        throw new Error(`Profil ${profile.name || profileId} ist bereits in einem Browser geöffnet.`);
    }
    const shopId = String(task.config?.shopId ?? "").trim();
    const shop = shops.get(shopId);
    if (!shop)
        throw new Error(`Shop ${shopId || "(ohne ID)"} wurde nicht gefunden.`);
    const cookieSnapshotId = String(task.config?.data?.["cookieSnapshotId"] ?? action.cookieSnapshotId ?? "").trim();
    await profileBrowserController.open(profile, {
        startUrl: shop.baseUrl,
        ...(cookieSnapshotId ? { cookieSnapshotId } : {})
    });
    visibleMonitorBrowserProfiles.set(String(task.id), profileId);
    broadcastMonitorUpdate({
        taskId: String(task.id),
        browserMonitor: { status: "visible", profileId, url: shop.baseUrl }
    });
}
async function closeVisibleProductMonitorBrowser(taskId) {
    const id = String(taskId ?? "").trim();
    const profileId = visibleMonitorBrowserProfiles.get(id);
    if (!profileId)
        return;
    visibleMonitorBrowserProfiles.delete(id);
    await profileBrowserController.close(profileId).catch(() => undefined);
    broadcastMonitorUpdate({ taskId: id, browserMonitor: { status: "closed", profileId } });
}
async function createBackend() {
    const userData = electron_1.app.getPath("userData");
    profileRepository.setStoragePath(path.join(userData, "profiles.json"));
    proxyRepository.setStoragePath(path.join(userData, "proxies.json"));
    profilePaymentVault = (0, profile_payment_controller_1.registerProfilePaymentIpc)(userData);
    loadShops();
    browserProfileRoot = path.join(userData, "browser-profiles");
    profileBrowserController = new profile_browser_controller_1.ProfileBrowserController(browserProfileRoot, proxyId => proxyRepository.get(proxyId));
    // Hard runtime default: final purchase is never enabled by persisted/UI state.
    allowFinalPurchase = false;
    browserWorker = new client_1.BrowserWorkerPoolClient(shopId => shops.get(shopId), profileId => profileRepository.get(profileId), {
        profileRoot: browserProfileRoot,
        getProxy: proxyId => proxyRepository.get(proxyId)
    });
    taskStore = await sqlite_task_store_1.SqliteTaskStore.open(path.join(userData, "ares.sqlite"));
    const productApiRouter = new router_1.CommerceProductApiRouter();
    commerceMonitor = new commerce_monitor_service_1.CommerceMonitorService(shopId => shops.get(shopId), productApiRouter, taskStore, {
        preCheckoutGate: new pre_checkout_gate_1.PassiveHttpPreCheckoutGate(),
        onEvent: (taskId, event) => {
            broadcastMonitorUpdate({ taskId, event });
            void (async () => {
                if (event.current.available)
                    await closeVisibleProductMonitorBrowser(taskId);
                await autoCheckoutCoordinator?.handleProductEvent(taskId, event);
            })().catch(error => {
                const task = orchestrator?.getTask(taskId);
                if (task) {
                    task.lastError = error instanceof Error ? error.message : String(error);
                    broadcastTaskUpdate(task);
                }
            });
        },
        onGateEvent: (taskId, event) => {
            broadcastMonitorUpdate({ taskId, gateEvent: event });
            void autoCheckoutCoordinator?.handleGateEvent(taskId, event).catch(error => {
                const task = orchestrator?.getTask(taskId);
                if (task) {
                    task.lastError = error instanceof Error ? error.message : String(error);
                    broadcastTaskUpdate(task);
                }
            });
        }
    });
    const paymentAwareBrowserWorker = new ephemeral_payment_executor_1.EphemeralPaymentExecutor(browserWorker, taskId => paymentSessions.get(taskId), (profileId, preference) => profilePaymentVault.toCheckoutPaymentSession(profileId, preference));
    commerceExecutor = new task_executor_router_1.CommerceTaskExecutorRouter(shopId => shops.get(shopId));
    commerceExecutor.register("shopify", paymentAwareBrowserWorker);
    commerceExecutor.registerMonitorExecutor(commerceMonitor);
    commerceExecutor.registerEarlyGateExecutor(paymentAwareBrowserWorker);
    await commerceExecutor.setFinalPurchaseAllowed(false);
    orchestrator = new orchestrator_1.TaskOrchestrator(taskStore, commerceExecutor);
    autoCheckoutCoordinator = new auto_checkout_coordinator_1.MonitorAutoCheckoutCoordinator(orchestrator, {
        getPaymentSession: taskId => paymentSessions.get(taskId),
        setPaymentSession: (taskId, session) => paymentSessions.set(taskId, session),
        onTriggered: (parent, child, event) => {
            broadcastMonitorUpdate({
                taskId: parent.id,
                event,
                autoCheckout: { childTaskId: child.id, status: "triggered" }
            });
            broadcastTaskUpdate(parent);
            broadcastTaskUpdate(child);
        },
        onGateTriggered: (parent, child, event) => {
            broadcastMonitorUpdate({
                taskId: parent.id,
                gateEvent: event,
                earlyGate: { childTaskId: child.id, status: "triggered" }
            });
            broadcastTaskUpdate(parent);
            broadcastTaskUpdate(child);
        }
    });
    persistenceCoordinator = new task_persistence_coordinator_1.TaskPersistenceCoordinator(orchestrator, taskStore);
    await orchestrator.initialize();
    const configuredConcurrency = Number(process.env["ARES_MAX_CONCURRENT_TASKS"] ?? "4");
    const maxConcurrentTasks = Number.isFinite(configuredConcurrency)
        ? Math.min(16, Math.max(1, Math.floor(configuredConcurrency)))
        : 4;
    for (let index = 1; index <= maxConcurrentTasks; index++) {
        orchestrator.addWorker(new mocks_1.WorkerMock(`browser-slot-${index}`));
    }
    const forwardTask = (task) => {
        if (task?.id && [models_1.TaskState.SUCCESS, models_1.TaskState.FAILED, models_1.TaskState.CANCELLED].includes(task.state)) {
            paymentSessions.delete(String(task.id));
            void closeVisibleProductMonitorBrowser(String(task.id));
        }
        mainWindow?.webContents.send("task-status-update", task);
    };
    orchestrator.on("taskCreated", forwardTask);
    orchestrator.on("taskQueued", forwardTask);
    orchestrator.on("taskStarted", forwardTask);
    orchestrator.on("taskUpdated", forwardTask);
    orchestrator.on("taskPaused", forwardTask);
    orchestrator.on("taskResumed", forwardTask);
    orchestrator.on("taskCompleted", forwardTask);
    orchestrator.on("taskFailed", forwardTask);
    orchestrator.on("taskCancelled", forwardTask);
    orchestrator.on("taskRetrying", forwardTask);
}
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 980,
        minHeight: 680,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    const devServerUrl = process.env["ARES_UI_URL"];
    if (devServerUrl)
        void win.loadURL(devServerUrl);
    else
        void win.loadFile(path.join(__dirname, "../../ares/index.html"));
    return win;
}
function findActiveTaskForProfile(profileId) {
    return orchestrator?.getAllTasks().find(task => {
        if ([models_1.TaskState.SUCCESS, models_1.TaskState.FAILED, models_1.TaskState.CANCELLED].includes(task.state))
            return false;
        const data = task.config.data ?? {};
        const action = data["monitorAction"];
        const assigned = String(data["profileId"] ?? action?.profileId ?? "").trim();
        return assigned === profileId;
    });
}
electron_1.ipcMain.handle("get-profiles", () => ({ success: true, profiles: profileRepository.getAll() }));
electron_1.ipcMain.handle("save-profile", (_event, profile) => {
    if (!profile?.id || !profile?.name) {
        return { success: false, error: "Profil-ID und Profilname sind erforderlich." };
    }
    if (profile.preferredProxyId && !proxyRepository.get(profile.preferredProxyId)) {
        return { success: false, error: `Standard-Proxy ${profile.preferredProxyId} existiert nicht.` };
    }
    profileRepository.save(profile);
    return { success: true, profile };
});
electron_1.ipcMain.handle("get-profile-browser-status", (_event, profileId) => {
    const id = String(profileId ?? "").trim();
    if (!id || !profileRepository.get(id))
        return { success: false, error: "Profil wurde nicht gefunden." };
    return { success: true, status: profileBrowserController.status(id) };
});
electron_1.ipcMain.handle("open-profile-browser", async (_event, profileId, startUrl) => {
    const id = String(profileId ?? "").trim();
    const profile = profileRepository.get(id);
    if (!profile)
        return { success: false, error: `Profil ${id || "(ohne ID)"} wurde nicht gefunden.` };
    const activeTask = findActiveTaskForProfile(id);
    if (activeTask) {
        return { success: false, error: `Profil ist aktuell durch Task ${activeTask.config.name} belegt.` };
    }
    try {
        const status = await profileBrowserController.open(profile, startUrl);
        return { success: true, status };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle("close-profile-browser", async (_event, profileId) => {
    const id = String(profileId ?? "").trim();
    if (!id)
        return { success: false, error: "Profil-ID fehlt." };
    try {
        const status = await profileBrowserController.close(id);
        return { success: true, status };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle("delete-profile", async (_event, profileId) => {
    const id = String(profileId ?? "").trim();
    const profile = profileRepository.get(id);
    if (!profile)
        return { success: false, error: "Profil wurde nicht gefunden." };
    if (profileBrowserController.isOpen(id)) {
        return { success: false, error: "Profil-Browser ist noch geöffnet. Browser zuerst schließen." };
    }
    const activeTask = findActiveTaskForProfile(id);
    if (activeTask) {
        return { success: false, error: `Profil ist noch Task ${activeTask.config.name} zugeordnet.` };
    }
    if (!profileRepository.delete(id))
        return { success: false, error: "Profil konnte nicht gelöscht werden." };
    try {
        (0, profile_session_manager_1.removeProfileUserDataDir)(id, browserProfileRoot);
        profilePaymentVault.delete(id);
        return { success: true };
    }
    catch (error) {
        profileRepository.save(profile);
        return {
            success: false,
            error: `Browserdaten konnten nicht sicher gelöscht werden: ${error instanceof Error ? error.message : String(error)}`
        };
    }
});
electron_1.ipcMain.handle("get-proxies", () => ({ success: true, proxies: proxyRepository.getAll() }));
electron_1.ipcMain.handle("save-proxy", (_event, input) => {
    try {
        const proxy = proxyRepository.save(input);
        return { success: true, proxy };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle("test-proxy", async (_event, proxyId) => {
    const id = String(proxyId ?? "").trim();
    const proxy = proxyRepository.get(id);
    if (!proxy)
        return { success: false, error: `Proxy ${id || "(ohne ID)"} wurde nicht gefunden.` };
    const health = await proxyHealthService.test(proxy);
    const saved = proxyRepository.save({ ...proxy, health });
    return { success: health.status === "online", proxy: saved, health, error: health.error };
});
electron_1.ipcMain.handle("test-all-proxies", async () => {
    const results = [];
    for (const proxy of proxyRepository.getAll()) {
        const health = await proxyHealthService.test(proxy);
        const saved = proxyRepository.save({ ...proxy, health });
        results.push({ proxyId: proxy.id, success: health.status === "online", health, proxy: saved });
    }
    return { success: true, results, proxies: proxyRepository.getAll() };
});
electron_1.ipcMain.handle("delete-proxy", (_event, proxyId) => {
    const id = String(proxyId ?? "").trim();
    if (!id)
        return { success: false, error: "Proxy-ID fehlt." };
    const assignedProfile = profileRepository.getAll().find(profile => profile.preferredProxyId === id);
    if (assignedProfile) {
        return { success: false, error: `Proxy ist als Standard in Profil ${assignedProfile.name} zugeordnet.` };
    }
    const activeTask = orchestrator.getAllTasks().find(task => {
        if ([models_1.TaskState.SUCCESS, models_1.TaskState.FAILED, models_1.TaskState.CANCELLED].includes(task.state))
            return false;
        const selection = task.config.data?.["proxySelection"];
        const action = task.config.data?.["monitorAction"];
        return (selection?.mode === "proxy" && selection.proxyId === id)
            || (action?.mode === "auto-checkout" && action.proxySelection?.mode === "proxy" && action.proxySelection.proxyId === id);
    });
    if (activeTask) {
        return { success: false, error: `Proxy ist noch Task ${activeTask.config.name} zugeordnet.` };
    }
    return { success: proxyRepository.delete(id) };
});
electron_1.ipcMain.handle("set-payment-session", (_event, taskId, input) => {
    const id = String(taskId ?? "").trim();
    if (!id || !orchestrator.getTask(id)) {
        return { success: false, error: "Task für Zahlungsdaten wurde nicht gefunden." };
    }
    const session = (0, payment_session_normalizer_1.normalizePaymentSessionInput)(input);
    if (!session) {
        paymentSessions.delete(id);
        return { success: false, error: "Ungültige Zahlungsart." };
    }
    paymentSessions.set(id, session);
    return { success: true, method: session.method };
});
electron_1.ipcMain.handle("clear-payment-session", (_event, taskId) => {
    paymentSessions.delete(String(taskId ?? ""));
    return { success: true };
});
electron_1.ipcMain.handle("get-shops", () => ({
    success: true,
    shops: [...shops.values()],
    platforms: platforms_1.COMMERCE_PLATFORMS,
    executorPlatforms: commerceExecutor?.listExecutorPlatforms() ?? [],
    monitorReady: commerceExecutor?.hasMonitorExecutor() ?? false,
    earlyGateReady: commerceExecutor?.hasEarlyGateExecutor() ?? false
}));
electron_1.ipcMain.handle("register-shop", (_event, input) => {
    if (!input?.id || !input?.baseUrl) {
        return { success: false, error: "Shop-ID und Shop-URL sind erforderlich." };
    }
    const platform = (0, platforms_1.normalizeCommercePlatform)(input.platform ?? "shopify");
    if (!platform) {
        return {
            success: false,
            error: `Unbekannte Commerce-Plattform. Unterstützte Typen: ${platforms_1.COMMERCE_PLATFORMS.join(", ")}`
        };
    }
    const shop = {
        id: String(input.id).trim(),
        name: String(input.name || input.id).trim(),
        baseUrl: String(input.baseUrl).trim(),
        platform,
        config: input.config && typeof input.config === "object" ? input.config : {}
    };
    shops.set(shop.id, shop);
    persistShops();
    return {
        success: true,
        shop,
        executorReady: commerceExecutor.hasExecutor(platform),
        monitorReady: commerceExecutor.hasMonitorExecutor(),
        earlyGateReady: commerceExecutor.hasEarlyGateExecutor()
    };
});
electron_1.ipcMain.handle("create-task", (_event, input) => {
    try {
        const task = orchestrator.createTask(input);
        broadcastTaskUpdate(task);
        return { success: true, taskId: task.id, task };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle("start-task", async (_event, taskId) => {
    try {
        const existing = orchestrator.getTask(taskId);
        if (!existing)
            return { success: false, error: `Task ${taskId} not found.` };
        if ((0, commerce_monitor_service_1.isCommerceMonitorTask)(existing)) {
            await openVisibleProductMonitorBrowser(existing);
            void orchestrator.startTask(taskId).catch(async (error) => {
                await closeVisibleProductMonitorBrowser(taskId);
                existing.lastError = error instanceof Error ? error.message : String(error);
                broadcastTaskUpdate(existing);
            });
            broadcastTaskUpdate(existing);
            return { success: true, task: existing };
        }
        await orchestrator.startTask(taskId);
        const task = orchestrator.getTask(taskId);
        broadcastTaskUpdate(task);
        return task?.lastError
            ? { success: false, error: task.lastError, task }
            : { success: true, task };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            task: orchestrator.getTask(taskId)
        };
    }
});
electron_1.ipcMain.handle("pause-task", async (_event, taskId) => {
    try {
        await orchestrator.pauseTask(taskId);
        const task = orchestrator.getTask(taskId);
        broadcastTaskUpdate(task);
        return { success: true, task };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), task: orchestrator.getTask(taskId) };
    }
});
electron_1.ipcMain.handle("resume-task", async (_event, taskId) => {
    try {
        await orchestrator.resumeTask(taskId);
        const task = orchestrator.getTask(taskId);
        broadcastTaskUpdate(task);
        return { success: true, task };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), task: orchestrator.getTask(taskId) };
    }
});
electron_1.ipcMain.handle("stop-task", async (_event, taskId) => {
    try {
        paymentSessions.delete(taskId);
        await closeVisibleProductMonitorBrowser(taskId);
        orchestrator.cancelTask(taskId);
        const task = orchestrator.getTask(taskId);
        commerceMonitor.resetTask(taskId);
        broadcastTaskUpdate(task);
        return { success: true, task };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle("update-discovery-keywords", async (_event, taskId, input) => {
    try {
        const id = String(taskId ?? "").trim();
        const task = orchestrator.getTask(id);
        if (!task || !(0, early_gate_1.isEarlyGateChildTask)(task)) {
            return { success: false, error: "Early-Gate-Browser-Child wurde nicht gefunden." };
        }
        if (task.state !== models_1.TaskState.POST_QUEUE_DISCOVERY) {
            return { success: false, error: "Discovery-Keywords können nur während POST_QUEUE_DISCOVERY geändert werden." };
        }
        const requested = (0, early_gate_1.normalizeDiscoveryKeywords)(input);
        const keywords = await commerceExecutor.updateDiscoveryKeywords(id, requested);
        const postQueue = task.config.data?.["postQueueDiscovery"];
        task.config.data = {
            ...(task.config.data ?? {}),
            postQueueDiscovery: {
                ...(postQueue ?? {}),
                keywords,
                updatedAt: new Date().toISOString()
            }
        };
        broadcastTaskUpdate(task);
        return { success: true, taskId: id, keywords };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle("get-final-purchase-setting", () => ({
    success: true,
    allowFinalPurchase
}));
electron_1.ipcMain.handle("set-final-purchase-allowed", async (_event, input) => {
    const requested = input === true;
    allowFinalPurchase = requested;
    try {
        await commerceExecutor.setFinalPurchaseAllowed(requested);
        return { success: true, allowFinalPurchase };
    }
    catch (error) {
        // Fail closed if any worker cannot confirm the global setting.
        allowFinalPurchase = false;
        await commerceExecutor.setFinalPurchaseAllowed(false).catch(() => undefined);
        return {
            success: false,
            allowFinalPurchase: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
});
electron_1.ipcMain.handle("get-task-status", (_event, taskId) => {
    const task = orchestrator.getTask(taskId);
    return task
        ? { success: true, status: task.state, task }
        : { success: false, error: `Task ${taskId} not found.` };
});
electron_1.ipcMain.handle("get-task-list", () => ({ success: true, tasks: orchestrator.getAllTasks() }));
electron_1.ipcMain.handle("get-task-logs", async (_event, taskId, limit = 100) => {
    try {
        const logs = await taskStore.findLogsByTaskId(taskId, limit);
        return { success: true, logs };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle("get-product-monitor-events", async (_event, taskId, limit = 100) => {
    try {
        const events = await taskStore.findProductMonitorEventsByTaskId(taskId, limit);
        return { success: true, events };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle("test-capmonster-api-key", async () => (0, capmonster_api_key_health_1.testCapMonsterApiKey)());
electron_1.ipcMain.handle("get-system-status", async () => {
    const systemNode = readSystemNodeStatus();
    return {
        success: true,
        availableWorkers: orchestrator.getAvailableWorkers(),
        shopCount: shops.size,
        taskCount: orchestrator.getAllTasks().length,
        profileCount: profileRepository.getAll().length,
        proxyCount: proxyRepository.getAll().length,
        commercePlatforms: platforms_1.COMMERCE_PLATFORMS,
        commerceExecutorPlatforms: commerceExecutor.listExecutorPlatforms(),
        commerceMonitorReady: commerceExecutor.hasMonitorExecutor(),
        earlyGateReady: commerceExecutor.hasEarlyGateExecutor(),
        allowFinalPurchase,
        captchaProvider: "CapMonster",
        captchaApiKeyConfigured: (0, capmonster_api_key_health_1.isCapMonsterApiKeyConfigured)(),
        liveChallengeSupport: ["turnstile", "recaptcha", "shopify-checkpoint"],
        electronNodeVersion: process.versions.node,
        systemNodeRequirement: ">=20",
        systemNode,
        persistence: {
            type: "sqlite",
            ready: true,
            error: persistenceCoordinator.getLastError()
        },
        browserWorkerPool: await browserWorker.health()
    };
});
electron_1.app.whenReady().then(async () => {
    try {
        (0, capmonster_api_key_health_1.loadCapMonsterApiKeyFromEnvFiles)(electron_1.app.getAppPath());
        await createBackend();
        mainWindow = createWindow();
        mainWindow.on("closed", () => { mainWindow = null; });
        electron_1.app.on("activate", () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0)
                mainWindow = createWindow();
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        electron_1.dialog.showErrorBox("ARES Startfehler", `Backend/SQLite konnte nicht initialisiert werden.\n\n${message}`);
        electron_1.app.quit();
    }
});
electron_1.app.on("before-quit", event => {
    if (quitting)
        return;
    event.preventDefault();
    quitting = true;
    void (async () => {
        allowFinalPurchase = false;
        await commerceExecutor?.setFinalPurchaseAllowed(false).catch(() => undefined);
        paymentSessions.clear();
        visibleMonitorBrowserProfiles.clear();
        await profileBrowserController?.closeAll().catch(() => undefined);
        await commerceExecutor?.close().catch(() => undefined);
        orchestrator?.cleanup();
        await persistenceCoordinator?.close().catch(() => undefined);
        await taskStore?.close().catch(() => undefined);
        electron_1.app.quit();
    })();
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
//# sourceMappingURL=main.js.map