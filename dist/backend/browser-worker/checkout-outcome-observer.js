"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.observeCheckoutOutcome = void 0;
const SUCCESS_URL = /(?:\/thank[_-]?you(?:[/?#]|$)|\/order(?:s)?\/(?:confirmation|confirmed|complete|success)(?:[/?#]|$)|\/checkout\/(?:thank[_-]?you|confirmation|success)(?:[/?#]|$))/i;
const SUCCESS_TEXT = [
    /thank you for (?:your )?(?:order|purchase)/i,
    /(?:your )?order (?:has been )?(?:confirmed|received|completed)/i,
    /we(?:'ve| have) received your order/i,
    /vielen dank für (?:deine|ihre) bestellung/i,
    /bestellung (?:wurde )?(?:bestätigt|bestaetigt|eingegangen|abgeschlossen)/i
];
/** Strong, generic post-submit confirmation observer. A click/navigation alone is never success. */
async function observeCheckoutOutcome(page) {
    const url = String(page.url() || "");
    if (SUCCESS_URL.test(url))
        return { confirmed: true, source: "url" };
    let title = "";
    let body = "";
    try {
        title = await page.title();
    }
    catch { }
    try {
        body = await page.locator("body").innerText({ timeout: 750 });
    }
    catch { }
    const text = `${title}\n${body}`.replace(/\s+/g, " ").slice(0, 40000);
    if (SUCCESS_TEXT.some(pattern => pattern.test(text))) {
        return { confirmed: true, source: "text" };
    }
    return { confirmed: false, source: "none" };
}
exports.observeCheckoutOutcome = observeCheckoutOutcome;
//# sourceMappingURL=checkout-outcome-observer.js.map