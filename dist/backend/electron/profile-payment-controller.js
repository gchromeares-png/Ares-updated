"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProfilePaymentIpc = void 0;
const tslib_1 = require("tslib");
const electron_1 = require("electron");
const path = tslib_1.__importStar(require("path"));
const profile_payment_vault_1 = require("../payments/profile-payment-vault");
let registeredVault;
function electronVaultCrypto() {
    return {
        isEncryptionAvailable: () => electron_1.safeStorage.isEncryptionAvailable(),
        encryptString: value => electron_1.safeStorage.encryptString(value),
        decryptString: value => electron_1.safeStorage.decryptString(value)
    };
}
/** Register renderer-safe payment-vault IPC once and return the shared vault instance. */
function registerProfilePaymentIpc(userDataRoot) {
    if (registeredVault)
        return registeredVault;
    const vault = new profile_payment_vault_1.ProfilePaymentVault(path.join(userDataRoot, "payment-vault.json"), electronVaultCrypto());
    registeredVault = vault;
    electron_1.ipcMain.handle("get-profile-payment", (_event, profileId) => {
        try {
            return {
                success: true,
                payment: vault.getView(profileId),
                encryptionAvailable: vault.isEncryptionAvailable()
            };
        }
        catch (error) {
            return {
                success: false,
                payment: { configured: false },
                encryptionAvailable: vault.isEncryptionAvailable(),
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });
    electron_1.ipcMain.handle("save-profile-payment", (_event, profileId, input) => {
        try {
            const payment = vault.save(profileId, input ?? {});
            return {
                success: true,
                payment,
                encryptionAvailable: vault.isEncryptionAvailable()
            };
        }
        catch (error) {
            return {
                success: false,
                encryptionAvailable: vault.isEncryptionAvailable(),
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });
    electron_1.ipcMain.handle("delete-profile-payment", (_event, profileId) => {
        try {
            vault.delete(profileId);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    return vault;
}
exports.registerProfilePaymentIpc = registerProfilePaymentIpc;
//# sourceMappingURL=profile-payment-controller.js.map