"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChallengeType = exports.TaskState = void 0;
var TaskState;
(function (TaskState) {
    TaskState["CREATED"] = "CREATED";
    TaskState["QUEUED"] = "QUEUED";
    TaskState["STARTING"] = "STARTING";
    TaskState["RUNNING"] = "RUNNING";
    TaskState["PAUSED"] = "PAUSED";
    TaskState["PRODUCT_FOUND"] = "PRODUCT_FOUND";
    TaskState["CART"] = "CART";
    TaskState["CHECKOUT"] = "CHECKOUT";
    TaskState["SUCCESS"] = "SUCCESS";
    TaskState["FAILED"] = "FAILED";
    TaskState["CANCELLED"] = "CANCELLED";
    TaskState["RETRYING"] = "RETRYING";
})(TaskState = exports.TaskState || (exports.TaskState = {}));
var ChallengeType;
(function (ChallengeType) {
    ChallengeType["CAPTCHA"] = "CAPTCHA";
    ChallengeType["HONEYPOT"] = "HONEYPOT";
    ChallengeType["RECAPTCHA"] = "RECAPTCHA";
    ChallengeType["DYNAMIC_CONTENT"] = "DYNAMIC_CONTENT";
})(ChallengeType = exports.ChallengeType || (exports.ChallengeType = {}));
//# sourceMappingURL=index.js.map