"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EarlyGateBrowserTaskExecutor = void 0;
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const os = tslib_1.__importStar(require("os"));
const path = tslib_1.__importStar(require("path"));
const queue_waiter_1 = require("./queue-waiter");
const checkout_payment_preparer_1 = require("./checkout-payment-preparer");
const payment_readiness_1 = require("./payment-readiness");
const final_submit_recovery_1 = require("./final-submit-recovery");
const semantic_checkout_preparer_1 = require("./semantic-checkout-preparer");
const early_gate_1 = require("../monitor/early-gate");
class EarlyGateBrowserTaskExecutor {
    constructor(getShop, getProfile, resolveJourney, browserWorker, onTaskUpdate = () => undefined) {
        this.getShop = getShop;
        this.getProfile = getProfile;
        this.resolveJourney = resolveJourney;
        this.browserWorker = browserWorker;
        this.onTaskUpdate = onTaskUpdate;
        this.active = new Map();
        this.checkoutPreparer = new semantic_checkout_preparer_1.SemanticCheckoutPreparer();
        this.paymentPreparer = new checkout_payment_preparer_1.CheckoutPaymentPreparer();
        this.allowFinalPurchase = false;
    }
    async execute(task, paymentSession) {
        const shopId = task.config.shopId;
        const profileId = String(task.config.data?.["profileId"] ?? "").trim();
        const postQueue = task.config.data?.["postQueueDiscovery"];
        const productName = String(postQueue?.["productName"] ?? "").trim();
        if (!shopId || !profileId || !productName) {
            task.lastError = "Early-Gate-Child benötigt shopId, profileId und productName.";
            return false;
        }
        const shop = this.getShop(shopId);
        const profile = this.getProfile(profileId);
        if (!shop || !profile) {
            task.lastError = !shop ? `Shop ${shopId} ist nicht registriert.` : `Profil ${profileId} ist nicht registriert.`;
            return false;
        }
        const journey = this.resolveJourney(shop);
        if (!journey?.supports(shop)) {
            task.lastError = `Für ${shop.name} ist keine Early-Gate-Release-Journey registriert.`;
            return false;
        }
        if (this.active.has(task.id)) {
            task.lastError = `Early-Gate-Browser-Task ${task.id} läuft bereits.`;
            return false;
        }
        const session = {
            task,
            keywords: (0, early_gate_1.normalizeDiscoveryKeywords)(postQueue?.["keywords"]),
            controller: new AbortController()
        };
        this.active.set(task.id, session);
        const profileRoot = process.env["ARES_BROWSER_PROFILE_ROOT"]?.trim() || path.join(os.tmpdir(), "ares-browser-profiles");
        fs.mkdirSync(profileRoot, { recursive: true });
        const userDataDir = path.join(profileRoot, task.id.replace(/[^a-zA-Z0-9_-]/g, "_"));
        fs.mkdirSync(userDataDir, { recursive: true });
        const proxy = profile.proxy?.host && profile.proxy.port ? {
            protocol: profile.proxy.protocol || "http",
            host: profile.proxy.host,
            port: profile.proxy.port,
            username: profile.proxy.username || undefined,
            password: profile.proxy.password || undefined
        } : undefined;
        try {
            await this.browserWorker.closeContext(task.id);
            const handle = await this.browserWorker.createContext({
                taskId: task.id,
                userDataDir,
                headless: profile.browser?.headless ?? Boolean(task.config.data?.["browserConfig"]?.["headless"]),
                proxy,
                userAgent: profile.browser?.userAgent || undefined,
                viewport: null,
                navigationTimeoutMs: 30000,
                actionTimeoutMs: 15000
            });
            const page = handle.page;
            task.config.data = {
                ...(task.config.data ?? {}),
                browserSession: { type: "seleniumbase-cdp", isolatedPerTask: true, userDataDir },
                browserEnvironment: handle.environmentAudit
            };
            (0, early_gate_1.setEarlyGateRuntime)(task, { activeArea: "browser-child", stage: "browser-child" });
            this.emit(task);
            const waiter = new queue_waiter_1.BrowserQueueWaiter(page, task, current => this.emit(current), {
                maxWaitMs: this.queueMaxWaitMs(task),
                pollIntervalMs: 2000,
                releaseConfirmations: 2
            });
            waiter.start();
            let navigationError;
            try {
                await page.goto(shop.baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
            }
            catch (error) {
                navigationError = error;
            }
            try {
                const queue = await waiter.waitIfQueued();
                if (!queue.detected && navigationError)
                    throw navigationError;
            }
            finally {
                waiter.stop();
            }
            this.markStage(task, "post-queue-discovery", { postQueueDiscoveryAt: new Date().toISOString() });
            this.publishKeywords(session);
            const discoveryDeadline = Date.now() + this.discoveryMaxMs(task);
            let product;
            while (!session.controller.signal.aborted && Date.now() < discoveryDeadline) {
                product = await journey.discover(page, shop, { productName, keywords: [...session.keywords] });
                if (product)
                    break;
                await this.delay(this.discoveryIntervalMs(task), session.controller.signal);
            }
            if (session.controller.signal.aborted)
                return true;
            if (!product)
                throw new Error("Post-Queue-Discovery-Zeitfenster ohne passenden verfügbaren Produkt-Treffer beendet.");
            task.config.data = {
                ...(task.config.data ?? {}),
                releaseProduct: {
                    title: product.title,
                    url: product.url,
                    externalId: product.externalId,
                    sku: product.sku
                }
            };
            this.markStage(task, "product-found", { productFoundAt: new Date().toISOString() });
            await journey.addToCart(page, shop, product);
            this.markStage(task, "cart", { cartAt: new Date().toISOString() });
            await journey.openCheckout(page, shop);
            const initialPaymentReadiness = (0, payment_readiness_1.evaluatePaymentReadiness)(paymentSession, undefined);
            this.publishCheckoutPreparation(task, {
                phase: "checkout-opened",
                profileReady: false,
                paymentReady: initialPaymentReadiness.ready,
                paymentReadinessReason: initialPaymentReadiness.reason,
                reviewReady: false
            });
            await this.prepareCheckoutUntilReady(task, session, journey, page, shop, profile, paymentSession);
            if (session.controller.signal.aborted)
                return true;
            this.markStage(task, "checkout", { checkoutAt: new Date().toISOString() });
            this.publishFinalPurchaseStatus(task, "blocked");
            while (!session.controller.signal.aborted) {
                if (!this.allowFinalPurchase) {
                    await this.delay(250, session.controller.signal);
                    continue;
                }
                const submitted = await journey.submitOrder(page, shop, () => this.allowFinalPurchase);
                if (submitted) {
                    this.publishFinalPurchaseStatus(task, "submitted");
                    const recovery = await (0, final_submit_recovery_1.confirmFinalSubmitWithRetries)(() => journey.isOrderConfirmed?.(page, shop) ?? Promise.resolve(false), {
                        attempts: this.orderConfirmationAttempts(task),
                        delayMs: this.orderConfirmationRetryDelayMs(task),
                        signal: session.controller.signal
                    });
                    if (recovery.confirmed) {
                        this.publishFinalPurchaseStatus(task, "confirmed");
                        return true;
                    }
                    task.lastError = "Finaler Bestell-Submit wurde ausgelöst, aber kein bestätigter Bestellerfolg erkannt. Nach zwei Recovery-Versuchen wird aus Sicherheitsgründen nicht erneut abgesendet.";
                    this.blockRetryAfterAmbiguousSubmit(task, recovery.attempts, recovery.maxAttempts);
                    this.publishFinalPurchaseStatus(task, "confirmation-missing");
                    this.emit(task);
                    return false;
                }
                this.publishFinalPurchaseStatus(task, this.allowFinalPurchase ? "not-ready" : "blocked");
                await this.delay(1000, session.controller.signal);
            }
            return true;
        }
        catch (error) {
            if (session.controller.signal.aborted)
                return true;
            task.lastError = error instanceof Error ? error.message : String(error);
            this.emit(task);
            await this.browserWorker.closeContext(task.id).catch(() => undefined);
            return false;
        }
        finally {
            this.active.delete(task.id);
        }
    }
    async updateDiscoveryKeywords(taskId, keywords) {
        const session = this.active.get(taskId);
        if (!session)
            throw new Error(`Laufender Early-Gate-Browser-Child ${taskId} wurde nicht gefunden.`);
        session.keywords = (0, early_gate_1.normalizeDiscoveryKeywords)(keywords);
        this.publishKeywords(session);
        return [...session.keywords];
    }
    async setFinalPurchaseAllowed(allowed) {
        this.allowFinalPurchase = allowed === true;
        for (const session of this.active.values()) {
            if (session.task.config.data?.["earlyGateFlow"] && this.flowStage(session.task) === "checkout") {
                this.publishFinalPurchaseStatus(session.task, this.allowFinalPurchase ? "armed" : "blocked");
            }
        }
    }
    async cancelTask(taskId) {
        this.active.get(taskId)?.controller.abort();
        this.active.delete(taskId);
        await this.browserWorker.closeContext(taskId);
    }
    async closeAll() {
        const taskIds = [...this.active.keys()];
        for (const session of this.active.values())
            session.controller.abort();
        this.active.clear();
        await Promise.allSettled(taskIds.map(taskId => this.browserWorker.closeContext(taskId)));
    }
    async prepareCheckoutUntilReady(task, session, journey, page, shop, profile, paymentSession) {
        const deadline = Date.now() + this.checkoutPreparationMaxMs(task);
        let profileReady = false;
        let lastProfile;
        let lastPayment;
        let lastPaymentReason = paymentSession ? "missing-preparation" : "missing-session";
        while (!session.controller.signal.aborted && Date.now() < deadline) {
            lastProfile = await this.checkoutPreparer.prepare(page, profile).catch(() => undefined);
            if (lastProfile?.requiredTargetsSatisfied)
                profileReady = true;
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
            const finalControlReady = await journey.isReadyForFinalSubmit(page, shop).catch(() => false);
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
            const advanced = await journey.advanceCheckout(page, shop).catch(() => false);
            if (!advanced)
                await this.delay(700, session.controller.signal);
        }
        if (session.controller.signal.aborted)
            return;
        const reason = !profileReady
            ? "Checkout-Adresse/Profil wurde nicht vollständig bestätigt."
            : lastPaymentReason !== "ready"
                ? `Checkout-Zahlung ist nicht kaufbereit (${lastPaymentReason}).`
                : "Finaler kaufbereiter Review-/Submit-Zustand wurde nicht erreicht.";
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
        this.emit(task);
    }
    publishKeywords(session) {
        const now = new Date().toISOString();
        session.task.config.data = {
            ...(session.task.config.data ?? {}),
            postQueueDiscovery: {
                ...(session.task.config.data?.["postQueueDiscovery"] ?? {}),
                keywords: [...session.keywords],
                updatedAt: now
            }
        };
        (0, early_gate_1.setEarlyGateRuntime)(session.task, { keywords: [...session.keywords], activeArea: "browser-child" });
        this.emit(session.task);
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
        this.emit(task);
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
    markStage(task, stage, timestamps) {
        task.config.data = {
            ...(task.config.data ?? {}),
            earlyGateFlow: { stage, updatedAt: new Date().toISOString() }
        };
        (0, early_gate_1.setEarlyGateRuntime)(task, { activeArea: "browser-child", stage, ...timestamps });
        this.emit(task);
    }
    flowStage(task) {
        const flow = task.config.data?.["earlyGateFlow"];
        return String(flow?.["stage"] ?? "");
    }
    emit(task) {
        this.onTaskUpdate(task);
    }
    queueMaxWaitMs(task) {
        const data = task.config.data ?? {};
        const browserConfig = data["browserConfig"];
        const raw = Number(browserConfig?.["queueMaxWaitMs"] ?? data["queueMaxWaitMs"] ?? 60 * 60000);
        return Number.isFinite(raw) ? Math.min(60 * 60000, Math.max(1000, raw)) : 60 * 60000;
    }
    discoveryMaxMs(task) {
        const raw = Number(task.config.data?.["discoveryMaxMs"] ?? 45 * 60000);
        return Number.isFinite(raw) ? Math.min(60 * 60000, Math.max(60000, raw)) : 45 * 60000;
    }
    discoveryIntervalMs(task) {
        const raw = Number(task.config.data?.["discoveryIntervalMs"] ?? 3000);
        return Number.isFinite(raw) ? Math.min(30000, Math.max(1000, raw)) : 3000;
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
exports.EarlyGateBrowserTaskExecutor = EarlyGateBrowserTaskExecutor;
//# sourceMappingURL=early-gate-task-executor.js.map