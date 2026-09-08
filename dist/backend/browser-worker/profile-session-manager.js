"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeProfileUserDataDir = exports.acquireBrowserProfileLease = exports.inspectBrowserProfileLease = exports.resolveProfileUserDataDir = exports.resolveBrowserProfileRoot = exports.safeProfilePartitionName = void 0;
const tslib_1 = require("tslib");
const fs = tslib_1.__importStar(require("fs"));
const os = tslib_1.__importStar(require("os"));
const path = tslib_1.__importStar(require("path"));
const profile_cookie_snapshot_registry_1 = require("../cookies/profile-cookie-snapshot-registry");
const errors_1 = require("./errors");
const PROFILE_LOCK_FILE = ".ares-profile.lock";
function safeProfilePartitionName(profileId) {
    const normalized = String(profileId ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!normalized)
        throw new TypeError("profileId must not be empty.");
    return `profile_${normalized}`;
}
exports.safeProfilePartitionName = safeProfilePartitionName;
function resolveBrowserProfileRoot(configuredRoot) {
    const value = configuredRoot?.trim() || process.env["ARES_BROWSER_PROFILE_ROOT"]?.trim();
    return value || path.join(os.tmpdir(), "ares-browser-profiles");
}
exports.resolveBrowserProfileRoot = resolveBrowserProfileRoot;
function resolveProfileUserDataDir(profileId, configuredRoot) {
    return path.join(resolveBrowserProfileRoot(configuredRoot), safeProfilePartitionName(profileId));
}
exports.resolveProfileUserDataDir = resolveProfileUserDataDir;
function lockPathFor(userDataDir) {
    return path.join(path.resolve(userDataDir), PROFILE_LOCK_FILE);
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function readLock(lockPath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        if (!parsed.ownerId || !parsed.pid || !parsed.acquiredAt)
            return undefined;
        return { ownerId: String(parsed.ownerId), pid: Number(parsed.pid), acquiredAt: String(parsed.acquiredAt) };
    }
    catch {
        return undefined;
    }
}
function removeStaleLock(lockPath) {
    const current = readLock(lockPath);
    if (current && isProcessAlive(current.pid))
        return false;
    try {
        fs.unlinkSync(lockPath);
        return true;
    }
    catch (error) {
        return error.code === "ENOENT";
    }
}
function inspectBrowserProfileLease(userDataDir) {
    const lockPath = lockPathFor(userDataDir);
    if (!fs.existsSync(lockPath))
        return undefined;
    const current = readLock(lockPath);
    if (!current || !isProcessAlive(current.pid)) {
        removeStaleLock(lockPath);
        return undefined;
    }
    return current;
}
exports.inspectBrowserProfileLease = inspectBrowserProfileLease;
function acquireBrowserProfileLease(userDataDir, ownerId) {
    const normalizedOwner = String(ownerId ?? "").trim();
    if (!normalizedOwner)
        throw new TypeError("ownerId must not be empty.");
    const normalizedDir = path.resolve(userDataDir);
    fs.mkdirSync(normalizedDir, { recursive: true });
    const lockPath = lockPathFor(normalizedDir);
    for (let attempt = 0; attempt < 2; attempt++) {
        const acquiredAt = new Date().toISOString();
        const record = { ownerId: normalizedOwner, pid: process.pid, acquiredAt };
        try {
            const fd = fs.openSync(lockPath, "wx");
            try {
                fs.writeFileSync(fd, JSON.stringify(record), "utf8");
            }
            finally {
                fs.closeSync(fd);
            }
            let released = false;
            return {
                ownerId: normalizedOwner,
                pid: process.pid,
                userDataDir: normalizedDir,
                lockPath,
                acquiredAt,
                release: () => {
                    if (released)
                        return;
                    released = true;
                    const current = readLock(lockPath);
                    if (current && current.ownerId === normalizedOwner && current.pid === process.pid) {
                        try {
                            fs.unlinkSync(lockPath);
                        }
                        catch (error) {
                            if (error.code !== "ENOENT")
                                throw error;
                        }
                    }
                }
            };
        }
        catch (error) {
            const code = error.code;
            if (code !== "EEXIST")
                throw error;
            if (attempt === 0 && removeStaleLock(lockPath))
                continue;
            const current = inspectBrowserProfileLease(normalizedDir);
            throw new errors_1.BrowserProfileInUseError(normalizedDir, current?.ownerId);
        }
    }
    throw new errors_1.BrowserProfileInUseError(normalizedDir);
}
exports.acquireBrowserProfileLease = acquireBrowserProfileLease;
function removeProfileUserDataDir(profileId, configuredRoot) {
    const userDataDir = resolveProfileUserDataDir(profileId, configuredRoot);
    const exists = fs.existsSync(userDataDir);
    if (exists) {
        const lease = acquireBrowserProfileLease(userDataDir, `delete:${profileId}`);
        try {
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }
        finally {
            lease.release();
        }
    }
    (0, profile_cookie_snapshot_registry_1.deleteRegisteredProfileCookieSnapshots)(profileId);
}
exports.removeProfileUserDataDir = removeProfileUserDataDir;
//# sourceMappingURL=profile-session-manager.js.map