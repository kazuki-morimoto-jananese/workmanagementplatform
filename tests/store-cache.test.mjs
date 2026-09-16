import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase, withReadCache } from "../server/store.mjs";

test("request cache reduces reads without leaking mutations, rollback values or concurrent updates", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  const second = openStoreDatabase(new DatabaseSync(":memory:"));
  try {
    store.put("sample", { id: "a", name: "first" });
    second.put("sample", { id: "a", name: "other database" });
    withReadCache(() => {
      for (let i = 0; i < 100; i++) {
        const records = store.all("sample");
        assert.equal(records[0].name, "first");
        records[0].name = "client mutation";
      }
      assert.equal(store.usage().reads, 1);
      assert.equal(store.usage().cacheHits, 99);
      assert.equal(second.all("sample")[0].name, "other database");
      store.put("sample", { id: "a", name: "updated" });
      assert.equal(store.all("sample")[0].name, "updated");
      assert.throws(() =>
        store.transaction(() => {
          store.put("sample", { id: "a", name: "rolled back" });
          assert.equal(store.get("sample", "a").name, "rolled back");
          throw new Error("rollback");
        }),
      );
      assert.equal(store.get("sample", "a").name, "updated");
      store.remove("sample", "a");
      assert.equal(store.all("sample").length, 0);
      assert.equal(store.get("sample", "a"), null);
      store.put("sample", { id: "a", name: "recreated" });
      assert.equal(store.get("sample", "a").name, "recreated");
      const user = { id: "u", email: "u@example.test", active: true };
      store.saveUser(user);
      assert.equal(store.user("u").active, true);
      store.saveUser({ ...user, active: false });
      assert.equal(store.user("u").active, false);
    });
    let resume;
    const gate = new Promise((r) => {
      resume = r;
    });
    const reading = withReadCache(async () => {
      assert.equal(store.get("sample", "a").name, "recreated");
      await gate;
      assert.equal(store.get("sample", "a").name, "concurrent update");
    });
    withReadCache(() =>
      store.put("sample", { id: "a", name: "concurrent update" }),
    );
    resume();
    await reading;
    const before = store.usage().reads;
    withReadCache(() => store.all("sample"));
    withReadCache(() => store.all("sample"));
    assert.equal(
      store.usage().reads - before,
      2,
      "requests do not reuse each other's cache",
    );
  } finally {
    store.db.close();
    second.db.close();
  }
});
