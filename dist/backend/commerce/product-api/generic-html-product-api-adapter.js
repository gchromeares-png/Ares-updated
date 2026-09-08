"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenericHtmlProductApiAdapter = void 0;
const http_text_client_1 = require("./http-text-client");
const POSITIVE_AVAILABILITY = [
    "add to cart",
    "add to bag",
    "buy now",
    "in stock",
    "available now",
    "auf lager",
    "lieferbar",
    "in den warenkorb",
    "jetzt kaufen"
];
const NEGATIVE_AVAILABILITY = [
    "out of stock",
    "sold out",
    "currently unavailable",
    "unavailable",
    "ausverkauft",
    "nicht verfügbar",
    "nicht verfugbar",
    "nicht lieferbar",
    "derzeit nicht erhältlich",
    "derzeit nicht erhaltlich"
];
function decodeEntities(value) {
    const named = {
        amp: "&",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: " "
    };
    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
        if (code[0] === "#") {
            const hex = code[1]?.toLowerCase() === "x";
            const parsed = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
            return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
        }
        return named[code.toLowerCase()] ?? match;
    });
}
function normalize(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9äöüß]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function queryTokens(query) {
    return [...new Set(normalize(query.searchTerm).split(" ").filter(token => token.length >= 2))];
}
function queryUrl(query) {
    const explicit = String(query.url ?? "").trim();
    if (/^https?:\/\//i.test(explicit))
        return explicit;
    const search = String(query.searchTerm ?? "").trim();
    return /^https?:\/\//i.test(search) ? search : undefined;
}
function stripHtml(html) {
    return decodeEntities(html
        .replace(/<!--([\s\S]*?)-->/g, " ")
        .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p\s*>/gi, " ")
        .replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}
function extractTitle(html) {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return stripHtml(match?.[1] ?? "").slice(0, 240);
}
function tokenCoverage(text, requested) {
    if (!requested.length)
        return 1;
    const normalized = normalize(text);
    let matched = 0;
    for (const token of requested)
        if (normalized.includes(token))
            matched += 1;
    return matched / requested.length;
}
function matchingContext(text, requested) {
    if (!requested.length)
        return text.slice(0, 12000);
    const lower = normalize(text);
    const windows = [];
    for (const token of requested) {
        let from = 0;
        for (let hit = 0; hit < 3; hit++) {
            const index = lower.indexOf(token, from);
            if (index < 0)
                break;
            const start = Math.max(0, index - 700);
            const end = Math.min(text.length, index + token.length + 700);
            windows.push(text.slice(start, end));
            from = index + token.length;
        }
    }
    return [...new Set(windows)].join(" … ").slice(0, 16000) || text.slice(0, 12000);
}
function availabilityFrom(html, context) {
    const raw = html.toLowerCase();
    if (/schema\.org\/(outofstock|soldout|discontinued)/i.test(raw)) {
        return { available: false, signal: "schema-out-of-stock" };
    }
    if (/schema\.org\/(instock|preorder|presale|onlineonly|limitedavailability)/i.test(raw)) {
        return { available: true, signal: "schema-in-stock" };
    }
    const local = normalize(context);
    const negative = NEGATIVE_AVAILABILITY.find(value => local.includes(normalize(value)));
    if (negative)
        return { available: false, signal: `negative:${negative}` };
    const positive = POSITIVE_AVAILABILITY.find(value => local.includes(normalize(value)));
    if (positive)
        return { available: true, signal: `positive:${positive}` };
    return { available: false, signal: "unknown" };
}
function configuredMonitorUrls(shop) {
    const raw = shop.config?.["monitorUrls"];
    if (!Array.isArray(raw))
        return [];
    return raw.map(value => String(value ?? "").trim()).filter(Boolean).slice(0, 20);
}
function likelyProductLinks(html, baseUrl, requested, maxLinks) {
    if (!requested.length || maxLinks <= 0)
        return [];
    let base;
    try {
        base = new URL(baseUrl);
    }
    catch {
        return [];
    }
    const candidates = [];
    const seen = new Set();
    const anchorPattern = /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorPattern.exec(html))) {
        const href = decodeEntities(match[1] || match[2] || match[3] || "").trim();
        if (!href || href.startsWith("#") || /^javascript:/i.test(href) || /^mailto:/i.test(href))
            continue;
        let target;
        try {
            target = new URL(href, base);
        }
        catch {
            continue;
        }
        if ((target.protocol !== "http:" && target.protocol !== "https:") || target.origin !== base.origin)
            continue;
        target.hash = "";
        const url = target.toString();
        if (seen.has(url) || url === base.toString())
            continue;
        const anchorText = stripHtml(match[4] || "");
        const score = Math.max(tokenCoverage(anchorText, requested), tokenCoverage(target.pathname, requested));
        if (score < 0.5)
            continue;
        seen.add(url);
        candidates.push({ url, score });
    }
    return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, maxLinks)
        .map(candidate => candidate.url);
}
class GenericHtmlProductApiAdapter {
    constructor(http = new http_text_client_1.NodeTextHttpClient()) {
        this.http = http;
    }
    async probe(shop) {
        try {
            const response = await this.http.get(shop.baseUrl);
            const readable = response.status >= 200 && response.status < 400;
            return {
                platform: shop.platform,
                endpoint: response.url,
                reachable: response.status > 0,
                status: response.status,
                publicReadable: readable,
                reason: readable ? "Public storefront HTML is readable." : `Storefront returned HTTP ${response.status}.`
            };
        }
        catch (error) {
            return {
                platform: shop.platform,
                endpoint: shop.baseUrl,
                reachable: false,
                publicReadable: false,
                reason: error instanceof Error ? error.message : String(error)
            };
        }
    }
    async search(shop, query, limit = 50) {
        const directUrl = queryUrl(query);
        const requested = directUrl ? [] : queryTokens(query);
        const maxDocuments = Math.max(1, Math.min(20, limit));
        const initialTargets = directUrl
            ? [directUrl]
            : [...configuredMonitorUrls(shop), shop.baseUrl];
        const uniqueTargets = [...new Set(initialTargets.map(value => String(value).trim()).filter(Boolean))];
        const documents = [];
        for (const target of uniqueTargets.slice(0, maxDocuments)) {
            const document = await this.fetchDocument(target, documents.length === 0);
            if (document)
                documents.push(document);
        }
        if (!directUrl && requested.length && documents.length < maxDocuments) {
            const links = documents.flatMap(document => likelyProductLinks(document.response.text, document.response.url, requested, maxDocuments - documents.length));
            const already = new Set(documents.map(document => document.response.url));
            for (const link of [...new Set(links)]) {
                if (documents.length >= maxDocuments || already.has(link))
                    continue;
                const document = await this.fetchDocument(link, false);
                if (!document)
                    continue;
                already.add(document.response.url);
                documents.push(document);
            }
        }
        return documents
            .filter(document => !requested.length || tokenCoverage(`${document.title} ${document.text} ${document.response.url}`, requested) >= 0.5)
            .map(document => this.toObservation(shop, query, requested, document));
    }
    async fetchDocument(url, required) {
        try {
            const response = await this.http.get(url);
            if (response.status < 200 || response.status >= 400) {
                if (required)
                    throw new Error(`Storefront returned HTTP ${response.status} for ${response.url}`);
                return undefined;
            }
            return {
                response,
                title: extractTitle(response.text),
                text: stripHtml(response.text)
            };
        }
        catch (error) {
            if (required)
                throw error;
            return undefined;
        }
    }
    toObservation(shop, query, requested, document) {
        const context = matchingContext(document.text, requested);
        const availability = availabilityFrom(document.response.text, context);
        return {
            shopId: shop.id,
            platform: shop.platform,
            externalId: document.response.url,
            title: document.title || query.searchTerm || shop.name,
            url: document.response.url,
            available: availability.available,
            attributes: {
                source: "generic-html",
                availabilitySignal: availability.signal,
                pageText: context
            },
            observedAt: new Date()
        };
    }
}
exports.GenericHtmlProductApiAdapter = GenericHtmlProductApiAdapter;
//# sourceMappingURL=generic-html-product-api-adapter.js.map