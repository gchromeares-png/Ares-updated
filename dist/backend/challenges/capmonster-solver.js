"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapMonsterSolver = void 0;
const capmonstercloud_client_1 = require("@zennolab_com/capmonstercloud-client");
class CapMonsterSolver {
    constructor(apiKey) {
        this.client = capmonstercloud_client_1.CapMonsterCloudClientFactory.Create(new capmonstercloud_client_1.ClientOptions({ clientKey: apiKey }));
    }
    /**
     * Löst Turnstile, reCAPTCHA oder hCaptcha (inkl. Tier- und Objekterkennung) via CapMonster Cloud.
     */
    async solve(type, websiteUrl, websiteKey, proxy) {
        let proxyConfig = {};
        if (proxy && proxy.server) {
            try {
                const parsed = new URL(proxy.server);
                proxyConfig = {
                    proxyType: parsed.protocol.replace(":", ""),
                    proxyAddress: parsed.hostname,
                    proxyPort: parseInt(parsed.port, 10),
                    proxyLogin: proxy.username || parsed.username || undefined,
                    proxyPassword: proxy.password || parsed.password || undefined,
                };
            }
            catch { }
        }
        // 1. Cloudflare Turnstile
        if (type === "turnstile" || type === "shopify-checkpoint") {
            const task = new capmonstercloud_client_1.TurnstileRequest({
                websiteURL: websiteUrl,
                websiteKey: websiteKey,
                ...proxyConfig,
            });
            const result = await this.client.Solve(task);
            if (!result.solution?.token) {
                throw new Error("CapMonster hat kein Turnstile-Token zurückgegeben.");
            }
            return result.solution.token;
        }
        // 2. Google reCAPTCHA
        if (type === "recaptcha") {
            const task = new capmonstercloud_client_1.RecaptchaV2Request({
                websiteURL: websiteUrl,
                websiteKey: websiteKey,
                ...proxyConfig,
            });
            const result = await this.client.Solve(task);
            const token = result.solution?.gRecaptchaResponse || result.solution?.token;
            if (!token) {
                throw new Error("CapMonster hat kein reCAPTCHA-Token zurückgegeben.");
            }
            return token;
        }
        // 3. 🚀 hCaptcha (Pokémon Center Tier- und Bilderrätsel)
        if (type === "hcaptcha") {
            const task = new capmonstercloud_client_1.HCaptchaRequest({
                websiteURL: websiteUrl,
                websiteKey: websiteKey,
                ...proxyConfig,
            });
            const result = await this.client.Solve(task);
            const token = result.solution?.gRecaptchaResponse || result.solution?.token;
            if (!token) {
                throw new Error("CapMonster hat kein hCaptcha-Token zurückgegeben.");
            }
            return token;
        }
        throw new Error(`Nicht unterstützter Captcha-Typ: ${type}`);
    }
    async injectAndSubmit(page, type, token) {
        await page.evaluate(({ type, token }) => {
            // 1. Turnstile Input
            if (type === "turnstile" || type === "shopify-checkpoint") {
                const input = document.querySelector('input[name="cf-turnstile-response"]');
                if (input) {
                    input.value = token;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            // 2. reCAPTCHA Textarea
            else if (type === "recaptcha") {
                const input = document.querySelector('textarea[name="g-recaptcha-response"]');
                if (input) {
                    input.value = token;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            // 3. 🚀 hCaptcha Response Feld
            else if (type === "hcaptcha") {
                const hInput = document.querySelector('textarea[name="h-captcha-response"], input[name="h-captcha-response"]');
                if (hInput) {
                    hInput.value = token;
                    hInput.dispatchEvent(new Event("input", { bubbles: true }));
                    hInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
                // Viele Seiten erwarten das Token zusätzlich im g-recaptcha Feld
                const gInput = document.querySelector('textarea[name="g-recaptcha-response"]');
                if (gInput && !gInput.value) {
                    gInput.value = token;
                    gInput.dispatchEvent(new Event("input", { bubbles: true }));
                    gInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            // Checkpoint-Formular absenden
            const form = document.querySelector("form#checkpoint-form") ||
                document.querySelector('form[action*="checkpoint"]') ||
                document.querySelector('form:has([name="h-captcha-response"])') ||
                document.querySelector('form:has([name="cf-turnstile-response"])');
            if (form && form instanceof HTMLFormElement) {
                form.submit();
            }
        }, { type, token });
        const submitBtn = page.locator('form#checkpoint-form button[type="submit"], input[type="submit"], button#submit').first();
        if (await submitBtn.isVisible().catch(() => false)) {
            await submitBtn.click();
        }
    }
}
exports.CapMonsterSolver = CapMonsterSolver;
//# sourceMappingURL=capmonster-solver.js.map