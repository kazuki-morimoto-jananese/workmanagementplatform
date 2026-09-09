export function isDailyStorageQuota(error) {
  return /Exceeded allowed rows (?:read|written) in Durable Objects free tier/i.test(error?.message || '');
}
export function nextDailyReset(time = Date.now()) {
  return Math.floor(time / 86400000) * 86400000 + 86400000 + 60000;
}
export function storageQuotaResponse(error, time = Date.now()) {
  if (!isDailyStorageQuota(error)) return null;
  return Response.json({
    error: 'Cloudflare無料枠の本日のデータベース利用上限に達しました。日本時間の午前9時以降に再読み込みしてください。',
    code: 'DAILY_STORAGE_QUOTA',
  }, { status: 503, headers: { 'Retry-After': String(Math.ceil((nextDailyReset(time) - time) / 1000)), 'Cache-Control': 'no-store' } });
}
