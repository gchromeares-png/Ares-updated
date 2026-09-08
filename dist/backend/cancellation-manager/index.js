"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancellationManager = void 0;
class CancellationManager {
    constructor() {
        this.controllers = new Map();
    }
    createCancellation(taskId) {
        this.cancelTask(taskId);
        const controller = new AbortController();
        this.controllers.set(taskId, controller);
        return controller.signal;
    }
    getSignal(taskId) {
        return this.controllers.get(taskId)?.signal;
    }
    cancelTask(taskId) {
        this.controllers.get(taskId)?.abort();
        this.controllers.delete(taskId);
    }
    cleanup() {
        for (const controller of this.controllers.values())
            controller.abort();
        this.controllers.clear();
    }
}
exports.CancellationManager = CancellationManager;
//# sourceMappingURL=index.js.map