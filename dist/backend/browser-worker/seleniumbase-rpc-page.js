"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeleniumBaseRpcPage = exports.SeleniumBaseRpcTransport = void 0;
const crypto_1 = require("crypto");
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const serializePattern = (value) => value instanceof RegExp ? { source: value.source, flags: value.flags } : value;
const serializeFunction = (fn) => typeof fn === "string" ? fn : fn.toString();
const frameKey = (path) => JSON.stringify(path);
function roleSelector(role) {
    switch (role.toLowerCase()) {
        case "button": return 'button,[role="button"],input[type="submit"],input[type="button"]';
        case "radio": return 'input[type="radio"],[role="radio"]';
        case "checkbox": return 'input[type="checkbox"],[role="checkbox"]';
        case "textbox": return 'input:not([type]),input[type="text"],input[type="email"],input[type="tel"],input[type="search"],input[type="url"],textarea,[role="textbox"]';
        case "link": return 'a,[role="link"]';
        default: return `[role="${role.replace(/"/g, "\\\"")}"]`;
    }
}
class SeleniumBaseRpcTransport {
    constructor(child, prefix = "ARES_SB_TASK\t") {
        this.child = child;
        this.prefix = prefix;
        this.pending = new Map();
        this.stdoutBuffer = "";
        this.stderrBuffer = "";
        this.ended = false;
        this.ready = false;
        this.startInFlight = false;
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", chunk => this.consume(String(chunk)));
        child.stderr.on("data", chunk => { this.stderrBuffer = `${this.stderrBuffer}${String(chunk)}`.slice(-8000); });
        child.once("exit", code => this.failAll(new Error(`SeleniumBase task worker exited (code=${String(code)}). ${this.stderrBuffer}`.trim())));
        child.once("error", error => this.failAll(error));
    }
    get closed() { return this.ended || this.child.exitCode != null; }
    get isReady() { return this.ready && !this.closed; }
    async start(payload, timeoutMs = 35000) {
        if (this.ready)
            return { type: "ready", ok: true };
        if (this.startInFlight)
            throw new Error("SeleniumBase task worker start is already in progress.");
        this.startInFlight = true;
        try {
            const reply = await this.requestInternal("start", payload, timeoutMs, true);
            if (reply.type !== "ready" || reply.ok === false)
                throw new Error(reply.error || "SeleniumBase task worker did not report READY.");
            this.ready = true;
            return reply;
        }
        finally {
            this.startInFlight = false;
        }
    }
    async request(type, payload = {}, timeoutMs = 15000) {
        if (!this.isReady)
            throw new Error(`SeleniumBase RPC ${type} rejected before explicit READY.`);
        return this.requestInternal(type, payload, timeoutMs, false);
    }
    async requestInternal(type, payload, timeoutMs, allowBeforeReady) {
        if (this.closed)
            throw new Error("SeleniumBase task worker is closed.");
        if (!allowBeforeReady && !this.ready)
            throw new Error(`SeleniumBase RPC ${type} rejected before READY.`);
        const requestId = (0, crypto_1.randomUUID)();
        const reply = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`SeleniumBase RPC ${type} timed out after ${timeoutMs}ms.`)); }, Math.max(250, timeoutMs));
            this.pending.set(requestId, { resolve, reject, timeout });
        });
        this.child.stdin.write(`${JSON.stringify({ type, requestId, ...payload })}\n`);
        return reply;
    }
    consume(chunk) {
        this.stdoutBuffer += chunk;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith(this.prefix))
                continue;
            let message;
            try {
                message = JSON.parse(line.slice(this.prefix.length));
            }
            catch {
                continue;
            }
            const id = message.requestId;
            if (!id)
                continue;
            const pending = this.pending.get(id);
            if (!pending)
                continue;
            this.pending.delete(id);
            clearTimeout(pending.timeout);
            if (message.type === "error" || message.ok === false)
                pending.reject(new Error(message.error || "SeleniumBase RPC failed."));
            else
                pending.resolve(message);
        }
    }
    failAll(error) {
        if (this.ended)
            return;
        this.ended = true;
        this.ready = false;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
    }
}
exports.SeleniumBaseRpcTransport = SeleniumBaseRpcTransport;
class RpcResponse {
    constructor(event) {
        this.event = event;
    }
    url() { return String(this.event.url ?? ""); }
    headers() { return { ...(this.event.headers ?? {}) }; }
    async text() { return String(this.event.body ?? ""); }
}
class SeleniumBaseRpcLocator {
    constructor(page, descriptor) {
        this.page = page;
        this.descriptor = descriptor;
    }
    first() { return new SeleniumBaseRpcLocator(this.page, { ...this.descriptor, nth: 0 }); }
    nth(index) { return new SeleniumBaseRpcLocator(this.page, { ...this.descriptor, nth: Math.max(0, Math.floor(index)) }); }
    filter(options) { return new SeleniumBaseRpcLocator(this.page, { ...this.descriptor, hasText: serializePattern(options.hasText) }); }
    async count() { const value = await this.op("count", {}, 5000).catch(() => 0); return Number(value ?? 0) || 0; }
    async isVisible(options = {}) { return Boolean(await this.op("is-visible", {}, options.timeout ?? 2000).catch(() => false)); }
    async isEnabled(options = {}) { return Boolean(await this.op("is-enabled", {}, options.timeout ?? 2000).catch(() => false)); }
    async click(options = {}) { await this.op("click", { options }, Number(options["timeout"] ?? 15000)); }
    async fill(value, options = {}) { await this.op("fill", { value, options }, Number(options["timeout"] ?? 15000)); }
    async inputValue(options = {}) { return String(await this.op("input-value", {}, options.timeout ?? 5000).catch(() => false) ?? ""); }
    async innerText(options = {}) { return String(await this.op("inner-text", {}, options.timeout ?? 5000) ?? ""); }
    async allTextContents() { const value = await this.op("all-text-contents"); return Array.isArray(value) ? value.map(item => String(item ?? "")) : []; }
    async selectOption(value) { return this.op("select-option", { value }); }
    async focus() { await this.op("focus"); }
    async scrollIntoViewIfNeeded() { await this.op("scroll-into-view"); }
    async waitFor(options = {}) { await this.op("wait-for", { state: options.state ?? "visible", timeoutMs: options.timeout }, options.timeout ?? 15000); }
    async boundingBox() {
        const value = await this.op("bounding-box").catch(() => null);
        if (!value || typeof value !== "object")
            return null;
        const box = value;
        return { x: Number(box["x"] ?? 0), y: Number(box["y"] ?? 0), width: Number(box["width"] ?? 0), height: Number(box["height"] ?? 0) };
    }
    async evaluate(fn, ...args) { return await this.op("evaluate-one", { script: serializeFunction(fn), args }); }
    async evaluateAll(fn, ...args) { return await this.op("evaluate-all", { script: serializeFunction(fn), args }); }
    async op(action, extra = {}, timeoutMs = 15000) { return this.page.locatorOperation(action, this.descriptor, extra, timeoutMs); }
}
class SeleniumBaseRpcFrame {
    constructor(page, framePath, url = "", name = "") {
        this.page = page;
        this.framePath = framePath;
        this.frameUrl = "";
        this.frameName = "";
        this.frameUrl = url;
        this.frameName = name;
    }
    update(url, name) { this.frameUrl = url; this.frameName = name; }
    path() { return [...this.framePath]; }
    url() { return this.frameUrl; }
    name() { return this.frameName; }
    locator(selector) { return new SeleniumBaseRpcLocator(this.page, { selector, framePath: [...this.framePath] }); }
    getByRole(role, options = {}) { return new SeleniumBaseRpcLocator(this.page, { selector: roleSelector(role), framePath: [...this.framePath], hasText: serializePattern(options.name) }); }
    frameLocator(selector) { return new SeleniumBaseRpcFrame(this.page, [...this.framePath, selector]); }
}
class SeleniumBaseRpcPage {
    constructor(transport) {
        this.transport = transport;
        this.currentUrl = "about:blank";
        this.currentReadyState = "";
        this.frameCache = new Map();
        this.responseListeners = new Set();
        this.loadListeners = new Set();
        this.frameNavigationListeners = new Set();
        this.eventPollInFlight = false;
        this.mouse = {
            move: async (x, y) => { await this.command("rpc", { action: "mouse-move", x, y }, 5000); },
            down: async (options = {}) => { await this.command("rpc", { action: "mouse-down", options }, 5000); },
            up: async (options = {}) => { await this.command("rpc", { action: "mouse-up", options }, 5000); },
            click: async (x, y, options = {}) => { await this.command("rpc", { action: "mouse-click", x, y, options }, 10000); }
        };
        if (!transport.isReady)
            throw new Error("Cannot create SeleniumBase page before worker READY.");
        this.mainFrameRef = new SeleniumBaseRpcFrame(this, [], this.currentUrl, "main");
    }
    locator(selector) { return new SeleniumBaseRpcLocator(this, { selector }); }
    async $(selector) { const locator = this.locator(selector).first(); return (await locator.count()) > 0 ? locator : null; }
    async content() { return String(await this.evaluate(() => document.documentElement ? document.documentElement.outerHTML : "")); }
    getByRole(role, options = {}) { return new SeleniumBaseRpcLocator(this, { selector: roleSelector(role), hasText: serializePattern(options.name) }); }
    frameLocator(selector) { return new SeleniumBaseRpcFrame(this, [selector]); }
    mainFrame() { return this.mainFrameRef; }
    frames() { return [this.mainFrameRef, ...this.frameCache.values()]; }
    async goto(url, options = {}) {
        const reply = await this.command("navigate", { url, waitUntil: options["waitUntil"], timeoutMs: options["timeout"] }, Number(options["timeout"] ?? 30000) + 5000);
        const fallback = String(reply.url ?? url);
        try {
            await this.refreshPageState(true);
        }
        catch {
            this.currentUrl = fallback;
            this.mainFrameRef.update(fallback, "main");
        }
        return reply.result;
    }
    url() { return this.currentUrl; }
    async title() { const reply = await this.command("rpc", { action: "title" }, 5000); return String(reply.result ?? reply.title ?? ""); }
    isClosed() { return this.transport.closed; }
    async evaluate(fn, ...args) {
        const reply = await this.command("rpc", { action: "evaluate-page", script: serializeFunction(fn), args }, 15000);
        if (typeof reply.url === "string" && reply.url) {
            this.currentUrl = reply.url;
            this.mainFrameRef.update(this.currentUrl, "main");
        }
        return reply.result;
    }
    async waitForTimeout(ms) { await sleep(Math.max(0, ms)); }
    async waitForLoadState(state = "domcontentloaded", options = {}) { await this.command("rpc", { action: "wait-load-state", state, timeoutMs: options.timeout }, options.timeout ?? 15000); await this.refreshPageState(true).catch(() => undefined); }
    async bringToFront() { await this.command("rpc", { action: "bring-to-front" }, 5000); }
    on(event, listener) {
        if (event === "response")
            this.responseListeners.add(listener);
        else if (event === "load")
            this.loadListeners.add(listener);
        else if (event === "framenavigated")
            this.frameNavigationListeners.add(listener);
        else
            return this;
        this.ensureEventPoll();
        return this;
    }
    off(event, listener) {
        if (event === "response")
            this.responseListeners.delete(listener);
        else if (event === "load")
            this.loadListeners.delete(listener);
        else if (event === "framenavigated")
            this.frameNavigationListeners.delete(listener);
        else
            return this;
        this.stopEventPollIfIdle();
        return this;
    }
    async locatorOperation(action, descriptor, extra = {}, timeoutMs = 15000) {
        const reply = await this.command("rpc", { action, locator: descriptor, ...extra }, timeoutMs);
        const returnedUrl = typeof reply.url === "string" ? reply.url : "";
        if (action === "click" && this.hasLifecycleListeners())
            await this.refreshPageState(true).catch(() => undefined);
        else if (returnedUrl) {
            this.currentUrl = returnedUrl;
            this.mainFrameRef.update(returnedUrl, "main");
        }
        return reply.result;
    }
    async closeTransport() {
        if (this.eventPoll)
            clearInterval(this.eventPoll);
        this.eventPoll = undefined;
        this.responseListeners.clear();
        this.loadListeners.clear();
        this.frameNavigationListeners.clear();
        if (!this.transport.closed)
            await this.transport.request("close", {}, 15000).catch(() => undefined);
    }
    hasLifecycleListeners() { return this.loadListeners.size > 0 || this.frameNavigationListeners.size > 0; }
    ensureEventPoll() {
        if (this.eventPoll)
            return;
        this.eventPoll = setInterval(() => { void this.pollEvents(); }, 100);
        void this.pollEvents();
    }
    stopEventPollIfIdle() {
        if (this.responseListeners.size || this.loadListeners.size || this.frameNavigationListeners.size)
            return;
        if (this.eventPoll)
            clearInterval(this.eventPoll);
        this.eventPoll = undefined;
    }
    async pollEvents() {
        if (this.eventPollInFlight || this.transport.closed)
            return;
        this.eventPollInFlight = true;
        try {
            if (this.responseListeners.size) {
                const reply = await this.command("network-events", {}, 2000).catch(() => ({ events: [] }));
                for (const event of reply.events ?? [])
                    for (const listener of this.responseListeners)
                        listener(new RpcResponse(event));
            }
            if (this.loadListeners.size || this.frameNavigationListeners.size)
                await this.refreshPageState(true).catch(() => undefined);
        }
        finally {
            this.eventPollInFlight = false;
        }
    }
    async refreshPageState(emitEvents) {
        const reply = await this.command("rpc", { action: "page-state" }, 5000);
        const snapshot = (reply.result && typeof reply.result === "object" ? reply.result : {});
        const nextUrl = String(snapshot.url ?? reply.url ?? this.currentUrl);
        const nextReady = String(snapshot.readyState ?? "");
        const previousUrl = this.currentUrl;
        const previousReady = this.currentReadyState;
        const previousFrames = new Map(this.frameCache);
        this.currentUrl = nextUrl;
        this.currentReadyState = nextReady;
        this.mainFrameRef.update(nextUrl, "main");
        const nextFrames = new Map();
        const rawFrames = Array.isArray(snapshot.frames) ? snapshot.frames : [];
        for (const raw of rawFrames) {
            if (!raw || typeof raw !== "object")
                continue;
            const item = raw;
            const path = Array.isArray(item.path) ? item.path.map(value => String(value)).filter(Boolean) : [];
            if (!path.length)
                continue;
            const key = frameKey(path);
            const existing = this.frameCache.get(key) ?? new SeleniumBaseRpcFrame(this, path);
            existing.update(String(item.url ?? ""), String(item.name ?? ""));
            nextFrames.set(key, existing);
        }
        this.frameCache = nextFrames;
        if (!emitEvents)
            return;
        if (nextUrl !== previousUrl)
            for (const listener of this.frameNavigationListeners)
                listener(this.mainFrameRef);
        for (const [key, frame] of nextFrames) {
            const previous = previousFrames.get(key);
            if (!previous || previous.url() !== frame.url())
                for (const listener of this.frameNavigationListeners)
                    listener(frame);
        }
        if (nextReady === "complete" && previousReady !== "complete")
            for (const listener of this.loadListeners)
                listener();
    }
    async command(type, payload, timeoutMs) { return this.transport.request(type, payload, timeoutMs); }
}
exports.SeleniumBaseRpcPage = SeleniumBaseRpcPage;
//# sourceMappingURL=seleniumbase-rpc-page.js.map