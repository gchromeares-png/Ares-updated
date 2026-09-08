"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GhostCursorPointerDriver = void 0;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Generic browser pointer driver for ordinary UI interactions.
 *
 * Coordinates are top-level viewport coordinates. Frame/OOPIF discovery and
 * coordinate resolution remain owned by the existing locator/session layer;
 * this driver never caches nodes, frame ids, execution contexts or CDP sessions.
 */
class GhostCursorPointerDriver {
    constructor(page) {
        this.page = page;
        this.position = { x: 0, y: 0 };
    }
    async moveTo(target) {
        this.assertPoint(target);
        await this.page.mouse.move(target.x, target.y);
        this.position = { ...target };
    }
    async click(target, options = {}) {
        this.assertPoint(target);
        await this.page.mouse.click(target.x, target.y, {
            button: options.button ?? "left",
            clickCount: options.clickCount ?? 1
        });
        this.position = { ...target };
    }
    async drag(path, durationMs = 300) {
        if (path.length < 2)
            throw new RangeError("PointerDriver.drag requires at least two points.");
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            throw new RangeError("PointerDriver.drag durationMs must be a finite non-negative number.");
        }
        for (const point of path)
            this.assertPoint(point);
        const first = path[0];
        await this.page.mouse.move(first.x, first.y);
        await this.page.mouse.down({ button: "left" });
        const startedAt = Date.now();
        const segments = path.length - 1;
        try {
            for (let index = 1; index < path.length; index += 1) {
                const targetElapsed = durationMs * (index / segments);
                const remaining = targetElapsed - (Date.now() - startedAt);
                if (remaining > 0)
                    await sleep(remaining);
                const point = path[index];
                await this.page.mouse.move(point.x, point.y);
            }
        }
        finally {
            await this.page.mouse.up({ button: "left" });
        }
        this.position = { ...path[path.length - 1] };
    }
    assertPoint(target) {
        if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
            throw new TypeError("Pointer coordinates must be finite numbers.");
        }
    }
}
exports.GhostCursorPointerDriver = GhostCursorPointerDriver;
//# sourceMappingURL=pointer-driver.js.map