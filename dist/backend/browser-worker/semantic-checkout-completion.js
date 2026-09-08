"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateSemanticCheckoutCompletion = void 0;
const semantic_target_1 = require("./semantic-target");
/**
 * Pure evaluation of an already-normalized semantic state. DOM visibility,
 * same-as-shipping handling, profile mapping and shop-specific decisions must
 * have happened before this function is called.
 *
 * Required identity is always the complete SemanticTarget. An intent alone is
 * never sufficient to decide checkout completion.
 */
function evaluateSemanticCheckoutCompletion(state) {
    const filledKeys = new Set(state.filled.map(semantic_target_1.targetKey));
    const missingKeys = new Set(state.missing.map(semantic_target_1.targetKey));
    const required = new Map();
    for (const target of state.requiredTargets) {
        required.set((0, semantic_target_1.targetKey)(target), { ...target });
    }
    const hasFilledRequiredTarget = [...required.keys()].some(key => filledKeys.has(key));
    const missingRequiredTargets = [...required.entries()]
        .filter(([key]) => missingKeys.has(key) || !filledKeys.has(key))
        .map(([, target]) => ({ ...target }));
    return {
        complete: required.size > 0 && hasFilledRequiredTarget && missingRequiredTargets.length === 0,
        hasFilledRequiredTarget,
        missingRequiredTargets
    };
}
exports.evaluateSemanticCheckoutCompletion = evaluateSemanticCheckoutCompletion;
//# sourceMappingURL=semantic-checkout-completion.js.map