"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChallenge = exports.defaultLiveChallengeHandler = exports.LiveChallengeHandler = void 0;
const ghost_cursor_1 = require("ghost-cursor");
const capmonster_solver_1 = require("./capmonster-solver");
const live_challenge_detector_1 = require("./live-challenge-detector");
class LiveChallengeHandler {
    constructor(detector = new live_challenge_detector_1.LiveChallengeDetector()) {
        this.detector = detector;
    }
    /**
     * Findet den Sitekey aus mehreren Quellen (DOM, Iframes, hCaptcha UUIDs, Turnstile RegEx).
     */
    async extractSitekey(page) {
        return page.evaluate(() => {
            // 1. data-sitekey Attribut (hCaptcha / reCAPTCHA / Turnstile)
            const el = document.querySelector("[data-sitekey]");
            if (el && el.getAttribute("data-sitekey")) {
                return el.getAttribute("data-sitekey");
            }
            // 2. Iframe URL Parameter (sitekey=... oder key=...)
            const iframes = Array.from(document.querySelectorAll("iframe"));
            for (const frame of iframes) {
                const src = frame.src || "";
                const match = src.match(/sitekey=([^&]+)/) || src.match(/key=([^&]+)/);
                if (match && match[1]) {
                    return decodeURIComponent(match[1]);
                }
            }
            const html = document.documentElement.innerHTML;
            // 3. hCaptcha UUID Pattern (z. B. a5f76b62-1234-...)
            const hcaptchaRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
            const hMatch = html.match(hcaptchaRegex);
            if (hMatch) {
                return hMatch[0];
            }
            // 4. Cloudflare Turnstile Sitekey Pattern (0x4...)
            const turnstileRegex = /0x4[A-Za-z0-9_-]{18,30}/;
            const tMatch = html.match(turnstileRegex);
            if (tMatch) {
                return tMatch[0];
            }
            return null;
        }).catch(() => null);
    }
    async handleLiveChallenge(page, options = {}) {
        const startTime = Date.now();
        const detection = await this.detector.detect(page);
        if (!detection.detected) {
            return {
                handled: false,
                resolved: true,
                durationMs: 0
            };
        }
        // Sicherer String-Cast verhindert TypeScript-Overlap-Fehler
        const currentType = String(detection.type ?? "");
        const isQueue = currentType === "shopify-queue" ||
            currentType === "queue-it" ||
            currentType === "waiting-room";
        // Warteräume: 1,5 Stunden (90 Min) / Captcha-Setzung: 90 Sekunden
        const defaultTimeoutMs = isQueue ? 90 * 60 * 1000 : 90000;
        const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
        const pollIntervalMs = options.pollIntervalMs ?? 500;
        if (options.bringToFrontOnChallenge !== false) {
            await page.bringToFront().catch(() => undefined);
        }
        options.onStatusChange?.(`Live-Challenge erkannt (${currentType || "unbekannt"}). Starte Live-Browser-Handling...`, detection);
        // =========================================================================
        // 🚀 STUFE 1: CAPMONSTER CLOUD SOLVER (Inkl. hCaptcha Tiererkennung)
        // =========================================================================
        const capmonsterKey = process.env["CAPMONSTER_API_KEY"];
        if (capmonsterKey &&
            (currentType === "turnstile" ||
                currentType === "recaptcha" ||
                currentType === "hcaptcha" ||
                currentType === "shopify-checkpoint")) {
            try {
                const sitekey = await this.extractSitekey(page);
                if (sitekey) {
                    options.onStatusChange?.(`CapMonster aktiv: Löse ${currentType} via Cloud...`, detection);
                    const solver = new capmonster_solver_1.CapMonsterSolver(capmonsterKey);
                    const challengeType = currentType === "shopify-checkpoint" ? "turnstile" : currentType;
                    const token = await solver.solve(challengeType, page.url(), sitekey);
                    await solver.injectAndSubmit(page, challengeType, token);
                    // 🚀 PASSIVES ÜBERGANGSFENSTER:
                    // Wartet bis zu 3,5s rein lesend ohne Ghost-Cursor / Klick-Störung
                    const transitionSuccess = await this.waitForResolvedTransition(page, 3500, 250);
                    if (transitionSuccess) {
                        options.onStatusChange?.(`Live-Challenge (${currentType}) im Browser erfolgreich gelöst!`, detection);
                        return {
                            handled: true,
                            type: detection.type,
                            resolved: true,
                            durationMs: Date.now() - startTime
                        };
                    }
                }
            }
            catch (solverErr) {
                options.onStatusChange?.(`CapMonster Hinweis (${solverErr?.message || solverErr}). Schalte auf Live-Browser-Interaktion...`, detection);
            }
        }
        // =========================================================================
        // 🚀 STUFE 2: GHOST-CURSOR MAUS-INTERAKTION + MENSCHLICHER FALLBACK
        // =========================================================================
        // Klickt erst, wenn das passive Übergangsfenster oben nicht gereicht hat!
        if ((currentType === "turnstile" || currentType === "generic-interstitial") && options.autoSolveTurnstile !== false) {
            await this.attemptTurnstileClick(page);
        }
        else if (currentType === "hcaptcha") {
            await this.attemptHCaptchaClick(page);
        }
        else if (currentType === "shopify-checkpoint") {
            await this.attemptCheckpointSubmit(page);
        }
        let lastInteractionTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (page.isClosed()) {
                return {
                    handled: true,
                    type: detection.type,
                    resolved: false,
                    durationMs: Date.now() - startTime,
                    error: "Browser-Seite wurde während der Live-Challenge geschlossen."
                };
            }
            const isResolved = await this.checkIfResolved(page);
            if (isResolved) {
                options.onStatusChange?.(`Live-Challenge (${currentType || "unbekannt"}) im Browser erfolgreich gelöst!`, detection);
                return {
                    handled: true,
                    type: detection.type,
                    resolved: true,
                    durationMs: Date.now() - startTime
                };
            }
            // Alle 4 Sekunden erneute Interaktion mit ghost-cursor versuchen
            if (!isQueue && Date.now() - lastInteractionTime > 4000) {
                lastInteractionTime = Date.now();
                if ((currentType === "turnstile" || currentType === "generic-interstitial") && options.autoSolveTurnstile !== false) {
                    await this.attemptTurnstileClick(page);
                }
                else if (currentType === "hcaptcha") {
                    await this.attemptHCaptchaClick(page);
                }
                else if (currentType === "shopify-checkpoint") {
                    await this.attemptCheckpointSubmit(page);
                }
            }
            await this.sleep(pollIntervalMs);
        }
        return {
            handled: true,
            type: detection.type,
            resolved: false,
            durationMs: Date.now() - startTime,
            error: `Live-Challenge (${currentType || "unbekannt"}) im Browser nicht innerhalb von ${Math.round(timeoutMs / 1000)}s gelöst (Timeout).`
        };
    }
    /**
     * 🚀 GHOST-CURSOR: Klickt die Cloudflare Turnstile Checkbox mit natürlicher Bézier-Kurve.
     */
    async attemptTurnstileClick(page) {
        if (page.isClosed())
            return false;
        try {
            const iframeElement = await page.$('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[title*="Turnstile" i], iframe[title*="Cloudflare" i]');
            if (iframeElement) {
                const box = await iframeElement.boundingBox();
                if (box) {
                    const clickX = box.x + 30 + Math.floor(Math.random() * 6);
                    const clickY = box.y + box.height / 2 + Math.floor(Math.random() * 6 - 3);
                    const cursor = (0, ghost_cursor_1.createCursor)(page);
                    await cursor.moveTo({ x: clickX, y: clickY });
                    await this.sleep(50 + Math.floor(Math.random() * 40));
                    await cursor.click();
                    return true;
                }
            }
        }
        catch { }
        return false;
    }
    /**
     * 🚀 GHOST-CURSOR: Klickt die hCaptcha Checkbox (z. B. Pokémon Center) mit natürlicher Bézier-Kurve.
     */
    async attemptHCaptchaClick(page) {
        if (page.isClosed())
            return false;
        try {
            const iframeElement = await page.$('iframe[src*="hcaptcha.com"], iframe[title*="hCaptcha" i], iframe[src*="newassets.hcaptcha.com"]');
            if (iframeElement) {
                const box = await iframeElement.boundingBox();
                if (box) {
                    const clickX = box.x + 28 + Math.floor(Math.random() * 6);
                    const clickY = box.y + box.height / 2 + Math.floor(Math.random() * 6 - 3);
                    const cursor = (0, ghost_cursor_1.createCursor)(page);
                    await cursor.moveTo({ x: clickX, y: clickY });
                    await this.sleep(60 + Math.floor(Math.random() * 40));
                    await cursor.click();
                    return true;
                }
            }
        }
        catch { }
        return false;
    }
    async attemptCheckpointSubmit(page) {
        if (page.isClosed())
            return false;
        try {
            const hasToken = await page.evaluate(() => {
                const cf = document.querySelector('input[name="cf-turnstile-response"]')?.value;
                const rc = document.querySelector('textarea[name="g-recaptcha-response"]')?.value;
                const hc = document.querySelector('textarea[name="h-captcha-response"]')?.value;
                return Boolean((cf && cf.trim()) || (rc && rc.trim()) || (hc && hc.trim()));
            }).catch(() => false);
            if (hasToken) {
                const submitButton = page.locator('form[action*="/checkpoint"] button[type="submit"], form[action*="/checkpoint"] input[type="submit"], #checkpoint-submit, button#submit').first();
                if (await submitButton.isVisible({ timeout: 800 }).catch(() => false)) {
                    await submitButton.click({ timeout: 1500 }).catch(() => undefined);
                    return true;
                }
            }
        }
        catch { }
        return false;
    }
    async checkIfResolved(page) {
        if (page.isClosed())
            return false;
        // Schutz vor vorzeitigem Verlassen bei Cloudflare-Wänden
        let title = "";
        if (typeof page.title === "function") {
            title = (await page.title().catch(() => "")) || "";
        }
        if (title.toLowerCase().includes("just a moment")) {
            return false;
        }
        const currentUrl = page.url();
        const isCheckpointUrl = currentUrl.includes("/checkpoint") || currentUrl.includes("/challenge") || currentUrl.includes("/throttle");
        if (!isCheckpointUrl) {
            const hasChallengeWidgets = await page.evaluate(() => {
                return Boolean(document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="google.com/recaptcha"], iframe[src*="hcaptcha.com"], .cf-turnstile, .g-recaptcha, .h-captcha'));
            }).catch(() => false);
            if (!hasChallengeWidgets) {
                return true;
            }
        }
        const hasCheckoutFields = await page.evaluate(() => {
            return Boolean(document.querySelector('input[name="email"], input[name="firstName"], input[name="address1"], #checkout_shipping_address, .step__sections, [data-step="contact_information"]'));
        }).catch(() => false);
        return hasCheckoutFields;
    }
    /**
     * 🚀 PASSIVES ÜBERGANGSFENSTER:
     * Wartet rein lesend darauf, dass die Seite nach einer Token-Injection
     * die Challenge verlässt, bevor der Fallback (Ghost-Cursor / Klick) loslegt.
     */
    async waitForResolvedTransition(page, timeoutMs = 3500, pollIntervalMs = 250) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (page.isClosed())
                return false;
            if (await this.checkIfResolved(page)) {
                return true;
            }
            await this.sleep(pollIntervalMs);
        }
        return false;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.LiveChallengeHandler = LiveChallengeHandler;
exports.defaultLiveChallengeHandler = new LiveChallengeHandler();
async function handleChallenge(page, options = {}) {
    return exports.defaultLiveChallengeHandler.handleLiveChallenge(page, options);
}
exports.handleChallenge = handleChallenge;
//# sourceMappingURL=live-challenge-handler.js.map