"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeJsonHttpClient = void 0;
const tslib_1 = require("tslib");
const http = tslib_1.__importStar(require("http"));
const https = tslib_1.__importStar(require("https"));
function assertHttpTarget(value, base) {
    const target = base ? new URL(value, base) : new URL(value);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error(`Unsupported HTTP protocol: ${target.protocol}`);
    }
    return target;
}
class NodeJsonHttpClient {
    constructor(timeoutMs = 12000, userAgent = "ARES-Product-Monitor/1.0", maxRedirects = 5) {
        this.timeoutMs = timeoutMs;
        this.userAgent = userAgent;
        this.maxRedirects = maxRedirects;
    }
    get(url, headers = {}) {
        return this.getWithRedirects(url, headers, 0);
    }
    getWithRedirects(url, headers, redirectCount) {
        return new Promise((resolve, reject) => {
            let target;
            try {
                target = assertHttpTarget(url);
            }
            catch (error) {
                reject(error);
                return;
            }
            const transport = target.protocol === "http:" ? http : https;
            const request = transport.request(target, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    "User-Agent": this.userAgent,
                    ...headers
                }
            }, response => {
                const status = response.statusCode ?? 0;
                const location = response.headers.location;
                const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
                if (isRedirect && location) {
                    response.resume();
                    if (redirectCount >= this.maxRedirects) {
                        reject(new Error(`Too many HTTP redirects while requesting ${url}`));
                        return;
                    }
                    let nextUrl;
                    try {
                        nextUrl = assertHttpTarget(location, target).toString();
                    }
                    catch (error) {
                        reject(error instanceof Error ? error : new Error(String(error)));
                        return;
                    }
                    resolve(this.getWithRedirects(nextUrl, headers, redirectCount + 1));
                    return;
                }
                const chunks = [];
                response.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                response.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    const responseHeaders = {};
                    for (const [key, value] of Object.entries(response.headers)) {
                        if (typeof value === "string")
                            responseHeaders[key] = value;
                        else if (Array.isArray(value))
                            responseHeaders[key] = value.join(", ");
                    }
                    let data;
                    if (text.trim()) {
                        try {
                            data = JSON.parse(text);
                        }
                        catch {
                            data = undefined;
                        }
                    }
                    resolve({
                        status,
                        headers: responseHeaders,
                        data,
                        text: data === undefined ? text.slice(0, 1000) : undefined
                    });
                });
            });
            request.setTimeout(this.timeoutMs, () => {
                request.destroy(new Error(`HTTP timeout after ${this.timeoutMs}ms`));
            });
            request.on("error", reject);
            request.end();
        });
    }
}
exports.NodeJsonHttpClient = NodeJsonHttpClient;
//# sourceMappingURL=http-json-client.js.map