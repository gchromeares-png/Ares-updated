"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyRepository = void 0;
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
function normalizeProxy(input) {
    const id = String(input?.id ?? "").trim();
    const name = String(input?.name ?? id).trim();
    const protocol = String(input?.protocol ?? "http").trim();
    const host = String(input?.host ?? "").trim();
    const port = Number(input?.port);
    if (!id || !name || !host)
        return undefined;
    if (!["http", "https", "socks5"].includes(protocol))
        return undefined;
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        return undefined;
    return {
        id,
        name,
        protocol,
        host,
        port,
        username: typeof input?.username === "string" ? input.username.trim() || undefined : undefined,
        password: typeof input?.password === "string" ? input.password || undefined : undefined,
        health: input?.health && typeof input.health === "object" ? input.health : undefined
    };
}
class ProxyRepository {
    constructor(storagePath) {
        this.proxies = new Map();
        if (storagePath)
            this.setStoragePath(storagePath);
    }
    setStoragePath(filePath) {
        this.storagePath = filePath;
        this.loadFromDisk();
    }
    save(proxy) {
        const normalized = normalizeProxy(proxy);
        if (!normalized)
            throw new Error("Ungültige Proxy-Konfiguration.");
        this.proxies.set(normalized.id, normalized);
        this.persistToDisk();
        return normalized;
    }
    get(id) {
        return this.proxies.get(id);
    }
    getAll() {
        return [...this.proxies.values()];
    }
    delete(id) {
        const deleted = this.proxies.delete(id);
        if (deleted)
            this.persistToDisk();
        return deleted;
    }
    loadFromDisk() {
        this.proxies.clear();
        if (!this.storagePath)
            return;
        try {
            if (!fs.existsSync(this.storagePath))
                return;
            const items = JSON.parse(fs.readFileSync(this.storagePath, "utf8"));
            if (!Array.isArray(items))
                return;
            for (const item of items) {
                const proxy = normalizeProxy(item);
                if (proxy)
                    this.proxies.set(proxy.id, proxy);
            }
        }
        catch {
            // Corrupt proxy storage must not prevent ARES startup.
        }
    }
    persistToDisk() {
        if (!this.storagePath)
            return;
        const dir = path.dirname(this.storagePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.storagePath, JSON.stringify([...this.proxies.values()], null, 2), "utf8");
    }
}
exports.ProxyRepository = ProxyRepository;
//# sourceMappingURL=proxy-repository.js.map