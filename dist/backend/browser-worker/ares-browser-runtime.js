"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AresBrowserRuntime = void 0;
const tslib_1 = require("tslib");
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const seleniumbase_browser_worker_1 = require("./seleniumbase-browser-worker");
/**
 * Single browser-runtime boundary for task/monitor sessions.
 *
 * Manual profile sessions and normal task sessions now share SeleniumBase Pure
 * CDP as the only active browser engine. Session ownership, leases, health,
 * cookies and shutdown stay in TypeScript; browser operations are delegated to
 * the Python SeleniumBase RPC worker.
 *
 * One loopback SigLIP service is also owned per Node browser worker so all
 * SeleniumBase session processes reuse a single warm model instead of loading
 * one model per browser session.
 */
class AresBrowserRuntime extends seleniumbase_browser_worker_1.SeleniumBaseBrowserWorker {
    constructor() {
        super();
        this.runtimeId = "ares-browser-runtime";
        this.engine = "seleniumbase-cdp";
        if (!this.sharedVisionDisabled() && !process.env["ARES_VISION_SERVICE_URL"]?.trim()) {
            // Start the service immediately, while the Python side preloads the model
            // in the background. Browser worker readiness itself stays non-blocking.
            void this.ensureSharedVisionService();
        }
    }
    async createContext(config) {
        // Session Python processes inherit ARES_VISION_SERVICE_URL/TOKEN from this
        // process. Wait only for the lightweight loopback listener, not model load.
        await this.ensureSharedVisionService();
        const handle = await super.createContext(config);
        // Reuse the existing task identity as the seed namespace for the existing
        // InteractionEngine/SeededRandom path. No second RNG or seed subsystem is
        // introduced; every task simply owns a distinct namespace from startup.
        handle.page["interactionSeed"] = String(config.taskId);
        return handle;
    }
    async shutdown() {
        await super.shutdown();
        const starting = this.sharedVisionStart;
        if (starting)
            await starting.catch(() => undefined);
        await this.stopSharedVisionService();
    }
    sharedVisionDisabled() {
        return process.env["ARES_SHARED_VISION_DISABLED"]?.trim() === "1";
    }
    async ensureSharedVisionService() {
        if (this.sharedVisionDisabled())
            return undefined;
        // Respect an explicitly supplied external/shared service instead of
        // shadowing operator configuration.
        if (process.env["ARES_VISION_SERVICE_URL"]?.trim() && !this.sharedVision)
            return undefined;
        const existing = this.sharedVision;
        if (existing && existing.child.exitCode == null) {
            this.publishSharedVisionEnvironment(existing);
            return existing;
        }
        if (this.sharedVisionStart)
            return this.sharedVisionStart;
        this.sharedVisionStart = this.startSharedVisionService()
            .finally(() => { this.sharedVisionStart = undefined; });
        return this.sharedVisionStart;
    }
    async startSharedVisionService() {
        let child;
        try {
            const script = this.resolveVisionServiceScript();
            const token = (0, crypto_1.randomBytes)(24).toString("hex");
            const args = [
                "-u",
                script,
                "--host", "127.0.0.1",
                "--port", "0",
                "--token", token
            ];
            if (process.env["ARES_VISION_SERVICE_PRELOAD"]?.trim() !== "0")
                args.push("--preload");
            child = (0, child_process_1.spawn)(process.env["ARES_PYTHON_EXECUTABLE"]?.trim() || "python", args, {
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
                env: { ...process.env, PYTHONUNBUFFERED: "1" }
            });
            const started = await this.readStartupLine(child, 8000);
            if (started["ready"] !== true)
                throw new Error(String(started["error"] || "shared vision service did not become ready"));
            const url = String(started["url"] || "").trim();
            if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(url)) {
                throw new Error(`shared vision service returned unsafe URL: ${url || "<empty>"}`);
            }
            const service = { child, url, token };
            this.sharedVision = service;
            this.publishSharedVisionEnvironment(service);
            child.once("exit", () => {
                const current = this.sharedVision;
                if (!current || current.child !== child)
                    return;
                this.clearSharedVisionEnvironment(current);
                this.sharedVision = undefined;
            });
            return service;
        }
        catch (error) {
            if (child && child.exitCode == null)
                child.kill("SIGKILL");
            // Availability beats optimization: if the shared owner cannot start,
            // session processes retain the existing local lazy-classifier fallback.
            process.stderr.write(`[ARES vision] shared service unavailable; using local fallback: ${error instanceof Error ? error.message : String(error)}\n`);
            return undefined;
        }
    }
    publishSharedVisionEnvironment(service) {
        process.env["ARES_VISION_SERVICE_URL"] = service.url;
        process.env["ARES_VISION_SERVICE_TOKEN"] = service.token;
    }
    clearSharedVisionEnvironment(service) {
        if (process.env["ARES_VISION_SERVICE_URL"] === service.url)
            delete process.env["ARES_VISION_SERVICE_URL"];
        if (process.env["ARES_VISION_SERVICE_TOKEN"] === service.token)
            delete process.env["ARES_VISION_SERVICE_TOKEN"];
    }
    async stopSharedVisionService() {
        const service = this.sharedVision;
        this.sharedVision = undefined;
        if (!service)
            return;
        this.clearSharedVisionEnvironment(service);
        if (service.child.exitCode != null)
            return;
        service.child.kill("SIGTERM");
        const exited = await this.waitForChildExit(service.child, 3000);
        if (!exited && service.child.exitCode == null)
            service.child.kill("SIGKILL");
    }
    resolveVisionServiceScript() {
        const configured = process.env["ARES_VISION_SERVICE_SCRIPT"]?.trim();
        const resourcesPath = process.resourcesPath || "";
        const filename = "vision_inference_service.py";
        const candidates = [
            configured,
            path.join(process.cwd(), "python", "seleniumbase_cdp", filename),
            path.join(__dirname, "../../python/seleniumbase_cdp", filename),
            resourcesPath ? path.join(resourcesPath, "python", "seleniumbase_cdp", filename) : undefined
        ].filter((value) => Boolean(value));
        const script = candidates.find(candidate => fs.existsSync(candidate));
        if (!script)
            throw new Error("Shared vision service script was not found. Set ARES_VISION_SERVICE_SCRIPT if needed.");
        return script;
    }
    readStartupLine(child, timeoutMs) {
        return new Promise((resolve, reject) => {
            let stdout = "";
            let stderr = "";
            let settled = false;
            const finish = (error, value) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                child.stdout.removeListener("data", onStdout);
                child.stderr.removeListener("data", onStderr);
                child.removeListener("exit", onExit);
                if (error)
                    reject(error);
                else
                    resolve(value ?? {});
            };
            const onStderr = (chunk) => {
                stderr = `${stderr}${String(chunk)}`.slice(-4096);
            };
            const onStdout = (chunk) => {
                stdout += String(chunk);
                const newline = stdout.indexOf("\n");
                if (newline < 0)
                    return;
                const line = stdout.slice(0, newline).trim();
                try {
                    const value = JSON.parse(line);
                    finish(undefined, value);
                }
                catch (error) {
                    finish(new Error(`invalid shared vision startup response: ${error instanceof Error ? error.message : String(error)}`));
                }
            };
            const onExit = (code) => finish(new Error(`shared vision service exited during startup (${code ?? "signal"}): ${stderr.trim()}`));
            const timeout = setTimeout(() => finish(new Error(`shared vision service startup timed out: ${stderr.trim()}`)), timeoutMs);
            child.stdout.on("data", onStdout);
            child.stderr.on("data", onStderr);
            child.once("exit", onExit);
        });
    }
    waitForChildExit(child, timeoutMs) {
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
exports.AresBrowserRuntime = AresBrowserRuntime;
//# sourceMappingURL=ares-browser-runtime.js.map