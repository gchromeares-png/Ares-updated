"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommerceProductAdapterRegistry = void 0;
class CommerceProductAdapterRegistry {
    constructor() {
        this.adapters = new Map();
    }
    register(adapter) {
        this.adapters.set(adapter.platform, adapter);
    }
    get(platform) {
        return this.adapters.get(platform);
    }
    has(platform) {
        return this.adapters.has(platform);
    }
    listPlatforms() {
        return [...this.adapters.keys()];
    }
}
exports.CommerceProductAdapterRegistry = CommerceProductAdapterRegistry;
//# sourceMappingURL=product-adapter.js.map