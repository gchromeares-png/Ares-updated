"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeleniumBaseBrowserWorker = void 0;
const tslib_1 = require("tslib");
const child_process_1 = require("child_process");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const errors_1 = require("./errors");
const profile_session_manager_1 = require("./profile-session-manager");
const browser_environment_audit_1 = require("./browser-environment-audit");
const seleniumbase_rpc_page_1 = require("./seleniumbase-rpc-page");
const webrtc_proxy_policy_1 = require("./webrtc/webrtc-proxy-policy");
const WEBRTC_PROXY_POLICY = "--force-webrtc-ip-handling-policy=disable_non_proxied_udp";
const WEBRTC_PERMISSION_CHECK = "--enforce-webrtc-ip-permission-check";
const DISABLE_ASYNC_DNS = "--disable-async-dns";
const DISABLE_FEATURES = "--disable-features=DnsOverHttps,NetworkPrediction";
const PROFILE_PRE_CLOSE_SETTLE_MS = 800;
function proxyValue(proxy) {
    if (!proxy)
        return undefined;
    if (!proxy.host?.trim())
        throw new TypeError("Proxy host must not be empty.");
    if (!Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
        throw new RangeError(`Invalid proxy port: ${proxy.port}`);
    }
    const auth = proxy.username ? `${proxy.username}:${proxy.password ?? ""}@` : "";
    const endpoint = `${auth}${proxy.host.trim()}:${proxy.port}`;
    return proxy.protocol && proxy.protocol !== "http" ? `${proxy.protocol}://${endpoint}` : endpoint;
}
function browserArgs(config) {
    const args = [...(config.args ?? [])];
    if (!config.proxy)
        return args;
    const filtered = args.filter(arg => !arg.startsWith("--force-webrtc-ip-handling-policy=")
        && !arg.startsWith("--disable-features=")
        && !arg.startsWith("--host-resolver-rules=")
        && arg !== "--enable-async-dns");
    if (!filtered.includes(WEBRTC_PERMISSION_CHECK))
        filtered.push(WEBRTC_PERMISSION_CHECK);
    filtered.push(WEBRTC_PROXY_POLICY, DISABLE_ASYNC_DNS, DISABLE_FEATURES);
    if (!config.proxy.bypass?.trim()) {
        filtered.push(`--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE ${config.proxy.host.trim()}`);
    }
    return filtered;
}
class SeleniumBaseBrowserWorker {
    constructor() {
        this.sessions = new Map();
        this.pendingCreations = new Set();
        this.activeProfileDirs = new Set();
        this.taskProfileIds = new Map();
        this.taskCookieSnapshots = new Map();
        this.profileLeases = new Map();
        this.startedAt = new Date();
        this.state = "healthy";
    }
    bindTaskProfile(taskId, profileId) {
        const normalizedTaskId = String(taskId ?? "").trim();
        const normalizedProfileId = String(profileId ?? "").trim();
        if (!normalizedTaskId || !normalizedProfileId)
            throw new TypeError("taskId and profileId are required.");
        this.taskProfileIds.set(normalizedTaskId, normalizedProfileId);
    }
    setTaskCookieSnapshot(taskId, cookies) {
        const id = String(taskId ?? "").trim();
        if (!id)
            throw new TypeError("taskId is required.");
        if (!cookies?.length) {
            this.taskCookieSnapshots.delete(id);
            return;
        }
        this.taskCookieSnapshots.set(id, cookies.map(cookie => ({ ...cookie })));
    }
    unbindTaskProfile(taskId) {
        this.taskProfileIds.delete(taskId);
        this.taskCookieSnapshots.delete(taskId);
    }
    getBoundProfileId(taskId) {
        return this.taskProfileIds.get(taskId);
    }
    getContext(taskId) {
        return this.sessions.get(taskId)?.handle;
    }
    async createContext(config) {
        if (this.state !== "healthy")
            throw new errors_1.BrowserWorkerStateError(this.state);
        if (this.sessions.has(config.taskId) || this.pendingCreations.has(config.taskId)) {
            throw new errors_1.BrowserContextAlreadyExistsError(config.taskId);
        }
        const profileId = this.taskProfileIds.get(config.taskId);
        const requestedRoot = path.dirname(config.userDataDir);
        const effectiveUserDataDir = profileId
            ? (0, profile_session_manager_1.resolveProfileUserDataDir)(profileId, requestedRoot)
            : config.userDataDir;
        const normalizedDir = path.resolve(effectiveUserDataDir);
        if (this.activeProfileDirs.has(normalizedDir)) {
            throw new errors_1.BrowserProfileInUseError(effectiveUserDataDir, `worker:${process.pid}:${config.taskId}`);
        }
        this.pendingCreations.add(config.taskId);
        this.activeProfileDirs.add(normalizedDir);
        fs.mkdirSync(normalizedDir, { recursive: true });
        let lease;
        let child;
        try {
            lease = (0, profile_session_manager_1.acquireBrowserProfileLease)(normalizedDir, `worker:${process.pid}:${config.taskId}`);
            this.profileLeases.set(config.taskId, lease);
            child = (0, child_process_1.spawn)(process.env["ARES_PYTHON_EXECUTABLE"]?.trim() || "python", ["-u", this.resolveWorkerScript()], {
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED: "1",
                    ARES_SB_MONITOR_MODE: config.monitorMode === true ? "1" : "0"
                }
            });
            const runningChild = child;
            const transport = new seleniumbase_rpc_page_1.SeleniumBaseRpcTransport(runningChild);
            await transport.start({
                taskId: config.taskId,
                profileDir: normalizedDir,
                headless: config.headless ?? false,
                proxy: proxyValue(config.proxy),
                userAgent: config.userAgent || undefined,
                browserArgs: browserArgs(config),
                locale: config.locale,
                timezoneId: config.timezoneId
            }, 35000);
            const page = new seleniumbase_rpc_page_1.SeleniumBaseRpcPage(transport);
            page["passiveQueueSnapshot"] = async () => {
                const reply = await transport.request("rpc", { action: "passive-queue-dom" }, 5000);
                const result = reply.result && typeof reply.result === "object" ? reply.result : {};
                return {
                    hasQueuePosition: result["hasQueuePosition"] === true,
                    hasPosition: result["hasPosition"] === true,
                    positionText: String(result["positionText"] ?? ""),
                    statusText: String(result["statusText"] ?? ""),
                    url: String(result["url"] ?? reply.url ?? page.url())
                };
            };
            const context = {
                addCookies: async (cookies) => {
                    await transport.request("apply-cookies", { cookies }, 12000);
                },
                addInitScript: async (script) => {
                    const content = typeof script === "string" ? script : script.content;
                    if (!content?.trim())
                        return;
                    await transport.request("add-init-script", { script: content }, 8000);
                },
                close: async () => {
                    await page.closeTransport();
                    await this.waitForExit(runningChild, 5000);
                    if (runningChild.exitCode == null)
                        runningChild.kill("SIGKILL");
                }
            };
            if (config.proxy)
                await (0, webrtc_proxy_policy_1.installWebRtcProxyPolicy)(context);
            const snapshot = this.taskCookieSnapshots.get(config.taskId);
            if (snapshot?.length) {
                await context.addCookies(snapshot);
            }
            const environmentAudit = await (0, browser_environment_audit_1.collectBrowserEnvironment)(page)
                .catch(error => (0, browser_environment_audit_1.failedBrowserEnvironmentAudit)(error));
            const handle = {
                taskId: config.taskId,
                context,
                page,
                createdAt: new Date(),
                userDataDir: normalizedDir,
                environmentAudit
            };
            this.sessions.set(config.taskId, { child: runningChild, transport, page, context, handle });
            this.lastError = undefined;
            return handle;
        }
        catch (error) {
            if (child && child.exitCode == null)
                child.kill("SIGKILL");
            this.profileLeases.delete(config.taskId);
            lease?.release();
            this.activeProfileDirs.delete(normalizedDir);
            this.lastError = error instanceof Error ? error.message : String(error);
            throw error;
        }
        finally {
            this.pendingCreations.delete(config.taskId);
        }
    }
    async closeContext(taskId) {
        const session = this.sessions.get(taskId);
        const lease = this.profileLeases.get(taskId);
        this.sessions.delete(taskId);
        this.profileLeases.delete(taskId);
        if (!session) {
            lease?.release();
            return;
        }
        this.activeProfileDirs.delete(path.resolve(session.handle.userDataDir));
        try {
            await new Promise(resolve => setTimeout(resolve, PROFILE_PRE_CLOSE_SETTLE_MS));
            await session.context.close();
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            if (session.child.exitCode == null)
                session.child.kill("SIGKILL");
            throw error;
        }
        finally {
            lease?.release();
        }
    }
    async health() {
        return {
            state: this.state,
            activeContexts: this.sessions.size,
            pendingCreations: this.pendingCreations.size,
            contextIds: [...this.sessions.keys()],
            startedAt: this.startedAt,
            uptimeMs: Date.now() - this.startedAt.getTime(),
            lastError: this.lastError
        };
    }
    async shutdown() {
        if (this.state === "stopping" || this.state === "stopped")
            return;
        this.state = "stopping";
        const ids = [...this.sessions.keys()];
        const results = await Promise.allSettled(ids.map(id => this.closeContext(id)));
        for (const lease of this.profileLeases.values())
            lease.release();
        this.profileLeases.clear();
        this.activeProfileDirs.clear();
        this.taskProfileIds.clear();
        this.taskCookieSnapshots.clear();
        const failed = results.filter(result => result.status === "rejected");
        if (failed.length)
            this.lastError = `${failed.length} SeleniumBase browser context(s) failed to close cleanly.`;
        this.state = "stopped";
    }
    resolveWorkerScript() {
        const configured = process.env["ARES_SELENIUMBASE_TASK_WORKER"]?.trim();
        const resourcesPath = process.resourcesPath || "";
        const oopifWorker = "task_browser_worker_oopif.py";
        const legacyWorker = "task_browser_worker.py";
        const candidates = [
            configured,
            path.join(process.cwd(), "python", "seleniumbase_cdp", oopifWorker),
            path.join(__dirname, "../../python/seleniumbase_cdp", oopifWorker),
            resourcesPath ? path.join(resourcesPath, "python", "seleniumbase_cdp", oopifWorker) : undefined,
            path.join(process.cwd(), "python", "seleniumbase_cdp", legacyWorker),
            path.join(__dirname, "../../python/seleniumbase_cdp", legacyWorker),
            resourcesPath ? path.join(resourcesPath, "python", "seleniumbase_cdp", legacyWorker) : undefined
        ].filter((value) => Boolean(value));
        const worker = candidates.find(candidate => fs.existsSync(candidate));
        if (!worker)
            throw new Error("SeleniumBase task worker was not found. Set ARES_SELENIUMBASE_TASK_WORKER if needed.");
        return worker;
    }
    waitForExit(child, timeoutMs) {
        if (child.exitCode != null)
            return Promise.resolve(true);
        return new Promise(resolve => {
            let settled = false;
            const finish = (value) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                child.removeListener("exit", onExit);
                resolve(value);
            };
            const onExit = () => finish(true);
            const timeout = setTimeout(() => finish(false), timeoutMs);
            child.once("exit", onExit);
        });
    }
}
exports.SeleniumBaseBrowserWorker = SeleniumBaseBrowserWorker;
//# sourceMappingURL=seleniumbase-browser-worker.js.map