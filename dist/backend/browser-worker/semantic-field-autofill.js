"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticFieldAutofill = void 0;
const field_semantic_resolver_1 = require("./field-semantic-resolver");
const semantic_checkout_observability_1 = require("./semantic-checkout-observability");
const semantic_target_1 = require("./semantic-target");
function normalizeValue(value) {
    return value.trim();
}
function semanticAutofillEnabled(values) {
    const policy = values;
    return policy.semanticAutofillEnabled !== false;
}
function semanticCheckoutTrace(values) {
    return values.semanticCheckoutTrace;
}
class SemanticFieldAutofill {
    constructor(page, interactions, resolver, trace) {
        this.page = page;
        this.interactions = interactions;
        this.resolver = resolver;
        this.completedTargets = new Map();
        this.writeCounts = new Map();
        this.seenTargets = new Map();
        this.trace = trace;
    }
    async fillSemantic(values) {
        // Bind the checkout-run recorder before the feature gate so deterministic
        // shop fallbacks remain observable even when KI AutoFill is disabled.
        this.trace ?? (this.trace = semanticCheckoutTrace(values));
        // A disabled KI AutoFill policy intentionally skips semantic DOM resolution.
        // Shop compatibility fallbacks may still fill deterministic known selectors.
        if (!semanticAutofillEnabled(values))
            return;
        const descriptors = await (0, field_semantic_resolver_1.collectFieldDescriptors)(this.page);
        const resolved = await this.resolver.resolve(descriptors);
        const ranked = [...resolved].sort((left, right) => right.confidence - left.confidence);
        for (const item of ranked) {
            const resolution = {
                resolverSource: {
                    intent: item.source.intent,
                    context: item.source.context
                },
                confidence: item.confidence
            };
            if (item.target.intent === "unknown") {
                this.trace?.record({
                    target: item.target,
                    ...resolution,
                    valueAvailable: false,
                    action: "resolve",
                    result: "unresolved"
                });
                continue;
            }
            const locator = (0, field_semantic_resolver_1.fieldLocator)(this.page, item.descriptor.index);
            const value = values.valueFor(item.target);
            if (item.descriptor.tagName === "select") {
                await this.selectLocator(item.target, locator, value, { kind: "semantic", resolution }).catch(() => false);
            }
            else {
                await this.fillLocator(item.target, locator, value, { kind: "semantic", resolution }).catch(() => false);
            }
        }
    }
    async fillLocator(target, locator, value, traceOptions = {}) {
        const kind = this.traceKind(traceOptions);
        const resolution = this.traceResolution(traceOptions);
        const valueAvailable = Boolean(value?.trim());
        const action = kind === "fallback" ? "fallback-write" : "write";
        if (target.intent === "unknown") {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable,
                action: "resolve",
                result: "unresolved"
            });
            return false;
        }
        if (!await this.isInteractive(locator)) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable,
                action: "interaction-check",
                result: "non-interactive"
            });
            return false;
        }
        const key = this.rememberTarget(target);
        const desired = normalizeValue(value ?? "");
        if (!desired) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: false,
                action: "value-check",
                result: "missing-value"
            });
            return false;
        }
        if (await this.isCompleted(target, desired)) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: true,
                action: "completion-check",
                result: "already-complete"
            });
            return true;
        }
        const current = await this.readValue(locator);
        if (normalizeValue(current) === desired) {
            this.completedTargets.set(key, locator);
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: true,
                action: "completion-check",
                result: "already-complete"
            });
            return true;
        }
        try {
            await this.interactions.fill(locator, desired, {
                attempts: 2,
                seed: `semantic-fill:${key}`
            });
        }
        catch (error) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: true,
                action,
                result: "write-failed"
            });
            throw error;
        }
        this.bumpWriteCount(target);
        const after = await this.readValue(locator);
        if (normalizeValue(after) !== desired) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: true,
                action,
                result: "write-failed"
            });
            return false;
        }
        this.completedTargets.set(key, locator);
        this.trace?.record({
            target,
            ...resolution,
            valueAvailable: true,
            action,
            result: kind === "fallback" ? "fallback-filled" : "filled"
        });
        return true;
    }
    async selectLocator(target, locator, value, traceOptions = {}) {
        const kind = this.traceKind(traceOptions);
        const resolution = this.traceResolution(traceOptions);
        const valueAvailable = Boolean(value?.trim());
        const action = kind === "fallback" ? "fallback-select" : "select";
        if (target.intent === "unknown") {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable,
                action: "resolve",
                result: "unresolved"
            });
            return false;
        }
        if (!await this.isInteractive(locator)) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable,
                action: "interaction-check",
                result: "non-interactive"
            });
            return false;
        }
        const key = this.rememberTarget(target);
        const desired = normalizeValue(value ?? "");
        if (!desired) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: false,
                action: "value-check",
                result: "missing-value"
            });
            return false;
        }
        if (await this.isCompleted(target, desired)) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: true,
                action: "completion-check",
                result: "already-complete"
            });
            return true;
        }
        const current = await this.readValue(locator);
        if (normalizeValue(current).toUpperCase() === desired.toUpperCase()) {
            this.completedTargets.set(key, locator);
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: true,
                action: "completion-check",
                result: "already-complete"
            });
            return true;
        }
        try {
            await this.interactions.select(locator, desired, {
                attempts: 2,
                seed: `semantic-select:${key}`
            });
        }
        catch (error) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: true,
                action,
                result: "write-failed"
            });
            throw error;
        }
        this.bumpWriteCount(target);
        const after = await this.readValue(locator);
        if (normalizeValue(after).toUpperCase() !== desired.toUpperCase()) {
            this.trace?.record({
                target,
                ...resolution,
                valueAvailable: true,
                action,
                result: "write-failed"
            });
            return false;
        }
        this.completedTargets.set(key, locator);
        this.trace?.record({
            target,
            ...resolution,
            valueAvailable: true,
            action,
            result: kind === "fallback" ? "fallback-filled" : "filled"
        });
        return true;
    }
    async isComplete(target, value) {
        this.rememberTarget(target);
        return this.isCompleted(target, value);
    }
    observedTargets() {
        return [...this.seenTargets.values()].map(target => ({ ...target }));
    }
    hasObservedIntent(intent) {
        return [...this.seenTargets.values()].some(target => target.intent === intent);
    }
    async result(values, targets = [...this.seenTargets.values()]) {
        this.trace ?? (this.trace = semanticCheckoutTrace(values));
        const filled = [];
        const missing = [];
        const uniqueTargets = new Map();
        for (const target of targets)
            uniqueTargets.set((0, semantic_target_1.targetKey)(target), target);
        for (const target of uniqueTargets.values()) {
            const value = values.valueFor(target);
            if (!value?.trim()) {
                missing.push({ ...target });
                continue;
            }
            if (await this.isCompleted(target, value))
                filled.push({ ...target });
            else
                missing.push({ ...target });
        }
        const writeCounts = {};
        for (const [key, count] of this.writeCounts.entries())
            writeCounts[key] = count;
        return {
            filled,
            missing,
            writeCounts,
            ...(this.trace ? { trace: this.trace.snapshot() } : {})
        };
    }
    async isCompleted(target, value) {
        const key = (0, semantic_target_1.targetKey)(target);
        const locator = this.completedTargets.get(key);
        if (!locator)
            return false;
        const current = await this.readValue(locator);
        if (normalizeValue(current).toUpperCase() === normalizeValue(value).toUpperCase())
            return true;
        this.completedTargets.delete(key);
        return false;
    }
    rememberTarget(target) {
        const key = (0, semantic_target_1.targetKey)(target);
        this.seenTargets.set(key, { ...target });
        return key;
    }
    async isInteractive(locator) {
        if (!await locator.isVisible({ timeout: 150 }).catch(() => false))
            return false;
        return locator.isEnabled({ timeout: 150 }).catch(() => false);
    }
    async readValue(locator) {
        return locator.inputValue({ timeout: 250 }).catch(() => "");
    }
    bumpWriteCount(target) {
        const key = (0, semantic_target_1.targetKey)(target);
        this.writeCounts.set(key, (this.writeCounts.get(key) ?? 0) + 1);
    }
    traceKind(options) {
        if (options.kind)
            return options.kind;
        return options.resolution ? "semantic" : "fallback";
    }
    traceResolution(options) {
        if (options.resolution)
            return options.resolution;
        return this.traceKind(options) === "fallback" ? (0, semantic_checkout_observability_1.fallbackTraceResolution)() : (0, semantic_checkout_observability_1.unknownTraceResolution)();
    }
}
exports.SemanticFieldAutofill = SemanticFieldAutofill;
//# sourceMappingURL=semantic-field-autofill.js.map