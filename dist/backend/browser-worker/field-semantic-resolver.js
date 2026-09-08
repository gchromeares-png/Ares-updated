"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fieldLocator = exports.collectFieldDescriptors = exports.FieldSemanticResolver = exports.OllamaEmbeddingProvider = void 0;
const tslib_1 = require("tslib");
const http = tslib_1.__importStar(require("http"));
const https = tslib_1.__importStar(require("https"));
const semantic_target_1 = require("./semantic-target");
const CONTROL_SELECTOR = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="password"])',
    "select",
    "textarea"
].join(", ");
const INTENT_PROTOTYPES = [
    { intent: "email", text: "contact email address, E-Mail-Adresse für Kontakt und Bestellbestätigung" },
    { intent: "firstName", text: "person's given name, first name, Vorname oder Rufname" },
    { intent: "lastName", text: "person's family name, surname, last name, Nachname oder Familienname" },
    { intent: "fullName", text: "complete person's name, full name, vollständiger Name, Name des Empfängers" },
    { intent: "street", text: "street name without house number, Straße ohne Hausnummer" },
    { intent: "address1", text: "primary address line, combined street and house number, Straße und Hausnummer, Anschrift" },
    { intent: "houseNumber", text: "house number, street number, Hausnummer" },
    { intent: "address2", text: "secondary address line, apartment, company, Zusatz zur Anschrift, Adresszusatz" },
    { intent: "city", text: "city, town or locality, Ort, Stadt oder Gemeinde" },
    { intent: "postalCode", text: "postal code, ZIP code, Postleitzahl" },
    { intent: "phone", text: "contact phone or mobile number, Telefonnummer oder Mobilnummer" },
    { intent: "countryCode", text: "country or country code, Land oder Ländercode" }
];
const CONTEXT_PROTOTYPES = [
    { context: "shipping", text: "shipping delivery recipient destination address, Lieferanschrift, Versandadresse, Zustelladresse, Empfänger" },
    { context: "billing", text: "billing invoice address, Rechnungsanschrift, Rechnungsadresse, Rechnungsempfänger" }
];
const AUTOCOMPLETE_INTENTS = {
    "email": "email",
    "name": "fullName",
    "given-name": "firstName",
    "family-name": "lastName",
    "street-address": "address1",
    "address-line1": "address1",
    "address-line2": "address2",
    "address-level2": "city",
    "postal-code": "postalCode",
    "tel": "phone",
    "country": "countryCode",
    "country-name": "countryCode"
};
function normalize(value) {
    return value.replace(/\s+/g, " ").trim();
}
function normalizeLower(value) {
    return normalize(value).toLocaleLowerCase("de-DE");
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function cosine(a, b) {
    const length = Math.min(a.length, b.length);
    if (!length)
        return -1;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let index = 0; index < length; index++) {
        const left = a[index] ?? 0;
        const right = b[index] ?? 0;
        dot += left * right;
        normA += left * left;
        normB += right * right;
    }
    if (normA === 0 || normB === 0)
        return -1;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
function postJson(endpoint, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            target = new URL(endpoint);
        }
        catch {
            reject(new Error("Invalid local embedding endpoint."));
            return;
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
            reject(new Error(`Unsupported local embedding protocol: ${target.protocol}`));
            return;
        }
        const body = JSON.stringify(payload);
        const client = target.protocol === "https:" ? https : http;
        let settled = false;
        let hardTimeout;
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(hardTimeout);
            callback();
        };
        const request = client.request(target, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body)
            }
        }, response => {
            let responseBody = "";
            response.setEncoding("utf8");
            response.on("data", chunk => { responseBody += chunk; });
            response.on("end", () => {
                const status = response.statusCode ?? 0;
                if (status < 200 || status >= 300) {
                    finish(() => reject(new Error(`Ollama embed HTTP ${status}`)));
                    return;
                }
                try {
                    const parsed = JSON.parse(responseBody);
                    finish(() => resolve(parsed));
                }
                catch {
                    finish(() => reject(new Error("Local embedding response was not valid JSON.")));
                }
            });
        });
        request.on("error", error => finish(() => reject(error)));
        hardTimeout = setTimeout(() => {
            request.destroy(new Error("Local embedding request timed out."));
        }, Math.max(200, timeoutMs));
        request.write(body);
        request.end();
    });
}
/** @deprecated Checkout runtime must not depend on Ollama. Kept temporarily for explicit test-only injection. */
class OllamaEmbeddingProvider {
    constructor(endpoint = process.env["ARES_FIELD_EMBED_ENDPOINT"]?.trim() || "http://127.0.0.1:11434/api/embed", model = process.env["ARES_FIELD_EMBED_MODEL"]?.trim() || "embeddinggemma:300m-qat-q4_0", timeoutMs = Number(process.env["ARES_FIELD_EMBED_TIMEOUT_MS"] || 1200)) {
        this.endpoint = endpoint;
        this.model = model;
        this.timeoutMs = timeoutMs;
        this.disabledUntil = 0;
    }
    async embed(texts) {
        if (!texts.length)
            return [];
        if (Date.now() < this.disabledUntil) {
            throw new Error("Local semantic embedding runtime is temporarily unavailable.");
        }
        try {
            const payload = await postJson(this.endpoint, {
                model: this.model,
                input: texts
            }, this.timeoutMs);
            if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== texts.length) {
                throw new Error("Ollama embed response did not contain the expected embedding batch.");
            }
            return payload.embeddings;
        }
        catch (error) {
            this.disabledUntil = Date.now() + 30000;
            throw error;
        }
    }
}
exports.OllamaEmbeddingProvider = OllamaEmbeddingProvider;
class FieldSemanticResolver {
    constructor(provider) {
        this.cache = new Map();
        // The production checkout path used to inject Ollama explicitly. Keep that
        // legacy construction source-compatible while disabling it at runtime.
        this.provider = provider instanceof OllamaEmbeddingProvider ? undefined : provider;
    }
    async resolve(fields) {
        const results = new Array(fields.length);
        const pending = [];
        fields.forEach((field, position) => {
            const key = this.cacheKey(field);
            const cached = this.cache.get(key);
            if (cached) {
                results[position] = { descriptor: field, ...cached };
                return;
            }
            const standardIntent = this.resolveIntentFromStandardMetadata(field);
            const standardContext = this.resolveContextFromAutocomplete(field);
            const lexicalIntent = standardIntent ?? this.resolveIntentLexically(field);
            const lexicalContext = standardContext ?? this.resolveContextLexically(field);
            const lockIntentUnknown = !standardIntent && !lexicalIntent && this.isBareName(field);
            const intent = lexicalIntent ?? { value: "unknown", confidence: 0, source: "unknown" };
            const context = lexicalContext ?? { value: "unknown", confidence: 0, source: "unknown" };
            // Intent is the required dimension for checkout value mapping. An unknown
            // shipping/billing context is valid and maps to the profile's default
            // address, so it must never trigger an embedding/LLM call by itself.
            if (intent.value !== "unknown") {
                const resolution = this.toResolution(intent, context);
                this.cache.set(key, resolution);
                results[position] = { descriptor: field, ...resolution };
                return;
            }
            pending.push({ field, position, key, intent, context, lockIntentUnknown });
        });
        if (pending.length && this.provider) {
            try {
                await this.resolveByEmbedding(pending, results);
            }
            catch {
                // Fall through to deterministic unknown resolution below.
            }
        }
        for (const item of pending) {
            if (results[item.position])
                continue;
            const resolution = this.toResolution(item.intent, item.context);
            this.cache.set(item.key, resolution);
            results[item.position] = { descriptor: item.field, ...resolution };
        }
        return results.map((result, index) => result ?? {
            descriptor: fields[index],
            ...this.toResolution({ value: "unknown", confidence: 0, source: "unknown" }, { value: "unknown", confidence: 0, source: "unknown" })
        });
    }
    resolveIntentFromStandardMetadata(field) {
        const tokens = field.autocomplete.toLowerCase().split(/\s+/).filter(Boolean);
        for (const token of tokens) {
            const intent = AUTOCOMPLETE_INTENTS[token];
            if (intent)
                return { value: intent, confidence: 1, source: "standard-metadata" };
        }
        if (field.inputType.toLowerCase() === "email") {
            return { value: "email", confidence: 0.99, source: "standard-metadata" };
        }
        if (field.inputType.toLowerCase() === "tel") {
            return { value: "phone", confidence: 0.99, source: "standard-metadata" };
        }
        return undefined;
    }
    resolveContextFromAutocomplete(field) {
        const tokens = new Set(field.autocomplete.toLowerCase().split(/\s+/).filter(Boolean));
        const shipping = tokens.has("shipping");
        const billing = tokens.has("billing");
        if (shipping === billing)
            return undefined;
        return {
            value: shipping ? "shipping" : "billing",
            confidence: 1,
            source: "standard-metadata"
        };
    }
    resolveIntentLexically(field) {
        const text = this.directText(field);
        const match = (pattern, value, confidence = 0.96) => pattern.test(text) ? { value, confidence, source: "lexical" } : undefined;
        const combinedAddress = match(/\b(?:stra(?:ß|ss)e|street)\s*(?:und|and|&|\/|\+)\s*(?:haus(?:\s*nummer|\s*-\s*nr\.?|\s*nr\.?)|hausnr\.?|(?:house\s*)?number|nr\.?)/i, "address1", 0.98);
        if (combinedAddress)
            return combinedAddress;
        return match(/\b(e-?mail|emailadresse|mailadresse)\b/i, "email")
            ?? match(/\b(vorname|rufname|given[ _-]?name|first[ _-]?name)\b/i, "firstName")
            ?? match(/\b(nachname|familienname|surname|family[ _-]?name|last[ _-]?name)\b/i, "lastName")
            ?? match(/\b(vollst[aä]ndiger? name|full[ _-]?name|recipient[ _-]?name|name des empf[aä]ngers|empf[aä]ngername)\b/i, "fullName", 0.94)
            ?? match(/\b(street(?:[ _-]+(?:delivery|shipping|billing))?[ _-]+address|delivery[ _-]+street[ _-]+address|street[ _-]?address|anschrift|address[ _-]?line[ _-]?1)\b/i, "address1", 0.95)
            ?? match(/\b(haus(?:\s*nummer|\s*-\s*nr\.?|\s*nr\.?)|hausnr\.?|house[ _-]?number|street[ _-]?number)/i, "houseNumber")
            ?? (this.hasStrongBareNumberContext(field) && /\bnr\.?\b/i.test(text)
                ? { value: "houseNumber", confidence: 0.9, source: "lexical" }
                : undefined)
            ?? match(/\b(adresszusatz|address[ _-]?line[ _-]?2|address2|apartment|wohnung|zusatz zur anschrift|company)\b/i, "address2", 0.94)
            ?? match(/\b(postleitzahl|plz|postal[ _-]?code|zip(?:[ _-]?code)?|zustellcode|postgebiet)\b/i, "postalCode")
            ?? match(/\b(stadt|wohnort|lieferort|gemeinde|city|town|locality)\b/i, "city")
            ?? match(/\b(land|l[aä]ndercode|country(?:[ _-]?code|[ _-]?name)?)\b/i, "countryCode", 0.94)
            ?? match(/\b(telefon(?:nummer)?|mobil(?:nummer)?|rufnummer|phone|mobile|tel)\b/i, "phone")
            ?? match(/\b(stra(?:ß|ss)e|street|road|avenue)\b/i, "street", 0.92);
    }
    hasStrongBareNumberContext(field) {
        const metadata = normalizeLower([
            field.name,
            field.id,
            field.autocomplete,
            field.placeholder,
            field.ariaLabel
        ].filter(Boolean).join(" ")).replace(/[^a-z0-9äöüß]+/gi, " ");
        if (/\b(?:house|street)\s*(?:number|no|nr)\b|\bhaus\s*(?:nummer|nr)\b/i.test(metadata))
            return true;
        const nearby = normalizeLower(field.nearbyText).replace(/[^a-z0-9äöüß]+/gi, " ");
        return /\b(?:haus\s*(?:nummer|nr)|house\s*number|street\s*number)\b/i.test(nearby);
    }
    resolveContextLexically(field) {
        const direct = this.contextFromText(this.directText(field), 0.97);
        if (direct)
            return direct;
        return this.contextFromText(normalizeLower(field.nearbyText), 0.86);
    }
    contextFromText(text, confidence) {
        if (!text)
            return undefined;
        const shipping = /\b(shipping|delivery|deliver\w*|liefer\w*|versand\w*|zustell\w*|empf[aä]nger\w*)\b/i.test(text);
        const billing = /\b(billing|invoice\w*|rechnung\w*|faktur\w*)\b/i.test(text);
        if (shipping === billing)
            return undefined;
        return { value: shipping ? "shipping" : "billing", confidence, source: "lexical" };
    }
    isBareName(field) {
        if (field.autocomplete.trim())
            return false;
        const direct = this.directText(field)
            .replace(/\b(shipping|billing|liefer\w*|rechnung\w*|versand\w*|zustell\w*)\b/gi, " ")
            .replace(/[^a-zA-ZäöüÄÖÜß]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        return /^(name|ihr name|your name)$/i.test(direct);
    }
    async resolveByEmbedding(pending, results) {
        const provider = this.provider;
        if (!provider)
            return;
        const fieldTexts = pending.map(item => this.toSemanticText(item.field));
        let fieldVectors;
        if (!this.intentPrototypeVectors || !this.contextPrototypeVectors) {
            const intentTexts = INTENT_PROTOTYPES.map(item => item.text);
            const contextTexts = CONTEXT_PROTOTYPES.map(item => item.text);
            const allVectors = await provider.embed([...intentTexts, ...contextTexts, ...fieldTexts]);
            this.intentPrototypeVectors = INTENT_PROTOTYPES.map((item, index) => ({
                intent: item.intent,
                vector: allVectors[index] ?? []
            }));
            const contextOffset = intentTexts.length;
            this.contextPrototypeVectors = CONTEXT_PROTOTYPES.map((item, index) => ({
                context: item.context,
                vector: allVectors[contextOffset + index] ?? []
            }));
            fieldVectors = allVectors.slice(intentTexts.length + contextTexts.length);
        }
        else {
            fieldVectors = await provider.embed(fieldTexts);
        }
        pending.forEach((item, pendingIndex) => {
            const vector = fieldVectors[pendingIndex] ?? [];
            let intent = item.intent;
            let context = item.context;
            if (intent.value === "unknown" && !item.lockIntentUnknown) {
                const inferred = this.rankIntent(vector);
                if (inferred)
                    intent = inferred;
            }
            if (context.value === "unknown") {
                const inferred = this.rankContext(vector);
                if (inferred)
                    context = inferred;
            }
            const resolution = this.toResolution(intent, context);
            this.cache.set(item.key, resolution);
            results[item.position] = { descriptor: item.field, ...resolution };
        });
    }
    rankIntent(vector) {
        const ranking = (this.intentPrototypeVectors ?? [])
            .map(prototype => ({ value: prototype.intent, score: cosine(vector, prototype.vector) }))
            .sort((left, right) => right.score - left.score);
        const best = ranking[0];
        const second = ranking[1];
        const margin = best ? best.score - (second?.score ?? -1) : 0;
        if (!best || best.score < 0.38 || margin < 0.02)
            return undefined;
        return {
            value: best.value,
            confidence: clamp(0.5 + Math.max(0, best.score - 0.38) * 0.65 + margin * 2.2, 0.5, 0.98),
            source: "embedding"
        };
    }
    rankContext(vector) {
        const ranking = (this.contextPrototypeVectors ?? [])
            .map(prototype => ({ value: prototype.context, score: cosine(vector, prototype.vector) }))
            .sort((left, right) => right.score - left.score);
        const best = ranking[0];
        const second = ranking[1];
        const margin = best ? best.score - (second?.score ?? -1) : 0;
        if (!best || best.score < 0.48 || margin < 0.06)
            return undefined;
        return {
            value: best.value,
            confidence: clamp(0.55 + Math.max(0, best.score - 0.48) * 0.55 + margin * 1.8, 0.55, 0.97),
            source: "embedding"
        };
    }
    toResolution(intent, context) {
        return {
            target: (0, semantic_target_1.semanticTarget)(intent.value, context.value),
            confidence: intent.confidence,
            intentConfidence: intent.confidence,
            contextConfidence: context.confidence,
            source: {
                intent: intent.source,
                context: context.source
            }
        };
    }
    directText(field) {
        return normalizeLower([
            field.label,
            field.ariaLabel,
            field.placeholder,
            field.name,
            field.id,
            field.autocomplete
        ].filter(Boolean).join(" | ")).replace(/_/g, " ");
    }
    toSemanticText(field) {
        return [
            `form control type: ${field.tagName} ${field.inputType}`,
            `label: ${field.label}`,
            `aria label: ${field.ariaLabel}`,
            `placeholder: ${field.placeholder}`,
            `name: ${field.name}`,
            `id: ${field.id}`,
            `autocomplete: ${field.autocomplete}`,
            `surrounding form text: ${field.nearbyText}`
        ].map(normalize).filter(Boolean).join(" | ");
    }
    cacheKey(field) {
        return this.toSemanticText(field).toLowerCase();
    }
}
exports.FieldSemanticResolver = FieldSemanticResolver;
async function collectFieldDescriptors(page) {
    return page.locator(CONTROL_SELECTOR).evaluateAll(elements => elements.map((raw, index) => {
        const element = raw;
        const labels = "labels" in element && element.labels
            ? Array.from(element.labels).map(label => label.textContent || "").join(" ")
            : "";
        const labelledBy = element.getAttribute("aria-labelledby") || "";
        const ariaText = labelledBy.split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.textContent || "").join(" ");
        const closestLabel = element.closest("label")?.textContent || "";
        const parentText = element.parentElement?.innerText || "";
        return {
            index,
            tagName: element.tagName.toLowerCase(),
            inputType: element instanceof HTMLInputElement ? (element.type || "text") : element.tagName.toLowerCase(),
            name: element.getAttribute("name") || "",
            id: element.id || "",
            autocomplete: element.getAttribute("autocomplete") || "",
            placeholder: element.getAttribute("placeholder") || "",
            ariaLabel: [element.getAttribute("aria-label") || "", ariaText].join(" ").trim(),
            label: [labels, closestLabel].join(" ").trim(),
            nearbyText: parentText.replace(/\s+/g, " ").trim().slice(0, 240)
        };
    }));
}
exports.collectFieldDescriptors = collectFieldDescriptors;
function fieldLocator(page, index) {
    return page.locator(CONTROL_SELECTOR).nth(index);
}
exports.fieldLocator = fieldLocator;
//# sourceMappingURL=field-semantic-resolver.js.map