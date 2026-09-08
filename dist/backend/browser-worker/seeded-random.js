"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeededRandom = void 0;
function hashSeed(seed) {
    if (typeof seed === "number" && Number.isFinite(seed))
        return seed >>> 0;
    const text = String(seed);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
class SeededRandom {
    constructor(seed) {
        this.state = hashSeed(seed) || 0x6d2b79f5;
    }
    next() {
        let value = this.state += 0x6d2b79f5;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        this.state = value >>> 0;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
    between(min, max) {
        return min + (max - min) * this.next();
    }
    integer(min, max) {
        const low = Math.ceil(Math.min(min, max));
        const high = Math.floor(Math.max(min, max));
        return Math.floor(this.between(low, high + 1));
    }
}
exports.SeededRandom = SeededRandom;
//# sourceMappingURL=seeded-random.js.map