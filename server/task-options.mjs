import { id, now } from "./store.mjs";
export const taskOwners = (t) =>
  t?.assigneeIds || (t?.assigneeId ? [t.assigneeId] : []);
export const canReadTask = (task, user) =>
  !!task &&
  (task.visibility !== "private" ||
    user.role === "admin" ||
    task.createdBy === user.id ||
    taskOwners(task).includes(user.id));
export function visibleTask(task, user, store) {
  return redactTaskReferences(task, user, store);
}
export function redactTaskReferences(value, user, store) {
  if (user.role === "admin") return value;
  if (Array.isArray(value))
    return value.map((v) => redactTaskReferences(v, user, store));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      k === "taskLinks" && Array.isArray(v)
        ? v.filter((l) => canReadTask(store.get("tasks", l.taskId), user))
        : k === "dependencies" && Array.isArray(v)
          ? v.filter((id) => canReadTask(store.get("tasks", id), user))
          : ["recurrenceNextId", "recurrenceParentId"].includes(k) &&
              typeof v === "string"
            ? canReadTask(store.get("tasks", v), user)
              ? v
              : ""
            : redactTaskReferences(v, user, store),
    ]),
  );
}
export function recurrenceInput(value, dueDate) {
  if (!value || value.frequency === "none") return null;
  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  if (!["daily", "weekly", "monthly"].includes(value.frequency))
    fail("繰り返し周期を選択してください。");
  const interval = Number(value.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 12 || !dueDate)
    fail("繰り返しには期日と1〜12の間隔を指定してください。");
  return { frequency: value.frequency, interval };
}
export function nextOccurrence(task) {
  const date = new Date(task.dueDate + "T00:00:00Z"),
    rule = task.recurrence;
  const anchor = task.recurrenceAnchor || Number(task.dueDate.slice(-2));
  if (rule.frequency === "monthly") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + rule.interval);
    const last = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(anchor, last));
  } else
    date.setUTCDate(
      date.getUTCDate() + rule.interval * (rule.frequency === "weekly" ? 7 : 1),
    );
  const dueDate = date.toISOString().slice(0, 10);
  if (!/^\d{4}-/.test(dueDate))
    throw Object.assign(new Error("繰り返しの期日が上限を超えています。"), {
      status: 400,
    });
  const duration = task.startDate
    ? Date.parse(task.dueDate) - Date.parse(task.startDate)
    : 0;
  return {
    ...task,
    id: id(),
    status: "todo",
    dueDate,
    startDate: task.startDate
      ? new Date(date.getTime() - duration).toISOString().slice(0, 10)
      : "",
    comments: [],
    approval: null,
    dependencies: [],
    minuteId: "",
    minuteActionIndex: null,
    recurrenceAnchor: anchor,
    recurrenceParentId: task.id,
    recurrenceNextId: "",
    version: 1,
    createdAt: now(),
    updatedAt: now(),
  };
}
