"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommerceProductApiRouter = void 0;
const generic_html_product_api_adapter_1 = require("./generic-html-product-api-adapter");
const http_json_client_1 = require("./http-json-client");
const http_text_client_1 = require("./http-text-client");
const shopify_product_api_adapter_1 = require("./shopify-product-api-adapter");
const woocommerce_product_api_adapter_1 = require("./woocommerce-product-api-adapter");
class CommerceProductApiRouter {
    constructor(includeBuiltIns = true, http = new http_json_client_1.NodeJsonHttpClient(), textHttp = new http_text_client_1.NodeTextHttpClient()) {
        this.adapters = new Map();
        this.genericHtml = new generic_html_product_api_adapter_1.GenericHtmlProductApiAdapter(textHttp);
        if (includeBuiltIns) {
            this.register(new shopify_product_api_adapter_1.ShopifyProductApiAdapter(http));
            this.register(new woocommerce_product_api_adapter_1.WooCommerceProductApiAdapter(http));
        }
    }
    register(adapter) {
        this.adapters.set(adapter.platform, adapter);
    }
    get(platform) {
        return this.adapters.get(platform);
    }
    async probe(shop) {
        const adapter = this.get(shop.platform);
        if (adapter) {
            try {
                const result = await adapter.probe(shop);
                if (result.publicReadable)
                    return result;
            }
            catch {
                // Public storefront HTML remains a valid fallback even when a platform
                // specific anonymous endpoint is missing or disabled by the merchant.
            }
        }
        return this.genericHtml.probe(shop);
    }
    async search(shop, query, limit = 50) {
        const adapter = this.get(shop.platform);
        if (adapter) {
            try {
                const results = await adapter.search(shop, query, limit);
                if (results.length)
                    return results;
            }
            catch {
                // Fall through to the public HTML monitor. This deliberately does not
                // attempt credentialed/private platform APIs.
            }
        }
        return this.genericHtml.search(shop, query, limit);
    }
    supportedPlatforms() {
        return [...this.adapters.keys()];
    }
}
exports.CommerceProductApiRouter = CommerceProductApiRouter;
//# sourceMappingURL=router.js.map