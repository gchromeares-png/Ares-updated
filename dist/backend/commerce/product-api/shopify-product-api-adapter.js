"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopifyProductApiAdapter = void 0;
const http_json_client_1 = require("./http-json-client");
function normalizeBaseUrl(input) {
    const raw = input.trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol))
        throw new Error(`Unsupported shop protocol: ${url.protocol}`);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
}
function productHandleFromUrl(value) {
    if (!value)
        return undefined;
    try {
        const url = new URL(value);
        const match = url.pathname.match(/\/products\/([^/?#]+)/i);
        return match?.[1] ? decodeURIComponent(match[1]) : undefined;
    }
    catch {
        return undefined;
    }
}
function normalizeText(value) {
    return String(value ?? "").trim().toLowerCase();
}
function parsePrice(value, ajaxMinorUnits) {
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return ajaxMinorUnits ? value / 100 : value;
    }
    return undefined;
}
class ShopifyProductApiAdapter {
    constructor(httpClient = new http_json_client_1.NodeJsonHttpClient()) {
        this.httpClient = httpClient;
        this.platform = "shopify";
    }
    async probe(shop) {
        const endpoint = `${normalizeBaseUrl(shop.baseUrl)}/products.json?limit=1`;
        try {
            const response = await this.httpClient.get(endpoint);
            const products = response.data?.products;
            const publicReadable = response.status >= 200
                && response.status < 300
                && Array.isArray(products);
            return {
                platform: this.platform,
                endpoint,
                reachable: response.status > 0,
                status: response.status,
                publicReadable,
                reason: publicReadable ? undefined : `Shopify product catalog returned HTTP ${response.status}.`
            };
        }
        catch (error) {
            return {
                platform: this.platform,
                endpoint,
                reachable: false,
                publicReadable: false,
                reason: error instanceof Error ? error.message : String(error)
            };
        }
    }
    async search(shop, query, limit = 50) {
        const baseUrl = normalizeBaseUrl(shop.baseUrl);
        const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
        const directHandle = productHandleFromUrl(query.url);
        if (directHandle) {
            const endpoint = `${baseUrl}/products/${encodeURIComponent(directHandle)}.js`;
            const response = await this.httpClient.get(endpoint);
            if (response.status < 200 || response.status >= 300 || !response.data) {
                throw new Error(`Shopify product endpoint returned HTTP ${response.status}.`);
            }
            return this.normalizeProducts(shop, [response.data], true).filter(item => this.matchesQuery(item, query));
        }
        const endpoint = `${baseUrl}/products.json?limit=${safeLimit}`;
        const response = await this.httpClient.get(endpoint);
        const products = response.data?.products;
        if (response.status < 200 || response.status >= 300 || !Array.isArray(products)) {
            throw new Error(`Shopify products endpoint returned HTTP ${response.status}.`);
        }
        return this.normalizeProducts(shop, products, false)
            .filter(item => this.matchesQuery(item, query));
    }
    normalizeProducts(shop, products, ajaxMinorUnits) {
        const observedAt = new Date();
        const baseUrl = normalizeBaseUrl(shop.baseUrl);
        const observations = [];
        for (const product of products) {
            const variants = product.variants?.length ? product.variants : [{}];
            for (const variant of variants) {
                const amount = parsePrice(variant.price ?? product.price, ajaxMinorUnits);
                const handle = product.handle ? String(product.handle) : undefined;
                const variantId = variant.id !== undefined ? String(variant.id) : undefined;
                const url = handle
                    ? `${baseUrl}/products/${encodeURIComponent(handle)}${variantId ? `?variant=${encodeURIComponent(variantId)}` : ""}`
                    : undefined;
                observations.push({
                    shopId: shop.id,
                    platform: this.platform,
                    externalId: product.id !== undefined ? String(product.id) : handle,
                    sku: variant.sku || undefined,
                    gtin: variant.barcode || undefined,
                    title: String(product.title || handle || "Shopify product"),
                    url,
                    variantId,
                    variantTitle: variant.title || undefined,
                    available: variant.available ?? product.available ?? false,
                    price: amount !== undefined ? { amount } : undefined,
                    attributes: {
                        vendor: product.vendor,
                        productType: product.product_type,
                        handle
                    },
                    observedAt
                });
            }
        }
        return observations;
    }
    matchesQuery(observation, query) {
        if (query.sku && normalizeText(observation.sku) !== normalizeText(query.sku))
            return false;
        if (query.gtin && normalizeText(observation.gtin) !== normalizeText(query.gtin))
            return false;
        if (query.url) {
            const requestedHandle = productHandleFromUrl(query.url);
            const observationHandle = productHandleFromUrl(observation.url);
            if (requestedHandle && observationHandle !== requestedHandle)
                return false;
        }
        if (query.searchTerm) {
            const haystack = normalizeText([
                observation.title,
                observation.variantTitle,
                observation.sku,
                observation.gtin,
                observation.attributes?.["vendor"],
                observation.attributes?.["productType"]
            ].join(" "));
            const tokens = normalizeText(query.searchTerm).split(/\s+/).filter(Boolean);
            if (!tokens.every(token => haystack.includes(token)))
                return false;
        }
        return true;
    }
}
exports.ShopifyProductApiAdapter = ShopifyProductApiAdapter;
//# sourceMappingURL=shopify-product-api-adapter.js.map