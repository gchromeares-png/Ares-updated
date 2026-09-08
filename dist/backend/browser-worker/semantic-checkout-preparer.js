"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticCheckoutPreparer = void 0;
const field_semantic_resolver_1 = require("./field-semantic-resolver");
const semantic_field_autofill_1 = require("./semantic-field-autofill");
const semantic_checkout_completion_1 = require("./semantic-checkout-completion");
const semantic_checkout_profile_planner_1 = require("./semantic-checkout-profile-planner");
const semantic_target_1 = require("./semantic-target");
const ui_interaction_helper_1 = require("./ui-interaction-helper");
/**
 * Shop-neutral checkout profile preparation using the existing semantic resolver.
 * The resolver implementation remains untouched; this class is only a caller.
 */
class SemanticCheckoutPreparer {
    constructor() {
        this.fieldResolver = new field_semantic_resolver_1.FieldSemanticResolver(new field_semantic_resolver_1.OllamaEmbeddingProvider());
    }
    async prepare(page, profile) {
        const interactions = new ui_interaction_helper_1.GhostCursorUiInteractionHelper(page);
        const plan = await new semantic_checkout_profile_planner_1.SemanticCheckoutProfilePlanner(interactions).prepare(page, profile);
        const autofill = new semantic_field_autofill_1.SemanticFieldAutofill(page, interactions, this.fieldResolver);
        const requiredIntents = new Set([
            "email",
            "firstName",
            "lastName",
            "address1",
            "city",
            "postalCode"
        ]);
        const requiredTargets = () => autofill.observedTargets().filter(target => target.intent !== "unknown" && requiredIntents.has(target.intent));
        const fallbackFields = [
            { target: (0, semantic_target_1.semanticTarget)("email", "unknown"), selectors: ['input[name="email"]', 'input[type="email"]', 'input[autocomplete="email"]'] },
            { target: (0, semantic_target_1.semanticTarget)("firstName", "unknown"), selectors: ['input[name="firstName"]', 'input[name*="first_name" i]', 'input[autocomplete="given-name"]'] },
            { target: (0, semantic_target_1.semanticTarget)("lastName", "unknown"), selectors: ['input[name="lastName"]', 'input[name*="last_name" i]', 'input[autocomplete="family-name"]'] },
            { target: (0, semantic_target_1.semanticTarget)("address1", "unknown"), selectors: ['input[name="address1"]', 'input[name*="address1" i]', 'input[autocomplete="address-line1"]'] },
            { target: (0, semantic_target_1.semanticTarget)("address2", "unknown"), selectors: ['input[name="address2"]', 'input[name*="address2" i]', 'input[autocomplete="address-line2"]'] },
            { target: (0, semantic_target_1.semanticTarget)("city", "unknown"), selectors: ['input[name="city"]', 'input[autocomplete="address-level2"]'] },
            { target: (0, semantic_target_1.semanticTarget)("postalCode", "unknown"), selectors: ['input[name="postalCode"]', 'input[name*="postal" i]', 'input[name*="zip" i]', 'input[autocomplete="postal-code"]'] },
            { target: (0, semantic_target_1.semanticTarget)("phone", "unknown"), selectors: ['input[name="phone"]', 'input[type="tel"]', 'input[autocomplete="tel"]'] },
            { target: (0, semantic_target_1.semanticTarget)("countryCode", "unknown"), selectors: ['select[name="countryCode"]', 'select[name*="country" i]'], select: true }
        ];
        for (let attempt = 0; attempt < 6; attempt++) {
            if (attempt > 0)
                await new Promise(resolve => setTimeout(resolve, 450));
            await autofill.fillSemantic(plan.values).catch(() => undefined);
            for (const fallback of fallbackFields) {
                if (autofill.hasObservedIntent(fallback.target.intent))
                    continue;
                const value = plan.values.valueFor(fallback.target);
                if (!value?.trim())
                    continue;
                for (const selector of fallback.selectors) {
                    const locator = page.locator(selector).first();
                    try {
                        const success = fallback.select
                            ? await autofill.selectLocator(fallback.target, locator, value)
                            : await autofill.fillLocator(fallback.target, locator, value);
                        if (success)
                            break;
                    }
                    catch { }
                }
            }
            const snapshot = await autofill.result(plan.values);
            const targets = requiredTargets();
            const completion = (0, semantic_checkout_completion_1.evaluateSemanticCheckoutCompletion)({
                filled: snapshot.filled,
                missing: snapshot.missing,
                requiredTargets: targets
            });
            if (targets.length > 0 && completion.complete)
                break;
        }
        const result = await autofill.result(plan.values);
        const targets = requiredTargets();
        const completion = (0, semantic_checkout_completion_1.evaluateSemanticCheckoutCompletion)({
            filled: result.filled,
            missing: result.missing,
            requiredTargets: targets
        });
        return {
            filled: result.filled,
            missing: result.missing,
            writeCounts: result.writeCounts,
            billingMode: plan.billingMode,
            requiredTargetsSatisfied: targets.length > 0 && completion.complete,
            requiredTargetCount: targets.length
        };
    }
}
exports.SemanticCheckoutPreparer = SemanticCheckoutPreparer;
//# sourceMappingURL=semantic-checkout-preparer.js.map