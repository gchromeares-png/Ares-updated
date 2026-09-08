"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductService = void 0;
class ProductService {
    constructor() {
        this.products = new Map();
    }
    createProduct(productData) {
        const product = {
            id: this.generateId(),
            ...productData,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.products.set(product.id, product);
        return product;
    }
    getProduct(id) {
        return this.products.get(id);
    }
    getAllProducts() {
        return Array.from(this.products.values());
    }
    updateProduct(id, updates) {
        const product = this.getProduct(id);
        if (product) {
            Object.assign(product, updates, { updatedAt: new Date() });
        }
    }
    deleteProduct(id) {
        return this.products.delete(id);
    }
    generateId() {
        return Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
    }
}
exports.ProductService = ProductService;
//# sourceMappingURL=product-service.js.map