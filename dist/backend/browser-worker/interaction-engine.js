"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InteractionEngine = void 0;
const interaction_models_1 = require("./interaction-models");
const interaction_policies_1 = require("./interaction-policies");
const seeded_random_1 = require("./seeded-random");
const state_observer_1 = require("./state-observer");
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function toError(error) {
    return error instanceof Error ? error.message : String(error);
}
function mergeProfiles(overrides) {
    return {
        pointer: {
            ...interaction_models_1.DEFAULT_INTERACTION_PROFILES.pointer,
            ...(overrides?.pointer ?? {})
        },
        form: {
            ...interaction_models_1.DEFAULT_INTERACTION_PROFILES.form,
            ...(overrides?.form ?? {})
        }
    };
}
class InteractionEngine {
    constructor(page, profiles, observer, pointerDriver) {
        this.page = page;
        this.pointerDriver = pointerDriver;
        this.pointer = { x: 0, y: 0 };
        this.profiles = mergeProfiles(profiles);
        this.observer = observer ?? new state_observer_1.InteractionStateObserver();
    }
    async click(locator, options = {}) {
        const attempts = this.attemptCount(options.attempts);
        const readinessTimeoutMs = options.readinessTimeoutMs ?? this.profiles.form.readinessTimeoutMs;
        const verifyTimeoutMs = options.verifyTimeoutMs ?? this.profiles.form.verifyTimeoutMs;
        const readiness = options.readiness ?? interaction_policies_1.DEFAULT_READINESS_POLICY;
        const baseSeed = String(options.seed ?? "ares-interaction");
        const trace = [];
        let lastState = { visible: false, enabled: false, stable: false };
        let failureReason = "not-ready";
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const seed = `${baseSeed}:${attempt}`;
            const random = new seeded_random_1.SeededRandom(seed);
            await locator.scrollIntoViewIfNeeded().catch(() => undefined);
            lastState = await this.observer.waitUntilReady(locator, readinessTimeoutMs);
            if (!await this.isReady(readiness, locator, lastState)) {
                failureReason = "not-ready";
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    outcomeExpectation: options.expected?.name,
                    failureReason
                });
                continue;
            }
            const target = this.chooseTargetPoint(lastState.box, random);
            try {
                if (this.pointerDriver) {
                    await this.pointerDriver.click(target, {
                        button: options.button ?? "left",
                        clickCount: options.clickCount ?? 1
                    });
                }
                else {
                    await this.movePointer(target, random);
                    await this.page.mouse.click(target.x, target.y, {
                        button: options.button ?? "left",
                        clickCount: options.clickCount ?? 1
                    });
                }
                this.pointer = target;
            }
            catch (error) {
                failureReason = "action-error";
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    targetPoint: target,
                    outcomeExpectation: options.expected?.name,
                    failureReason,
                    error: toError(error)
                });
                continue;
            }
            if (!options.expected || await this.waitForOutcome(options.expected, verifyTimeoutMs)) {
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    targetPoint: target,
                    outcomeExpectation: options.expected?.name
                });
                return { success: true, attempts: attempt, targetState: lastState, targetPoint: target, trace };
            }
            failureReason = "outcome-timeout";
            trace.push({
                attempt,
                seed,
                readinessPolicy: readiness.name,
                targetState: lastState,
                targetPoint: target,
                outcomeExpectation: options.expected.name,
                failureReason
            });
        }
        return { success: false, attempts, targetState: lastState, failureReason, trace };
    }
    async moveToPoint(target, seed = "ares-pointer-move") {
        if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
            throw new TypeError("Pointer coordinates must be finite numbers.");
        }
        if (this.pointerDriver) {
            await this.pointerDriver.moveTo(target);
        }
        else {
            await this.movePointer(target, new seeded_random_1.SeededRandom(String(seed)));
        }
        this.pointer = { ...target };
    }
    async fill(locator, value, options = {}) {
        return this.runFormAction(locator, options, "ares-form-fill", options.expected ?? (0, interaction_policies_1.locatorValueEquals)(locator, value), () => locator.fill(value));
    }
    async select(locator, value, options = {}) {
        return this.runFormAction(locator, options, "ares-form-select", options.expected ?? (0, interaction_policies_1.locatorValueEquals)(locator, value), () => locator.selectOption(value).then(() => undefined));
    }
    async focus(locator, options = {}) {
        return this.runFormAction(locator, options, "ares-form-focus", options.expected ?? (0, interaction_policies_1.locatorFocused)(locator), () => locator.focus());
    }
    async hover(locator, options = {}) {
        const attempts = this.attemptCount(options.attempts);
        const readinessTimeoutMs = options.readinessTimeoutMs ?? this.profiles.form.readinessTimeoutMs;
        const verifyTimeoutMs = options.verifyTimeoutMs ?? this.profiles.form.verifyTimeoutMs;
        const readiness = options.readiness ?? interaction_policies_1.DEFAULT_READINESS_POLICY;
        const expectation = options.expected ?? (0, interaction_policies_1.locatorHovered)(locator);
        const baseSeed = String(options.seed ?? "ares-hover");
        const trace = [];
        let lastState = { visible: false, enabled: false, stable: false };
        let failureReason = "not-ready";
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const seed = `${baseSeed}:${attempt}`;
            const random = new seeded_random_1.SeededRandom(seed);
            await locator.scrollIntoViewIfNeeded().catch(() => undefined);
            lastState = await this.observer.waitUntilReady(locator, readinessTimeoutMs);
            if (!await this.isReady(readiness, locator, lastState)) {
                failureReason = "not-ready";
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    outcomeExpectation: expectation.name,
                    failureReason
                });
                continue;
            }
            const target = this.chooseTargetPoint(lastState.box, random);
            try {
                await this.moveToPoint(target, seed);
            }
            catch (error) {
                failureReason = "action-error";
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    targetPoint: target,
                    outcomeExpectation: expectation.name,
                    failureReason,
                    error: toError(error)
                });
                continue;
            }
            if (await this.waitForOutcome(expectation, verifyTimeoutMs)) {
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    targetPoint: target,
                    outcomeExpectation: expectation.name
                });
                return { success: true, attempts: attempt, targetState: lastState, targetPoint: target, trace };
            }
            failureReason = "outcome-timeout";
            trace.push({
                attempt,
                seed,
                readinessPolicy: readiness.name,
                targetState: lastState,
                targetPoint: target,
                outcomeExpectation: expectation.name,
                failureReason
            });
        }
        return { success: false, attempts, targetState: lastState, failureReason, trace };
    }
    async scrollIntoView(locator, options = {}) {
        const attempts = this.attemptCount(options.attempts);
        const readinessTimeoutMs = options.readinessTimeoutMs ?? this.profiles.form.readinessTimeoutMs;
        const verifyTimeoutMs = options.verifyTimeoutMs ?? this.profiles.form.verifyTimeoutMs;
        const readiness = options.readiness ?? interaction_policies_1.VISIBLE_STABLE_POLICY;
        const expectation = options.expected ?? (0, interaction_policies_1.locatorVisible)(locator);
        const baseSeed = String(options.seed ?? "ares-scroll");
        const trace = [];
        let lastState = { visible: false, enabled: false, stable: false };
        let failureReason = "not-ready";
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const seed = `${baseSeed}:${attempt}`;
            try {
                await locator.scrollIntoViewIfNeeded();
            }
            catch (error) {
                failureReason = "action-error";
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    outcomeExpectation: expectation.name,
                    failureReason,
                    error: toError(error)
                });
                continue;
            }
            lastState = await this.observer.waitUntilReady(locator, readinessTimeoutMs);
            if (!await this.isReady(readiness, locator, lastState)) {
                failureReason = "not-ready";
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    outcomeExpectation: expectation.name,
                    failureReason
                });
                continue;
            }
            if (await this.waitForOutcome(expectation, verifyTimeoutMs)) {
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    outcomeExpectation: expectation.name
                });
                return { success: true, attempts: attempt, targetState: lastState, trace };
            }
            failureReason = "outcome-timeout";
            trace.push({
                attempt,
                seed,
                readinessPolicy: readiness.name,
                targetState: lastState,
                outcomeExpectation: expectation.name,
                failureReason
            });
        }
        return { success: false, attempts, targetState: lastState, failureReason, trace };
    }
    async runFormAction(locator, options, defaultSeed, expectation, action) {
        const attempts = this.attemptCount(options.attempts);
        const readinessTimeoutMs = options.readinessTimeoutMs ?? this.profiles.form.readinessTimeoutMs;
        const verifyTimeoutMs = options.verifyTimeoutMs ?? this.profiles.form.verifyTimeoutMs;
        const readiness = options.readiness ?? interaction_policies_1.DEFAULT_READINESS_POLICY;
        const baseSeed = String(options.seed ?? defaultSeed);
        const trace = [];
        let lastState = { visible: false, enabled: false, stable: false };
        let failureReason = "not-ready";
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const seed = `${baseSeed}:${attempt}`;
            await locator.scrollIntoViewIfNeeded().catch(() => undefined);
            lastState = await this.observer.waitUntilReady(locator, readinessTimeoutMs);
            if (!await this.isReady(readiness, locator, lastState)) {
                failureReason = "not-ready";
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    outcomeExpectation: expectation.name,
                    failureReason
                });
                continue;
            }
            try {
                await action();
            }
            catch (error) {
                failureReason = "action-error";
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    outcomeExpectation: expectation.name,
                    failureReason,
                    error: toError(error)
                });
                continue;
            }
            if (await this.waitForOutcome(expectation, verifyTimeoutMs)) {
                trace.push({
                    attempt,
                    seed,
                    readinessPolicy: readiness.name,
                    targetState: lastState,
                    outcomeExpectation: expectation.name
                });
                return { success: true, attempts: attempt, targetState: lastState, trace };
            }
            failureReason = "outcome-timeout";
            trace.push({
                attempt,
                seed,
                readinessPolicy: readiness.name,
                targetState: lastState,
                outcomeExpectation: expectation.name,
                failureReason
            });
        }
        return { success: false, attempts, targetState: lastState, failureReason, trace };
    }
    attemptCount(raw) {
        return Math.max(1, Math.min(5, Math.floor(raw ?? 2)));
    }
    async isReady(policy, locator, state) {
        try {
            return Boolean(await policy.evaluate(locator, state));
        }
        catch {
            return false;
        }
    }
    chooseTargetPoint(box, random) {
        const insetRatio = clamp(this.profiles.pointer.targetInsetRatio, 0, 0.45);
        const variation = clamp(this.profiles.pointer.targetVariationRatio, 0, 0.5);
        const insetX = box.width * insetRatio;
        const insetY = box.height * insetRatio;
        const usableWidth = Math.max(1, box.width - insetX * 2);
        const usableHeight = Math.max(1, box.height - insetY * 2);
        const centerX = box.x + insetX + usableWidth / 2;
        const centerY = box.y + insetY + usableHeight / 2;
        const maxOffsetX = usableWidth * variation;
        const maxOffsetY = usableHeight * variation;
        return {
            x: clamp(centerX + random.between(-maxOffsetX, maxOffsetX), box.x + insetX, box.x + box.width - insetX),
            y: clamp(centerY + random.between(-maxOffsetY, maxOffsetY), box.y + insetY, box.y + box.height - insetY)
        };
    }
    async movePointer(target, random) {
        const profile = this.profiles.pointer;
        const steps = random.integer(profile.minSteps, profile.maxSteps);
        const start = { ...this.pointer };
        const distanceX = target.x - start.x;
        const distanceY = target.y - start.y;
        const bend = Math.max(8, Math.min(60, Math.hypot(distanceX, distanceY) * 0.12));
        const direction = random.next() < 0.5 ? -1 : 1;
        const control1 = {
            x: start.x + distanceX * random.between(0.22, 0.38) - direction * bend * (distanceY === 0 ? 0.2 : Math.sign(distanceY)),
            y: start.y + distanceY * random.between(0.22, 0.38) + direction * bend * (distanceX === 0 ? 0.2 : Math.sign(distanceX))
        };
        const control2 = {
            x: start.x + distanceX * random.between(0.62, 0.82) + direction * bend * (distanceY === 0 ? 0.15 : Math.sign(distanceY)),
            y: start.y + distanceY * random.between(0.62, 0.82) - direction * bend * (distanceX === 0 ? 0.15 : Math.sign(distanceX))
        };
        for (let index = 1; index <= steps; index++) {
            const t = index / steps;
            const inverse = 1 - t;
            const x = inverse ** 3 * start.x
                + 3 * inverse ** 2 * t * control1.x
                + 3 * inverse * t ** 2 * control2.x
                + t ** 3 * target.x;
            const y = inverse ** 3 * start.y
                + 3 * inverse ** 2 * t * control1.y
                + 3 * inverse * t ** 2 * control2.y
                + t ** 3 * target.y;
            await this.page.mouse.move(x, y);
            const delay = random.integer(profile.minStepDelayMs, profile.maxStepDelayMs);
            if (delay > 0)
                await sleep(delay);
        }
    }
    async waitForOutcome(expectation, timeoutMs) {
        const deadline = Date.now() + Math.max(0, timeoutMs);
        do {
            try {
                if (await expectation.verify(this.page))
                    return true;
            }
            catch {
                // UI may be re-rendering between action and verification.
            }
            if (Date.now() >= deadline)
                break;
            await sleep(50);
        } while (true);
        return false;
    }
}
exports.InteractionEngine = InteractionEngine;
//# sourceMappingURL=interaction-engine.js.map