"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopifyPurchaseReadyExecutor = void 0;
const semantic_checkout_preparer_1 = require("../browser-worker/semantic-checkout-preparer");
const checkout_payment_preparer_1 = require("../browser-worker/checkout-payment-preparer");
const payment_readiness_1 = require("../browser-worker/payment-readiness");
const final_submit_recovery_1 = require("../browser-worker/final-submit-recovery");
const checkout_journey_1 = require("./checkout-journey");
class ShopifyPurchaseReadyExecutor {
    constructor(delegate, runtime, onTaskUpdate = () => undefined, checkoutPreparer = new semantic_checkout_preparer_1.SemanticCheckoutPreparer(), paymentPreparer = new checkout_payment_preparer_1.CheckoutPaymentPreparer(), journey = new checkout_journey_1.ShopifyCheckoutJourney()) {
        this.delegate = delegate;
        this.runtime = runtime;
        this.onTaskUpdate = onTaskUpdate;
        this.checkoutPreparer = checkoutPreparer;
        this.paymentPreparer = paymentPreparer;
        this.journey = journey;
        this.active = new Map();
        this.allowFinalPurchase = false;
    }
    async execute(task, profile, paymentSession) {
        if (!profile) {
            task.lastError = "Shopify Purchase-Ready-Flow benötigt das zugeordnete Profil.";
            return false;
        }
        if (this.active.has(task.id)) {
            task.lastError = `Shopify Checkout ${task.id} läuft bereits.`;
            return false;
        }
        const checkoutOpened = await this.delegate.execute(task);
        if (!checkoutOpened)
            return false;
        const page = this.runtime.getContext(task.id)?.page;
        if (!page || page.isClosed()) {
            task.lastError = "Shopify Checkout-Kontext ist nach der Profilvorbereitung nicht mehr aktiv.";
            return false;
        }
        const active = { task, controller: new AbortController(), purchaseReady: false };
        this.active.set(task.id, active);
        try {
            this.publishFlow(task, "checkout");
            await this.prepareUntilPurchaseReady(task, active, page, profile, paymentSession);
            if (active.controller.signal.aborted)
                return true;
            active.purchaseReady = true;
            this.publishFlow(task, "purchase-ready");
            this.publishFinalPurchaseStatus(task, this.allowFinalPurchase ? "armed" : "blocked");
            while (!active.controller.signal.aborted) {
                if (!this.allowFinalPurchase) {
                    await this.delay(250, active.controller.signal);
                    continue;
                }
                const submitted = await this.journey.submitOrder(page, () => this.allowFinalPurchase && !active.controller.signal.aborted);
                if (submitted) {
                    this.publishFlow(task, "submitted");
                    this.publishFinalPurchaseStatus(task, "submitted");
                    const recovery = await (0, final_submit_recovery_1.confirmFinalSubmitWithRetries)(() => this.journey.isOrderConfirmed?.(page) ?? Promise.resolve(false), {
                        attempts: this.orderConfirmationAttempts(task),
                        delayMs: this.orderConfirmationRetryDelayMs(task),
                        signal: active.controller.signal
                    });
                    if (recovery.confirmed) {
                        this.publishFlow(task, "confirmed");
                        this.publishFinalPurchaseStatus(task, "confirmed");
                        return true;
                    }
                    task.lastError = "Finaler Bestell-Submit wurde ausgelöst, aber kein bestätigter Bestellerfolg erkannt. Nach zwei Recovery-Versuchen wird aus Sicherheitsgründen nicht erneut abgesendet.";
                    this.blockRetryAfterAmbiguousSubmit(task, recovery.attempts, recovery.maxAttempts);
                    this.publishFinalPurchaseStatus(task, "confirmation-missing");
                    this.onTaskUpdate(task);
                    return false;
                }
                this.publishFinalPurchaseStatus(task, this.allowFinalPurchase ? "not-ready" : "blocked");
                if (!await this.journey.isReadyForFinalSubmit(page).catch(() => false)) {
                    active.purchaseReady = false;
                    await this.prepareUntilPurchaseReady(task, active, page, profile, paymentSession);
                    if (active.controller.signal.aborted)
                        return true;
                    active.purchaseReady = true;
                    this.publishFlow(task, "purchase-ready");
                }
                await this.delay(700, active.controller.signal);
            }
            return true;
        }
        catch (error) {
            if (active.controller.signal.aborted)
                return true;
            task.lastError = error instanceof Error ? error.message : String(error);
            this.onTaskUpdate(task);
            await this.delegate.closeTask(task.id).catch(() => undefined);
            return false;
        }
        finally {
            this.active.delete(task.id);
        }
    }
    async setFinalPurchaseAllowed(allowed) {
        this.allowFinalPurchase = allowed === true;
        for (const active of this.active.values()) {
            if (!active.purchaseReady)
                continue;
            this.publishFinalPurchaseStatus(active.task, this.allowFinalPurchase ? "armed" : "blocked");
        }
    }
    async cancelTask(taskId) {
        this.active.get(taskId)?.controller.abort();
        this.active.delete(taskId);
        await this.delegate.closeTask(taskId);
    }
    async closeAll() {
        for (const active of this.active.values())
            active.controller.abort();
        this.active.clear();
        await this.delegate.closeAll();
    }
    async prepareUntilPurchaseReady(task, active, page, profile, paymentSession) {
        const deadline = Date.now() + this.checkoutPreparationMaxMs(task);
        const shopify = task.config.data?.["shopify"];
        const initialProfile = shopify?.["checkoutProfile"];
        let profileReady = initialProfile?.["requiredTargetsSatisfied"] === true;
        let lastProfile;
        let lastPayment;
        let lastPaymentReason = paymentSession ? "missing-preparation" : "missing-session";
        while (!active.controller.signal.aborted && Date.now() < deadline) {
            lastProfile = await this.checkoutPreparer.prepare(page, profile).catch(() => undefined);
            if (lastProfile && lastProfile.requiredTargetCount > 0)
                profileReady = lastProfile.requiredTargetsSatisfied;
            lastPayment = await this.paymentPreparer.prepare(page, paymentSession).catch(error => ({
                detectedMethods: [],
                selectedMethod: paymentSession?.method,
                filledFields: [],
                missingFields: [],
                requiresUserAction: true,
                note: `Zahlungsprüfung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`
            }));
            const paymentReadiness = (0, payment_readiness_1.evaluatePaymentReadiness)(paymentSession, lastPayment);
            lastPaymentReason = paymentReadiness.reason;
            const finalControlReady = await this.journey.isReadyForFinalSubmit(page).catch(() => false);
            const reviewReady = profileReady && paymentReadiness.ready && finalControlReady;
            this.publishCheckoutPreparation(task, {
                phase: reviewReady ? "purchase-ready" : "preparing",
                profileReady,
                paymentReady: paymentReadiness.ready,
                paymentReadinessReason: paymentReadiness.reason,
                reviewReady,
                profile: lastProfile,
                payment: lastPayment
            });
            if (reviewReady)
                return;
            const advanced = await this.journey.advanceCheckout(page).catch(() => false);
            if (!advanced)
                await this.delay(700, active.controller.signal);
        }
        if (active.controller.signal.aborted)
            return;
        const reason = !profileReady
            ? "Shopify Checkout-Adresse/Profil wurde nicht vollständig bestätigt."
            : lastPaymentReason !== "ready"
                ? `Shopify Checkout-Zahlung ist nicht kaufbereit (${lastPaymentReason}).`
                : "Shopify Checkout erreichte keinen finalen kaufbereiten Review-/Submit-Zustand.";
        throw new Error(reason);
    }
    publishCheckoutPreparation(task, input) {
        task.config.data = {
            ...(task.config.data ?? {}),
            checkoutPreparation: {
                phase: input.phase,
                profileReady: input.profileReady,
                paymentReady: input.paymentReady,
                paymentReadinessReason: input.paymentReadinessReason,
                reviewReady: input.reviewReady,
                ...(input.profile ? {
                    profile: {
                        billingMode: input.profile.billingMode,
                        requiredTargetsSatisfied: input.profile.requiredTargetsSatisfied,
                        requiredTargetCount: input.profile.requiredTargetCount,
                        filled: input.profile.filled,
                        missing: input.profile.missing,
                        writeCounts: input.profile.writeCounts
                    }
                } : {}),
                ...(input.payment ? { payment: input.payment } : {}),
                updatedAt: new Date().toISOString()
            },
            ...(input.payment ? { paymentPreparation: input.payment } : {})
        };
        this.onTaskUpdate(task);
    }
    publishFlow(task, stage) {
        const now = new Date().toISOString();
        const shopify = task.config.data?.["shopify"];
        task.config.data = {
            ...(task.config.data ?? {}),
            shopifyFlow: { stage, updatedAt: now },
            ...(stage === "submitted" || stage === "confirmed" ? {
                shopify: {
                    ...(shopify ?? {}),
                    finalPaymentSubmitted: true,
                    ...(stage === "confirmed" ? { finalPaymentConfirmed: true } : {})
                }
            } : {})
        };
        this.onTaskUpdate(task);
    }
    publishFinalPurchaseStatus(task, status) {
        const now = new Date().toISOString();
        const previous = task.config.data?.["finalPurchaseRuntime"];
        task.config.data = {
            ...(task.config.data ?? {}),
            finalPurchaseRuntime: {
                ...(previous ?? {}),
                allowFinalPurchase: this.allowFinalPurchase,
                status,
                updatedAt: now,
                ...((status === "submitted" || status === "confirmed" || status === "confirmation-missing") && !previous?.["submittedAt"] ? { submittedAt: now } : {}),
                ...(status === "confirmed" ? { confirmedAt: now } : {})
            }
        };
        this.onTaskUpdate(task);
    }
    blockRetryAfterAmbiguousSubmit(task, attempts, maxAttempts) {
        task.config.data = {
            ...(task.config.data ?? {}),
            retryPolicy: {
                blocked: true,
                reason: "ambiguous-final-submit",
                attempts,
                maxAttempts,
                updatedAt: new Date().toISOString()
            }
        };
    }
    checkoutPreparationMaxMs(task) {
        const raw = Number(task.config.data?.["checkoutPreparationMaxMs"] ?? 10 * 60000);
        return Number.isFinite(raw) ? Math.min(30 * 60000, Math.max(30000, raw)) : 10 * 60000;
    }
    orderConfirmationAttempts(task) {
        const raw = Number(task.config.data?.["orderConfirmationAttempts"] ?? 2);
        return Number.isFinite(raw) ? Math.min(5, Math.max(2, Math.floor(raw))) : 2;
    }
    orderConfirmationRetryDelayMs(task) {
        const raw = Number(task.config.data?.["orderConfirmationRetryDelayMs"] ?? 750);
        return Number.isFinite(raw) ? Math.min(5000, Math.max(0, Math.floor(raw))) : 750;
    }
    delay(ms, signal) {
        if (signal.aborted)
            return Promise.resolve();
        return new Promise(resolve => {
            const timer = setTimeout(done, ms);
            function done() {
                clearTimeout(timer);
                signal.removeEventListener("abort", done);
                resolve();
            }
            signal.addEventListener("abort", done, { once: true });
        });
    }
}
exports.ShopifyPurchaseReadyExecutor = ShopifyPurchaseReadyExecutor;
//# sourceMappingURL=shopify-purchase-ready-executor.js.map