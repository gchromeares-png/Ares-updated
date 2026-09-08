"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommercePlatformCapability = exports.normalizeCommercePlatform = exports.isCommercePlatform = exports.COMMERCE_PLATFORM_CAPABILITIES = exports.COMMERCE_PLATFORMS = void 0;
exports.COMMERCE_PLATFORMS = [
    "shopify",
    "woocommerce",
    "jtl",
    "wix",
    "shopware",
    "magento",
    "bigcommerce",
    "prestashop",
    "squarespace",
    "ecwid",
    "lightspeed",
    "commercetools",
    "salesforce-commerce-cloud",
    "custom"
];
exports.COMMERCE_PLATFORM_CAPABILITIES = {
    shopify: {
        platform: "shopify",
        productApi: "anonymous",
        productEndpoint: "/products.json and /products/{handle}.js",
        notes: "Public storefront product JSON is usable without a private API credential on standard Shopify storefronts."
    },
    woocommerce: {
        platform: "woocommerce",
        productApi: "anonymous",
        productEndpoint: "/wp-json/wc/store/v1/products",
        notes: "WooCommerce Store API exposes published storefront product data without authentication."
    },
    jtl: {
        platform: "jtl",
        productApi: "auth-required",
        notes: "JTL ERP/Wawi APIs require application registration and API credentials; there is no universal anonymous JTL-Shop product REST endpoint."
    },
    wix: {
        platform: "wix",
        productApi: "auth-required",
        productEndpoint: "https://www.wixapis.com/stores/v3/products/query",
        notes: "Wix Catalog APIs require authorization/permissions."
    },
    shopware: {
        platform: "shopware",
        productApi: "public-config",
        productEndpoint: "/store-api/product",
        notes: "Shopware Store API uses a sales-channel sw-access-key. The key identifies public storefront configuration but is still required per shop."
    },
    magento: {
        platform: "magento",
        productApi: "shop-dependent",
        productEndpoint: "/rest/V1/products",
        notes: "Adobe Commerce/Magento anonymous catalog API availability depends on merchant security configuration."
    },
    bigcommerce: {
        platform: "bigcommerce",
        productApi: "auth-required",
        notes: "BigCommerce catalog APIs require store context and an API/storefront token."
    },
    prestashop: {
        platform: "prestashop",
        productApi: "auth-required",
        productEndpoint: "/api/products",
        notes: "PrestaShop Webservice requires a shop-generated Webservice access key."
    },
    squarespace: {
        platform: "squarespace",
        productApi: "auth-required",
        productEndpoint: "https://api.squarespace.com/v2/commerce/products",
        notes: "Squarespace Commerce APIs require an API key or OAuth access token."
    },
    ecwid: {
        platform: "ecwid",
        productApi: "auth-required",
        productEndpoint: "https://app.ecwid.com/api/v3/{storeId}/products",
        notes: "Ecwid REST requests require an access token; public app tokens can expose only permitted public data."
    },
    lightspeed: {
        platform: "lightspeed",
        productApi: "auth-required",
        notes: "Lightspeed commerce APIs are account/store scoped and credentialed."
    },
    commercetools: {
        platform: "commercetools",
        productApi: "auth-required",
        notes: "commercetools product APIs use OAuth scopes and project context."
    },
    "salesforce-commerce-cloud": {
        platform: "salesforce-commerce-cloud",
        productApi: "auth-required",
        notes: "Salesforce Shopper APIs require SLAS client configuration and a shopper access token."
    },
    custom: {
        platform: "custom",
        productApi: "shop-dependent",
        notes: "Custom stores must declare their endpoint and access requirements explicitly."
    }
};
function isCommercePlatform(value) {
    return typeof value === "string" && exports.COMMERCE_PLATFORMS.includes(value);
}
exports.isCommercePlatform = isCommercePlatform;
function normalizeCommercePlatform(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim().toLowerCase();
    return isCommercePlatform(normalized) ? normalized : undefined;
}
exports.normalizeCommercePlatform = normalizeCommercePlatform;
function getCommercePlatformCapability(platform) {
    return exports.COMMERCE_PLATFORM_CAPABILITIES[platform];
}
exports.getCommercePlatformCapability = getCommercePlatformCapability;
//# sourceMappingURL=platforms.js.map