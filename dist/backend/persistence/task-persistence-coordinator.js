"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskPersistenceCoordinator = void 0;
const models_1 = require("../models");
function cloneTask(task) {
    return {
        ...task,
        config: JSON.parse(JSON.stringify(task.config)),
        createdAt: new Date(task.createdAt),
        updatedAt: new Date(task.updatedAt)
    };
}
function levelForState(state) {
    if (state === models_1.TaskState.FAILED)
        return "error";
    if ([models_1.TaskState.PAUSED, models_1.TaskState.CANCELLED, models_1.TaskState.RETRYING].includes(state))
        return "warn";
    return "info";
}
function stateMessage(task, previousState, newState) {
    if (newState === models_1.TaskState.FAILED && task.lastError) {
        return `${previousState} -> ${newState}: ${task.lastError}`;
    }
    return `${previousState} -> ${newState}`;
}
class TaskPersistenceCoordinator {
    constructor(orchestrator, repository) {
        this.repository = repository;
        this.unsubscribers = [];
        this.writeQueue = Promise.resolve();
        this.unsubscribers.push(orchestrator.on("taskCreated", task => {
            const snapshot = cloneTask(task);
            this.enqueue(snapshot, {
                taskId: snapshot.id,
                event: "taskCreated",
                state: snapshot.state,
                level: "info",
                message: "Task erstellt",
                createdAt: new Date()
            });
        }));
        this.unsubscribers.push(orchestrator.on("taskStateChanged", ({ task, previousState, newState }) => {
            const snapshot = cloneTask(task);
            this.enqueue(snapshot, {
                taskId: snapshot.id,
                event: "taskStateChanged",
                state: newState,
                level: levelForState(newState),
                message: stateMessage(snapshot, previousState, newState),
                createdAt: new Date()
            });
        }));
    }
    getLastError() {
        return this.lastError;
    }
    async flush() {
        await this.writeQueue;
    }
    async close() {
        for (const unsubscribe of this.unsubscribers.splice(0))
            unsubscribe();
        await this.flush();
    }
    enqueue(task, entry) {
        const run = this.writeQueue.then(async () => {
            await this.repository.recordTaskEvent(task, entry);
            this.lastError = undefined;
        });
        this.writeQueue = run.catch(error => {
            this.lastError = error instanceof Error ? error.message : String(error);
        });
    }
}
exports.TaskPersistenceCoordinator = TaskPersistenceCoordinator;
//# sourceMappingURL=task-persistence-coordinator.js.map