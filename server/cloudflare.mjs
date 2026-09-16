import { DurableObject } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./index.mjs";
import { openStoreDatabase } from "./store.mjs";
import {
  isDailyStorageQuota,
  nextDailyReset,
  storageQuotaResponse,
} from "./cloud-quota.mjs";

// The existing domain model uses synchronous SQLite transactions. Durable Objects
// supplies the same isolation without relying on a temporary Worker filesystem.
export function durableDatabase(storage) {
  let depth = 0;
  const startedAt = new Date().toISOString();
  let day = startedAt.slice(0, 10),
    rowsRead = 0,
    rowsWritten = 0,
    queries = 0;
  const measure = (cursor) => {
    const current = new Date().toISOString().slice(0, 10);
    if (current !== day) {
      day = current;
      rowsRead = rowsWritten = queries = 0;
    }
    rowsRead += cursor.rowsRead || 0;
    rowsWritten += cursor.rowsWritten || 0;
    queries++;
  };
  return {
    usage: () => ({
      startedAt,
      day,
      rowsRead,
      rowsWritten,
      queries,
      bytes: storage.sql.databaseSize,
    }),
    get isTransaction() {
      return depth > 0;
    },
    exec(sql) {
      const cursor = storage.sql.exec(sql);
      cursor.toArray();
      measure(cursor);
    },
    prepare(sql) {
      return {
        all(...args) {
          const cursor = storage.sql.exec(sql, ...args);
          const rows = cursor.toArray();
          measure(cursor);
          return rows;
        },
        get(...args) {
          const cursor = storage.sql.exec(sql, ...args);
          const rows = cursor.toArray();
          measure(cursor);
          return rows[0];
        },
        run(...args) {
          const cursor = storage.sql.exec(sql, ...args);
          cursor.toArray();
          measure(cursor);
          return { changes: cursor.rowsWritten };
        },
      };
    },
    transactionSync(fn) {
      if (depth) return fn();
      return storage.transactionSync(() => {
        depth++;
        try {
          return fn();
        } finally {
          depth--;
        }
      });
    },
    close() {},
  };
}

export class CompanyWorkspace extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.origin = "";
  }
  ensureApp() {
    if (this.app) return;
    this.store = openStoreDatabase(durableDatabase(this.ctx.storage));
    this.app = createApp({
      store: this.store,
      production: true,
      timers: false,
      appOrigin: () => this.env.APP_ORIGIN || this.origin,
      background: (promise) => this.ctx.waitUntil(promise),
      storageInfo: {
        kind: "cloudflare",
        description:
          "Cloudflareの永続SQLiteへ保存しています。履歴は自動削除しません。復元ポイントはCloudflareの保存期間内で利用できます。長期保管には全データを書き出してください。",
      },
      backupProvider: async () => ({
        recoveryPoint: await this.ctx.storage.getCurrentBookmark(),
        bytes: this.ctx.storage.sql.databaseSize,
      }),
    });
    this.handler = httpServerHandler(this.app.server);
  }
  async fetch(request) {
    // Only this Worker's router calls this singleton. No client-selectable
    // workspace IDs or unauthenticated internal scheduling endpoints exist.
    this.origin = new URL(request.url).origin;
    this.ensureApp();
    if (!(await this.ctx.storage.getAlarm()))
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    return this.handler.fetch(request, this.env, this.ctx);
  }
  async alarm() {
    let next = Date.now() + 60_000;
    try {
      this.ensureApp();
      await this.app.tick();
    } catch (error) {
      if (!isDailyStorageQuota(error)) throw error;
      next = nextDailyReset();
    } finally {
      await this.ctx.storage.setAlarm(next);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const id = env.WORKSPACE.idFromName("company-v1");
      try {
        return await env.WORKSPACE.get(id).fetch(request);
      } catch (error) {
        const response = storageQuotaResponse(error);
        if (response) return response;
        throw error;
      }
    }
    return env.ASSETS.fetch(request);
  },
};
