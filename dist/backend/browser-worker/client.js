"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserWorkerClient = exports.BrowserWorkerPoolClient = exports.BrowserWorkerProcessClient = void 0;
const tslib_1 = require("tslib");
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const path = tslib_1.__importStar(require("path"));
const profile_cookie_snapshot_registry_1 = require("../cookies/profile-cookie-snapshot-registry");
function boundedMs(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
function isEarlyGateExecution(task) {
    const trigger = task.config.data?.["triggerSource"];
    return trigger?.["kind"] === "early-gate";
}
class BrowserWorkerProcessClient {
    constructor(requestTimeoutMs, profileRoot, onExit, onTaskUpdate = () => undefined, heartbeatIntervalMs = 30000, heartbeatTimeoutMs = 10000, executeTimeoutMs = 65 * 60000) {
        this.requestTimeoutMs = requestTimeoutMs;
        this.profileRoot = profileRoot;
        this.onExit = onExit;
        this.onTaskUpdate = onTaskUpdate;
        this.heartbeatIntervalMs = heartbeatIntervalMs;
        this.heartbeatTimeoutMs = heartbeatTimeoutMs;
        this.executeTimeoutMs = executeTimeoutMs;
        this.stdoutBuffer = "";
        this.stderrBuffer = "";
        this.stderrLineBuffer = "";
        this.pending = new Map();
        this.taskIds = new Set();
        this.taskRefs = new Map();
        this.closing = false;
        this.heartbeatInFlight = false;
        this.restartCount = 0;
        this.desiredFinalPurchaseAllowed = false;
    }
    get load() { return this.taskIds.size; }
    owns(taskId) { return this.taskIds.has(taskId); }
    async start() { await this.ensureReady(); }
    async execute(task, shop, profile, cookieSnapshot) {
        this.taskIds.add(task.id);
        this.taskRefs.set(task.id, task);
        try {
            await this.ensureReady();
            await this.syncFinalPurchasePermission();
            const response = await this.request({
                type: "execute",
                requestId: (0, crypto_1.randomUUID)(),
                task,
                shop,
                profile,
                cookieSnapshot
            }, this.executeTimeoutFor(task));
            if (response.type !== "execute-result")
                throw new Error(`Unerwartete Browser-Worker-Antwort: ${response.type}`);
            task.config = response.taskPatch.config;
            task.lastError = response.taskPatch.lastError;
            return response.success;
        }
        finally {
            this.taskIds.delete(task.id);
            this.taskRefs.delete(task.id);
        }
    }
    async updateDiscoveryKeywords(taskId, keywords) {
        if (!this.owns(taskId))
            throw new Error(`Browser Worker besitzt Task ${taskId} nicht.`);
        await this.ensureReady();
        const response = await this.request({ type: "update-discovery-keywords", requestId: (0, crypto_1.randomUUID)(), taskId, keywords }, 10000);
        if (response.type !== "ack")
            throw new Error(`Unerwartete Keyword-Antwort: ${response.type}`);
        return response.keywords ?? [];
    }
    async setFinalPurchaseAllowed(allowed) {
        this.desiredFinalPurchaseAllowed = allowed === true;
        if (!this.child || this.child.killed)
            return;
        await this.ensureReady();
        await this.syncFinalPurchasePermission();
    }
    async cancelTask(taskId) {
        if (!this.child) {
            this.taskIds.delete(taskId);
            this.taskRefs.delete(taskId);
            return;
        }
        await this.ensureReady();
        try {
            await this.request({ type: "cancel", requestId: (0, crypto_1.randomUUID)(), taskId }, 10000);
        }
        finally {
            this.taskIds.delete(taskId);
            this.taskRefs.delete(taskId);
        }
    }
    async health() {
        if (!this.child || this.child.killed)
            return this.snapshot(false);
        await this.ensureReady();
        const response = await this.request({ type: "health", requestId: (0, crypto_1.randomUUID)() }, this.heartbeatTimeoutMs);
        if (response.type !== "health-result")
            throw new Error(`Unerwartete Health-Antwort: ${response.type}`);
        this.lastHeartbeatAt = new Date();
        return {
            pid: response.pid,
            nodeVersion: response.nodeVersion,
            activeTasks: this.taskIds.size,
            browser: { ...response.health, startedAt: new Date(response.health.startedAt) },
            running: true,
            lastHeartbeatAt: this.lastHeartbeatAt,
            restartCount: this.restartCount,
            lastFailure: this.lastFailure
        };
    }
    snapshot(running = Boolean(this.child && !this.child.killed)) {
        return { pid: this.pid, nodeVersion: this.nodeVersion, activeTasks: this.taskIds.size, running, lastHeartbeatAt: this.lastHeartbeatAt, restartCount: this.restartCount, lastFailure: this.lastFailure };
    }
    async close() {
        const child = this.child;
        if (!child || child.exitCode !== null || child.signalCode !== null)
            return;
        this.closing = true;
        this.stopHeartbeat();
        try {
            const response = await this.request({ type: "shutdown", requestId: (0, crypto_1.randomUUID)() }, 20000);
            if (response.type !== "ack")
                throw new Error(`Unerwartete Shutdown-Antwort: ${response.type}`);
            await this.waitForWorkerExit(child, 5000);
        }
        catch {
            if (child.exitCode === null && child.signalCode === null && !child.killed)
                child.kill("SIGKILL");
            await this.waitForWorkerExit(child, 5000).catch(() => undefined);
        }
    }
    waitForWorkerExit(child, timeoutMs) {
        if (child.exitCode !== null || child.signalCode !== null)
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            let timer;
            const finish = (error) => {
                if (timer)
                    clearTimeout(timer);
                child.off("exit", onExit);
                if (error)
                    reject(error);
                else
                    resolve();
            };
            const onExit = () => finish();
            child.once("exit", onExit);
            timer = setTimeout(() => finish(new Error("Browser Worker wurde nach Shutdown nicht beendet.")), timeoutMs);
            timer.unref();
            if (child.exitCode !== null || child.signalCode !== null)
                finish();
        });
    }
    executeTimeoutFor(task) {
        if (!isEarlyGateExecution(task))
            return this.executeTimeoutMs;
        const data = task.config.data ?? {};
        const browserConfig = data["browserConfig"];
        const queueMs = boundedMs(browserConfig?.["queueMaxWaitMs"] ?? data["queueMaxWaitMs"], 60 * 60000, 1000, 60 * 60000);
        const discoveryMs = boundedMs(data["discoveryMaxMs"], 45 * 60000, 60000, 60 * 60000);
        const checkoutPreparationMs = boundedMs(data["checkoutPreparationMaxMs"], 10 * 60000, 30000, 30 * 60000);
        return Math.max(this.executeTimeoutMs, queueMs + discoveryMs + checkoutPreparationMs + 10 * 60000);
    }
    async ensureReady() {
        if (!this.child || this.child.killed)
            this.spawnWorker();
        if (!this.ready)
            throw new Error("Browser Worker konnte nicht initialisiert werden.");
        return this.ready;
    }
    async syncFinalPurchasePermission() {
        const response = await this.request({ type: "set-final-purchase-permission", requestId: (0, crypto_1.randomUUID)(), allowed: this.desiredFinalPurchaseAllowed }, 10000);
        if (response.type !== "ack")
            throw new Error(`Unerwartete Purchase-Permission-Antwort: ${response.type}`);
    }
    spawnWorker() {
        // @ts-ignore
        const nodeExecutable = process.env.ARES_NODE_EXECUTABLE?.trim() || "node";
        const workerScript = path.join(__dirname, "worker.js");
        const child = (0, child_process_1.spawn)(nodeExecutable, [workerScript], {
            stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
            env: { ...process.env, ARES_BROWSER_WORKER: "1", ...(this.profileRoot ? { ARES_BROWSER_PROFILE_ROOT: this.profileRoot } : {}) }
        });
        this.child = child;
        this.stdoutBuffer = "";
        this.stderrBuffer = "";
        this.stderrLineBuffer = "";
        this.lastHeartbeatAt = undefined;
        this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", chunk => this.handleStdout(String(chunk)));
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", chunk => this.handleStderr(String(chunk)));
        child.on("error", error => this.handleWorkerExit(new Error(`Browser Worker konnte nicht mit Node-Executable "${nodeExecutable}" gestartet werden: ${error.message}`), child));
        child.on("exit", (code, signal) => {
            const details = this.stderrBuffer.trim();
            this.handleWorkerExit(new Error(`Browser Worker beendet (code=${String(code)}, signal=${String(signal)}).${details ? ` ${details}` : ""}`), child);
        });
    }
    handleStderr(chunk) {
        this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-8000);
        this.stderrLineBuffer += chunk;
        const lines = this.stderrLineBuffer.split(/\r?\n/);
        this.stderrLineBuffer = lines.pop() ?? "";
        for (const line of lines) {
            if (line.startsWith("[MONITOR]"))
                process.stderr.write(`${line}\n`);
        }
    }
    handleStdout(chunk) {
        this.stdoutBuffer += chunk;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.trim())
                continue;
            let message;
            try {
                message = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (message.type === "ready") {
                this.pid = message.pid;
                this.nodeVersion = message.nodeVersion;
                this.readyResolve?.();
                this.readyResolve = undefined;
                this.readyReject = undefined;
                this.lastHeartbeatAt = new Date();
                this.startHeartbeat();
                continue;
            }
            if (message.type === "task-update") {
                const task = this.taskRefs.get(message.taskId);
                if (task) {
                    task.config = message.taskPatch.config;
                    task.lastError = message.taskPatch.lastError;
                    this.onTaskUpdate(task);
                }
                continue;
            }
            const requestId = "requestId" in message ? message.requestId : undefined;
            if (!requestId)
                continue;
            const pending = this.pending.get(requestId);
            if (!pending)
                continue;
            clearTimeout(pending.timeout);
            this.pending.delete(requestId);
            if (message.type === "error")
                pending.reject(new Error(message.error));
            else
                pending.resolve(message);
        }
    }
    request(request, timeoutMs = this.requestTimeoutMs) {
        const child = this.child;
        if (!child || child.killed)
            return Promise.reject(new Error("Browser Worker ist nicht aktiv."));
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const error = new Error(`Browser Worker Timeout für ${request.type}.`);
                this.pending.delete(request.requestId);
                reject(error);
                this.recycleWorker(error, child);
            }, timeoutMs);
            timeout.unref();
            this.pending.set(request.requestId, { resolve, reject, timeout });
            child.stdin.write(`${JSON.stringify(request)}\n`, error => {
                if (!error)
                    return;
                clearTimeout(timeout);
                this.pending.delete(request.requestId);
                reject(error);
                this.recycleWorker(error, child);
            });
        });
    }
    startHeartbeat() {
        this.stopHeartbeat();
        if (this.heartbeatIntervalMs <= 0)
            return;
        this.heartbeatTimer = setInterval(() => void this.runHeartbeat(), this.heartbeatIntervalMs);
        this.heartbeatTimer.unref();
    }
    stopHeartbeat() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
        this.heartbeatInFlight = false;
    }
    async runHeartbeat() {
        if (this.closing || this.heartbeatInFlight || !this.child || this.child.killed)
            return;
        const child = this.child;
        this.heartbeatInFlight = true;
        try {
            const response = await this.request({ type: "health", requestId: (0, crypto_1.randomUUID)() }, this.heartbeatTimeoutMs);
            if (response.type !== "health-result") {
                this.recycleWorker(new Error(`Unerwartete Heartbeat-Antwort: ${response.type}`), child);
                return;
            }
            this.lastHeartbeatAt = new Date();
        }
        catch (error) {
            if (this.child === child) {
                const reason = error instanceof Error ? error : new Error(String(error));
                this.recycleWorker(new Error(`Browser Worker Heartbeat fehlgeschlagen: ${reason.message}`), child);
            }
        }
        finally {
            this.heartbeatInFlight = false;
        }
    }
    recycleWorker(error, child = this.child) {
        if (!child || this.child !== child)
            return;
        const shouldReplace = !this.closing;
        this.restartCount += 1;
        this.lastFailure = error.message;
        if (!child.killed)
            child.kill("SIGKILL");
        this.handleWorkerExit(error, child);
        if (shouldReplace && !this.child)
            this.spawnWorker();
    }
    handleWorkerExit(error, child = this.child) {
        if (!child || this.child !== child)
            return;
        const shouldNotify = !this.closing;
        this.stopHeartbeat();
        this.lastFailure = error.message;
        this.readyReject?.(error);
        this.readyResolve = undefined;
        this.readyReject = undefined;
        this.ready = undefined;
        this.child = undefined;
        this.pid = undefined;
        this.nodeVersion = undefined;
        this.taskIds.clear();
        this.taskRefs.clear();
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
        if (shouldNotify)
            this.onExit(this, error);
        this.closing = false;
    }
}
exports.BrowserWorkerProcessClient = BrowserWorkerProcessClient;
class BrowserWorkerPoolClient {
    constructor(getShop, getProfile, options = {}) {
        this.getShop = getShop;
        this.getProfile = getProfile;
        this.taskOwners = new Map();
        this.runtimeListeners = new Set();
        this.allowFinalPurchase = false;
        this.getProxy = options.getProxy ?? (() => undefined);
        this.getCookieSnapshot = options.getCookieSnapshot ?? profile_cookie_snapshot_registry_1.readRegisteredProfileCookieSnapshot;
        // @ts-ignore
        const requestedCount = options.processCount ?? Number(process.env.ARES_BROWSER_WORKER_PROCESSES ?? "1");
        const processCount = Number.isFinite(requestedCount) ? Math.min(4, Math.max(1, Math.floor(requestedCount))) : 1;
        const requestTimeoutMs = options.requestTimeoutMs ?? 120000;
        this.executeTimeoutMs = options.executeTimeoutMs ?? 65 * 60000;
        this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
        this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 10000;
        const emitTaskUpdate = (task) => {
            options.onTaskUpdate?.(task);
            for (const listener of this.runtimeListeners)
                listener(task);
        };
        this.clients = Array.from({ length: processCount }, () => new BrowserWorkerProcessClient(requestTimeoutMs, options.profileRoot, (client, error) => this.handleClientExit(client, error), emitTaskUpdate, this.heartbeatIntervalMs, this.heartbeatTimeoutMs, this.executeTimeoutMs));
    }
    onTaskUpdate(callback) {
        this.runtimeListeners.add(callback);
        return () => this.runtimeListeners.delete(callback);
    }
    async execute(task) {
        const shopId = task.config.shopId;
        if (!shopId) {
            task.lastError = "Task hat keine shopId.";
            return false;
        }
        const profileId = String((task.config.data ?? {})["profileId"] ?? "");
        if (!profileId) {
            task.lastError = "Kein Profil für den Task ausgewählt.";
            return false;
        }
        const shop = this.getShop(shopId);
        if (!shop) {
            task.lastError = `Shop ${shopId} ist nicht registriert.`;
            return false;
        }
        const profile = this.getProfile(profileId);
        if (!profile) {
            task.lastError = `Profil ${profileId} ist nicht registriert.`;
            return false;
        }
        let effectiveProfile;
        try {
            effectiveProfile = this.resolveEffectiveProfile(task, profile);
        }
        catch (error) {
            task.lastError = error instanceof Error ? error.message : String(error);
            return false;
        }
        let cookieSnapshot;
        const snapshotId = String(task.config.data?.["cookieSnapshotId"] ?? "").trim();
        if (snapshotId) {
            try {
                cookieSnapshot = this.getCookieSnapshot(profileId, snapshotId);
                if (!cookieSnapshot?.length)
                    throw new Error("Snapshot ist leer oder nicht vorhanden.");
            }
            catch (error) {
                task.lastError = `Cookie-Snapshot konnte nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`;
                return false;
            }
        }
        const client = this.taskOwners.get(task.id) ?? this.leastLoadedClient();
        this.taskOwners.set(task.id, client);
        await client.setFinalPurchaseAllowed(this.allowFinalPurchase);
        try {
            return await client.execute(task, shop, effectiveProfile, cookieSnapshot);
        }
        catch (error) {
            task.lastError = error instanceof Error ? error.message : String(error);
            return false;
        }
        finally {
            this.taskOwners.delete(task.id);
        }
    }
    async updateDiscoveryKeywords(taskId, keywords) {
        const owner = this.taskOwners.get(taskId);
        if (!owner)
            throw new Error(`Laufender Browser-Child ${taskId} wurde nicht gefunden.`);
        return owner.updateDiscoveryKeywords(taskId, keywords);
    }
    async setFinalPurchaseAllowed(allowed) {
        this.allowFinalPurchase = allowed === true;
        await Promise.all(this.clients.map(client => client.setFinalPurchaseAllowed(this.allowFinalPurchase)));
    }
    async cancelTask(taskId) {
        const owner = this.taskOwners.get(taskId);
        if (!owner)
            return;
        try {
            await owner.cancelTask(taskId);
        }
        finally {
            this.taskOwners.delete(taskId);
        }
    }
    async health() {
        const workers = await Promise.all(this.clients.map(client => client.health().catch(() => client.snapshot(false))));
        return { workers, lastError: this.lastWorkerError, watchdog: { heartbeatIntervalMs: this.heartbeatIntervalMs, heartbeatTimeoutMs: this.heartbeatTimeoutMs, executeTimeoutMs: this.executeTimeoutMs } };
    }
    async close() {
        this.allowFinalPurchase = false;
        this.taskOwners.clear();
        this.runtimeListeners.clear();
        await Promise.allSettled(this.clients.map(client => client.close()));
    }
    resolveEffectiveProfile(task, profile) {
        const data = task.config.data ?? {};
        const selection = data["proxySelection"];
        const mode = selection?.mode ?? "profile-default";
        if (mode === "direct") {
            data["proxyRuntime"] = { mode: "direct" };
            task.config.data = data;
            return { ...profile, proxy: undefined };
        }
        const proxyId = mode === "proxy" ? selection?.proxyId : profile.preferredProxyId;
        if (mode === "proxy" && !proxyId)
            throw new Error("Proxy-Modus gewählt, aber keine Proxy-ID zugeordnet.");
        if (proxyId) {
            const proxy = this.getProxy(proxyId);
            if (!proxy)
                throw new Error(`Zugeordneter Proxy ${proxyId} ist nicht mehr vorhanden.`);
            data["proxyRuntime"] = { mode, proxyId: proxy.id, proxyName: proxy.name };
            task.config.data = data;
            return { ...profile, proxy: { protocol: proxy.protocol, host: proxy.host, port: proxy.port, username: proxy.username, password: proxy.password } };
        }
        data["proxyRuntime"] = profile.proxy?.host ? { mode: "legacy-profile" } : { mode: "direct" };
        task.config.data = data;
        return profile;
    }
    leastLoadedClient() {
        return this.clients.reduce((best, current) => current.load < best.load ? current : best);
    }
    handleClientExit(client, error) {
        this.lastWorkerError = error.message;
        for (const [taskId, owner] of this.taskOwners)
            if (owner === client)
                this.taskOwners.delete(taskId);
    }
}
exports.BrowserWorkerPoolClient = BrowserWorkerPoolClient;
exports.BrowserWorkerClient = BrowserWorkerPoolClient;
//# sourceMappingURL=client.js.map