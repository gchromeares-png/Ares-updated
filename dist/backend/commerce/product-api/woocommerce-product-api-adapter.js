"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WooCommerceProductApiAdapter = void 0;
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
function slugFromProductUrl(value) {
    if (!value)
        return undefined;
    try {
        const url = new URL(value);
        const match = url.pathname.match(/\/product\/([^/?#]+)/i);
        return match?.[1] ? decodeURIComponent(match[1]) : undefined;
    }
    catch {
        return undefined;
    }
}
function priceAmount(prices) {
    if (!prices?.price)
        return undefined;
    const raw = Number(prices.price);
    if (!Number.isFinite(raw))
        return undefined;
    const minor = Number.isFinite(prices.currency_minor_unit) ? Number(prices.currency_minor_unit) : 2;
    return raw / Math.pow(10, minor);
}
class WooCommerceProductApiAdapter {
    constructor(httpClient = new http_json_client_1.NodeJsonHttpClient()) {
        this.httpClient = httpClient;
        this.platform = "woocommerce";
    }
    async probe(shop) {
        const endpoint = `${normalizeBaseUrl(shop.baseUrl)}/wp-json/wc/store/v1/products?per_page=1`;
        try {
            const response = await this.httpClient.get(endpoint);
            const publicReadable = response.status >= 200
                && response.status < 300
                && Array.isArray(response.data);
            return {
                platform: this.platform,
                endpoint,
                reachable: response.status > 0,
                status: response.status,
                publicReadable,
                reason: publicReadable ? undefined : `WooCommerce Store API returned HTTP ${response.status}.`
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
        const params = new URLSearchParams({ per_page: String(safeLimit) });
        if (query.searchTerm)
            params.set("search", query.searchTerm.trim());
        if (query.sku)
            params.set("sku", query.sku.trim());
        const slug = slugFromProductUrl(query.url);
        if (slug)
            params.set("slug", slug);
        const endpoint = `${baseUrl}/wp-json/wc/store/v1/products?${params.toString()}`;
        const response = await this.httpClient.get(endpoint);
        if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) {
            throw new Error(`WooCommerce Store API returned HTTP ${response.status}.`);
        }
        const observedAt = new Date();
        return response.data
            .map(product => this.normalizeProduct(shop, product, observedAt))
            .filter((item) => Boolean(item))
            .filter(item => !query.gtin || String(item.gtin ?? "").toLowerCase() === query.gtin.trim().toLowerCase());
    }
    normalizeProduct(shop, product, observedAt) {
        if (!product.name && product.id === undefined)
            return undefined;
        const amount = priceAmount(product.prices);
        return {
            shopId: shop.id,
            platform: this.platform,
            externalId: product.id !== undefined ? String(product.id) : product.slug,
            sku: product.sku || undefined,
            gtin: product.global_unique_id || undefined,
            title: String(product.name || product.slug || `WooCommerce product ${product.id ?? ""}`).trim(),
            url: product.permalink || undefined,
            variantTitle: product.variation || undefined,
            available: Boolean(product.is_in_stock),
            price: amount !== undefined
                ? { amount, currency: product.prices?.currency_code || undefined }
                : undefined,
            attributes: {
                slug: product.slug,
                type: product.type,
                hasOptions: product.has_options
            },
            observedAt
        };
    }
}
exports.WooCommerceProductApiAdapter = WooCommerceProductApiAdapter;
//# sourceMappingURL=woocommerce-product-api-adapter.js.map