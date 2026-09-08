"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PokemonCenterReleaseJourney = void 0;
const checkout_outcome_observer_1 = require("../../browser-worker/checkout-outcome-observer");
const ui_interaction_helper_1 = require("../../browser-worker/ui-interaction-helper");
const product_matcher_1 = require("../../monitor/product-matcher");
function asProducts(value, result = []) {
    if (Array.isArray(value)) {
        for (const item of value)
            asProducts(item, result);
        return result;
    }
    if (!value || typeof value !== "object")
        return result;
    const record = value;
    const type = record["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product")))
        result.push(record);
    for (const child of Object.values(record)) {
        if (child && typeof child === "object")
            asProducts(child, result);
    }
    return result;
}
function firstOffer(product) {
    return Array.isArray(product.offers) ? product.offers[0] : product.offers;
}
function absoluteUrl(value, baseUrl) {
    const text = String(value ?? "").trim();
    if (!text)
        return undefined;
    try {
        return new URL(text, baseUrl).toString();
    }
    catch {
        return undefined;
    }
}
function numberValue(value) {
    const parsed = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
}
function inStock(availability) {
    return /(?:^|\/)(?:instock|limitedavailability)$/i.test(String(availability ?? "").trim());
}
const FINAL_PURCHASE_TEXT = /(?:zahlungspflichtig\s+bestellen|jetzt\s+(?:kaufen|bezahlen)|bestellung\s+(?:aufgeben|abschließen)|place\s+order|pay\s+now|complete\s+(?:order|purchase)|submit\s+order)/i;
const SAFE_CONTINUE_TEXT = /(?:^|\s)(?:weiter|fortfahren|weiter\s+zur\s+(?:lieferung|versand|zahlung|bezahlung|übersicht)|zur\s+übersicht|continue|continue\s+to\s+(?:shipping|delivery|payment|review)|review\s+order|save\s+and\s+continue)(?:\s|$)/i;
class PokemonCenterReleaseJourney {
    constructor() {
        this.matcher = new product_matcher_1.ProductMatcher();
    }
    supports(shop) {
        try {
            return /(^|\.)pokemoncenter\.com$/i.test(new URL(shop.baseUrl).hostname);
        }
        catch {
            return false;
        }
    }
    async discover(page, shop, input) {
        const categoryUrl = new URL("/de-de/category/new-releases", shop.baseUrl).toString();
        await page.goto(categoryUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
        const products = [];
        for (const script of scripts) {
            try {
                asProducts(JSON.parse(script), products);
            }
            catch { }
        }
        const criteria = {
            searchTerm: [input.productName, ...input.keywords].filter(Boolean).join(" "),
            requireAvailable: true,
            minimumScore: 0.72
        };
        const ranked = [];
        for (const item of products) {
            const offer = firstOffer(item);
            const observation = {
                shopId: shop.id,
                platform: shop.platform,
                externalId: String(item.mpn ?? item.sku ?? "").trim() || undefined,
                sku: String(item.sku ?? item.mpn ?? "").trim() || undefined,
                title: String(item.name ?? "").trim(),
                url: absoluteUrl(item.url, shop.baseUrl),
                available: inStock(offer?.availability),
                price: numberValue(offer?.price) !== undefined
                    ? { amount: numberValue(offer?.price), currency: String(offer?.priceCurrency ?? "").trim() || undefined }
                    : undefined,
                observedAt: new Date(),
                attributes: { source: "pokemon-center-jsonld" }
            };
            if (!observation.title || !observation.url)
                continue;
            const match = this.matcher.match(observation, criteria);
            if (match.matched)
                ranked.push({ observation, score: match.score });
        }
        ranked.sort((a, b) => b.score - a.score);
        for (const candidate of ranked) {
            await page.goto(candidate.observation.url, { waitUntil: "domcontentloaded", timeout: 30000 });
            const add = page.locator("button").filter({ hasText: "In den Einkaufswagen" }).first();
            const usable = await add.isVisible().catch(() => false) && await add.isEnabled().catch(() => false);
            if (usable)
                return candidate.observation;
        }
        return undefined;
    }
    async addToCart(page, shop, _product) {
        const add = page.locator("button").filter({ hasText: "In den Einkaufswagen" }).first();
        if (!(await add.isVisible().catch(() => false)) || !(await add.isEnabled().catch(() => false))) {
            throw new Error("Pokémon-Center-Produkt ist nicht mehr in den Einkaufswagen legbar.");
        }
        await new ui_interaction_helper_1.GhostCursorUiInteractionHelper(page).click(add);
        await page.waitForTimeout(600);
        const cartUrl = new URL("/de-de/cart", shop.baseUrl).toString();
        await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        const guest = page.locator("#guest-checkout").first();
        if (!(await guest.isVisible().catch(() => false))) {
            throw new Error("Pokémon-Center-Warenkorb enthält keinen sichtbaren Gast-Checkout.");
        }
    }
    async openCheckout(page, _shop) {
        const guestById = page.locator("#guest-checkout").first();
        const guest = await guestById.isVisible().catch(() => false)
            ? guestById
            : page.locator("button").filter({ hasText: "Als Gast zur Kasse" }).first();
        if (!(await guest.isVisible().catch(() => false)) || !(await guest.isEnabled().catch(() => false))) {
            throw new Error("Pokémon-Center-Gast-Checkout ist nicht verfügbar.");
        }
        await new ui_interaction_helper_1.GhostCursorUiInteractionHelper(page).click(guest);
        await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => undefined);
        const title = await page.title().catch(() => "");
        const current = page.url();
        if (!/(checkout|global-e|international)/i.test(`${title} ${current}`)) {
            throw new Error("Pokémon-Center-Checkout wurde nach Gast-Checkout nicht bestätigt.");
        }
    }
    async isReadyForFinalSubmit(page, _shop) {
        return Boolean(await this.findButton(page, FINAL_PURCHASE_TEXT));
    }
    async isOrderConfirmed(page, _shop) {
        return (await (0, checkout_outcome_observer_1.observeCheckoutOutcome)(page)).confirmed;
    }
    async advanceCheckout(page, _shop) {
        const candidate = await this.findButton(page, SAFE_CONTINUE_TEXT, FINAL_PURCHASE_TEXT);
        if (!candidate)
            return false;
        await new ui_interaction_helper_1.GhostCursorUiInteractionHelper(page).click(candidate);
        await page.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => undefined);
        await page.waitForTimeout(350).catch(() => undefined);
        return true;
    }
    /** Returns only whether the guarded irreversible click was dispatched. */
    async submitOrder(page, _shop, allowFinalPurchase) {
        const candidate = await this.findButton(page, FINAL_PURCHASE_TEXT);
        if (!candidate)
            return false;
        // Hard backend-side guard immediately before the irreversible submit click.
        if (!allowFinalPurchase())
            return false;
        await new ui_interaction_helper_1.GhostCursorUiInteractionHelper(page).click(candidate);
        await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => undefined);
        return true;
    }
    async findButton(page, include, exclude) {
        const candidates = page.locator('button, input[type="submit"], [role="button"]');
        const count = Math.min(await candidates.count().catch(() => 0), 120);
        for (let index = 0; index < count; index++) {
            const candidate = candidates.nth(index);
            if (!await candidate.isVisible().catch(() => false) || !await candidate.isEnabled().catch(() => false))
                continue;
            const text = await candidate.evaluate(element => [
                element.textContent || "",
                element.getAttribute("value") || "",
                element.getAttribute("aria-label") || "",
                element.getAttribute("data-test") || "",
                element.getAttribute("data-testid") || ""
            ].join(" ").replace(/\s+/g, " ").trim()).catch(() => "");
            if (!include.test(text))
                continue;
            if (exclude?.test(text))
                continue;
            return candidate;
        }
        return undefined;
    }
}
exports.PokemonCenterReleaseJourney = PokemonCenterReleaseJourney;
//# sourceMappingURL=release-journey.js.map