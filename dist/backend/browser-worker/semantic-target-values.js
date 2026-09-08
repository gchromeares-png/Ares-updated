"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticTargetValueMap = void 0;
const semantic_target_1 = require("./semantic-target");
class SemanticTargetValueMap {
    constructor(entries = []) {
        this.values = new Map();
        for (const entry of entries)
            this.set(entry.target, entry.value);
    }
    set(target, value) {
        const normalized = value?.trim();
        const key = (0, semantic_target_1.targetKey)(target);
        if (!normalized) {
            this.values.delete(key);
            return;
        }
        this.values.set(key, { target: { ...target }, value: normalized });
    }
    valueFor(target) {
        return this.values.get((0, semantic_target_1.targetKey)(target))?.value;
    }
    entries() {
        return [...this.values.values()].map(entry => ({ target: { ...entry.target }, value: entry.value }));
    }
}
exports.SemanticTargetValueMap = SemanticTargetValueMap;
//# sourceMappingURL=semantic-target-values.js.map