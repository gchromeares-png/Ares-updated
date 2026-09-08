"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskRegistry = void 0;
const models_1 = require("../models");
class TaskRegistry {
    constructor(repository) {
        this.repository = repository;
        this.tasks = new Map();
    }
    createTask(config) {
        if (this.tasks.has(config.id)) {
            throw new Error(`Task ${config.id} already exists`);
        }
        const now = new Date();
        const task = {
            id: config.id,
            config,
            state: models_1.TaskState.CREATED,
            createdAt: now,
            updatedAt: now,
            retries: 0,
            maxRetries: config.maxRetries ?? 3
        };
        this.tasks.set(task.id, task);
        return task;
    }
    getTask(id) {
        return this.tasks.get(id);
    }
    getAllTasks() {
        return [...this.tasks.values()];
    }
    updateTask(id, updates) {
        const task = this.tasks.get(id);
        if (!task)
            throw new Error(`Task ${id} not found`);
        Object.assign(task, updates, { updatedAt: new Date() });
        return task;
    }
    deleteTask(id) {
        return this.tasks.delete(id);
    }
    async saveTask(id) {
        const task = this.getTask(id);
        if (task)
            await this.repository.save(task);
    }
    async loadTask(id) {
        const task = await this.repository.findById(id);
        if (task)
            this.tasks.set(id, task);
        return task;
    }
    async loadAllTasks() {
        const tasks = await this.repository.findAll();
        this.tasks.clear();
        for (const task of tasks)
            this.tasks.set(task.id, task);
        return tasks;
    }
}
exports.TaskRegistry = TaskRegistry;
//# sourceMappingURL=index.js.map