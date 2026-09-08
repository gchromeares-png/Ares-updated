"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionHttpPoller = void 0;
const tslib_1 = require("tslib");
const child_process_1 = require("child_process");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const PREFIX = "ARES_SESSION_HTTP\t";
class SessionHttpPoller {
    constructor(options) {
        this.options = options;
        this.buffer = "";
    }
    start() {
        if (this.child)
            return;
        const script = this.resolveScript();
        const child = (0, child_process_1.spawn)(process.env["ARES_PYTHON_EXECUTABLE"]?.trim() || "python", ["-u", script], {
            stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
            env: { ...process.env, PYTHONUNBUFFERED: "1" }
        });
        this.child = child;
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", chunk => this.consume(String(chunk)));
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", chunk => { this.lastError = `${this.lastError ?? ""}${String(chunk)}`.slice(-4000); });
        child.once("exit", () => { if (this.child === child)
            this.child = undefined; });
        child.stdin.write(`${JSON.stringify({
            url: this.options.url,
            profileDir: this.options.profileDir,
            proxy: this.options.proxy,
            pollIntervalMs: this.options.pollIntervalMs ?? 2000
        })}\n`);
    }
    getLatest(maxAgeMs = 15000) {
        const signal = this.latest;
        if (!signal || Date.now() - signal.observedAtMs > maxAgeMs)
            return undefined;
        return signal;
    }
    getError() { return this.lastError; }
    stop() {
        const child = this.child;
        this.child = undefined;
        if (child && child.exitCode == null)
            child.kill();
    }
    consume(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith(PREFIX))
                continue;
            try {
                const value = JSON.parse(line.slice(PREFIX.length));
                if (value["ok"] !== true) {
                    this.lastError = String(value["error"] ?? "session HTTP poll failed");
                    continue;
                }
                this.lastError = undefined;
                this.latest = {
                    active: value["active"] === true,
                    position: typeof value["position"] === "number" ? value["position"] : undefined,
                    timeToWaitSeconds: typeof value["timeToWaitSeconds"] === "number" ? value["timeToWaitSeconds"] : undefined,
                    statusText: typeof value["statusText"] === "string" ? value["statusText"] : undefined,
                    source: "session-http",
                    observedAtMs: Number(value["observedAtMs"] ?? Date.now()),
                    statusCode: typeof value["statusCode"] === "number" ? value["statusCode"] : undefined,
                    url: typeof value["url"] === "string" ? value["url"] : undefined
                };
            }
            catch { /* best-effort sidecar telemetry */ }
        }
    }
    resolveScript() {
        const resourcesPath = process.resourcesPath || "";
        const candidates = [
            process.env["ARES_SESSION_HTTP_POLLER"]?.trim(),
            path.join(process.cwd(), "python", "seleniumbase_cdp", "session_http_poller.py"),
            path.join(__dirname, "../../python/seleniumbase_cdp/session_http_poller.py"),
            resourcesPath ? path.join(resourcesPath, "python", "seleniumbase_cdp", "session_http_poller.py") : undefined
        ].filter((value) => Boolean(value));
        const resolved = candidates.find(candidate => fs.existsSync(candidate));
        if (!resolved)
            throw new Error("session_http_poller.py was not found");
        return resolved;
    }
}
exports.SessionHttpPoller = SessionHttpPoller;
//# sourceMappingURL=session-http-poller.js.map