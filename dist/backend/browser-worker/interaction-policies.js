"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.urlMatches = exports.locatorVisible = exports.locatorHovered = exports.locatorFocused = exports.locatorValueEquals = exports.VISIBLE_STABLE_POLICY = exports.DEFAULT_READINESS_POLICY = void 0;
exports.DEFAULT_READINESS_POLICY = {
    name: "visible-enabled-stable",
    evaluate: (_locator, state) => state.visible && state.enabled && state.stable && Boolean(state.box)
};
exports.VISIBLE_STABLE_POLICY = {
    name: "visible-stable",
    evaluate: (_locator, state) => state.visible && state.stable && Boolean(state.box)
};
function locatorValueEquals(locator, expected) {
    return {
        name: "locator-value-equals",
        verify: async () => (await locator.inputValue().catch(() => "")) === expected
    };
}
exports.locatorValueEquals = locatorValueEquals;
function locatorFocused(locator) {
    return {
        name: "locator-focused",
        verify: async () => locator.evaluate(element => element === document.activeElement).catch(() => false)
    };
}
exports.locatorFocused = locatorFocused;
function locatorHovered(locator) {
    return {
        name: "locator-hovered",
        verify: async () => locator.evaluate(element => element.matches(":hover")).catch(() => false)
    };
}
exports.locatorHovered = locatorHovered;
function locatorVisible(locator) {
    return {
        name: "locator-visible",
        verify: async () => locator.isVisible().catch(() => false)
    };
}
exports.locatorVisible = locatorVisible;
function urlMatches(pattern) {
    return {
        name: "url-matches",
        verify: page => pattern.test(page.url())
    };
}
exports.urlMatches = urlMatches;
//# sourceMappingURL=interaction-policies.js.map