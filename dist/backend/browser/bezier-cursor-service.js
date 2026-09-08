"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BezierCursorService = void 0;
const ui_interaction_helper_1 = require("../browser-worker/ui-interaction-helper");
/** @deprecated Use GhostCursorUiInteractionHelper directly in new worker code. */
class BezierCursorService {
    constructor() {
        this.helpers = new WeakMap();
    }
    async moveTo(page, target) {
        await this.forPage(page).moveToPoint(target);
    }
    async clickLocator(page, locator, options) {
        await this.forPage(page).click(locator, options);
    }
    async fillLocator(page, locator, value, options) {
        await this.forPage(page).fill(locator, value, options);
    }
    async selectLocator(page, locator, value, options) {
        await this.forPage(page).select(locator, value, options);
    }
    async focusLocator(page, locator, options) {
        await this.forPage(page).focus(locator, options);
    }
    async hoverLocator(page, locator, options) {
        await this.forPage(page).hover(locator, options);
    }
    async scrollLocatorIntoView(page, locator, options) {
        await this.forPage(page).scrollIntoView(locator, options);
    }
    forPage(page) {
        const existing = this.helpers.get(page);
        if (existing)
            return existing;
        const helper = new ui_interaction_helper_1.GhostCursorUiInteractionHelper(page);
        this.helpers.set(page, helper);
        return helper;
    }
}
exports.BezierCursorService = BezierCursorService;
//# sourceMappingURL=bezier-cursor-service.js.map