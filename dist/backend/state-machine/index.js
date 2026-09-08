"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateMachine = void 0;
const models_1 = require("../models");
class StateMachine {
    constructor() {
        this.transitions = new Map([
            [models_1.TaskState.CREATED, new Set([models_1.TaskState.QUEUED])],
            [models_1.TaskState.QUEUED, new Set([models_1.TaskState.STARTING, models_1.TaskState.CANCELLED, models_1.TaskState.PAUSED])],
            [models_1.TaskState.STARTING, new Set([models_1.TaskState.RUNNING, models_1.TaskState.FAILED, models_1.TaskState.CANCELLED, models_1.TaskState.PAUSED])],
            [models_1.TaskState.RUNNING, new Set([
                    models_1.TaskState.WAITING_QUEUE,
                    models_1.TaskState.POST_QUEUE_DISCOVERY,
                    models_1.TaskState.PRODUCT_FOUND,
                    models_1.TaskState.CART,
                    models_1.TaskState.CHECKOUT,
                    models_1.TaskState.SUCCESS,
                    models_1.TaskState.FAILED,
                    models_1.TaskState.CANCELLED,
                    models_1.TaskState.PAUSED
                ])],
            [models_1.TaskState.WAITING_QUEUE, new Set([
                    models_1.TaskState.RUNNING,
                    models_1.TaskState.POST_QUEUE_DISCOVERY,
                    models_1.TaskState.FAILED,
                    models_1.TaskState.CANCELLED,
                    models_1.TaskState.PAUSED
                ])],
            [models_1.TaskState.POST_QUEUE_DISCOVERY, new Set([
                    models_1.TaskState.PRODUCT_FOUND,
                    models_1.TaskState.FAILED,
                    models_1.TaskState.CANCELLED,
                    models_1.TaskState.PAUSED
                ])],
            [models_1.TaskState.PAUSED, new Set([models_1.TaskState.QUEUED, models_1.TaskState.CANCELLED])],
            [models_1.TaskState.PRODUCT_FOUND, new Set([models_1.TaskState.CART, models_1.TaskState.FAILED, models_1.TaskState.CANCELLED, models_1.TaskState.PAUSED])],
            [models_1.TaskState.CART, new Set([models_1.TaskState.CHECKOUT, models_1.TaskState.FAILED, models_1.TaskState.CANCELLED, models_1.TaskState.PAUSED])],
            [models_1.TaskState.CHECKOUT, new Set([
                    models_1.TaskState.SUCCESS,
                    models_1.TaskState.RETRYING,
                    models_1.TaskState.FAILED,
                    models_1.TaskState.CANCELLED,
                    models_1.TaskState.PAUSED
                ])],
            [models_1.TaskState.RETRYING, new Set([models_1.TaskState.QUEUED, models_1.TaskState.RUNNING, models_1.TaskState.PAUSED])],
            [models_1.TaskState.SUCCESS, new Set()],
            [models_1.TaskState.FAILED, new Set([models_1.TaskState.RETRYING])],
            [models_1.TaskState.CANCELLED, new Set()]
        ]);
    }
    canTransition(from, to) {
        return this.transitions.get(from)?.has(to) ?? false;
    }
    getAllowedTransitions(from) {
        return [...(this.transitions.get(from) ?? [])];
    }
}
exports.StateMachine = StateMachine;
//# sourceMappingURL=index.js.map