"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileRepository = void 0;
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
class ProfileRepository {
    constructor(storagePath) {
        this.profiles = new Map();
        const initialPath = storagePath || process.env["ARES_PROFILES_FILE"];
        if (initialPath) {
            this.setStoragePath(initialPath);
        }
    }
    setStoragePath(filePath) {
        this.storagePath = filePath;
        this.loadFromDisk();
    }
    loadFromDisk() {
        if (!this.storagePath)
            return;
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, "utf8");
                const list = JSON.parse(data);
                if (Array.isArray(list)) {
                    for (const item of list) {
                        if (item && item.id) {
                            this.profiles.set(item.id, item);
                        }
                    }
                }
            }
        }
        catch {
            // Gracefully ignore corrupt storage file
        }
    }
    persistToDisk() {
        if (!this.storagePath)
            return;
        try {
            const dir = path.dirname(this.storagePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.storagePath, JSON.stringify([...this.profiles.values()], null, 2), "utf8");
        }
        catch {
            // Ignore write errors if disk is not writable
        }
    }
    save(profile) {
        this.profiles.set(profile.id, profile);
        this.persistToDisk();
        return profile;
    }
    get(id) {
        return this.profiles.get(id);
    }
    getAll() {
        return [...this.profiles.values()];
    }
    delete(id) {
        const deleted = this.profiles.delete(id);
        if (deleted) {
            this.persistToDisk();
        }
        return deleted;
    }
}
exports.ProfileRepository = ProfileRepository;
//# sourceMappingURL=profile-repository.js.map