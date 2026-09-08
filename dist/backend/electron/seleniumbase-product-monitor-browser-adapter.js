"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeleniumBaseProductMonitorBrowserAdapter = void 0;
const tslib_1 = require("tslib");
const child_process_1 = require("child_process");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const crypto_1 = require("crypto");
const generic_html_product_api_adapter_1 = require("../commerce/product-api/generic-html-product-api-adapter");
const WIRE_PREFIX = "ARES_MONITOR_BROWSER\t";
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
function safeSegment(value) {
    return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120) || "monitor";
}
class SeleniumBaseProductMonitorBrowserAdapter {
    constructor(profileRoot, getProxy) {
        this.profileRoot = profileRoot;
        this.getProxy = getProxy;
        this.sessions = new Map();
    }
    async search(task, shop, query, limit = 50, signal) {
        if (signal?.aborted)
            return [];
        const session = await this.ensureSession(task, shop);
        const http = {
            get: async (url) => {
                if (signal?.aborted)
                    throw new Error("Monitor browser request aborted.");
                const document = await this.render(session, url);
                if (signal?.aborted)
                    throw new Error("Monitor browser request aborted.");
                return {
                    status: 200,
                    headers: { "content-type": "text/html; charset=utf-8" },
                    text: document.html || document.text || "",
                    url: document.url || url
                };
            }
        };
        const parser = new generic_html_product_api_adapter_1.GenericHtmlProductApiAdapter(http);
        const observations = await parser.search(shop, query, limit);
        return observations.map(observation => ({
            ...observation,
            attributes: {
                ...(observation.attributes ?? {}),
                source: "seleniumbase-rendered-html",
                browserRendered: true
            }
        }));
    }
    async cancelTask(taskId) {
        const id = String(taskId ?? "").trim();
        const session = this.sessions.get(id);
        if (!session)
            return;
        this.sessions.delete(id);
        await this.closeSession(session);
    }
    async close() {
        const sessions = [...this.sessions.values()];
        this.sessions.clear();
        await Promise.allSettled(sessions.map(session => this.closeSession(session)));
    }
    async ensureSession(task, shop) {
        const taskId = String(task.id ?? "").trim();
        if (!taskId)
            throw new Error("Monitor browser task id is missing.");
        const existing = this.sessions.get(taskId);
        if (existing && existing.child.exitCode == null)
            return existing;
        if (existing)
            this.sessions.delete(taskId);
        const action = this.monitorAction(task);
        const profileDir = path.join(this.profileRoot, "monitor-runtime", safeSegment(action.runtimeProfileId || taskId), safeSegment(taskId));
        fs.mkdirSync(profileDir, { recursive: true });
        const workerScript = this.resolveWorkerScript();
        const python = process.env["ARES_PYTHON_EXECUTABLE"]?.trim() || "python";
        const child = (0, child_process_1.spawn)(python, [workerScript], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: { ...process.env }
        });
        const session = {
            taskId,
            child,
            profileDir,
            startedAt: new Date().toISOString()
        };
        this.sessions.set(taskId, session);
        child.once("exit", () => {
            if (this.sessions.get(taskId)?.child === child)
                this.sessions.delete(taskId);
        });
        const requestId = (0, crypto_1.randomUUID)();
        const ready = this.waitForMessage(child, requestId, "ready", 45000, true);
        child.stdin.write(`${JSON.stringify({
            type: "start",
            requestId,
            taskId,
            profileDir,
            startUrl: shop.baseUrl,
            headless: action.headless === true,
            userAgent: action.runtimeUserAgent || undefined,
            proxy: this.proxyString(this.resolveProxy(action))
        })}\n`);
        try {
            await ready;
            return session;
        }
        catch (error) {
            this.sessions.delete(taskId);
            if (child.exitCode == null)
                child.kill("SIGTERM");
            throw error;
        }
    }
    async render(session, url) {
        const requestId = (0, crypto_1.randomUUID)();
        const response = this.waitForMessage(session.child, requestId, "rendered-document", 20000, true);
        session.child.stdin.write(`${JSON.stringify({
            type: "render",
            requestId,
            url,
            stableMs: 650,
            timeoutMs: 9000
        })}\n`);
        const message = await response;
        if (!message.url)
            throw new Error("SeleniumBase monitor returned no document URL.");
        if (typeof message.html !== "string")
            throw new Error("SeleniumBase monitor returned no rendered HTML.");
        return message;
    }
    monitorAction(task) {
        return asRecord(task.config.data?.["monitorAction"]) ?? {};
    }
    resolveProxy(action) {
        const selection = action.proxySelection;
        if (selection?.mode === "direct")
            return undefined;
        if (selection?.mode === "proxy") {
            const proxyId = String(selection.proxyId ?? "").trim();
            if (!proxyId)
                throw new Error("Monitor proxy selection has no proxy id.");
            const proxy = this.getProxy(proxyId);
            if (!proxy)
                throw new Error(`Monitor proxy ${proxyId} was not found.`);
            return proxy;
        }
        const preferred = String(action.runtimePreferredProxyId ?? "").trim();
        if (!preferred)
            return undefined;
        const proxy = this.getProxy(preferred);
        if (!proxy)
            throw new Error(`Monitor runtime profile proxy ${preferred} was not found.`);
        return proxy;
    }
    proxyString(proxy) {
        if (!proxy?.host || !proxy.port)
            return undefined;
        const auth = proxy.username ? `${proxy.username}:${proxy.password ?? ""}@` : "";
        const endpoint = `${auth}${proxy.host}:${proxy.port}`;
        return proxy.protocol && proxy.protocol !== "http" ? `${proxy.protocol}://${endpoint}` : endpoint;
    }
    async closeSession(session) {
        const child = session.child;
        if (child.exitCode != null)
            return;
        const requestId = (0, crypto_1.randomUUID)();
        try {
            const closed = this.waitForMessage(child, requestId, "closed", 8000);
            child.stdin.write(`${JSON.stringify({ type: "close", requestId })}\n`);
            await closed;
        }
        catch {
            if (child.exitCode == null)
                child.kill("SIGTERM");
        }
    }
    resolveWorkerScript() {
        const configured = process.env["ARES_MONITOR_BROWSER_WORKER"]?.trim();
        const resourcesPath = process.resourcesPath || "";
        const candidates = [
            configured,
            path.join(process.cwd(), "python", "seleniumbase_cdp", "product_monitor_browser.py"),
            path.join(__dirname, "../../python/seleniumbase_cdp/product_monitor_browser.py"),
            resourcesPath ? path.join(resourcesPath, "python", "seleniumbase_cdp", "product_monitor_browser.py") : undefined
        ].filter((value) => Boolean(value));
        const worker = candidates.find(candidate => fs.existsSync(candidate));
        if (!worker)
            throw new Error("SeleniumBase product monitor worker was not found.");
        return worker;
    }
    waitForMessage(child, requestId, expectedType, timeoutMs, includeStderr = false) {
        return new Promise((resolve, reject) => {
            let stdoutBuffer = "";
            let stderrBuffer = "";
            let settled = false;
            const timeout = setTimeout(() => finishError(new Error(`SeleniumBase monitor ${expectedType} timeout.`)), timeoutMs);
            const cleanup = () => {
                clearTimeout(timeout);
                child.stdout.removeListener("data", onStdout);
                child.stderr.removeListener("data", onStderr);
                child.removeListener("exit", onExit);
                child.removeListener("error", onError);
            };
            const finishError = (error) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                reject(error);
            };
            const finishSuccess = (message) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                resolve(message);
            };
            const onExit = (code) => {
                const detail = includeStderr && stderrBuffer.trim() ? ` ${stderrBuffer.trim()}` : "";
                finishError(new Error(`SeleniumBase monitor process exited (code=${String(code)}).${detail}`));
            };
            const onError = (error) => finishError(error);
            const onStderr = (chunk) => {
                stderrBuffer = `${stderrBuffer}${String(chunk)}`.slice(-5000);
            };
            const onStdout = (chunk) => {
                stdoutBuffer += String(chunk);
                const lines = stdoutBuffer.split(/\r?\n/);
                stdoutBuffer = lines.pop() ?? "";
                for (const line of lines) {
                    if (!line.startsWith(WIRE_PREFIX))
                        continue;
                    let message;
                    try {
                        message = JSON.parse(line.slice(WIRE_PREFIX.length));
                    }
                    catch {
                        continue;
                    }
                    if (message.requestId && message.requestId !== requestId)
                        continue;
                    if (message.type === "error") {
                        finishError(new Error(message.error || "SeleniumBase monitor worker error."));
                        return;
                    }
                    if (message.type === expectedType) {
                        finishSuccess(message);
                        return;
                    }
                }
            };
            child.stdout.setEncoding("utf8");
            child.stderr.setEncoding("utf8");
            child.stdout.on("data", onStdout);
            child.stderr.on("data", onStderr);
            child.once("exit", onExit);
            child.once("error", onError);
        });
    }
}
exports.SeleniumBaseProductMonitorBrowserAdapter = SeleniumBaseProductMonitorBrowserAdapter;
//# sourceMappingURL=seleniumbase-product-monitor-browser-adapter.js.map