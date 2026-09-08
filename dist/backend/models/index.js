"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskState = void 0;
var TaskState;
(function (TaskState) {
    TaskState["CREATED"] = "CREATED";
    TaskState["QUEUED"] = "QUEUED";
    TaskState["STARTING"] = "STARTING";
    TaskState["RUNNING"] = "RUNNING";
    TaskState["WAITING_QUEUE"] = "WAITING_QUEUE";
    TaskState["POST_QUEUE_DISCOVERY"] = "POST_QUEUE_DISCOVERY";
    TaskState["PAUSED"] = "PAUSED";
    TaskState["PRODUCT_FOUND"] = "PRODUCT_FOUND";
    TaskState["CART"] = "CART";
    TaskState["CHECKOUT"] = "CHECKOUT";
    TaskState["SUCCESS"] = "SUCCESS";
    TaskState["FAILED"] = "FAILED";
    TaskState["CANCELLED"] = "CANCELLED";
    TaskState["RETRYING"] = "RETRYING";
})(TaskState = exports.TaskState || (exports.TaskState = {}));
//# sourceMappingURL=index.js.map