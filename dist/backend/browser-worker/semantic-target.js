"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.targetKey = exports.semanticTarget = void 0;
function semanticTarget(intent, context = "unknown") {
    return { intent, context };
}
exports.semanticTarget = semanticTarget;
/** The single canonical identity function for semantic field targets. */
function targetKey(target) {
    return `${target.context}:${target.intent}`;
}
exports.targetKey = targetKey;
//# sourceMappingURL=semantic-target.js.map