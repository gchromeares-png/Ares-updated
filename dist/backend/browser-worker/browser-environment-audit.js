"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectBrowserEnvironment = exports.failedBrowserEnvironmentAudit = exports.classifyBrowserEnvironment = void 0;
const SOFTWARE_RENDERER_TOKENS = [
    "swiftshader",
    "llvmpipe",
    "softpipe",
    "software rasterizer",
    "software renderer"
];
function osFromUserAgent(userAgent) {
    const value = userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(value))
        return "ios";
    if (value.includes("android"))
        return "android";
    if (value.includes("windows"))
        return "windows";
    if (/macintosh|mac os x/.test(value))
        return "macos";
    if (/linux|x11/.test(value))
        return "linux";
    return "unknown";
}
function osFromPlatform(platform) {
    const value = platform.toLowerCase();
    if (/iphone|ipad|ipod/.test(value))
        return "ios";
    if (value.includes("win"))
        return "windows";
    if (value.includes("mac"))
        return "macos";
    if (/linux|x11|android/.test(value))
        return "linux";
    return "unknown";
}
function osFamiliesCompatible(userAgentOs, platformOs) {
    if (userAgentOs === "unknown" || platformOs === "unknown")
        return true;
    if (userAgentOs === platformOs)
        return true;
    if (userAgentOs === "android" && platformOs === "linux")
        return true;
    if (userAgentOs === "ios" && platformOs === "macos")
        return true;
    return false;
}
function classifyBrowserEnvironment(snapshot, checkedAt = new Date().toISOString()) {
    const issues = [];
    const userAgentOs = osFromUserAgent(snapshot.userAgent);
    const platformOs = osFromPlatform(snapshot.platform);
    const renderer = snapshot.webglRenderer.toLowerCase();
    if (!osFamiliesCompatible(userAgentOs, platformOs)) {
        issues.push({
            code: "ua-platform-mismatch",
            message: `User-Agent (${userAgentOs}) und navigator.platform (${platformOs}) passen nicht zusammen.`
        });
    }
    if (!snapshot.webglRenderer) {
        issues.push({
            code: "webgl-unavailable",
            message: "Kein WebGL-Renderer konnte gelesen werden."
        });
    }
    else {
        if (SOFTWARE_RENDERER_TOKENS.some(token => renderer.includes(token))) {
            issues.push({
                code: "software-renderer",
                message: `WebGL verwendet einen Software-Renderer: ${snapshot.webglRenderer}`
            });
        }
        if (userAgentOs === "windows" && /mesa|llvmpipe|softpipe/.test(renderer)) {
            issues.push({
                code: "windows-mesa-renderer",
                message: `Windows-User-Agent mit Linux/Mesa-artigem WebGL-Renderer: ${snapshot.webglRenderer}`
            });
        }
    }
    return {
        version: 1,
        status: issues.length ? "warning" : "green",
        checkedAt,
        userAgentOs,
        platformOs,
        snapshot,
        issues
    };
}
exports.classifyBrowserEnvironment = classifyBrowserEnvironment;
function failedBrowserEnvironmentAudit(error) {
    return {
        version: 1,
        status: "warning",
        checkedAt: new Date().toISOString(),
        userAgentOs: "unknown",
        platformOs: "unknown",
        snapshot: {
            userAgent: "",
            platform: "",
            language: "",
            languages: [],
            timezone: "",
            hardwareConcurrency: 0,
            deviceMemory: null,
            screen: {
                width: 0,
                height: 0,
                availWidth: 0,
                availHeight: 0,
                colorDepth: 0,
                pixelDepth: 0,
                devicePixelRatio: 0
            },
            webglVendor: "",
            webglRenderer: ""
        },
        issues: [{
                code: "audit-failed",
                message: `Browser-Umgebungsprüfung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`
            }]
    };
}
exports.failedBrowserEnvironmentAudit = failedBrowserEnvironmentAudit;
async function collectBrowserEnvironment(page) {
    const snapshot = await page.evaluate(() => {
        const nav = navigator;
        const canvas = document.createElement("canvas");
        const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl"));
        let webglVendor = "";
        let webglRenderer = "";
        if (gl) {
            const debug = gl.getExtension("WEBGL_debug_renderer_info");
            if (debug) {
                webglVendor = String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) ?? "");
                webglRenderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? "");
            }
            if (!webglVendor)
                webglVendor = String(gl.getParameter(gl.VENDOR) ?? "");
            if (!webglRenderer)
                webglRenderer = String(gl.getParameter(gl.RENDERER) ?? "");
        }
        return {
            userAgent: navigator.userAgent || "",
            platform: navigator.platform || "",
            language: navigator.language || "",
            languages: Array.from(navigator.languages || []),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
            hardwareConcurrency: navigator.hardwareConcurrency || 0,
            deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
            screen: {
                width: screen.width,
                height: screen.height,
                availWidth: screen.availWidth,
                availHeight: screen.availHeight,
                colorDepth: screen.colorDepth,
                pixelDepth: screen.pixelDepth,
                devicePixelRatio: window.devicePixelRatio || 1
            },
            webglVendor,
            webglRenderer
        };
    });
    return classifyBrowserEnvironment(snapshot);
}
exports.collectBrowserEnvironment = collectBrowserEnvironment;
//# sourceMappingURL=browser-environment-audit.js.map