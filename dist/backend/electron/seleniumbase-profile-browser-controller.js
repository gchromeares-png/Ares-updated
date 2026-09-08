"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeleniumBaseProfileBrowserController = void 0;
const tslib_1 = require("tslib");
const child_process_1 = require("child_process");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const crypto_1 = require("crypto");
const unified_interaction_pipeline_1 = require("../browser-worker/unified-interaction-pipeline");
const profile_cookie_snapshot_registry_1 = require("../cookies/profile-cookie-snapshot-registry");
const profile_session_manager_1 = require("../browser-worker/profile-session-manager");
const WIRE_PREFIX = "ARES_SB_MANUAL\t";
class SeleniumBaseProfileBrowserController {
    constructor(profileRoot, getProxy) {
        this.profileRoot = profileRoot;
        this.getProxy = getProxy;
        this.sessions = new Map();
    }
    async open(profile, startUrl, cookieSnapshotId) {
        const profileId = String(profile.id ?? "").trim();
        if (!profileId)
            throw new Error("Profil-ID fehlt.");
        const existing = this.sessions.get(profileId);
        if (existing && existing.child.exitCode == null)
            return this.status(profileId);
        const userDataDir = this.resolveUserDataDir(profileId);
        const workerScript = this.resolveWorkerScript();
        const pythonExecutable = process.env["ARES_PYTHON_EXECUTABLE"]?.trim() || "python";
        const snapshotId = String(cookieSnapshotId ?? "").trim();
        const cookies = snapshotId
            ? (0, profile_cookie_snapshot_registry_1.readRegisteredProfileCookieSnapshot)(profileId, snapshotId)
            : undefined;
        if (snapshotId && !cookies) {
            throw new Error("Cookie-Snapshot konnte für SeleniumBase nicht geladen werden.");
        }
        const proxy = this.toSeleniumBaseProxy(this.resolveProxy(profile));
        const lease = (0, profile_session_manager_1.acquireBrowserProfileLease)(userDataDir, `manual:${process.pid}:${profileId}`);
        let child;
        try {
            child = (0, child_process_1.spawn)(pythonExecutable, [workerScript], {
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
                env: { ...process.env }
            });
        }
        catch (error) {
            lease.release();
            throw error;
        }
        const session = {
            profileId,
            child,
            userDataDir,
            lease,
            startedAt: new Date().toISOString(),
            appliedSnapshotId: snapshotId || undefined
        };
        this.sessions.set(profileId, session);
        child.once("exit", () => {
            if (this.sessions.get(profileId)?.child === child)
                this.sessions.delete(profileId);
            lease.release();
        });
        child.once("error", () => lease.release());
        const requestId = (0, crypto_1.randomUUID)();
        const payload = {
            type: "start",
            requestId,
            profileId,
            profileDir: userDataDir,
            startUrl: startUrl?.trim() || undefined,
            proxy,
            userAgent: profile.browser?.userAgent || undefined,
            headless: false,
            cookies
        };
        try {
            const ready = this.waitForMessage(child, requestId, "ready", 30000, true);
            child.stdin.write(`${JSON.stringify(payload)}\n`);
            const message = await ready;
            return {
                engine: "seleniumbase-cdp",
                profileId,
                open: true,
                pid: message.pid ?? child.pid,
                userDataDir: message.profileDir || userDataDir,
                startedAt: session.startedAt,
                appliedSnapshotId: session.appliedSnapshotId
            };
        }
        catch (error) {
            this.sessions.delete(profileId);
            if (child.exitCode == null)
                child.kill("SIGTERM");
            else
                lease.release();
            throw error;
        }
    }
    async autofill(profileId, values) {
        const id = String(profileId ?? "").trim();
        const pipeline = new unified_interaction_pipeline_1.UnifiedInteractionPipeline({
            observeFields: () => this.observeSemanticFields(id),
            executePlan: plan => this.executeSemanticPlan(id, plan)
        });
        return pipeline.autofill(values);
    }
    async observeSemanticFields(profileId) {
        const message = await this.sendCommand(profileId, "observe-semantic-fields", "semantic-fields", {}, 12000);
        return Array.isArray(message.fields) ? message.fields : [];
    }
    async executeSemanticPlan(profileId, plan) {
        const message = await this.sendCommand(profileId, "execute-semantic-plan", "semantic-plan-result", { plan }, 15000);
        const results = Array.isArray(message.results) ? message.results : [];
        const fallbackNeeded = Array.isArray(message.fallbackNeeded) ? message.fallbackNeeded : [];
        return {
            planned: Number(message.planned ?? plan.length),
            applied: Number(message.applied ?? 0),
            verified: Boolean(message.verified),
            results,
            fallbackNeeded
        };
    }
    async applySnapshot(profileId, snapshotId) {
        const id = String(profileId ?? "").trim();
        const selected = String(snapshotId ?? "").trim();
        if (!selected)
            throw new Error("Cookie-Snapshot fehlt.");
        const session = this.requireOpenSession(id);
        const cookies = (0, profile_cookie_snapshot_registry_1.readRegisteredProfileCookieSnapshot)(id, selected);
        if (!cookies)
            throw new Error("Cookie-Snapshot konnte für SeleniumBase nicht geladen werden.");
        const requestId = (0, crypto_1.randomUUID)();
        session.child.stdin.write(`${JSON.stringify({ type: "apply-cookies", requestId, cookies })}\n`);
        const message = await this.waitForMessage(session.child, requestId, "cookies-applied", 12000);
        session.appliedSnapshotId = selected;
        return { count: Number(message.count ?? cookies.length), snapshotId: selected };
    }
    async captureCookies(profileId) {
        const id = String(profileId ?? "").trim();
        const session = this.requireOpenSession(id);
        const requestId = (0, crypto_1.randomUUID)();
        session.child.stdin.write(`${JSON.stringify({ type: "export-cookies", requestId })}\n`);
        const message = await this.waitForMessage(session.child, requestId, "cookies", 12000);
        return Array.isArray(message.cookies) ? message.cookies : [];
    }
    async saveSnapshot(profileId, name, snapshotId) {
        const cookies = await this.captureCookies(profileId);
        return (0, profile_cookie_snapshot_registry_1.saveRegisteredProfileCookieSnapshot)(profileId, name, cookies, snapshotId);
    }
    async close(profileId) {
        const id = String(profileId ?? "").trim();
        const session = this.sessions.get(id);
        if (!session)
            return this.status(id);
        const child = session.child;
        if (child.exitCode == null) {
            const requestId = (0, crypto_1.randomUUID)();
            try {
                child.stdin.write(`${JSON.stringify({ type: "close", requestId })}\n`);
                await this.waitForMessage(child, requestId, "closed", 10000);
            }
            catch {
                if (child.exitCode == null)
                    child.kill("SIGTERM");
            }
            const graceful = await this.waitForExit(child, 4000);
            if (!graceful && child.exitCode == null)
                child.kill("SIGKILL");
        }
        this.sessions.delete(id);
        if (child.exitCode != null)
            session.lease.release();
        return this.status(id);
    }
    status(profileId) {
        const id = String(profileId ?? "").trim();
        const session = this.sessions.get(id);
        const open = Boolean(session && session.child.exitCode == null);
        return {
            engine: "seleniumbase-cdp",
            profileId: id,
            open,
            pid: open ? session?.child.pid : undefined,
            userDataDir: this.resolveUserDataDir(id),
            startedAt: open ? session?.startedAt : undefined,
            appliedSnapshotId: open ? session?.appliedSnapshotId : undefined
        };
    }
    isOpen(profileId) {
        return this.status(profileId).open;
    }
    async closeAll() {
        await Promise.allSettled([...this.sessions.keys()].map(profileId => this.close(profileId)));
    }
    async sendCommand(profileId, type, expectedType, payload, timeoutMs) {
        const session = this.requireOpenSession(String(profileId ?? "").trim());
        const requestId = (0, crypto_1.randomUUID)();
        session.child.stdin.write(`${JSON.stringify({ type, requestId, ...payload })}\n`);
        return this.waitForMessage(session.child, requestId, expectedType, timeoutMs);
    }
    requireOpenSession(profileId) {
        const session = this.sessions.get(profileId);
        if (!session || session.child.exitCode != null) {
            throw new Error("SeleniumBase-CDP-Profilbrowser ist nicht geöffnet.");
        }
        return session;
    }
    resolveUserDataDir(profileId) {
        return (0, profile_session_manager_1.resolveProfileUserDataDir)(profileId, this.profileRoot);
    }
    resolveWorkerScript() {
        const configured = process.env["ARES_SELENIUMBASE_MANUAL_WORKER"]?.trim();
        const resourcesPath = process.resourcesPath || "";
        const candidates = [
            configured,
            path.join(process.cwd(), "python", "seleniumbase_cdp", "manual_profile_browser.py"),
            path.join(__dirname, "../../python/seleniumbase_cdp/manual_profile_browser.py"),
            resourcesPath ? path.join(resourcesPath, "python", "seleniumbase_cdp", "manual_profile_browser.py") : undefined
        ].filter((value) => Boolean(value));
        const worker = candidates.find(candidate => fs.existsSync(candidate));
        if (!worker) {
            throw new Error("SeleniumBase-CDP-Worker wurde nicht gefunden. ARES_SELENIUMBASE_MANUAL_WORKER kann den Pfad explizit setzen.");
        }
        return worker;
    }
    waitForMessage(child, requestId, expectedType, timeoutMs, includeStderr = false) {
        return new Promise((resolve, reject) => {
            let stdoutBuffer = "";
            let stderrBuffer = "";
            let settled = false;
            const timeout = setTimeout(() => finishError(new Error(`SeleniumBase ${expectedType} Timeout.`)), timeoutMs);
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
                finishError(new Error(`SeleniumBase-Prozess wurde beendet (code=${String(code)}).${detail}`));
            };
            const onError = (error) => finishError(error);
            const onStderr = (chunk) => {
                stderrBuffer = `${stderrBuffer}${String(chunk)}`.slice(-4000);
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
                        finishError(new Error(message.error || "SeleniumBase-CDP-Workerfehler."));
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
    waitForExit(child, timeoutMs) {
        if (child.exitCode != null)
            return Promise.resolve(true);
        return new Promise(resolve => {
            let settled = false;
            const finish = (exited) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                child.removeListener("exit", onExit);
                resolve(exited);
            };
            const onExit = () => finish(true);
            const timeout = setTimeout(() => finish(false), timeoutMs);
            child.once("exit", onExit);
        });
    }
    resolveProxy(profile) {
        const preferredProxyId = profile.preferredProxyId?.trim();
        if (preferredProxyId) {
            const proxy = this.getProxy(preferredProxyId);
            if (!proxy)
                throw new Error(`Standard-Proxy ${preferredProxyId} existiert nicht mehr.`);
            return {
                protocol: proxy.protocol,
                host: proxy.host,
                port: proxy.port,
                username: proxy.username,
                password: proxy.password
            };
        }
        if (!profile.proxy?.host || !profile.proxy.port)
            return undefined;
        return {
            protocol: profile.proxy.protocol || "http",
            host: profile.proxy.host,
            port: profile.proxy.port,
            username: profile.proxy.username || undefined,
            password: profile.proxy.password || undefined
        };
    }
    toSeleniumBaseProxy(proxy) {
        if (!proxy?.host || !proxy.port)
            return undefined;
        const auth = proxy.username
            ? `${proxy.username}:${proxy.password ?? ""}@`
            : "";
        const endpoint = `${auth}${proxy.host}:${proxy.port}`;
        return proxy.protocol && proxy.protocol !== "http"
            ? `${proxy.protocol}://${endpoint}`
            : endpoint;
    }
}
exports.SeleniumBaseProfileBrowserController = SeleniumBaseProfileBrowserController;
//# sourceMappingURL=seleniumbase-profile-browser-controller.js.map