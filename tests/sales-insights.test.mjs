import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priorityActions,
  effectiveActionStatus,
  matchingState,
} from "../src/sales-insights.ts";
import { emptyMedia } from "../server/sales-import.mjs";

test("priority rules respect missing, stopped and old data, with stable evidence and expiring snoozes", () => {
  const month = "2026-09",
    week = "2026-09-14",
    today = "2026-09-16";
  const account = {
    id: "a",
    name: "Account",
    ownerId: "u",
    status: "利用中",
    lastContactAt: "2026-08-20",
  };
  const media = (spend, cv) => ({
    ...emptyMedia(),
    stanby: { ...emptyMedia().stanby, spend, cv },
  });
  const sales = {
    masters: [
      {
        accountId: "a",
        month,
        gTrend: 600,
        previousGTrend: 1000,
        importedAt: today,
      },
    ],
    reviews: [
      {
        accountId: "a",
        month,
        weekOf: "2026-09-07",
        observedAt: "2026-09-07",
        forecast: 800,
        media: media(200, 1),
      },
      {
        accountId: "a",
        month,
        weekOf: "2026-08-31",
        observedAt: "2026-09-01",
        forecast: 800,
        media: media(100, 1),
      },
    ],
  };
  const data = {
    members: [{ id: "u", active: true }],
    tasks: [
      {
        id: "t",
        accountId: "a",
        title: "Follow up",
        status: "todo",
        dueDate: "2026-09-15",
      },
    ],
  };
  const actions = priorityActions([account], sales, data, month, week, today);
  assert.equal(actions[0].kind, "task");
  assert.deepEqual(
    new Set(actions.map((a) => a.kind)),
    new Set(["forecast", "contact", "cpa", "trend", "task"]),
  );
  const contact = actions.find((a) => a.kind === "contact");
  const state = { ...contact, month, week, status: "done" };
  assert.equal(effectiveActionStatus(contact, state, today), "done");
  const tomorrowContact = priorityActions(
    [account],
    sales,
    data,
    month,
    week,
    "2026-09-17",
  ).find((a) => a.kind === "contact");
  assert.equal(
    effectiveActionStatus(tomorrowContact, state, "2026-09-17"),
    "done",
    "date passage alone does not re-open completed contact",
  );
  assert.equal(
    effectiveActionStatus(
      { ...contact, fingerprint: "new evidence" },
      state,
      today,
    ),
    "open",
  );
  assert.equal(
    effectiveActionStatus(
      contact,
      { ...state, status: "snoozed", until: "2026-09-17" },
      today,
    ),
    "snoozed",
  );
  assert.equal(
    effectiveActionStatus(
      contact,
      { ...state, status: "snoozed", until: today },
      today,
    ),
    "open",
  );
  assert.equal(matchingState(contact, [state], month, "2026-09-21"), undefined);
  assert.deepEqual(
    priorityActions(
      [{ ...account, status: "配信停止" }],
      sales,
      data,
      month,
      week,
      today,
    ).map((a) => a.kind),
    ["task"],
  );
  const noNumbers = {
    masters: [{ ...sales.masters[0], gTrend: 0 }],
    reviews: [],
  };
  assert.equal(
    priorityActions([account], noNumbers, data, month, week, today).some((a) =>
      ["forecast", "trend", "cpa"].includes(a.kind),
    ),
    false,
  );
  const old = {
    masters: [{ ...sales.masters[0], importedAt: "2026-08-01" }],
    reviews: sales.reviews.map((r) => ({ ...r, observedAt: "2026-08-01" })),
  };
  assert.equal(
    priorityActions([account], old, data, month, week, today).some((a) =>
      ["trend", "cpa"].includes(a.kind),
    ),
    false,
  );
});
