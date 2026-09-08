"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBus = void 0;
class EventBus {
    constructor() {
        this.listeners = new Map();
    }
    on(event, callback) {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        const listener = callback;
        set.add(listener);
        return () => this.off(event, callback);
    }
    off(event, callback) {
        this.listeners.get(event)?.delete(callback);
    }
    emit(event, data) {
        for (const listener of this.listeners.get(event) ?? []) {
            listener(data);
        }
    }
}
exports.EventBus = EventBus;
//# sourceMappingURL=index.js.map