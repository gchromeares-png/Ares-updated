"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerMock = exports.TaskExecutorMock = exports.ProxyManagerMock = exports.ShopAdapterMock = exports.BrowserManagerMock = exports.TaskRepositoryMock = void 0;
class TaskRepositoryMock {
    constructor() {
        this.tasks = new Map();
    }
    async save(task) {
        this.tasks.set(task.id, structuredClone(task));
    }
    async findById(id) {
        return this.tasks.get(id) ?? null;
    }
    async findAll() {
        return [...this.tasks.values()];
    }
    async update(task) {
        this.tasks.set(task.id, structuredClone(task));
    }
    async delete(id) {
        this.tasks.delete(id);
    }
}
exports.TaskRepositoryMock = TaskRepositoryMock;
class BrowserManagerMock {
    async launchBrowser() { }
    async closeBrowser() { }
    async navigateTo(_url) { }
    async waitForSelector(_selector, _timeout) { }
}
exports.BrowserManagerMock = BrowserManagerMock;
class ShopAdapterMock {
    async findProduct(_task) { return true; }
    async addToCart(_task) { return true; }
    async checkout(_task) { return true; }
}
exports.ShopAdapterMock = ShopAdapterMock;
class ProxyManagerMock {
    constructor() {
        this.proxies = ["mock-proxy-1", "mock-proxy-2"];
        this.used = new Set();
    }
    async getProxy() {
        const proxy = this.proxies.find(p => !this.used.has(p));
        if (!proxy)
            throw new Error("No mock proxy available");
        this.used.add(proxy);
        return proxy;
    }
    releaseProxy(proxy) {
        this.used.delete(proxy);
    }
}
exports.ProxyManagerMock = ProxyManagerMock;
class TaskExecutorMock {
    async execute(_task) {
        return true;
    }
}
exports.TaskExecutorMock = TaskExecutorMock;
class WorkerMock {
    constructor(id) {
        this.id = id;
        this.status = "idle";
    }
    async run(_task) { }
    stop() {
        this.status = "idle";
        this.currentTaskId = undefined;
    }
}
exports.WorkerMock = WorkerMock;
//# sourceMappingURL=index.js.map