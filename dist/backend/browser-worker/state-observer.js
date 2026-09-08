"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InteractionStateObserver = void 0;
function sameBox(a, b, tolerance = 1) {
    if (!a || !b)
        return false;
    return Math.abs(a.x - b.x) <= tolerance
        && Math.abs(a.y - b.y) <= tolerance
        && Math.abs(a.width - b.width) <= tolerance
        && Math.abs(a.height - b.height) <= tolerance;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
class InteractionStateObserver {
    constructor(stabilityWindowMs = 60) {
        this.stabilityWindowMs = stabilityWindowMs;
    }
    async observe(locator) {
        const visible = await locator.isVisible().catch(() => false);
        if (!visible)
            return { visible: false, enabled: false, stable: false };
        const enabled = await locator.isEnabled().catch(() => false);
        const first = await locator.boundingBox().catch(() => null);
        if (!first)
            return { visible: true, enabled, stable: false };
        await sleep(this.stabilityWindowMs);
        const second = await locator.boundingBox().catch(() => null);
        const box = second ?? first;
        return {
            visible: true,
            enabled,
            stable: sameBox(first, second ?? undefined),
            box
        };
    }
    async waitUntilReady(locator, timeoutMs) {
        const deadline = Date.now() + Math.max(1, timeoutMs);
        let last = { visible: false, enabled: false, stable: false };
        while (Date.now() <= deadline) {
            last = await this.observe(locator);
            if (last.visible && last.enabled && last.stable && last.box)
                return last;
            await sleep(50);
        }
        return last;
    }
}
exports.InteractionStateObserver = InteractionStateObserver;
//# sourceMappingURL=state-observer.js.map