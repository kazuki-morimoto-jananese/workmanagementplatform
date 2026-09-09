import { DurableObject } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { createApp } from "./index.mjs";
import { openStoreDatabase } from "./store.mjs";
import { isDailyStorageQuota, nextDailyReset, storageQuotaResponse } from "./cloud-quota.mjs";

// The existing domain model uses synchronous SQLite transactions. Durable Objects
// supplies the same isolation without relying on a temporary Worker filesystem.
export function durableDatabase(storage) {
  let depth = 0;
  return {
    get isTransaction() {
      return depth > 0;
    },
    exec(sql) {
      storage.sql.exec(sql);
    },
    prepare(sql) {
      return {
        all(...args) {
          return storage.sql.exec(sql, ...args).toArray();
        },
        get(...args) {
          return storage.sql.exec(sql, ...args).toArray()[0];
        },
        run(...args) {
          const cursor = storage.sql.exec(sql, ...args);
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
