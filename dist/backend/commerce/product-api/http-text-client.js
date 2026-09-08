"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeTextHttpClient = void 0;
const tslib_1 = require("tslib");
const http = tslib_1.__importStar(require("http"));
const https = tslib_1.__importStar(require("https"));
function resolveHttpUrl(value, base) {
    const target = base ? new URL(value, base) : new URL(value);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error(`Unsupported HTTP protocol: ${target.protocol}`);
    }
    return target;
}
class NodeTextHttpClient {
    constructor(timeoutMs = 12000, userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36", maxRedirects = 5, maxBodyBytes = 2 * 1024 * 1024) {
        this.timeoutMs = timeoutMs;
        this.userAgent = userAgent;
        this.maxRedirects = maxRedirects;
        this.maxBodyBytes = maxBodyBytes;
    }
    get(url, headers = {}) {
        return this.getWithRedirects(url, headers, 0);
    }
    getWithRedirects(url, headers, redirectCount) {
        return new Promise((resolve, reject) => {
            let target;
            try {
                target = resolveHttpUrl(url);
            }
            catch (error) {
                reject(error);
                return;
            }
            const transport = target.protocol === "http:" ? http : https;
            const request = transport.request(target, {
                method: "GET",
                headers: {
                    Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
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
                    try {
                        const next = resolveHttpUrl(location, target).toString();
                        resolve(this.getWithRedirects(next, headers, redirectCount + 1));
                    }
                    catch (error) {
                        reject(error instanceof Error ? error : new Error(String(error)));
                    }
                    return;
                }
                const chunks = [];
                let bodyBytes = 0;
                let tooLarge = false;
                response.on("data", chunk => {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    bodyBytes += buffer.length;
                    if (bodyBytes <= this.maxBodyBytes)
                        chunks.push(buffer);
                    else
                        tooLarge = true;
                });
                response.on("end", () => {
                    if (tooLarge) {
                        reject(new Error(`HTTP body exceeded ${this.maxBodyBytes} bytes for ${target.toString()}`));
                        return;
                    }
                    const responseHeaders = {};
                    for (const [key, value] of Object.entries(response.headers)) {
                        if (typeof value === "string")
                            responseHeaders[key] = value;
                        else if (Array.isArray(value))
                            responseHeaders[key] = value.join(", ");
                    }
                    resolve({
                        status,
                        headers: responseHeaders,
                        text: Buffer.concat(chunks).toString("utf8"),
                        url: target.toString()
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
exports.NodeTextHttpClient = NodeTextHttpClient;
//# sourceMappingURL=http-text-client.js.map