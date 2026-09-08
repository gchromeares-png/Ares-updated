"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearProfileBrowserUserAgent = void 0;
/**
 * Clears browser-session identity that is intentionally reset with profile browser data.
 * Address, proxy selection, payment preference and other ARES profile data stay untouched.
 */
function clearProfileBrowserUserAgent(profile) {
    const browser = { ...(profile.browser ?? {}) };
    delete browser.userAgent;
    return { ...profile, browser };
}
exports.clearProfileBrowserUserAgent = clearProfileBrowserUserAgent;
//# sourceMappingURL=profile-browser-reset.js.map