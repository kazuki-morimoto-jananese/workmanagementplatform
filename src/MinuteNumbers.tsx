import { useEffect, useState } from "react";
import type { SalesMinute, SalesReview, SalesData } from "./sales-types";
const names: Record<string, string> = {
  forecast: "担当者ヨミ",
  aggressive: "アグレッシブ",
  probability: "確度",
  acceptableCpa: "許容CPA",
  stanby: "スタンバイ",
  indeed: "Indeed",
  box: "求人BOX",
  budget: "予算",
  spend: "消化額",
  cv: "応募数",
  cpa: "CPA",
  hires: "採用数",
  months: "継続月数",
};
export function MinuteNumbers({
  minute,
  configured,
  request,
  update,
}: {
  minute: SalesMinute;
  configured: boolean;
  request: (path: string) => Promise<SalesData>;
  update: (action: string, body: unknown) => Promise<unknown>;
}) {
  const [review, setReview] = useState<SalesReview | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError("");
    request(
      `/sales/bootstrap?month=${minute.targetMonth || minute.meetingDate.slice(0, 7)}`,
    )
      .then((s) => {
        if (active) {
          setReview(
            s.reviews.find(
              (r) =>
                r.accountId === minute.accountId &&
                r.weekOf === minute.reviewWeek,
            ) || null,
          );
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [minute.id, minute.version]);
  const run = async (action: string) => {
    setBusy(true);
    setError("");
    try {
      await update(action, {
        version: minute.version,
        reviewVersion: review?.version || 0,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const extracting = ["pending", "processing"].includes(
    minute.extraction?.status || "",
  );
  return (
    <section className="minute-numbers">
      <h3>議事録からヨミ・媒体数値を入力</h3>
      <p>
        対象月 {minute.targetMonth || minute.meetingDate.slice(0, 7)} · 会議週{" "}
        {minute.reviewWeek || "抽出時の当週"}
        。根拠を確認して空欄へ反映します。入力済みの値（0を含む）は保持します。
      </p>
      <div className="admin-actions">
        <button
          className="button"
          disabled={busy || extracting || !configured || !!minute.supersededBy}
          onClick={() => void run("extract")}
        >
          {extracting ? "Geminiで数値を抽出中…" : "Geminiで数値を抽出"}
        </button>
        {minute.extraction?.status === "completed" &&
          !minute.extraction.appliedAt && (
            <button
              className="button primary"
              disabled={busy || !loaded || !minute.extraction.fields.length}
              onClick={() => void run("apply-numbers")}
            >
              確認して空欄へ反映
            </button>
          )}
      </div>
      {!configured && (
        <p className="sales-muted">
          Gemini未設定です。データ連携タブで設定方法を確認できます。
        </p>
      )}
      {(error || minute.extraction?.error) && (
        <p className="form-error" role="alert">
          {error || minute.extraction?.error}
        </p>
      )}
      {minute.extraction?.fields.map((f) => {
        const parts = f.path.split(".");
        const previous =
          parts.length === 2
            ? (review?.media as any)?.[parts[0]]?.[parts[1]]
            : f.path === "acceptableCpa"
              ? review?.media.acceptableCpa
              : (review as any)?.[f.path];
        return (
          <div className="number-evidence" key={f.path}>
            <strong>
              {parts.map((p) => names[p] || p).join(" / ")}：
              {f.value.toLocaleString("ja-JP")}
              {f.path === "probability"
                ? "%"
                : /\.(cv|hires|months)$/.test(f.path)
                  ? ""
                  : "円"}
            </strong>
            <small>
              現在値：
              {previous == null
                ? "未入力"
                : previous.toLocaleString("ja-JP") + "（保持）"}
            </small>
            <blockquote>{f.evidence}</blockquote>
          </div>
        );
      })}
      {minute.extraction?.status === "completed" &&
        !minute.extraction.fields.length && (
          <p>
            対象月の確かな数値は見つかりませんでした。原文に媒体名・対象月・金額と単位を記載してください。
          </p>
        )}
      {minute.extraction?.appliedAt && (
        <p className="info-box">
          反映済み：{minute.extraction.applied?.length || 0}項目 /
          入力済み・矛盾のため保持：{minute.extraction.skipped?.length || 0}項目
        </p>
      )}
    </section>
  );
}
