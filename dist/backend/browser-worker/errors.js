"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserWorkerStateError = exports.BrowserLaunchError = exports.BrowserProfileInUseError = exports.BrowserContextAlreadyExistsError = exports.BrowserWorkerError = void 0;
class BrowserWorkerError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = "BrowserWorkerError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.BrowserWorkerError = BrowserWorkerError;
class BrowserContextAlreadyExistsError extends BrowserWorkerError {
    constructor(taskId) {
        super(`Browser context already exists for task "${taskId}".`, "CONTEXT_ALREADY_EXISTS");
        this.name = "BrowserContextAlreadyExistsError";
    }
}
exports.BrowserContextAlreadyExistsError = BrowserContextAlreadyExistsError;
class BrowserProfileInUseError extends BrowserWorkerError {
    constructor(userDataDir, ownerId) {
        const owner = ownerId ? ` Owner: ${ownerId}.` : "";
        super(`Browser profile directory "${userDataDir}" is currently active and cannot be reused simultaneously.${owner}`, "PROFILE_IN_USE");
        this.name = "BrowserProfileInUseError";
    }
}
exports.BrowserProfileInUseError = BrowserProfileInUseError;
class BrowserLaunchError extends BrowserWorkerError {
    constructor(taskId, cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        super(`Failed to launch browser context for task "${taskId}": ${detail}`, "BROWSER_LAUNCH_FAILED");
        this.name = "BrowserLaunchError";
    }
}
exports.BrowserLaunchError = BrowserLaunchError;
class BrowserWorkerStateError extends BrowserWorkerError {
    constructor(state) {
        super(`Browser worker cannot accept new contexts while state="${state}".`, "WORKER_NOT_READY");
        this.name = "BrowserWorkerStateError";
    }
}
exports.BrowserWorkerStateError = BrowserWorkerStateError;
//# sourceMappingURL=errors.js.map