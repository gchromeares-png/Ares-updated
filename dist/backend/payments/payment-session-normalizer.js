"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePaymentSessionInput = void 0;
const ALLOWED_METHODS = new Set(["card", "paypal", "shop-pay", "klarna", "other"]);
function text(value, maxLength) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim().slice(0, maxLength);
    return normalized || undefined;
}
function compactDigits(value, maxLength) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.replace(/\s+/g, "").slice(0, maxLength);
    return normalized || undefined;
}
/**
 * Renderer/IPC input validation for the established checkout payment contract.
 * Runtime card fields stay holderName/cardNumber/expiry/securityCode end to end.
 */
function normalizePaymentSessionInput(input) {
    if (!input || typeof input !== "object")
        return undefined;
    const raw = input;
    const method = String(raw["method"] ?? "").trim();
    if (!ALLOWED_METHODS.has(method))
        return undefined;
    const session = {
        method,
        label: text(raw["label"], 120)
    };
    if (method !== "card")
        return session;
    const rawCard = raw["card"];
    if (!rawCard || typeof rawCard !== "object")
        return session;
    const card = rawCard;
    session.card = {
        holderName: text(card["holderName"], 120),
        cardNumber: compactDigits(card["cardNumber"], 24),
        expiry: text(card["expiry"], 12),
        securityCode: text(card["securityCode"], 8)
    };
    return session;
}
exports.normalizePaymentSessionInput = normalizePaymentSessionInput;
//# sourceMappingURL=payment-session-normalizer.js.map