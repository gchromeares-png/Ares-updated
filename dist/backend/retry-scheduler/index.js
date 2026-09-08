"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetryScheduler = void 0;
class RetryScheduler {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.scheduled = new Map();
    }
    scheduleRetry(task, delayMs = 5000) {
        this.cancelRetry(task.id);
        const timer = setTimeout(() => {
            this.scheduled.delete(task.id);
            this.eventBus.emit("taskRetrying", task);
        }, delayMs);
        this.scheduled.set(task.id, timer);
    }
    cancelRetry(taskId) {
        const timer = this.scheduled.get(taskId);
        if (timer) {
            clearTimeout(timer);
            this.scheduled.delete(taskId);
        }
    }
    cleanup() {
        for (const timer of this.scheduled.values())
            clearTimeout(timer);
        this.scheduled.clear();
    }
}
exports.RetryScheduler = RetryScheduler;
//# sourceMappingURL=index.js.map