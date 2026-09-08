"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopUtils = exports.TaskUtils = void 0;
class TaskUtils {
    static generateTaskId(prefix = 'task') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    }
    static isValidTaskState(state) {
        const validStates = [
            'CREATED', 'QUEUED', 'STARTING', 'RUNNING',
            'PRODUCT_FOUND', 'CART', 'CHECKOUT', 'SUCCESS',
            'FAILED', 'CANCELLED', 'RETRYING'
        ];
        return validStates.includes(state);
    }
    static getTaskStateDescription(state) {
        const descriptions = {
            'CREATED': 'Task wurde erstellt',
            'QUEUED': 'Task wartet in der Warteschlange',
            'STARTING': 'Task wird gestartet',
            'RUNNING': 'Task läuft',
            'PRODUCT_FOUND': 'Produkt gefunden',
            'CART': 'Zum Warenkorb hinzugefügt',
            'CHECKOUT': 'Checkout-Prozess läuft',
            'SUCCESS': 'Task erfolgreich abgeschlossen',
            'FAILED': 'Task fehlgeschlagen',
            'CANCELLED': 'Task abgebrochen',
            'RETRYING': 'Task wird erneut versucht'
        };
        return descriptions[state] || 'Unbekannter Status';
    }
}
exports.TaskUtils = TaskUtils;
class ShopUtils {
    static normalizeUrl(url) {
        if (!url.startsWith('http')) {
            url = `https://${url}`;
        }
        return url.replace(/\/$/, ''); // Entferne abschließenden Slash
    }
    static validateShopData(shop) {
        return shop && shop.name && shop.url;
    }
}
exports.ShopUtils = ShopUtils;
//# sourceMappingURL=index.js.map