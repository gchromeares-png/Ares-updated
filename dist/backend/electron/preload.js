"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const taskStatusListeners = new Map();
const monitorListeners = new Map();
const api = {
    getProfiles: () => electron_1.ipcRenderer.invoke("get-profiles"),
    saveProfile: (profile) => electron_1.ipcRenderer.invoke("save-profile", profile),
    deleteProfile: (profileId) => electron_1.ipcRenderer.invoke("delete-profile", profileId),
    getProfilePayment: (profileId) => electron_1.ipcRenderer.invoke("get-profile-payment", profileId),
    saveProfilePayment: (profileId, payment) => electron_1.ipcRenderer.invoke("save-profile-payment", profileId, payment),
    deleteProfilePayment: (profileId) => electron_1.ipcRenderer.invoke("delete-profile-payment", profileId),
    getProfileBrowserStatus: (profileId) => electron_1.ipcRenderer.invoke("get-profile-browser-status", profileId),
    openProfileBrowser: (profileId, startUrl) => electron_1.ipcRenderer.invoke("open-profile-browser", profileId, startUrl),
    closeProfileBrowser: (profileId) => electron_1.ipcRenderer.invoke("close-profile-browser", profileId),
    resetProfileBrowserSession: (profileId) => electron_1.ipcRenderer.invoke("reset-profile-browser-session", profileId),
    getSeleniumBaseProfileBrowserStatus: (profileId) => electron_1.ipcRenderer.invoke("get-seleniumbase-profile-browser-status", profileId),
    getSeleniumBaseVisionStatus: () => electron_1.ipcRenderer.invoke("get-seleniumbase-vision-status"),
    prepareSeleniumBaseVision: () => electron_1.ipcRenderer.invoke("prepare-seleniumbase-vision"),
    openSeleniumBaseProfileBrowser: (profileId, startUrl, cookieSnapshotId) => electron_1.ipcRenderer.invoke("open-profile-browser", profileId, { engine: "seleniumbase-cdp", startUrl, cookieSnapshotId }),
    closeSeleniumBaseProfileBrowser: (profileId) => electron_1.ipcRenderer.invoke("close-seleniumbase-profile-browser", profileId),
    applySeleniumBaseCookieSnapshot: (profileId, snapshotId) => electron_1.ipcRenderer.invoke("apply-seleniumbase-cookie-snapshot", profileId, snapshotId),
    saveSeleniumBaseProfileCookieSnapshot: (profileId, name, snapshotId) => electron_1.ipcRenderer.invoke("save-seleniumbase-profile-cookie-snapshot", profileId, name, snapshotId),
    listProfileCookieSnapshots: (profileId) => electron_1.ipcRenderer.invoke("list-profile-cookie-snapshots", profileId),
    saveProfileCookieSnapshot: (profileId, name, snapshotId) => electron_1.ipcRenderer.invoke("save-profile-cookie-snapshot", profileId, name, snapshotId),
    deleteProfileCookieSnapshot: (profileId, snapshotId) => electron_1.ipcRenderer.invoke("delete-profile-cookie-snapshot", profileId, snapshotId),
    getProxies: () => electron_1.ipcRenderer.invoke("get-proxies"),
    saveProxy: (proxy) => electron_1.ipcRenderer.invoke("save-proxy", proxy),
    testProxy: (proxyId) => electron_1.ipcRenderer.invoke("test-proxy", proxyId),
    testAllProxies: () => electron_1.ipcRenderer.invoke("test-all-proxies"),
    deleteProxy: (proxyId) => electron_1.ipcRenderer.invoke("delete-proxy", proxyId),
    getShops: () => electron_1.ipcRenderer.invoke("get-shops"),
    registerShop: (config) => electron_1.ipcRenderer.invoke("register-shop", config),
    createTask: (config) => electron_1.ipcRenderer.invoke("create-task", config),
    setPaymentSession: (taskId, payment) => electron_1.ipcRenderer.invoke("set-payment-session", taskId, payment),
    clearPaymentSession: (taskId) => electron_1.ipcRenderer.invoke("clear-payment-session", taskId),
    startTask: (taskId) => electron_1.ipcRenderer.invoke("start-task", taskId),
    pauseTask: (taskId) => electron_1.ipcRenderer.invoke("pause-task", taskId),
    resumeTask: (taskId) => electron_1.ipcRenderer.invoke("resume-task", taskId),
    stopTask: (taskId) => electron_1.ipcRenderer.invoke("stop-task", taskId),
    updateDiscoveryKeywords: (taskId, keywords) => electron_1.ipcRenderer.invoke("update-discovery-keywords", taskId, keywords),
    getFinalPurchaseSetting: () => electron_1.ipcRenderer.invoke("get-final-purchase-setting"),
    setFinalPurchaseAllowed: (allowed) => electron_1.ipcRenderer.invoke("set-final-purchase-allowed", allowed),
    getTaskStatus: (taskId) => electron_1.ipcRenderer.invoke("get-task-status", taskId),
    getTaskList: () => electron_1.ipcRenderer.invoke("get-task-list"),
    getTaskLogs: (taskId, limit = 100) => electron_1.ipcRenderer.invoke("get-task-logs", taskId, limit),
    getProductMonitorEvents: (taskId, limit = 100) => electron_1.ipcRenderer.invoke("get-product-monitor-events", taskId, limit),
    getSystemStatus: () => electron_1.ipcRenderer.invoke("get-system-status"),
    testCapmonsterApiKey: () => electron_1.ipcRenderer.invoke("test-capmonster-api-key"),
    onTaskStatusUpdate: (callback) => {
        const listener = (_event, payload) => callback(payload);
        taskStatusListeners.set(callback, listener);
        electron_1.ipcRenderer.on("task-status-update", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("task-status-update", listener);
            taskStatusListeners.delete(callback);
        };
    },
    onProductMonitorUpdate: (callback) => {
        const listener = (_event, payload) => callback(payload);
        monitorListeners.set(callback, listener);
        electron_1.ipcRenderer.on("product-monitor-update", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("product-monitor-update", listener);
            monitorListeners.delete(callback);
        };
    },
    removeTaskStatusListener: (callback) => {
        if (callback && taskStatusListeners.has(callback)) {
            const listener = taskStatusListeners.get(callback);
            electron_1.ipcRenderer.removeListener("task-status-update", listener);
            taskStatusListeners.delete(callback);
        }
        else {
            electron_1.ipcRenderer.removeAllListeners("task-status-update");
            taskStatusListeners.clear();
        }
    },
    removeProductMonitorListener: (callback) => {
        if (callback && monitorListeners.has(callback)) {
            const listener = monitorListeners.get(callback);
            electron_1.ipcRenderer.removeListener("product-monitor-update", listener);
            monitorListeners.delete(callback);
        }
        else {
            electron_1.ipcRenderer.removeAllListeners("product-monitor-update");
            monitorListeners.clear();
        }
    }
};
electron_1.contextBridge.exposeInMainWorld("ares", api);
//# sourceMappingURL=preload.js.map