/**
 * @file src/bridge/logger.js
 * @description Persistent file-based and in-memory logging subsystem for the shapez.io Steam Co-op Mod.
 * 
 * Provides rotating diagnostic logs written to the shapez.io application data directory
 * (%APPDATA%/shapez.io/coop-multiplayer.log on Windows) and maintains a fixed-size ring
 * buffer of recent entries for in-game diagnostic inspection.
 * 
 * Invariants:
 * - Thread-safe within Electron's Node.js Main Process event loop.
 * - Never throws unhandled exceptions during disk I/O failure (graceful degradation).
 * - Enforces a strict 2 MB maximum disk file size to prevent unbounded disk growth.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Standard roaming application data path across operating systems.
 * @type {string}
 */
const ROAMING_DIR =
    process.env.APPDATA ||
    (process.platform === "darwin"
        ? path.join(process.env.HOME || "", "Library", "Preferences")
        : path.join(process.env.HOME || "", ".local", "share"));

/**
 * Target directory for shapez.io multiplayer diagnostic logs.
 * @type {string}
 */
const LOG_DIR = path.join(ROAMING_DIR || os.tmpdir(), "shapez.io");

/**
 * Absolute file path to the active multiplayer diagnostic log.
 * @type {string}
 */
const LOG_FILE_PATH = path.join(LOG_DIR, "coop-multiplayer.log");

/**
 * Maximum allowable log file size before truncation / rotation (2 Megabytes).
 * @type {number}
 */
const MAX_LOG_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * In-memory circular buffer preserving recent log entries for UI display.
 * @type {string[]}
 */
const recentLogs = [];

/**
 * Writes a timestamped log entry to both the in-memory circular buffer and the persistent log file.
 * Automatically rotates / truncates the log file if it exceeds MAX_LOG_SIZE_BYTES.
 *
 * @param {"MAIN" | "RENDERER" | "NATIVE" | "NET"} source - Subsystem generating the log event.
 * @param {"INFO" | "WARN" | "ERROR" | "DEBUG"} level - Severity level.
 * @param {string} message - Descriptive log message.
 */
function writeMpLog(source, level, message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${source}] [${level}] ${message}`;

    recentLogs.push(line);
    if (recentLogs.length > 200) {
        recentLogs.shift();
    }

    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        if (fs.existsSync(LOG_FILE_PATH)) {
            const stat = fs.statSync(LOG_FILE_PATH);
            if (stat.size > MAX_LOG_SIZE_BYTES) {
                // Truncate file on overflow, keeping the latest line as entry
                fs.writeFileSync(LOG_FILE_PATH, line + "\n", "utf8");
                return;
            }
        }
        fs.appendFileSync(LOG_FILE_PATH, line + "\n", "utf8");
    } catch {
        // Silently swallow filesystem permission / concurrency errors to preserve stability
    }
}

/**
 * Logs an informational message to stdout and the persistent log.
 *
 * @param {string} msg - Informational message text.
 */
function logInfo(msg) {
    console.log("[Steam MP]", msg);
    writeMpLog("MAIN", "INFO", msg);
}

/**
 * Logs a warning message to stderr and the persistent log.
 *
 * @param {string} msg - Warning message text.
 */
function logWarn(msg) {
    console.warn("[Steam MP]", msg);
    writeMpLog("MAIN", "WARN", msg);
}

/**
 * Retrieves the most recent log entries from the in-memory circular buffer.
 *
 * @param {number} [limit=80] - Maximum number of lines to return.
 * @returns {{ logPath: string, lines: string[] }} Object containing log path and lines.
 */
function getRecentLogs(limit = 80) {
    return {
        logPath: LOG_FILE_PATH,
        lines: recentLogs.slice(-limit),
    };
}

module.exports = {
    ROAMING_DIR,
    LOG_DIR,
    LOG_FILE_PATH,
    recentLogs,
    writeMpLog,
    logInfo,
    logWarn,
    getRecentLogs,
};
