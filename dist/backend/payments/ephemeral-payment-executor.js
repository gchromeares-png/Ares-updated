"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EphemeralPaymentExecutor = void 0;
const SESSION_KEY = "__paymentSession";
function sanitizedConfig(config) {
    const data = { ...(config.data ?? {}) };
    delete data[SESSION_KEY];
    return { ...config, data };
}
function taskProfileId(task) {
    const data = task.config.data ?? {};
    const action = data["monitorAction"];
    return String(data["profileId"] ?? action?.profileId ?? "").trim();
}
class EphemeralPaymentExecutor {
    constructor(delegate, getPaymentSession, getProfilePaymentSession) {
        this.delegate = delegate;
        this.getPaymentSession = getPaymentSession;
        this.getProfilePaymentSession = getProfilePaymentSession;
        this.listeners = new Set();
        this.taskRefs = new Map();
        const runtimeSource = delegate;
        this.unsubscribe = runtimeSource.onTaskUpdate?.(workerTask => {
            const task = this.taskRefs.get(workerTask.id);
            if (!task)
                return;
            task.config = sanitizedConfig(workerTask.config);
            task.lastError = workerTask.lastError;
            for (const listener of this.listeners)
                listener(task);
        });
    }
    onTaskUpdate(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
    async execute(task) {
        const session = this.resolveProfilePaymentSession(task, this.getPaymentSession(task.id));
        const workerTask = {
            ...task,
            config: {
                ...task.config,
                data: {
                    ...(task.config.data ?? {}),
                    ...(session ? { [SESSION_KEY]: session } : {})
                }
            }
        };
        this.taskRefs.set(task.id, task);
        try {
            const success = await this.delegate.execute(workerTask);
            task.config = sanitizedConfig(workerTask.config);
            task.lastError = workerTask.lastError;
            return success;
        }
        finally {
            this.taskRefs.delete(task.id);
        }
    }
    async updateDiscoveryKeywords(taskId, keywords) {
        if (!this.delegate.updateDiscoveryKeywords) {
            throw new Error("Dieser Browser-Executor unterstützt keine Live-Discovery-Keywords.");
        }
        return this.delegate.updateDiscoveryKeywords(taskId, keywords);
    }
    async setFinalPurchaseAllowed(allowed) {
        await this.delegate.setFinalPurchaseAllowed?.(allowed === true);
    }
    async cancelTask(taskId) {
        await this.delegate.cancelTask?.(taskId);
    }
    async close() {
        this.unsubscribe?.();
        this.listeners.clear();
        this.taskRefs.clear();
        await this.delegate.close?.();
    }
    resolveProfilePaymentSession(task, session) {
        const profileId = taskProfileId(task);
        // A profile-backed task does not need a pre-existing ephemeral card session.
        // If the task has a profile and the vault resolver is available, materialize
        // the card only for the delegated worker copy.
        if (!session) {
            if (!profileId || !this.getProfilePaymentSession)
                return undefined;
            try {
                return this.getProfilePaymentSession(profileId, { method: "card" });
            }
            catch {
                // Fail closed. Returning a card-method shell lets payment preparation
                // report missing fields without ever falling back to plaintext task data.
                return { method: "card" };
            }
        }
        if (session.method !== "card")
            return session;
        const profileOnlySession = {
            method: "card",
            label: session.label
        };
        // Profile-backed card data is authoritative. Any card secret supplied by a
        // legacy/manual task payload is ignored and never gets a fallback path.
        if (!profileId || !this.getProfilePaymentSession)
            return profileOnlySession;
        try {
            return this.getProfilePaymentSession(profileId, {
                method: "card",
                label: session.label
            });
        }
        catch {
            // Fail closed: payment preparation reports missing fields instead of using
            // plaintext task payloads when the encrypted profile vault is unavailable.
            return profileOnlySession;
        }
    }
}
exports.EphemeralPaymentExecutor = EphemeralPaymentExecutor;
//# sourceMappingURL=ephemeral-payment-executor.js.map