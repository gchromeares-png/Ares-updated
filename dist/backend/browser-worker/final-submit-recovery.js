"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmFinalSubmitWithRetries = void 0;
/**
 * Read-only recovery after an irreversible submit was already dispatched.
 * It retries confirmation, never the submit itself. At least two observations
 * are made before callers may mark the retry policy blocked.
 */
async function confirmFinalSubmitWithRetries(check, options = {}) {
    const maxAttempts = Math.min(5, Math.max(2, Math.floor(Number(options.attempts ?? 2) || 2)));
    const delayMs = Math.min(5000, Math.max(0, Math.floor(Number(options.delayMs ?? 750) || 0)));
    let attempts = 0;
    while (attempts < maxAttempts && !options.signal?.aborted) {
        attempts += 1;
        if (await check().catch(() => false)) {
            return { confirmed: true, attempts, maxAttempts };
        }
        if (attempts < maxAttempts && delayMs > 0 && !options.signal?.aborted) {
            await delay(delayMs, options.signal);
        }
    }
    return { confirmed: false, attempts, maxAttempts };
}
exports.confirmFinalSubmitWithRetries = confirmFinalSubmitWithRetries;
function delay(ms, signal) {
    if (signal?.aborted || ms <= 0)
        return Promise.resolve();
    return new Promise(resolve => {
        const timer = setTimeout(done, ms);
        function done() {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            resolve();
        }
        signal?.addEventListener("abort", done, { once: true });
    });
}
//# sourceMappingURL=final-submit-recovery.js.map