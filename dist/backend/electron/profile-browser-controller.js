"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileBrowserController = void 0;
const tslib_1 = require("tslib");
const electron_1 = require("electron");
const path = tslib_1.__importStar(require("path"));
const profile_session_manager_1 = require("../browser-worker/profile-session-manager");
const profile_payment_controller_1 = require("./profile-payment-controller");
const profile_cookie_snapshot_controller_1 = require("./profile-cookie-snapshot-controller");
const seleniumbase_profile_browser_controller_1 = require("./seleniumbase-profile-browser-controller");
const seleniumbase_product_monitor_browser_adapter_1 = require("./seleniumbase-product-monitor-browser-adapter");
const seleniumbase_vision_runtime_1 = require("./seleniumbase-vision-runtime");
const browser_product_fallback_registry_1 = require("../monitor/browser-product-fallback-registry");
class ProfileBrowserController {
    constructor(profileRoot, getProxy) {
        this.profileRoot = profileRoot;
        this.visionRuntime = new seleniumbase_vision_runtime_1.SeleniumBaseVisionRuntime();
        const userDataRoot = path.dirname(profileRoot);
        (0, profile_payment_controller_1.registerProfilePaymentIpc)(userDataRoot);
        (0, profile_cookie_snapshot_controller_1.registerProfileCookieSnapshotIpc)(userDataRoot, this);
        this.seleniumBase = new seleniumbase_profile_browser_controller_1.SeleniumBaseProfileBrowserController(profileRoot, getProxy);
        this.productMonitorBrowser = new seleniumbase_product_monitor_browser_adapter_1.SeleniumBaseProductMonitorBrowserAdapter(profileRoot, getProxy);
        (0, browser_product_fallback_registry_1.setDefaultBrowserProductFallback)(this.productMonitorBrowser);
        this.registerSeleniumBaseIpc();
    }
    async open(profile, startUrlOrOptions) {
        const options = typeof startUrlOrOptions === "string"
            ? { startUrl: startUrlOrOptions }
            : (startUrlOrOptions ?? {});
        // The manual browser must inherit the shared vision service URL/token at
        // spawn time. Waiting here is only for the lightweight loopback listener;
        // SigLIP2 itself preloads asynchronously inside that persistent service.
        await this.visionRuntime.ensureSharedService().catch(() => undefined);
        void this.visionRuntime.prepare().catch(() => undefined);
        return this.seleniumBase.open(profile, options.startUrl, options.cookieSnapshotId);
    }
    captureCookies(profileId) {
        return this.seleniumBase.captureCookies(profileId);
    }
    close(profileId) {
        return this.seleniumBase.close(profileId);
    }
    async resetSession(profileId) {
        const id = String(profileId ?? "").trim();
        if (!id)
            throw new Error("Profil-ID fehlt.");
        await this.seleniumBase.close(id);
        (0, profile_session_manager_1.removeProfileUserDataDir)(id, this.profileRoot);
        return this.seleniumBase.status(id);
    }
    status(profileId) {
        return this.seleniumBase.status(profileId);
    }
    isOpen(profileId) {
        return this.seleniumBase.isOpen(profileId);
    }
    async closeAll() {
        await Promise.all([
            this.seleniumBase.closeAll(),
            this.productMonitorBrowser.close()
        ]);
        await this.visionRuntime.shutdown().catch(() => undefined);
    }
    registerSeleniumBaseIpc() {
        electron_1.ipcMain.handle("get-seleniumbase-profile-browser-status", (_event, profileId) => {
            try {
                return { success: true, status: this.seleniumBase.status(profileId) };
            }
            catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
        electron_1.ipcMain.handle("get-seleniumbase-vision-status", async () => {
            try {
                return { success: true, status: await this.visionRuntime.status() };
            }
            catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
        electron_1.ipcMain.handle("prepare-seleniumbase-vision", async () => {
            try {
                return { success: true, status: await this.visionRuntime.prepare() };
            }
            catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
        electron_1.ipcMain.handle("close-seleniumbase-profile-browser", async (_event, profileId) => {
            try {
                return { success: true, status: await this.seleniumBase.close(profileId) };
            }
            catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
        electron_1.ipcMain.handle("reset-profile-browser-session", async (_event, profileId) => {
            try {
                return { success: true, status: await this.resetSession(profileId) };
            }
            catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
        electron_1.ipcMain.handle("apply-seleniumbase-cookie-snapshot", async (_event, profileId, snapshotId) => {
            try {
                return { success: true, ...(await this.seleniumBase.applySnapshot(profileId, snapshotId)) };
            }
            catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
        electron_1.ipcMain.handle("save-seleniumbase-profile-cookie-snapshot", async (_event, profileId, name, snapshotId) => {
            try {
                const snapshot = await this.seleniumBase.saveSnapshot(profileId, name, snapshotId);
                return { success: true, snapshot };
            }
            catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
    }
}
exports.ProfileBrowserController = ProfileBrowserController;
//# sourceMappingURL=profile-browser-controller.js.map