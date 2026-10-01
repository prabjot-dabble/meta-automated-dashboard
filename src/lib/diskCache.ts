/**
 * diskCache.ts — a bounded in-memory cache that survives server restarts.
 *
 * Server-only (uses `fs`): import it from API routes, never from client code.
 *
 * Behaves like a Map for the routes (get / set), but every write is also saved
 * to a JSON file, and the file is read back the first time the cache is used. So
 * a restart, or a dev-mode hot reload that re-creates the module, no longer wipes
 * what Meta already told us — past date ranges (24 h TTL) stay instant.
 *
 * Where it lives: the OS temp folder by default, NOT the project folder. The
 * project sits inside OneDrive, which would upload cached ad data to the cloud
 * (and it would otherwise need a .gitignore entry). Override with
 * `META_CACHE_DIR`. Nothing secret is stored: keys are date ranges and values are
 * Meta's response rows, never the access token or request URLs.
 *
 * Failure is always soft: a missing, unreadable, corrupt or read-only location
 * just means the cache behaves as in-memory only.
 */

import { promises as fsp, readFileSync } from "fs";
import os from "os";
import path from "path";

const FILE_VERSION = 1;
const MAX_ENTRIES = 50;
/** Entries older than this are dropped on load (they'd be useless even as stale data). */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Coalesce bursts of writes (a page load sets several entries) into one file write. */
const FLUSH_DELAY_MS = 750;

const cacheDir = () =>
    process.env.META_CACHE_DIR ||
    path.join(os.tmpdir(), "dabble-meta-dashboard-cache");

interface Stamped {
    /** Epoch ms the entry was stored; used to age entries out on load. */
    at: number;
}

export class DiskCache<V extends Stamped> {
    private map = new Map<string, V>();
    private loaded = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly file: string;

    /** `name` becomes the file name, so keep it short and unique per cache. */
    constructor(name: string) {
        this.file = path.join(cacheDir(), `${name}.json`);
    }

    get(key: string): V | undefined {
        this.ensureLoaded();
        return this.map.get(key);
    }

    /** Stores `value`, evicting the oldest entries beyond MAX_ENTRIES. */
    set(key: string, value: V): void {
        this.ensureLoaded();
        this.map.delete(key); // re-insert so the newest write sorts last
        this.map.set(key, value);
        while (this.map.size > MAX_ENTRIES) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined) break;
            this.map.delete(oldest);
        }
        this.scheduleFlush();
    }

    private ensureLoaded(): void {
        if (this.loaded) return;
        this.loaded = true;
        try {
            const parsed = JSON.parse(readFileSync(this.file, "utf8")) as {
                v?: number;
                entries?: [string, V][];
            };
            if (parsed.v !== FILE_VERSION || !Array.isArray(parsed.entries)) return;
            const cutoff = Date.now() - MAX_AGE_MS;
            for (const [key, value] of parsed.entries) {
                if (
                    typeof key === "string" &&
                    value &&
                    typeof value.at === "number" &&
                    value.at >= cutoff
                ) {
                    this.map.set(key, value);
                }
            }
        } catch {
            // No file yet, or it is unreadable/corrupt: start empty.
        }
    }

    private scheduleFlush(): void {
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, FLUSH_DELAY_MS);
        // Never keep the process alive just to write the cache.
        this.timer.unref?.();
    }

    /** Atomic write: temp file then rename, so a crash never leaves half a file. */
    private async flush(): Promise<void> {
        const tmp = `${this.file}.${process.pid}.tmp`;
        try {
            await fsp.mkdir(path.dirname(this.file), { recursive: true });
            const body = JSON.stringify({
                v: FILE_VERSION,
                entries: Array.from(this.map.entries()),
            });
            await fsp.writeFile(tmp, body, "utf8");
            await fsp.rename(tmp, this.file);
        } catch (err) {
            // Read-only disk, permissions, etc.: stay in-memory only.
            console.warn(
                "[cache] could not save to disk:",
                err instanceof Error ? err.message : err
            );
            fsp.unlink(tmp).catch(() => {});
        }
    }
}
