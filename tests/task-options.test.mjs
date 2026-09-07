import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase, digest } from "../server/store.mjs";
import { createApp } from "../server/index.mjs";
import { nextOccurrence, recurrenceInput } from "../server/task-options.mjs";
test("monthly recurrence preserves the anchor across short months; weekly and invalid rules", () => {
  const task = {
    id: "a",
    dueDate: "2027-01-31",
    startDate: "2027-01-30",
    recurrence: { frequency: "monthly", interval: 1 },
  };
  const feb = nextOccurrence(task),
    mar = nextOccurrence(feb);
  assert.equal(feb.dueDate, "2027-02-28");
  assert.equal(mar.dueDate, "2027-03-31");
  assert.equal(
    nextOccurrence({ ...task, dueDate: "2028-01-31" }).dueDate,
    "2028-02-29",
  );
  assert.equal(
    nextOccurrence({
      ...task,
      recurrence: { frequency: "weekly", interval: 2 },
    }).dueDate,
    "2027-02-14",
  );
  assert.throws(() =>
    recurrenceInput({ frequency: "weekly", interval: 0 }, "2027-01-31"),
  );
  assert.throws(() =>
    recurrenceInput({ frequency: "monthly", interval: 1 }, ""),
  );
});
test("private tasks protect APIs, notifications, audit and references; completing recurrence is idempotent", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  for (const name of ["admin", "owner", "assigned", "other"]) {
    store.saveUser({
      id: name,
      name,
      email: name + "@test.example",
      active: true,
      role: name === "admin" ? "admin" : "member",
      mustChangePassword: false,
    });
    store.db
      .prepare("INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)")
      .run(digest(name), name, Date.now() + 60000);
  }
  store.put("projects", { id: "project", name: "Team", rules: [], fields: [] });
  const app = createApp({
    store,
    production: false,
    allowedDomain: "",
    timers: false,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = async (path, method = "GET", body, user = "owner") => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        Cookie: "worknest_session=" + user,
        "Content-Type": "application/json",
        "X-Worknest": "1",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    const input = {
      title: "PRIVATE-TITLE",
      description: "PRIVATE-CONTENT",
      status: "todo",
      priority: "medium",
      projectIds: ["project"],
      assigneeIds: ["assigned"],
      visibility: "private",
      dueDate: "2027-01-31",
      recurrence: { frequency: "monthly", interval: 1 },
    };
    const created = await call("/tasks", "POST", input);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    let task = created.data;
    for (const user of ["owner", "assigned", "admin"])
      assert.ok(
        (await call("/bootstrap", "GET", undefined, user)).data.tasks.some(
          (t) => t.id === task.id,
        ),
      );
    const outsider = await call("/bootstrap", "GET", undefined, "other");
    assert.equal(outsider.data.tasks.length, 0);
    assert.ok(!JSON.stringify(outsider.data).includes("PRIVATE-"));
    for (const [suffix, method, body] of [
      ["", "PATCH", { version: 1, title: "Bad" }],
      ["", "DELETE", { version: 1 }],
      ["/comments", "POST", { text: "Bad" }],
      ["/approval", "POST", { action: "request", reviewerId: "other" }],
      ["/calendar", "GET", null],
    ])
      assert.equal(
        (await call("/tasks/" + task.id + suffix, method, body, "other"))
          .status,
        404,
      );
    assert.deepEqual(
      (
        await call(
          "/audit?kind=tasks&recordId=" + task.id,
          "GET",
          null,
          "other",
        )
      ).data.entries,
      [],
    );
    assert.equal(
      (
        await call(
          "/tasks/" + task.id,
          "PATCH",
          { version: 1, visibility: "workspace" },
          "assigned",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/tasks/" + task.id,
          "PATCH",
          { version: 1, assigneeIds: ["assigned", "other"] },
          "assigned",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/tasks",
          "POST",
          {
            ...input,
            title: "Public",
            visibility: "workspace",
            dependencies: [task.id],
          },
          "other",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call("/tasks/" + task.id + "/approval", "POST", {
          action: "request",
          reviewerId: "other",
        })
      ).status,
      403,
    );
    task = (
      await call("/tasks/" + task.id, "PATCH", { version: 1, status: "done" })
    ).data;
    const next = store.get("tasks", task.recurrenceNextId);
    assert.equal(next.dueDate, "2027-02-28");
    assert.equal(next.visibility, "private");
    assert.deepEqual(next.comments, []);
    task = (
      await call("/tasks/" + task.id, "PATCH", {
        version: task.version,
        status: "todo",
      })
    ).data;
    task = (
      await call("/tasks/" + task.id, "PATCH", {
        version: task.version,
        status: "done",
      })
    ).data;
    assert.equal(store.all("tasks").length, 2);
    assert.equal(
      (
        await call("/tasks/" + task.id, "PATCH", {
          version: task.version - 1,
          status: "done",
        })
      ).status,
      409,
    );
    task = (
      await call("/tasks/" + task.id, "PATCH", {
        version: task.version,
        assigneeIds: [],
      })
    ).data;
    assert.ok(
      !(
        await call("/bootstrap", "GET", null, "assigned")
      ).data.notifications.some((n) => n.taskId === task.id),
    );
    assert.deepEqual(
      (
        await call(
          "/audit?kind=tasks&recordId=" + task.id,
          "GET",
          null,
          "assigned",
        )
      ).data.entries,
      [],
    );
    await call("/tasks/" + task.id, "DELETE", { version: task.version });
    assert.ok(
      !JSON.stringify(
        (await call("/bootstrap", "GET", null, "other")).data,
      ).includes("PRIVATE-"),
    );
  } finally {
    await app.close();
  }
});
