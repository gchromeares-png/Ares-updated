"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserQueueWaiter = exports.queueLikeUrl = void 0;
const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_POLL_MS = 2000;
const NETWORK_SIGNAL_TTL_MS = 15000;
const RELEASE_STATUS_RE = /(released|complete|completed|redirect|passed|admitted)/i;
function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function numericValue(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value !== "string")
        return undefined;
    const match = value.match(/-?\d+(?:[.,]\d+)?/);
    if (!match)
        return undefined;
    const parsed = Number(match[0].replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
}
function queueSource(value) {
    return value === "session-http" || value === "dom" || value === "network" || value === "url" || value === "combined"
        ? value
        : "network";
}
function queueLikeUrl(url) {
    return /(queue|waiting[-_]?room|queue-?it|incapsula_resource)/i.test(url);
}
exports.queueLikeUrl = queueLikeUrl;
function extractQueuePayload(value) {
    if (!value || typeof value !== "object")
        return {};
    const record = value;
    const data = record["data"] && typeof record["data"] === "object"
        ? record["data"]
        : undefined;
    const position = numericValue(record["pos"] ?? record["position"] ?? data?.["pos"] ?? data?.["position"]);
    const timeToWaitSeconds = numericValue(record["ttw"] ?? record["timeToWait"] ?? data?.["ttw"] ?? data?.["timeToWait"]);
    const rawStatus = record["status"] ?? data?.["status"];
    const statusText = typeof rawStatus === "string" ? rawStatus.trim() : undefined;
    return { position, timeToWaitSeconds, statusText };
}
function extractUrlTelemetry(url) {
    try {
        const parsed = new URL(url);
        return {
            position: numericValue(parsed.searchParams.get("pos") ?? parsed.searchParams.get("position") ?? undefined),
            timeToWaitSeconds: numericValue(parsed.searchParams.get("ttw") ?? parsed.searchParams.get("timeToWait") ?? undefined)
        };
    }
    catch {
        return {};
    }
}
class BrowserQueueWaiter {
    constructor(page, task, onTaskUpdate = () => undefined, options = {}) {
        this.page = page;
        this.task = task;
        this.onTaskUpdate = onTaskUpdate;
        this.options = options;
    }
    start() {
        if (this.responseListener || this.options.allowPassiveNetwork === false)
            return;
        const events = this.page;
        if (typeof events.on !== "function")
            return;
        this.responseListener = response => void this.captureResponse(response);
        events.on("response", this.responseListener);
    }
    stop() {
        if (!this.responseListener)
            return;
        const listener = this.responseListener;
        this.responseListener = undefined;
        const events = this.page;
        if (typeof events.off === "function")
            events.off("response", listener);
    }
    async waitIfQueued() {
        const maxWaitMs = clampNumber(this.options.maxWaitMs ?? ONE_HOUR_MS, 1000, ONE_HOUR_MS);
        const pollIntervalMs = clampNumber(this.options.pollIntervalMs ?? DEFAULT_POLL_MS, 250, 10000);
        const releaseConfirmations = Math.max(1, Math.floor(this.options.releaseConfirmations ?? 2));
        const existing = this.task.config.data?.["queueStatus"];
        const seededActive = existing?.["active"] === true;
        const initial = await this.readSignal();
        if (!initial.active && !seededActive)
            return { detected: false, released: false, elapsedMs: 0 };
        const seededDetectedMs = Date.parse(String(existing?.["detectedAt"] ?? ""));
        const startedAt = seededActive && Number.isFinite(seededDetectedMs) ? seededDetectedMs : Date.now();
        const detectedAt = seededActive && typeof existing?.["detectedAt"] === "string"
            ? String(existing["detectedAt"])
            : new Date(startedAt).toISOString();
        let clearCount = 0;
        let releaseSignal;
        let lastSignal = initial.active
            ? initial
            : {
                active: true,
                position: numericValue(existing?.["position"]),
                timeToWaitSeconds: numericValue(existing?.["timeToWaitSeconds"]),
                statusText: typeof existing?.["statusText"] === "string" ? String(existing["statusText"]) : undefined,
                source: queueSource(existing?.["source"])
            };
        while (Date.now() - startedAt < maxWaitMs) {
            const elapsedMs = Math.max(0, Date.now() - startedAt);
            const signal = await this.readSignal();
            if (signal.active) {
                clearCount = 0;
                releaseSignal = undefined;
                lastSignal = signal;
                this.publish({
                    active: true, phase: "waiting", position: signal.position,
                    timeToWaitSeconds: signal.timeToWaitSeconds, statusText: signal.statusText,
                    source: signal.source, detectedAt, updatedAt: new Date().toISOString(), elapsedMs, maxWaitMs
                });
            }
            else {
                if (clearCount === 0 || signal.source !== "url")
                    releaseSignal = signal;
                clearCount += 1;
                if (clearCount >= releaseConfirmations) {
                    const releasedAt = new Date().toISOString();
                    const confirmedRelease = releaseSignal ?? signal;
                    this.publish({
                        active: false, phase: "released", position: lastSignal.position,
                        timeToWaitSeconds: 0, statusText: confirmedRelease.statusText || "Warteschlange verlassen", source: confirmedRelease.source,
                        detectedAt, updatedAt: releasedAt, releasedAt, elapsedMs, maxWaitMs
                    });
                    return { detected: true, released: true, elapsedMs };
                }
            }
            await this.sleep(pollIntervalMs);
        }
        const elapsedMs = Math.max(0, Date.now() - startedAt);
        this.publish({
            active: false, phase: "timed-out", position: lastSignal.position,
            timeToWaitSeconds: lastSignal.timeToWaitSeconds, statusText: "Maximale Queue-Wartezeit erreicht",
            source: lastSignal.source, detectedAt, updatedAt: new Date().toISOString(), elapsedMs, maxWaitMs
        });
        throw new Error(`Queue-Wartezeit von ${Math.round(maxWaitMs / 60000)} Minuten überschritten.`);
    }
    publish(queueStatus) {
        this.task.config.data = { ...(this.task.config.data ?? {}), queueStatus };
        this.onTaskUpdate(this.task);
    }
    async readSignal() {
        if (this.page.isClosed())
            return { active: false, source: "dom" };
        const external = this.options.externalSignal?.();
        const externalRelease = Boolean(external && !external.active && (external.authoritativeRelease === true
            || Boolean(external.statusText && RELEASE_STATUS_RE.test(external.statusText))));
        if (externalRelease) {
            return { active: false, statusText: external?.statusText, source: "session-http" };
        }
        if (external?.active)
            return { ...external };
        const recentNetwork = this.options.allowPassiveNetwork === false
            ? undefined
            : this.networkSignal && Date.now() - this.networkSignal.updatedAt <= NETWORK_SIGNAL_TTL_MS
                ? this.networkSignal
                : undefined;
        if (recentNetwork?.authoritativeRelease) {
            return { active: false, source: "network", statusText: recentNetwork.statusText };
        }
        if (recentNetwork?.active) {
            return {
                active: true, source: "network", position: recentNetwork.position,
                timeToWaitSeconds: recentNetwork.timeToWaitSeconds, statusText: recentNetwork.statusText
            };
        }
        if (this.options.allowPassiveDom === false) {
            return { active: queueLikeUrl(this.page.url()), source: "url" };
        }
        const page = this.page;
        const dom = typeof page.passiveQueueSnapshot === "function"
            ? await page.passiveQueueSnapshot().catch(() => ({
                hasQueuePosition: false, hasPosition: false, positionText: "", statusText: "", url: this.page.url()
            }))
            : { hasQueuePosition: false, hasPosition: false, positionText: "", statusText: "", url: this.page.url() };
        const domPosition = numericValue(dom.positionText);
        const urlSignal = queueLikeUrl(dom.url);
        const released = Boolean(dom.statusText && RELEASE_STATUS_RE.test(dom.statusText));
        if (released)
            return { active: false, statusText: dom.statusText, source: "dom" };
        const statusLooksQueued = /(queue|warteschlange|waiting|position|wait)/i.test(dom.statusText);
        const domActive = dom.hasQueuePosition || (dom.hasPosition && (statusLooksQueued || urlSignal));
        return {
            active: domActive || urlSignal,
            position: domPosition,
            statusText: dom.statusText || undefined,
            source: domActive && urlSignal ? "combined" : domActive ? "dom" : "url"
        };
    }
    async captureResponse(response) {
        const url = response.url();
        if (!queueLikeUrl(url))
            return;
        const fromUrl = extractUrlTelemetry(url);
        this.networkSignal = { active: true, ...fromUrl, updatedAt: Date.now() };
        try {
            const contentType = response.headers()["content-type"] ?? "";
            if (!/(json|javascript|text)/i.test(contentType))
                return;
            const text = await response.text();
            if (!text || text.length > 256000)
                return;
            let extracted = {};
            try {
                extracted = extractQueuePayload(JSON.parse(text));
            }
            catch {
                const pos = text.match(/["']?(?:pos|position)["']?\s*[:=]\s*["']?([0-9.,-]+)/i);
                const ttw = text.match(/["']?(?:ttw|timeToWait)["']?\s*[:=]\s*["']?([0-9.,-]+)/i);
                const status = text.match(/["']?status["']?\s*[:=]\s*["']([^"']+)/i);
                extracted = {
                    position: numericValue(pos?.[1]),
                    timeToWaitSeconds: numericValue(ttw?.[1]),
                    statusText: status?.[1]?.trim()
                };
            }
            const released = Boolean(extracted.statusText && RELEASE_STATUS_RE.test(extracted.statusText));
            this.networkSignal = {
                active: !released,
                authoritativeRelease: released,
                position: extracted.position ?? fromUrl.position,
                timeToWaitSeconds: released ? 0 : extracted.timeToWaitSeconds ?? fromUrl.timeToWaitSeconds,
                statusText: extracted.statusText,
                updatedAt: Date.now()
            };
        }
        catch {
            // Passive best-effort telemetry; Stage 3 DOM remains available.
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.BrowserQueueWaiter = BrowserQueueWaiter;
//# sourceMappingURL=queue-waiter.js.map