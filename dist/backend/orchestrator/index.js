"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskOrchestrator = void 0;
const cancellation_manager_1 = require("../cancellation-manager");
const event_bus_1 = require("../event-bus");
const retry_scheduler_1 = require("../retry-scheduler");
const state_machine_1 = require("../state-machine");
const task_registry_1 = require("../task-registry");
const models_1 = require("../models");
const task_executor_1 = require("../task-executor");
const worker_pool_1 = require("../worker-pool");
const early_gate_1 = require("../monitor/early-gate");
class TaskOrchestrator {
    constructor(repository, executor, browserManager, shopAdapter, proxyManager) {
        this.eventBus = new event_bus_1.EventBus();
        this.stateMachine = new state_machine_1.StateMachine();
        this.retryScheduler = new retry_scheduler_1.RetryScheduler(this.eventBus);
        this.cancellationManager = new cancellation_manager_1.CancellationManager();
        this.workerPool = new worker_pool_1.WorkerPool(this.eventBus);
        this.pendingTaskIds = [];
        this.pendingTaskIdSet = new Set();
        this.pausedRunningTaskIds = new Set();
        this.registry = new task_registry_1.TaskRegistry(repository);
        this.executor =
            browserManager && shopAdapter && proxyManager
                ? new task_executor_1.TaskExecutor(this.eventBus, this.cancellationManager, browserManager, shopAdapter, proxyManager)
                : executor;
        const runtimeSource = this.executor;
        this.unsubscribeExecutorUpdates = runtimeSource.onTaskUpdate?.(task => {
            this.handleRuntimeTaskUpdate(task);
        });
        this.eventBus.on("taskFailed", task => {
            const retryPolicy = task.config.data?.["retryPolicy"];
            if (retryPolicy?.["blocked"] === true)
                return;
            if (task.retries < task.maxRetries) {
                task.retries += 1;
                this.transition(task, models_1.TaskState.RETRYING);
                this.retryScheduler.scheduleRetry(task);
            }
        });
        this.eventBus.on("taskRetrying", task => {
            if (task.state === models_1.TaskState.RETRYING) {
                this.transition(task, models_1.TaskState.QUEUED);
                void this.startTask(task.id);
            }
        });
    }
    async initialize() {
        const restored = await this.registry.loadAllTasks();
        for (const task of restored) {
            if (task.state === models_1.TaskState.CREATED) {
                this.transition(task, models_1.TaskState.QUEUED);
                await this.registry.saveTask(task.id);
                continue;
            }
            if (this.isRecoverableActiveState(task.state)) {
                task.lastError = task.lastError || "Nach App-Neustart sicher pausiert. Fortsetzen erforderlich.";
                this.transition(task, models_1.TaskState.PAUSED);
                await this.registry.saveTask(task.id);
            }
        }
    }
    createTask(config) {
        const task = this.registry.createTask(config);
        this.eventBus.emit("taskCreated", task);
        this.transition(task, models_1.TaskState.QUEUED);
        return task;
    }
    async startTask(taskId) {
        const task = this.registry.getTask(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        if (task.state !== models_1.TaskState.QUEUED) {
            throw new Error(`Task ${taskId} cannot start from ${task.state}`);
        }
        const workerId = this.workerPool.assignTask(task);
        if (!workerId) {
            this.enqueueTask(taskId);
            return;
        }
        this.removePendingTask(taskId);
        try {
            this.transition(task, models_1.TaskState.STARTING);
            this.transition(task, models_1.TaskState.RUNNING);
            this.eventBus.emit("taskStarted", task);
            let success;
            try {
                success = await this.executor.execute(task);
            }
            catch (error) {
                const wasPausedWhileRunning = this.pausedRunningTaskIds.delete(task.id);
                const currentState = task.state;
                task.lastError = error instanceof Error ? error.message : String(error);
                if (currentState === models_1.TaskState.CANCELLED || currentState === models_1.TaskState.PAUSED || wasPausedWhileRunning) {
                    if (wasPausedWhileRunning && currentState === models_1.TaskState.QUEUED) {
                        this.enqueueTask(task.id);
                    }
                    await this.registry.saveTask(task.id);
                    return;
                }
                if (this.stateMachine.canTransition(task.state, models_1.TaskState.FAILED)) {
                    this.transition(task, models_1.TaskState.FAILED);
                    this.eventBus.emit("taskFailed", task);
                }
                await this.registry.saveTask(task.id);
                return;
            }
            const wasPausedWhileRunning = this.pausedRunningTaskIds.delete(task.id);
            const currentState = task.state;
            if (currentState === models_1.TaskState.CANCELLED || currentState === models_1.TaskState.PAUSED || wasPausedWhileRunning) {
                if (wasPausedWhileRunning && currentState === models_1.TaskState.QUEUED) {
                    this.enqueueTask(task.id);
                }
                await this.registry.saveTask(task.id);
                return;
            }
            if (success) {
                this.completeSuccessfulTask(task);
            }
            else {
                this.transition(task, models_1.TaskState.FAILED);
                this.eventBus.emit("taskFailed", task);
            }
            await this.registry.saveTask(task.id);
        }
        finally {
            this.workerPool.releaseWorker(workerId);
            this.drainQueue();
        }
    }
    async pauseTask(taskId) {
        const task = this.registry.getTask(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        this.removePendingTask(taskId);
        this.retryScheduler.cancelRetry(taskId);
        if (!this.stateMachine.canTransition(task.state, models_1.TaskState.PAUSED)) {
            throw new Error(`Task ${taskId} cannot pause from ${task.state}`);
        }
        if (this.isRunningLike(task.state)) {
            this.pausedRunningTaskIds.add(taskId);
        }
        this.transition(task, models_1.TaskState.PAUSED);
        this.cancellationManager.cancelTask(taskId);
        void this.executor.cancelTask?.(taskId).catch(error => {
            task.lastError = error instanceof Error ? error.message : String(error);
        });
        await this.registry.saveTask(task.id);
        this.drainQueue();
    }
    async resumeTask(taskId) {
        const task = this.registry.getTask(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        if (task.state !== models_1.TaskState.PAUSED) {
            throw new Error(`Task ${taskId} cannot resume from ${task.state}`);
        }
        this.transition(task, models_1.TaskState.QUEUED);
        this.eventBus.emit("taskResumed", task);
        await this.registry.saveTask(task.id);
        this.enqueueTask(task.id);
        this.drainQueue();
    }
    cancelTask(taskId) {
        const task = this.registry.getTask(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        this.removePendingTask(taskId);
        this.pausedRunningTaskIds.delete(taskId);
        this.retryScheduler.cancelRetry(taskId);
        this.cancellationManager.cancelTask(taskId);
        void this.executor.cancelTask?.(taskId).catch(error => {
            task.lastError = error instanceof Error ? error.message : String(error);
        });
        if (this.stateMachine.canTransition(task.state, models_1.TaskState.CANCELLED)) {
            this.transition(task, models_1.TaskState.CANCELLED);
            this.eventBus.emit("taskCancelled", task);
        }
    }
    setTaskQueueWaiting(taskId, waiting) {
        const task = this.registry.getTask(taskId);
        if (!task)
            return;
        const queueStatus = task.config.data?.["queueStatus"];
        if (waiting && task.state === models_1.TaskState.RUNNING) {
            if ((0, early_gate_1.isEarlyGateChildTask)(task)) {
                (0, early_gate_1.setEarlyGateRuntime)(task, {
                    activeArea: "browser-child",
                    queueEnteredAt: String(queueStatus?.["detectedAt"] ?? new Date().toISOString())
                });
            }
            this.transition(task, models_1.TaskState.WAITING_QUEUE);
            return;
        }
        if (!waiting && task.state === models_1.TaskState.WAITING_QUEUE) {
            const released = queueStatus?.["phase"] === "released";
            if ((0, early_gate_1.isEarlyGateChildTask)(task) && released) {
                (0, early_gate_1.setEarlyGateRuntime)(task, {
                    activeArea: "browser-child",
                    stage: "post-queue-discovery",
                    queueReleasedAt: String(queueStatus?.["releasedAt"] ?? queueStatus?.["updatedAt"] ?? new Date().toISOString()),
                    postQueueDiscoveryAt: String(queueStatus?.["releasedAt"] ?? queueStatus?.["updatedAt"] ?? new Date().toISOString())
                });
                this.transition(task, models_1.TaskState.POST_QUEUE_DISCOVERY);
            }
            else if (!(0, early_gate_1.isEarlyGateChildTask)(task) && queueStatus?.["phase"] !== "timed-out") {
                this.transition(task, models_1.TaskState.RUNNING);
            }
        }
    }
    addWorker(worker) {
        this.workerPool.addWorker(worker);
        this.drainQueue();
    }
    getAvailableWorkers() {
        return this.workerPool.getAvailableWorkers();
    }
    getTask(id) {
        return this.registry.getTask(id);
    }
    getAllTasks() {
        return this.registry.getAllTasks();
    }
    on(event, callback) {
        return this.eventBus.on(event, callback);
    }
    cleanup() {
        this.pendingTaskIds.length = 0;
        this.pendingTaskIdSet.clear();
        this.pausedRunningTaskIds.clear();
        this.unsubscribeExecutorUpdates?.();
        this.retryScheduler.cleanup();
        this.cancellationManager.cleanup();
        for (const worker of this.workerPool.getAllWorkers())
            worker.stop();
    }
    handleRuntimeTaskUpdate(task) {
        const current = this.registry.getTask(task.id);
        if (!current)
            return;
        const before = current.state;
        const queueStatus = current.config.data?.["queueStatus"];
        const waiting = Boolean(queueStatus?.["active"]);
        this.setTaskQueueWaiting(current.id, waiting);
        if (!waiting)
            this.applyEarlyGateFlowState(current);
        if (current.state === before) {
            current.updatedAt = new Date();
            this.eventBus.emit("taskUpdated", current);
        }
    }
    applyEarlyGateFlowState(task) {
        if (!(0, early_gate_1.isEarlyGateChildTask)(task))
            return;
        const flow = task.config.data?.["earlyGateFlow"];
        const stage = String(flow?.["stage"] ?? "");
        const desired = stage === "post-queue-discovery" ? models_1.TaskState.POST_QUEUE_DISCOVERY :
            stage === "product-found" ? models_1.TaskState.PRODUCT_FOUND :
                stage === "cart" ? models_1.TaskState.CART :
                    stage === "checkout" ? models_1.TaskState.CHECKOUT :
                        undefined;
        if (!desired || task.state === desired)
            return;
        if (this.stateMachine.canTransition(task.state, desired)) {
            this.transition(task, desired);
        }
    }
    completeSuccessfulTask(task) {
        if (task.state === models_1.TaskState.CHECKOUT) {
            this.transition(task, models_1.TaskState.SUCCESS);
            return;
        }
        if (this.stateMachine.canTransition(task.state, models_1.TaskState.CHECKOUT)) {
            this.transition(task, models_1.TaskState.CHECKOUT);
            this.transition(task, models_1.TaskState.SUCCESS);
            return;
        }
        if (this.stateMachine.canTransition(task.state, models_1.TaskState.SUCCESS)) {
            this.transition(task, models_1.TaskState.SUCCESS);
            return;
        }
        throw new Error(`Task ${task.id} kann aus ${task.state} nicht erfolgreich abgeschlossen werden.`);
    }
    enqueueTask(taskId) {
        if (this.pendingTaskIdSet.has(taskId))
            return;
        this.pendingTaskIdSet.add(taskId);
        this.pendingTaskIds.push(taskId);
    }
    removePendingTask(taskId) {
        if (!this.pendingTaskIdSet.delete(taskId))
            return;
        const index = this.pendingTaskIds.indexOf(taskId);
        if (index >= 0)
            this.pendingTaskIds.splice(index, 1);
    }
    drainQueue() {
        // Inspect each task that was pending when this drain started at most once.
        // A resumed task may still own its previous worker while that executor is
        // unwinding; keep it queued until releaseWorker() triggers the next drain.
        const candidates = this.pendingTaskIds.length;
        for (let inspected = 0; inspected < candidates && this.workerPool.getAvailableWorkers() > 0 && this.pendingTaskIds.length > 0; inspected += 1) {
            const taskId = this.pendingTaskIds.shift();
            if (!taskId)
                return;
            this.pendingTaskIdSet.delete(taskId);
            const task = this.registry.getTask(taskId);
            if (!task || task.state !== models_1.TaskState.QUEUED)
                continue;
            if (this.workerPool.hasAssignment(taskId)) {
                this.enqueueTask(taskId);
                continue;
            }
            void this.startTask(taskId).catch(error => {
                task.lastError = error instanceof Error ? error.message : String(error);
            });
        }
    }
    isRunningLike(state) {
        return [
            models_1.TaskState.STARTING,
            models_1.TaskState.RUNNING,
            models_1.TaskState.WAITING_QUEUE,
            models_1.TaskState.POST_QUEUE_DISCOVERY,
            models_1.TaskState.PRODUCT_FOUND,
            models_1.TaskState.CART,
            models_1.TaskState.CHECKOUT
        ].includes(state);
    }
    isRecoverableActiveState(state) {
        return this.isRunningLike(state) || state === models_1.TaskState.RETRYING;
    }
    transition(task, newState) {
        if (!this.stateMachine.canTransition(task.state, newState)) {
            throw new Error(`Invalid transition: ${task.state} -> ${newState}`);
        }
        const previousState = task.state;
        task.state = newState;
        task.updatedAt = new Date();
        this.eventBus.emit("taskStateChanged", {
            task,
            previousState,
            newState
        });
        const event = newState === models_1.TaskState.QUEUED ? "taskQueued" :
            newState === models_1.TaskState.SUCCESS ? "taskCompleted" :
                newState === models_1.TaskState.CANCELLED ? "taskCancelled" :
                    newState === models_1.TaskState.PAUSED ? "taskPaused" :
                        "taskUpdated";
        this.eventBus.emit(event, task);
    }
}
exports.TaskOrchestrator = TaskOrchestrator;
//# sourceMappingURL=index.js.map