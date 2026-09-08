"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteRegisteredProfileCookieSnapshots = exports.saveRegisteredProfileCookieSnapshot = exports.readRegisteredProfileCookieSnapshot = exports.registerProfileCookieSnapshotVault = void 0;
let registeredVault;
function registerProfileCookieSnapshotVault(vault) {
    registeredVault = vault;
}
exports.registerProfileCookieSnapshotVault = registerProfileCookieSnapshotVault;
function readRegisteredProfileCookieSnapshot(profileId, snapshotId) {
    if (!registeredVault)
        return undefined;
    return registeredVault.read(profileId, snapshotId);
}
exports.readRegisteredProfileCookieSnapshot = readRegisteredProfileCookieSnapshot;
function saveRegisteredProfileCookieSnapshot(profileId, name, cookies, snapshotId) {
    if (!registeredVault)
        throw new Error("Cookie-Snapshot Vault ist noch nicht registriert.");
    return registeredVault.save(profileId, name, cookies, snapshotId);
}
exports.saveRegisteredProfileCookieSnapshot = saveRegisteredProfileCookieSnapshot;
function deleteRegisteredProfileCookieSnapshots(profileId) {
    return registeredVault?.deleteProfile(profileId) ?? 0;
}
exports.deleteRegisteredProfileCookieSnapshots = deleteRegisteredProfileCookieSnapshots;
//# sourceMappingURL=profile-cookie-snapshot-registry.js.map