"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkerPool = void 0;
class WorkerPool {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.workers = new Map();
        this.available = [];
        this.assignments = new Map();
    }
    addWorker(worker) {
        if (this.workers.has(worker.id)) {
            throw new Error(`Worker ${worker.id} already exists`);
        }
        this.workers.set(worker.id, worker);
        this.available.push(worker.id);
        this.eventBus.emit("workerAdded", worker);
    }
    assignTask(task) {
        // A paused/resumed task can be queued while its previous executor call is
        // still unwinding. Never allow the same task id to own two workers at once.
        if (this.assignments.has(task.id))
            return null;
        const workerId = this.available.shift();
        if (!workerId)
            return null;
        const worker = this.workers.get(workerId);
        if (!worker)
            return null;
        worker.status = "busy";
        worker.currentTaskId = task.id;
        this.assignments.set(task.id, workerId);
        this.eventBus.emit("workerAssigned", { taskId: task.id, workerId });
        return workerId;
    }
    releaseWorker(workerId) {
        const worker = this.workers.get(workerId);
        if (!worker)
            return;
        const assignment = [...this.assignments.entries()]
            .find(([, id]) => id === workerId);
        if (assignment) {
            this.assignments.delete(assignment[0]);
            this.eventBus.emit("workerReleased", {
                taskId: assignment[0],
                workerId
            });
        }
        worker.status = "idle";
        worker.currentTaskId = undefined;
        if (!this.available.includes(workerId)) {
            this.available.push(workerId);
        }
    }
    hasAssignment(taskId) {
        return this.assignments.has(taskId);
    }
    getAvailableWorkers() {
        return this.available.length;
    }
    getAllWorkers() {
        return [...this.workers.values()];
    }
}
exports.WorkerPool = WorkerPool;
//# sourceMappingURL=index.js.map