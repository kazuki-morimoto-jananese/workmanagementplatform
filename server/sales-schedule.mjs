const day = (date) =>
  date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
export function syncTime(value = "06:00") {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw Object.assign(
      new Error("同期時刻は00:00〜23:59で指定してください。"),
      { status: 400 },
    );
  return value;
}
export function scheduledSyncDue(source, date = new Date()) {
  if (!source?.enabled) return false;
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const last = source.lastScheduledAttemptAt
    ? day(new Date(source.lastScheduledAttemptAt))
    : "";
  return clock >= syncTime(source.syncTime || "06:00") && last !== day(date);
}
