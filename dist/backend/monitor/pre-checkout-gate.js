"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PassiveHttpPreCheckoutGate = void 0;
/**
 * Legacy compatibility guard.
 *
 * Keep the symbol temporarily so older composition/tests fail explicitly
 * instead of silently falling back to a second HTTP-based gate detector.
 * Production Early-Gate monitoring must run through BrowserGateMonitorExecutor.
 */
class PassiveHttpPreCheckoutGate {
    async evaluate(_task, _shop, signal) {
        if (signal?.aborted)
            return undefined;
        throw new Error("PassiveHttpPreCheckoutGate wurde entfernt. Early-Gate-Monitoring muss über BrowserGateMonitorExecutor/SeleniumBase laufen.");
    }
}
exports.PassiveHttpPreCheckoutGate = PassiveHttpPreCheckoutGate;
//# sourceMappingURL=pre-checkout-gate.js.map