"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticCheckoutProfilePlanner = void 0;
const semantic_checkout_observability_1 = require("./semantic-checkout-observability");
const semantic_profile_mapper_1 = require("./semantic-profile-mapper");
class PlannedProfileValues {
    constructor(mapper, profile, semanticCheckoutTrace) {
        this.mapper = mapper;
        this.semanticCheckoutTrace = semanticCheckoutTrace;
        this.semanticAutofillEnabled = profile.browser?.kiAutofill !== false;
    }
    valueFor(target) {
        return this.mapper.valueFor(target);
    }
}
const SAME_AS_SHIPPING_TEXT = /(?:same\s+as\s+(?:shipping|delivery)|billing\s+address\s+(?:is\s+)?same\s+as|rechnungs(?:adresse|anschrift)\s+(?:ist\s+)?(?:gleich|entspricht)\s+(?:der\s+)?liefer(?:adresse|anschrift)|liefer(?:adresse|anschrift)\s+(?:auch|als)\s+rechnungs(?:adresse|anschrift))/i;
class SemanticCheckoutProfilePlanner {
    constructor(interactions) {
        this.interactions = interactions;
    }
    async prepare(page, profile) {
        if (profile.billingAddress) {
            return this.plan(new semantic_profile_mapper_1.SemanticProfileMapper(profile, { billingMode: "separate-billing-fields" }), profile, "explicit-billing");
        }
        const preferred = new semantic_profile_mapper_1.SemanticProfileMapper(profile, { billingMode: "prefer-same-as-shipping" });
        if (await this.activateSameAsShipping(page)) {
            return this.plan(preferred, profile, "same-as-shipping");
        }
        return this.plan(new semantic_profile_mapper_1.SemanticProfileMapper(profile, { billingMode: "separate-billing-fields" }), profile, "separate-billing-fields");
    }
    plan(mapper, profile, billingMode) {
        const semanticCheckoutTrace = new semantic_checkout_observability_1.SemanticCheckoutTraceRecorder(billingMode);
        return {
            values: new PlannedProfileValues(mapper, profile, semanticCheckoutTrace),
            billingMode
        };
    }
    async activateSameAsShipping(page) {
        const candidates = page.locator('label, button, [role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"]');
        const count = Math.min(await candidates.count().catch(() => 0), 120);
        for (let index = 0; index < count; index++) {
            const candidate = candidates.nth(index);
            const text = await this.candidateText(candidate).catch(() => "");
            if (!SAME_AS_SHIPPING_TEXT.test(text))
                continue;
            const control = await this.resolveControl(candidate);
            if (!control || !await control.isVisible({ timeout: 120 }).catch(() => false))
                continue;
            if (await this.isSelected(control))
                return true;
            await this.interactions.click(control, {
                attempts: 2,
                seed: "semantic-billing:same-as-shipping"
            }).catch(() => undefined);
            if (await this.isSelected(control))
                return true;
        }
        return false;
    }
    async candidateText(locator) {
        return locator.evaluate(element => {
            const input = element;
            const id = input.id || "";
            const explicitLabel = id
                ? Array.from(document.querySelectorAll("label")).find(label => label.htmlFor === id)?.textContent || ""
                : "";
            const enclosingLabel = element.closest("label")?.textContent || "";
            return [
                element.textContent || "",
                element.getAttribute("aria-label") || "",
                element.getAttribute("name") || "",
                element.getAttribute("id") || "",
                explicitLabel,
                enclosingLabel
            ].join(" ").replace(/\s+/g, " ").trim();
        });
    }
    async resolveControl(candidate) {
        const usable = await candidate.evaluate(element => {
            const tag = element.tagName.toLowerCase();
            const type = (element.getAttribute("type") || "").toLowerCase();
            const role = (element.getAttribute("role") || "").toLowerCase();
            if (tag === "input" && (type === "checkbox" || type === "radio"))
                return true;
            if (role === "checkbox" || role === "radio" || tag === "button")
                return true;
            if (tag !== "label")
                return false;
            const htmlFor = element.htmlFor || element.getAttribute("for") || "";
            if (htmlFor && document.getElementById(htmlFor))
                return true;
            return Boolean(element.querySelector('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'));
        }).catch(() => false);
        return usable ? candidate : undefined;
    }
    async isSelected(control) {
        return control.evaluate(element => {
            const ariaChecked = element.getAttribute("aria-checked");
            if (ariaChecked === "true")
                return true;
            if (ariaChecked === "false")
                return false;
            if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
                return element.checked;
            }
            if (element instanceof HTMLLabelElement) {
                const explicit = element.htmlFor ? document.getElementById(element.htmlFor) : null;
                const nested = element.querySelector('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]');
                const target = explicit || nested;
                if (target instanceof HTMLInputElement)
                    return target.checked;
                return target?.getAttribute("aria-checked") === "true";
            }
            return false;
        }).catch(() => false);
    }
}
exports.SemanticCheckoutProfilePlanner = SemanticCheckoutProfilePlanner;
//# sourceMappingURL=semantic-checkout-profile-planner.js.map