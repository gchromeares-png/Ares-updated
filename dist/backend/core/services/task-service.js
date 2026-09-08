"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskService = void 0;
const models_1 = require("../models");
class TaskService {
    constructor() {
        this.tasks = new Map();
    }
    createTask(config) {
        const task = {
            id: config.id,
            config,
            state: models_1.TaskState.CREATED,
            createdAt: new Date(),
            updatedAt: new Date(),
            retries: 0,
            maxRetries: config.maxRetries ?? 3,
            shopId: config.shopId
        };
        this.tasks.set(task.id, task);
        return task;
    }
    getTask(id) {
        return this.tasks.get(id);
    }
    getAllTasks() {
        return Array.from(this.tasks.values());
    }
    updateTask(id, updates) {
        const task = this.tasks.get(id);
        if (task) {
            Object.assign(task, updates, { updatedAt: new Date() });
        }
    }
    deleteTask(id) {
        return this.tasks.delete(id);
    }
    // Zustandsübergänge
    transitionToQueued(taskId) {
        const task = this.getTask(taskId);
        if (task && task.state === models_1.TaskState.CREATED) {
            task.state = models_1.TaskState.QUEUED;
            task.updatedAt = new Date();
        }
    }
    transitionToRunning(taskId) {
        const task = this.getTask(taskId);
        if (task && task.state === models_1.TaskState.QUEUED) {
            task.state = models_1.TaskState.RUNNING;
            task.updatedAt = new Date();
        }
    }
    transitionToSuccess(taskId) {
        const task = this.getTask(taskId);
        if (task && task.state === models_1.TaskState.CHECKOUT) {
            task.state = models_1.TaskState.SUCCESS;
            task.updatedAt = new Date();
        }
    }
    transitionToFailed(taskId, error) {
        const task = this.getTask(taskId);
        if (task) {
            task.state = models_1.TaskState.FAILED;
            task.lastError = error;
            task.updatedAt = new Date();
        }
    }
}
exports.TaskService = TaskService;
//# sourceMappingURL=task-service.js.map