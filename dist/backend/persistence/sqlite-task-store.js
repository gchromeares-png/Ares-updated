"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteTaskStore = void 0;
const tslib_1 = require("tslib");
const promises_1 = require("fs/promises");
const fs = tslib_1.__importStar(require("fs"));
const path = tslib_1.__importStar(require("path"));
const better_sqlite3_1 = tslib_1.__importDefault(require("better-sqlite3"));
const sensitive_data_scrubber_1 = require("./sensitive-data-scrubber");
const CURRENT_SCHEMA_VERSION = 1;
const BUSY_TIMEOUT_MS = 5000;
function serializeConfig(config) {
    return JSON.stringify((0, sensitive_data_scrubber_1.sanitizePersistedValue)(config));
}
function parseConfig(value) {
    if (typeof value !== "string")
        throw new Error("Stored task config is invalid.");
    return JSON.parse(value);
}
function asString(value) {
    return typeof value === "string" ? value : String(value ?? "");
}
function asNumber(value) {
    return typeof value === "number" ? value : Number(value ?? 0);
}
function rowToTask(row) {
    return {
        id: asString(row["id"]),
        config: parseConfig(row["config_json"]),
        state: asString(row["state"]),
        createdAt: new Date(asString(row["created_at"])),
        updatedAt: new Date(asString(row["updated_at"])),
        lastError: row["last_error"] == null ? undefined : asString(row["last_error"]),
        retries: asNumber(row["retries"]),
        maxRetries: asNumber(row["max_retries"])
    };
}
function rowToLog(row) {
    return {
        id: asNumber(row["id"]),
        taskId: asString(row["task_id"]),
        event: asString(row["event"]),
        state: row["state"] == null ? undefined : asString(row["state"]),
        level: asString(row["level"]),
        message: asString(row["message"]),
        createdAt: new Date(asString(row["created_at"]))
    };
}
function serializeMonitorEvent(event) {
    return JSON.stringify((0, sensitive_data_scrubber_1.sanitizePersistedValue)({
        ...event,
        observedAt: event.observedAt.toISOString(),
        current: {
            ...event.current,
            observedAt: event.current.observedAt.toISOString()
        },
        previous: event.previous
            ? { ...event.previous, observedAt: event.previous.observedAt.toISOString() }
            : undefined
    }));
}
function reviveObservation(input) {
    return {
        ...input,
        observedAt: new Date(input.observedAt)
    };
}
function rowToMonitorEvent(row) {
    const parsed = JSON.parse(asString(row["event_json"]));
    return {
        ...parsed,
        id: asNumber(row["id"]),
        taskId: asString(row["task_id"]),
        observedAt: new Date(parsed.observedAt),
        current: reviveObservation(parsed.current),
        previous: parsed.previous ? reviveObservation(parsed.previous) : undefined
    };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
class SqliteTaskStore {
    constructor(filePath, db) {
        this.filePath = filePath;
        this.db = db;
    }
    static async open(filePath) {
        await (0, promises_1.mkdir)(path.dirname(filePath), { recursive: true });
        const existed = fs.existsSync(filePath);
        let database;
        try {
            database = new better_sqlite3_1.default(filePath, existed ? { fileMustExist: true } : undefined);
            // Existing data is checked before any PRAGMA that can mutate the database header.
            if (existed)
                SqliteTaskStore.assertIntegrity(database);
            SqliteTaskStore.configureConnection(database);
            const store = new SqliteTaskStore(filePath, database);
            store.migrate();
            SqliteTaskStore.assertIntegrity(database);
            return store;
        }
        catch (error) {
            try {
                database?.close();
            }
            catch {
                // Preserve the original startup error.
            }
            throw new Error(`ARES SQLite konnte nicht sicher geöffnet werden: ${errorMessage(error)}`);
        }
    }
    async save(task) {
        this.upsertTask(task);
    }
    async update(task) {
        this.upsertTask(task);
    }
    async findById(id) {
        const row = this.db.prepare(`
      SELECT id, config_json, state, created_at, updated_at, last_error, retries, max_retries
      FROM tasks WHERE id = ? LIMIT 1
    `).get(id);
        return row ? rowToTask(row) : null;
    }
    async findAll() {
        const rows = this.db.prepare(`
      SELECT id, config_json, state, created_at, updated_at, last_error, retries, max_retries
      FROM tasks ORDER BY updated_at DESC
    `).all();
        return rows.map(rowToTask);
    }
    async delete(id) {
        const remove = this.db.transaction((taskId) => {
            this.db.prepare("DELETE FROM task_logs WHERE task_id = ?").run(taskId);
            this.db.prepare("DELETE FROM product_monitor_events WHERE task_id = ?").run(taskId);
            this.db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
        });
        remove(id);
    }
    async appendLog(entry) {
        this.insertLog(entry);
    }
    async findLogsByTaskId(taskId, limit = 100) {
        const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
        const rows = this.db.prepare(`
      SELECT id, task_id, event, state, level, message, created_at
      FROM task_logs WHERE task_id = ? ORDER BY id DESC LIMIT ?
    `).all(taskId, safeLimit);
        return rows.map(rowToLog).reverse();
    }
    async deleteLogsByTaskId(taskId) {
        this.db.prepare("DELETE FROM task_logs WHERE task_id = ?").run(taskId);
    }
    async recordProductMonitorEvent(taskId, event) {
        this.db.prepare(`
      INSERT INTO product_monitor_events (task_id, product_key, change_type, event_json, observed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(taskId, event.key, event.type, serializeMonitorEvent(event), event.observedAt.toISOString());
    }
    async findProductMonitorEventsByTaskId(taskId, limit = 100) {
        const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
        const rows = this.db.prepare(`
      SELECT id, task_id, event_json
      FROM product_monitor_events
      WHERE task_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(taskId, safeLimit);
        return rows.map(rowToMonitorEvent).reverse();
    }
    async deleteProductMonitorEventsByTaskId(taskId) {
        this.db.prepare("DELETE FROM product_monitor_events WHERE task_id = ?").run(taskId);
    }
    async recordTaskEvent(task, entry) {
        const record = this.db.transaction(() => {
            this.upsertTask(task);
            this.insertLog(entry);
        });
        record();
    }
    async close() {
        if (this.db.open)
            this.db.close();
    }
    migrate() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
        const row = this.db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get();
        const version = asNumber(row?.["version"] ?? 0);
        if (version > CURRENT_SCHEMA_VERSION) {
            throw new Error(`SQLite-Schema ${version} ist neuer als die von ARES unterstützte Version ${CURRENT_SCHEMA_VERSION}.`);
        }
        if (version < 1) {
            const migration = this.db.transaction(() => {
                this.db.exec(`
          CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            state TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_error TEXT,
            retries INTEGER NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 3
          );

          CREATE TABLE IF NOT EXISTS task_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            event TEXT NOT NULL,
            state TEXT,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS product_monitor_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            product_key TEXT NOT NULL,
            change_type TEXT NOT NULL,
            event_json TEXT NOT NULL,
            observed_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_task_logs_task_id_id
            ON task_logs(task_id, id);

          CREATE INDEX IF NOT EXISTS idx_product_monitor_events_task_id_id
            ON product_monitor_events(task_id, id);
        `);
                this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(1, new Date().toISOString());
            });
            migration();
        }
        this.assertSchema();
        (0, sensitive_data_scrubber_1.scrubLegacySensitiveData)(this.db);
    }
    assertSchema() {
        const requiredTables = ["schema_migrations", "tasks", "task_logs", "product_monitor_events"];
        const rows = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (?, ?, ?, ?)
    `).all(...requiredTables);
        const present = new Set(rows.map(row => asString(row["name"])));
        const missing = requiredTables.filter(name => !present.has(name));
        if (missing.length > 0) {
            throw new Error(`SQLite-Schema ist unvollständig: ${missing.join(", ")}`);
        }
    }
    upsertTask(task) {
        this.db.prepare(`
      INSERT INTO tasks (
        id, config_json, state, created_at, updated_at, last_error, retries, max_retries
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        config_json = excluded.config_json,
        state = excluded.state,
        updated_at = excluded.updated_at,
        last_error = excluded.last_error,
        retries = excluded.retries,
        max_retries = excluded.max_retries
    `).run(task.id, serializeConfig(task.config), task.state, task.createdAt.toISOString(), task.updatedAt.toISOString(), task.lastError ? (0, sensitive_data_scrubber_1.sanitizePersistedMessage)(task.lastError) : null, task.retries, task.maxRetries);
    }
    insertLog(entry) {
        this.db.prepare(`
      INSERT INTO task_logs (task_id, event, state, level, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entry.taskId, entry.event, entry.state ?? null, entry.level, (0, sensitive_data_scrubber_1.sanitizePersistedMessage)(entry.message), entry.createdAt.toISOString());
    }
    static configureConnection(db) {
        db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
        db.pragma("foreign_keys = ON");
        const journalMode = String(db.pragma("journal_mode = WAL", { simple: true }) ?? "").toLowerCase();
        if (journalMode !== "wal") {
            throw new Error(`SQLite WAL konnte nicht aktiviert werden (journal_mode=${journalMode || "unknown"}).`);
        }
        db.pragma("synchronous = FULL");
    }
    static assertIntegrity(db) {
        const result = String(db.pragma("quick_check", { simple: true }) ?? "");
        if (result.toLowerCase() !== "ok") {
            throw new Error(`SQLite quick_check fehlgeschlagen: ${result || "unknown"}`);
        }
    }
}
exports.SqliteTaskStore = SqliteTaskStore;
//# sourceMappingURL=sqlite-task-store.js.map