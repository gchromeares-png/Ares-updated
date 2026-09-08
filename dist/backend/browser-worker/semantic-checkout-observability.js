"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fallbackTraceResolution = exports.unknownTraceResolution = exports.SemanticCheckoutTraceRecorder = void 0;
const semantic_target_1 = require("./semantic-target");
const UNKNOWN_RESOLUTION = {
    resolverSource: { intent: "unknown", context: "unknown" },
    confidence: null
};
const FALLBACK_RESOLUTION = {
    resolverSource: { intent: "fallback", context: "fallback" },
    confidence: null
};
/**
 * PII-safe by construction: this recorder accepts semantic metadata only.
 * It intentionally has no fields for profile values, field labels, selectors,
 * free-form DOM text or error messages.
 */
class SemanticCheckoutTraceRecorder {
    constructor(billingMode, maxEvents = 500) {
        this.billingMode = billingMode;
        this.maxEvents = maxEvents;
        this.events = [];
        this.droppedEvents = 0;
    }
    record(input) {
        if (this.events.length >= this.maxEvents) {
            this.droppedEvents += 1;
            return;
        }
        this.events.push({
            targetKey: (0, semantic_target_1.targetKey)(input.target),
            context: input.target.context,
            intent: input.target.intent,
            resolverSource: {
                intent: input.resolverSource.intent,
                context: input.resolverSource.context
            },
            confidence: input.confidence,
            billingMode: this.billingMode,
            valueAvailable: input.valueAvailable,
            action: input.action,
            result: input.result,
            timestamp: new Date().toISOString()
        });
    }
    snapshot() {
        return {
            schemaVersion: 1,
            events: this.events.map(event => ({
                ...event,
                resolverSource: { ...event.resolverSource }
            })),
            droppedEvents: this.droppedEvents
        };
    }
}
exports.SemanticCheckoutTraceRecorder = SemanticCheckoutTraceRecorder;
function unknownTraceResolution() {
    return {
        resolverSource: { ...UNKNOWN_RESOLUTION.resolverSource },
        confidence: UNKNOWN_RESOLUTION.confidence
    };
}
exports.unknownTraceResolution = unknownTraceResolution;
function fallbackTraceResolution() {
    return {
        resolverSource: { ...FALLBACK_RESOLUTION.resolverSource },
        confidence: FALLBACK_RESOLUTION.confidence
    };
}
exports.fallbackTraceResolution = fallbackTraceResolution;
//# sourceMappingURL=semantic-checkout-observability.js.map