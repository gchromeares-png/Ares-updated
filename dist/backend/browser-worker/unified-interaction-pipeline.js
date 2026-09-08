"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnifiedInteractionPipeline = void 0;
const field_semantic_resolver_1 = require("./field-semantic-resolver");
const semantic_target_1 = require("./semantic-target");
class UnifiedInteractionPipeline {
    constructor(executor, resolver = new field_semantic_resolver_1.FieldSemanticResolver(), minimumConfidence = 0.78) {
        this.executor = executor;
        this.resolver = resolver;
        this.minimumConfidence = minimumConfidence;
    }
    async autofill(values) {
        const observed = await this.executor.observeFields();
        const resolved = await this.resolver.resolve(observed);
        const plan = [];
        const unresolved = [];
        resolved.forEach((field, index) => {
            const observedField = observed[index];
            if (!observedField)
                return;
            const decision = this.toPlanItem(observedField, field, values);
            if (decision.item)
                plan.push(decision.item);
            else
                unresolved.push({ fieldId: observedField.fieldId, reason: decision.reason });
        });
        const execution = plan.length
            ? await this.executor.executePlan(plan)
            : { planned: 0, applied: 0, verified: true, results: [], fallbackNeeded: [] };
        return {
            observed: observed.length,
            resolved: resolved.filter(field => field.target.intent !== "unknown").length,
            planned: plan.length,
            unresolved,
            execution
        };
    }
    toPlanItem(observed, resolved, values) {
        if (resolved.target.intent === "unknown")
            return { reason: "unknown-intent" };
        if (resolved.confidence < this.minimumConfidence)
            return { reason: "low-confidence" };
        const exactKey = (0, semantic_target_1.targetKey)(resolved.target);
        const genericKey = (0, semantic_target_1.targetKey)({ intent: resolved.target.intent, context: "unknown" });
        const value = values[exactKey] ?? values[genericKey];
        if (typeof value !== "string")
            return { reason: "missing-value" };
        return {
            reason: "",
            item: {
                fieldId: observed.fieldId,
                intent: resolved.target.intent,
                context: resolved.target.context,
                confidence: resolved.confidence,
                value
            }
        };
    }
}
exports.UnifiedInteractionPipeline = UnifiedInteractionPipeline;
//# sourceMappingURL=unified-interaction-pipeline.js.map