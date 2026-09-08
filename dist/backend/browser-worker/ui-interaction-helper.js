"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GhostCursorUiInteractionHelper = void 0;
const interaction_engine_1 = require("./interaction-engine");
/**
 * Backwards-compatible facade for normal UI automation.
 * InteractionEngine owns readiness/outcome/retries and the seeded Bezier cursor
 * path. Challenge handling stays separate.
 */
class GhostCursorUiInteractionHelper {
    constructor(page) {
        this.page = page;
        // Do not inject the direct pointer driver here: doing so bypasses
        // InteractionEngine.movePointer(), which is where the deterministic seeded
        // Bezier path is generated. Keeping the engine on its native Page.mouse
        // path makes every supplied seed affect both target variation and movement.
        this.engine = new interaction_engine_1.InteractionEngine(page);
        const runtimeSeed = String(page["interactionSeed"] ?? "").trim();
        this.seedNamespace = runtimeSeed || "ares-interaction";
    }
    async moveTo(target, options = {}) {
        await target.scrollIntoViewIfNeeded();
        await target.waitFor({ state: "visible" });
        const box = await target.boundingBox();
        if (!box)
            throw new Error("UI target has no visible bounding box.");
        await this.moveToPoint({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, options);
    }
    async moveToPoint(target, options = {}) {
        await this.engine.moveToPoint(target, options.seed ?? `${this.seedNamespace}:move`);
    }
    async click(target, options = {}) {
        const result = await this.engine.click(target, {
            seed: options.seed ?? `${this.seedNamespace}:click`,
            attempts: options.attempts,
            expected: options.expected,
            button: options.button,
            clickCount: options.clickCount
        });
        this.assertSuccess("click", result.success, result.failureReason);
    }
    async fill(target, value, options = {}) {
        const result = await this.engine.fill(target, value, {
            attempts: options.attempts,
            seed: options.seed ?? `${this.seedNamespace}:fill`,
            expected: options.expected
        });
        this.assertSuccess("fill", result.success, result.failureReason);
    }
    async select(target, value, options = {}) {
        const result = await this.engine.select(target, value, {
            attempts: options.attempts,
            seed: options.seed ?? `${this.seedNamespace}:select`,
            expected: options.expected
        });
        this.assertSuccess("select", result.success, result.failureReason);
    }
    async focus(target, options = {}) {
        const result = await this.engine.focus(target, {
            attempts: options.attempts,
            seed: options.seed ?? `${this.seedNamespace}:focus`,
            expected: options.expected
        });
        this.assertSuccess("focus", result.success, result.failureReason);
    }
    async hover(target, options = {}) {
        const result = await this.engine.hover(target, {
            attempts: options.attempts,
            seed: options.seed ?? `${this.seedNamespace}:hover`,
            expected: options.expected
        });
        this.assertSuccess("hover", result.success, result.failureReason);
    }
    async scrollIntoView(target, options = {}) {
        const result = await this.engine.scrollIntoView(target, {
            attempts: options.attempts,
            seed: options.seed ?? `${this.seedNamespace}:scroll`,
            expected: options.expected
        });
        this.assertSuccess("scroll", result.success, result.failureReason);
    }
    assertSuccess(action, success, failureReason) {
        if (!success)
            throw new Error(`Interaction ${action} failed: ${failureReason ?? "unknown"}`);
    }
}
exports.GhostCursorUiInteractionHelper = GhostCursorUiInteractionHelper;
//# sourceMappingURL=ui-interaction-helper.js.map