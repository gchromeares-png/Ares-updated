"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = void 0;
class SessionService {
    constructor() {
        this.sessions = new Map();
    }
    createSession(sessionData) {
        const session = {
            id: this.generateId(),
            ...sessionData,
            createdAt: new Date()
        };
        this.sessions.set(session.id, session);
        return session;
    }
    getSession(id) {
        return this.sessions.get(id);
    }
    getAllSessions() {
        return Array.from(this.sessions.values());
    }
    updateSession(id, updates) {
        const session = this.getSession(id);
        if (session) {
            Object.assign(session, updates);
        }
    }
    deleteSession(id) {
        return this.sessions.delete(id);
    }
    generateId() {
        return Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
    }
}
exports.SessionService = SessionService;
//# sourceMappingURL=session-service.js.map