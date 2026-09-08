"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachLiveChallengePageWatcher = void 0;
const live_challenge_handler_1 = require("./live-challenge-handler");
const activePages = new WeakSet();
const defaultHandler = new live_challenge_handler_1.LiveChallengeHandler();
function attachLiveChallengePageWatcher(page) {
    let isChecking = false;
    const runCheck = async (_eventName) => {
        if (page.isClosed() || isChecking || activePages.has(page))
            return;
        isChecking = true;
        activePages.add(page);
        try {
            await page.waitForTimeout(600);
            if (page.isClosed())
                return;
            await defaultHandler.handleLiveChallenge(page);
        }
        catch {
            // Navigationsfehler ignorieren
        }
        finally {
            isChecking = false;
            activePages.delete(page);
        }
    };
    const onLoad = () => void runCheck("load");
    const onFrame = (frame) => {
        if (frame === page.mainFrame())
            void runCheck("framenavigated");
    };
    page.on("load", onLoad);
    page.on("framenavigated", onFrame);
    void runCheck("initial");
    return () => {
        page.off("load", onLoad);
        page.off("framenavigated", onFrame);
        activePages.delete(page);
    };
}
exports.attachLiveChallengePageWatcher = attachLiveChallengePageWatcher;
//# sourceMappingURL=live-challenge-page-watcher.js.map