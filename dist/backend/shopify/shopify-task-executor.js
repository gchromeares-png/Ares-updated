"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopifyTaskExecutor = void 0;
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const os = tslib_1.__importStar(require("os"));
const path = tslib_1.__importStar(require("path"));
const http = tslib_1.__importStar(require("http"));
const https = tslib_1.__importStar(require("https"));
const field_semantic_resolver_1 = require("../browser-worker/field-semantic-resolver");
const semantic_field_autofill_1 = require("../browser-worker/semantic-field-autofill");
const semantic_checkout_completion_1 = require("../browser-worker/semantic-checkout-completion");
const semantic_checkout_profile_planner_1 = require("../browser-worker/semantic-checkout-profile-planner");
const semantic_target_1 = require("../browser-worker/semantic-target");
const ui_interaction_helper_1 = require("../browser-worker/ui-interaction-helper");
const seleniumbase_browser_worker_1 = require("../browser-worker/seleniumbase-browser-worker");
const live_challenge_handler_1 = require("../challenges/live-challenge-handler");
const queue_waiter_1 = require("./queue-waiter");
class ShopifyTaskExecutor {
    constructor(getShop, getProfile = () => undefined, browserWorker = new seleniumbase_browser_worker_1.SeleniumBaseBrowserWorker(), liveChallengeHandler = new live_challenge_handler_1.LiveChallengeHandler(), onTaskUpdate = () => undefined) {
        this.getShop = getShop;
        this.getProfile = getProfile;
        this.browserWorker = browserWorker;
        this.liveChallengeHandler = liveChallengeHandler;
        this.onTaskUpdate = onTaskUpdate;
        this.productCache = new Map();
        this.requestDelayMs = 500;
        this.cacheTtlMs = 45000;
        this.maxFallbackPages = 2;
        this.fieldResolver = new field_semantic_resolver_1.FieldSemanticResolver();
    }
    async execute(task) {
        const shopId = task.config.shopId;
        if (!shopId) {
            task.lastError = "Task hat keine shopId.";
            return false;
        }
        const shop = this.getShop(shopId);
        if (!shop) {
            task.lastError = `Shop ${shopId} ist nicht registriert.`;
            return false;
        }
        const profileId = this.extractProfileId(task);
        if (!profileId) {
            task.lastError = "Kein Profil für den Task ausgewählt.";
            return false;
        }
        const profile = this.getProfile(profileId);
        if (!profile) {
            task.lastError = `Profil ${profileId} ist nicht registriert.`;
            return false;
        }
        const baseUrl = this.normalizeBaseUrl(shop.baseUrl);
        const searchTerm = this.extractSearchTerm(task);
        const headless = profile.browser?.headless ?? this.extractHeadless(task);
        // Each task receives a persistent, isolated Chrome profile owned by BrowserWorker.
        const configuredRoot = process.env["ARES_BROWSER_PROFILE_ROOT"]?.trim();
        const profileRoot = configuredRoot || path.join(os.tmpdir(), "ares-browser-profiles");
        fs.mkdirSync(profileRoot, { recursive: true });
        const userDataDir = path.join(profileRoot, this.safePartitionName(task.id));
        fs.mkdirSync(userDataDir, { recursive: true });
        const proxy = profile.proxy?.host && profile.proxy.port
            ? {
                protocol: profile.proxy.protocol || "http",
                host: profile.proxy.host,
                port: profile.proxy.port,
                username: profile.proxy.username || undefined,
                password: profile.proxy.password || undefined
            }
            : undefined;
        try {
            // Retries of the same logical task reuse the persistent profile directory,
            // but never keep two live contexts for one task ID.
            await this.browserWorker.closeContext(task.id);
            const handle = await this.browserWorker.createContext({
                taskId: task.id,
                userDataDir,
                headless,
                proxy,
                userAgent: profile.browser?.userAgent || undefined,
                viewport: null,
                navigationTimeoutMs: 30000,
                actionTimeoutMs: 15000
            });
            const page = handle.page;
            const found = await this.findProduct(baseUrl, searchTerm, page);
            if (!found.ok || !found.product) {
                task.lastError = found.error || "Kein passendes verfügbares Shopify-Produkt gefunden.";
                await this.browserWorker.closeContext(task.id).catch(() => undefined);
                return false;
            }
            const cartUrl = new URL(`/cart/${found.product.variantId}:1`, baseUrl).toString();
            await this.navigateWithQueueSupport(page, cartUrl, task);
            await this.sleep(900);
            // Existing live challenge flow remains unchanged; only its status is forwarded live.
            await this.liveChallengeHandler.handleLiveChallenge(page, {
                timeoutMs: 30000,
                bringToFrontOnChallenge: !headless,
                onStatusChange: status => {
                    task.config.data = { ...(task.config.data ?? {}), liveChallengeStatus: status };
                    this.emitTaskUpdate(task);
                }
            });
            const checkoutUrl = new URL("/checkout", baseUrl).toString();
            await this.navigateWithQueueSupport(page, checkoutUrl, task);
            // Handle live checkpoint or captcha on checkout entry.
            const challengeResult = await this.liveChallengeHandler.handleLiveChallenge(page, {
                timeoutMs: 60000,
                bringToFrontOnChallenge: !headless,
                onStatusChange: status => {
                    task.config.data = { ...(task.config.data ?? {}), liveChallengeStatus: status };
                    this.emitTaskUpdate(task);
                }
            });
            if (challengeResult.handled && !challengeResult.resolved) {
                task.lastError = challengeResult.error || "Live-Challenge im Browser nicht gelöst.";
                await this.browserWorker.closeContext(task.id).catch(() => undefined);
                return false;
            }
            const checkoutProfile = await this.fillCheckoutProfile(page, profile);
            task.config.data = {
                ...(task.config.data ?? {}),
                profileId,
                browserSession: {
                    type: "seleniumbase-cdp",
                    isolatedPerTask: true,
                    userDataDir
                },
                shopify: {
                    product: found.product,
                    cartUrl,
                    checkoutUrl,
                    checkoutOpened: true,
                    checkoutProfile,
                    finalPaymentSubmitted: false,
                    challenge: challengeResult
                }
            };
            if (!checkoutProfile.requiredTargetsSatisfied) {
                task.lastError = "Checkout-Profil konnte kein vollständiges erforderliches SemanticTarget-Ergebnis herstellen.";
                this.emitTaskUpdate(task);
                await this.browserWorker.closeContext(task.id).catch(() => undefined);
                return false;
            }
            this.emitTaskUpdate(task);
            return true;
        }
        catch (error) {
            task.lastError = error instanceof Error ? error.message : String(error);
            this.emitTaskUpdate(task);
            await this.browserWorker.closeContext(task.id).catch(() => undefined);
            return false;
        }
    }
    async closeTask(taskId) {
        await this.browserWorker.closeContext(taskId);
    }
    async closeAll() {
        if (this.browserWorker instanceof seleniumbase_browser_worker_1.SeleniumBaseBrowserWorker) {
            await this.browserWorker.shutdown();
            return;
        }
        const health = await this.browserWorker.health();
        await Promise.all(health.contextIds.map(taskId => this.browserWorker.closeContext(taskId)));
    }
    async navigateWithQueueSupport(page, url, task) {
        const waiter = new queue_waiter_1.ShopifyQueueWaiter(page, task, current => this.emitTaskUpdate(current), {
            maxWaitMs: this.extractQueueMaxWaitMs(task),
            pollIntervalMs: 2000,
            releaseConfirmations: 2
        });
        waiter.start();
        let navigationError;
        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        }
        catch (error) {
            navigationError = error;
        }
        try {
            const queue = await waiter.waitIfQueued();
            if (!queue.detected && navigationError)
                throw navigationError;
            if (queue.detected && queue.released) {
                await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => undefined);
            }
        }
        finally {
            waiter.stop();
        }
    }
    extractQueueMaxWaitMs(task) {
        const data = task.config.data ?? {};
        const browserConfig = data["browserConfig"];
        const rawMs = Number(browserConfig?.["queueMaxWaitMs"] ?? data["queueMaxWaitMs"]);
        if (Number.isFinite(rawMs) && rawMs > 0)
            return Math.min(60 * 60 * 1000, rawMs);
        const rawMinutes = Number(browserConfig?.["queueMaxWaitMinutes"] ?? data["queueMaxWaitMinutes"] ?? 60);
        const minutes = Number.isFinite(rawMinutes) ? Math.min(60, Math.max(1, rawMinutes)) : 60;
        return minutes * 60000;
    }
    emitTaskUpdate(task) {
        this.onTaskUpdate(task);
    }
    extractProfileId(task) {
        const raw = (task.config.data ?? {})["profileId"];
        return raw ? String(raw) : undefined;
    }
    extractSearchTerm(task) {
        const data = task.config.data ?? {};
        const criteria = data["productCriteria"];
        const value = criteria?.["searchTerm"] ?? data["searchTerm"] ?? task.config.name;
        return String(value ?? "").trim();
    }
    extractHeadless(task) {
        const browserConfig = (task.config.data ?? {})["browserConfig"];
        return Boolean(browserConfig?.["headless"]);
    }
    safePartitionName(value) {
        return value.replace(/[^a-zA-Z0-9_-]/g, "_");
    }
    normalizeBaseUrl(input) {
        const withProtocol = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
        const url = new URL(withProtocol);
        url.pathname = url.pathname.replace(/\/$/, "");
        url.search = "";
        url.hash = "";
        return url.toString();
    }
    async fillCheckoutProfile(page, profile) {
        const interactions = new ui_interaction_helper_1.GhostCursorUiInteractionHelper(page);
        const plan = await new semantic_checkout_profile_planner_1.SemanticCheckoutProfilePlanner(interactions).prepare(page, profile);
        const autofill = new semantic_field_autofill_1.SemanticFieldAutofill(page, interactions, this.fieldResolver);
        // Intent-only configuration is permitted here because it describes the global
        // classes of fields required by checkout. Concrete completion identity is
        // derived below from the observed SemanticTargets.
        const requiredIntents = new Set([
            "email",
            "firstName",
            "lastName",
            "address1",
            "city",
            "postalCode"
        ]);
        const requiredTargets = () => autofill.observedTargets().filter(target => target.intent !== "unknown" && requiredIntents.has(target.intent));
        // Compatibility fallback for checkout versions whose fields cannot be resolved
        // semantically. These are explicit unknown-context targets and receive their
        // values only from the central profile mapper.
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
        for (let attempt = 0; attempt < 12; attempt++) {
            if (attempt > 0)
                await this.sleep(700);
            if (attempt === 3 || attempt === 7) {
                await this.liveChallengeHandler.handleLiveChallenge(page, { timeoutMs: 20000 });
            }
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
                    catch {
                        // Checkout may still be rendering; try the next selector/attempt.
                    }
                }
            }
            const snapshot = await autofill.result(plan.values);
            const completion = (0, semantic_checkout_completion_1.evaluateSemanticCheckoutCompletion)({
                filled: snapshot.filled,
                missing: snapshot.missing,
                requiredTargets: requiredTargets()
            });
            if (completion.complete)
                break;
        }
        const result = await autofill.result(plan.values);
        const completion = (0, semantic_checkout_completion_1.evaluateSemanticCheckoutCompletion)({
            filled: result.filled,
            missing: result.missing,
            requiredTargets: requiredTargets()
        });
        return {
            ...result,
            billingMode: plan.billingMode,
            requiredTargetsSatisfied: completion.complete
        };
    }
    async findProduct(baseUrl, searchTerm, page) {
        const requestedTokens = [...new Set(this.tokenize(searchTerm))];
        if (!requestedTokens.length)
            return { ok: false, error: "Kein Produkt-Keyword angegeben." };
        if (/^https?:\/\//i.test(searchTerm) && searchTerm.includes("/products/")) {
            const productUrl = new URL(searchTerm);
            const handle = productUrl.pathname.split("/products/")[1]?.split("/")[0];
            if (handle) {
                const product = await this.readJson(new URL(`/products/${handle}.js`, baseUrl).toString(), page);
                const variant = this.chooseAvailableVariant(product);
                if (!variant)
                    return { ok: false, error: `Das angegebene Produkt ist ausverkauft: ${product.title}` };
                return { ok: true, product: this.toMatch(product, variant, requestedTokens, []) };
            }
        }
        const predictive = await this.predictiveSearch(baseUrl, searchTerm, page);
        const products = predictive.length ? predictive : await this.fallbackCatalog(baseUrl, page);
        if (!products.length)
            return { ok: false, error: "Keine Produkte im Shopify-Katalog gefunden." };
        const scored = products.map(product => {
            const info = this.matchTokens(product, requestedTokens);
            return { product, info, score: info.coverage * 100 + info.matchedWeight * 8 };
        }).sort((a, b) => b.score - a.score);
        for (const entry of scored.filter(item => item.info.coverage >= 0.72)) {
            const fresh = await this.readJson(new URL(`/products/${entry.product.handle}.js`, baseUrl).toString(), page).catch(() => entry.product);
            const variant = this.chooseAvailableVariant(fresh);
            if (variant)
                return { ok: true, product: this.toMatch(fresh, variant, entry.info.matchedTokens, entry.info.missingTokens) };
        }
        const best = scored[0];
        return {
            ok: false,
            error: best
                ? `Kein verfügbares Produkt passt ausreichend zu '${searchTerm}'. Bester Treffer: '${best.product.title}' (${Math.round(best.info.coverage * 100)}%).`
                : `Kein verfügbares Produkt passt zu '${searchTerm}'.`
        };
    }
    normalize(value) {
        return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9äöüß]+/gi, " ").replace(/\s+/g, " ").trim();
    }
    tokenize(value) {
        return this.normalize(value).split(" ").map(word => word.trim()).filter(word => word.length >= 2);
    }
    productWords(product) {
        return this.normalize([product.title, product.handle, product.vendor, product.product_type, product.body_html, ...(product.tags || [])].join(" ")).split(" ").filter(Boolean);
    }
    allowedDistance(token) {
        if (token.length <= 4)
            return 1;
        if (token.length <= 7)
            return 2;
        return 3;
    }
    levenshtein(a, b) {
        const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
        const current = new Array(b.length + 1);
        for (let i = 1; i <= a.length; i++) {
            current[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
            }
            for (let j = 0; j <= b.length; j++)
                previous[j] = current[j];
        }
        return previous[b.length];
    }
    tokenMatchesWord(token, word) {
        if (token === word)
            return true;
        if (token.length >= 5 && word.length >= 5 && (word.includes(token) || token.includes(word)))
            return true;
        const allowed = this.allowedDistance(token);
        return Math.abs(token.length - word.length) <= allowed && this.levenshtein(token, word) <= allowed;
    }
    tokenWeight(token) {
        if (token.length >= 10)
            return 4;
        if (token.length >= 7)
            return 3;
        if (token.length >= 5)
            return 2;
        return 1;
    }
    matchTokens(product, requestedTokens) {
        const generic = new Set(["the", "and", "und", "der", "die", "das", "ein", "eine", "mit", "von", "for", "fur", "für", "edition", "set", "neu", "new", "deutsch", "englisch", "english", "german"]);
        const important = requestedTokens.filter(token => token.length >= 3 && !generic.has(token));
        const required = important.length ? important : requestedTokens;
        const words = this.productWords(product);
        const matchedTokens = required.filter(token => words.some(word => this.tokenMatchesWord(token, word)));
        const missingTokens = required.filter(token => !matchedTokens.includes(token));
        const totalWeight = required.reduce((sum, token) => sum + this.tokenWeight(token), 0);
        const matchedWeight = matchedTokens.reduce((sum, token) => sum + this.tokenWeight(token), 0);
        return { matchedTokens, missingTokens, matchedWeight, coverage: totalWeight ? matchedWeight / totalWeight : 0 };
    }
    chooseAvailableVariant(product) {
        return (product.variants || []).find(variant => variant.available !== false);
    }
    toMatch(product, variant, matchedTokens, missingTokens) {
        return { title: product.title, handle: product.handle, variantId: Number(variant.id), variantTitle: variant.title || "Default", price: variant.price, matchedTokens, missingTokens };
    }
    async predictiveSearch(baseUrl, searchTerm, page) {
        const url = new URL("/search/suggest.json", baseUrl);
        url.searchParams.set("q", searchTerm);
        url.searchParams.set("resources[type]", "product");
        url.searchParams.set("resources[limit]", "10");
        url.searchParams.set("resources[options][unavailable_products]", "show");
        try {
            const data = await this.readJson(url.toString(), page);
            const raw = data?.resources?.results?.products ?? [];
            const products = [];
            for (const item of raw) {
                const handle = String(item?.handle ?? "");
                if (!handle)
                    continue;
                try {
                    const hydrated = await this.readJson(new URL(`/products/${handle}.js`, baseUrl).toString(), page);
                    products.push({
                        title: String(hydrated.title ?? item.title ?? ""),
                        handle: String(hydrated.handle ?? handle),
                        vendor: String(hydrated.vendor ?? item.vendor ?? ""),
                        product_type: String(hydrated.type ?? ""),
                        body_html: String(hydrated.description ?? ""),
                        tags: Array.isArray(hydrated.tags) ? hydrated.tags : [],
                        variants: Array.isArray(hydrated.variants) ? hydrated.variants.map((variant) => ({ id: variant.id, title: variant.title, price: String(variant.price ?? ""), available: Boolean(variant.available) })) : []
                    });
                }
                catch { }
            }
            return products;
        }
        catch {
            return [];
        }
    }
    async fallbackCatalog(baseUrl, page) {
        const key = this.normalizeBaseUrl(baseUrl);
        const cached = this.productCache.get(key);
        if (cached && cached.expiresAt > Date.now())
            return cached.products;
        const products = [];
        for (let pageNum = 1; pageNum <= this.maxFallbackPages; pageNum++) {
            const catalog = await this.readJson(new URL(`/products.json?limit=250&page=${pageNum}`, baseUrl).toString(), page);
            const pageProducts = catalog.products ?? [];
            products.push(...pageProducts);
            if (pageProducts.length < 250)
                break;
        }
        this.productCache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, products });
        return products;
    }
    async readJson(url, page, attempt = 0, redirects = 0) {
        await this.sleep(this.requestDelayMs);
        if (page && !page.isClosed()) {
            try {
                const data = await page.evaluate(async (targetUrl) => {
                    const res = await fetch(targetUrl, {
                        headers: { Accept: "application/json,text/plain,*/*" }
                    });
                    if (!res.ok)
                        throw new Error(`HTTP ${res.status}`);
                    return await res.json();
                }, url);
                return data;
            }
            catch {
                // Fallback to direct HTTP request if page context evaluation fails
            }
        }
        try {
            return await new Promise((resolve, reject) => {
                const parsed = new URL(url);
                const client = parsed.protocol === "http:" ? http : https;
                const request = client.get(parsed, {
                    headers: {
                        Accept: "application/json,text/plain,*/*",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    }
                }, response => {
                    const status = response.statusCode ?? 0;
                    const location = response.headers.location;
                    if ([301, 302, 303, 307, 308].includes(status) && location && redirects < 5) {
                        response.resume();
                        this.readJson(new URL(location, parsed).toString(), page, attempt, redirects + 1).then(resolve).catch(reject);
                        return;
                    }
                    let body = "";
                    response.setEncoding("utf8");
                    response.on("data", chunk => { body += chunk; });
                    response.on("end", () => {
                        if (status < 200 || status >= 300) {
                            const error = new Error(`${parsed.pathname} returned ${status}`);
                            error.statusCode = status;
                            reject(error);
                            return;
                        }
                        try {
                            resolve(JSON.parse(body));
                        }
                        catch (error) {
                            reject(error);
                        }
                    });
                });
                request.on("error", reject);
                request.setTimeout(15000, () => request.destroy(new Error(`Timeout beim Lesen von ${parsed.pathname}`)));
            });
        }
        catch (error) {
            const status = error?.statusCode;
            if ((status === 429 || status === 503) && attempt < 3) {
                await this.sleep(800 * Math.pow(2, attempt));
                return this.readJson(url, page, attempt + 1, redirects);
            }
            throw error;
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.ShopifyTaskExecutor = ShopifyTaskExecutor;
//# sourceMappingURL=shopify-task-executor.js.map