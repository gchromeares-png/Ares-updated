"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskExecutor = void 0;
class TaskExecutor {
    constructor(eventBus, cancellation, browser, shop, proxy) {
        this.eventBus = eventBus;
        this.cancellation = cancellation;
        this.browser = browser;
        this.shop = shop;
        this.proxy = proxy;
    }
    async execute(task) {
        const signal = this.cancellation.createCancellation(task.id);
        let proxyId;
        try {
            await this.browser.launchBrowser();
            if (signal.aborted)
                return false;
            proxyId = await this.proxy.getProxy();
            if (signal.aborted)
                return false;
            if (!(await this.shop.findProduct(task)) || signal.aborted)
                return false;
            task.state = "PRODUCT_FOUND";
            this.eventBus.emit("taskUpdated", task);
            if (!(await this.shop.addToCart(task)) || signal.aborted)
                return false;
            task.state = "CART";
            this.eventBus.emit("taskUpdated", task);
            if (!(await this.shop.checkout(task)) || signal.aborted)
                return false;
            return true;
        }
        catch (error) {
            task.lastError = error instanceof Error ? error.message : String(error);
            return false;
        }
        finally {
            await this.browser.closeBrowser().catch(() => undefined);
            if (proxyId)
                this.proxy.releaseProxy(proxyId);
            this.cancellation.cancelTask(task.id);
        }
    }
}
exports.TaskExecutor = TaskExecutor;
//# sourceMappingURL=index.js.map