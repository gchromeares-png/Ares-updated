"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserFactory = void 0;
class BrowserFactory {
    static createBrowser(config) {
        // Diese Legacy-Core-Factory bleibt für Mock-/Kompatibilitätstests bestehen;
        // der aktive Task-Browserpfad wird separat durch SeleniumBase CDP bereitgestellt.
        return new MockBrowserService(config);
    }
}
exports.BrowserFactory = BrowserFactory;
// Mock-Implementierung für Testzwecke
class MockBrowserService {
    constructor(config) {
        this.config = config;
    }
    async launch() {
        console.log('Launching browser with config:', this.config);
    }
    async close() {
        console.log('Closing browser');
    }
    async navigate(url) {
        console.log(`Navigating to ${url}`);
    }
    async waitForSelector(selector, timeout) {
        console.log(`Waiting for selector ${selector} with timeout ${timeout}`);
    }
    async click(selector) {
        console.log(`Clicking on ${selector}`);
    }
    async fill(selector, value) {
        console.log(`Filling ${selector} with ${value}`);
    }
    async getHtml() {
        return '<html></html>';
    }
    async getTitle() {
        return 'Mock Title';
    }
    async getCurrentUrl() {
        return 'https://mock.example.com';
    }
    async takeScreenshot(path) {
        console.log(`Taking screenshot at ${path}`);
    }
    async executeScript(script) {
        console.log(`Executing script: ${script}`);
        return {};
    }
    async waitForNetworkIdle(timeout) {
        console.log(`Waiting for network idle with timeout ${timeout}`);
    }
    async setCookie(cookie) {
        console.log('Setting cookie:', cookie);
    }
    async getCookies() {
        return [];
    }
}
//# sourceMappingURL=browser-factory.js.map