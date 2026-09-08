"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProfileCookieSnapshotIpc = void 0;
const tslib_1 = require("tslib");
const electron_1 = require("electron");
const path = tslib_1.__importStar(require("path"));
const profile_cookie_snapshot_vault_1 = require("../cookies/profile-cookie-snapshot-vault");
const profile_cookie_snapshot_registry_1 = require("../cookies/profile-cookie-snapshot-registry");
function electronCookieCrypto() {
    return {
        isEncryptionAvailable: () => electron_1.safeStorage.isEncryptionAvailable(),
        encryptString: value => electron_1.safeStorage.encryptString(value),
        decryptString: value => electron_1.safeStorage.decryptString(value)
    };
}
function registerProfileCookieSnapshotIpc(userDataRoot, profileBrowserController) {
    const vault = new profile_cookie_snapshot_vault_1.ProfileCookieSnapshotVault(path.join(userDataRoot, "cookie-snapshots.json"), electronCookieCrypto());
    (0, profile_cookie_snapshot_registry_1.registerProfileCookieSnapshotVault)(vault);
    electron_1.ipcMain.handle("list-profile-cookie-snapshots", (_event, profileId) => {
        try {
            return { success: true, snapshots: vault.list(profileId), encryptionAvailable: vault.isEncryptionAvailable() };
        }
        catch (error) {
            return { success: false, snapshots: [], encryptionAvailable: vault.isEncryptionAvailable(), error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle("save-profile-cookie-snapshot", async (_event, profileId, name, snapshotId) => {
        try {
            const cookies = await profileBrowserController.captureCookies(profileId);
            const snapshot = vault.save(profileId, name, cookies, snapshotId);
            return { success: true, snapshot };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle("delete-profile-cookie-snapshot", (_event, profileId, snapshotId) => {
        try {
            return { success: vault.delete(profileId, snapshotId) };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    return vault;
}
exports.registerProfileCookieSnapshotIpc = registerProfileCookieSnapshotIpc;
//# sourceMappingURL=profile-cookie-snapshot-controller.js.map