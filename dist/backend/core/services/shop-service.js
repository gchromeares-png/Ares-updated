"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopService = void 0;
class ShopService {
    constructor() {
        this.shops = new Map();
    }
    createShop(shopData) {
        const shop = {
            id: this.generateId(),
            ...shopData,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.shops.set(shop.id, shop);
        return shop;
    }
    getShop(id) {
        return this.shops.get(id);
    }
    getAllShops() {
        return Array.from(this.shops.values());
    }
    updateShop(id, updates) {
        const shop = this.getShop(id);
        if (shop) {
            Object.assign(shop, updates, { updatedAt: new Date() });
        }
    }
    deleteShop(id) {
        return this.shops.delete(id);
    }
    generateId() {
        return Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
    }
}
exports.ShopService = ShopService;
//# sourceMappingURL=shop-service.js.map