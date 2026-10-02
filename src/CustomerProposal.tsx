import { useEffect, useRef, useState } from "react";
import {
  buildCustomerProposal,
  proposalDefaults,
  type CustomerProposal as Deck,
  type ProposalOptions,
  type ProposalSlide,
} from "../shared/customer-proposal.mjs";
import type { GoogleApi } from "./GoogleWorkflows";
import type { KwReport } from "./kw-analysis";
import "./customer-proposal.css";

type SavedProposal = {
  id: string;
  title: string;
  deck: Deck;
  createdAt: string;
  createdBy: string;
  parentId: string;
};
type HistoryItem = Pick<
  SavedProposal,
  "id" | "title" | "createdAt" | "createdBy"
>;
export default function CustomerProposal({
  api,
  report,
  accountId,
  accountName,
  analysisId,
  presenter,
}: {
  api: GoogleApi;
  report: KwReport;
  accountId: string;
  accountName: string;
  analysisId: string;
  presenter: string;
}) {
  const [options, setOptions] = useState(() =>
    proposalDefaults(report, accountName, presenter),
  );
  const [saved, setSaved] = useState<SavedProposal | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [message, setMessage] = useState("");
  const request = useRef<{ payload: string; id: string } | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const dirty =
    !saved || JSON.stringify(options) !== JSON.stringify(saved.deck.options);
  let deck: Deck | undefined,
    validation = "";
  try {
    deck =
      !dirty && saved ? saved.deck : buildCustomerProposal(report, options);
  } catch (e) {
    validation = (e as Error).message;
  }
  const query = "?" + new URLSearchParams({ accountId, analysisId });
  useEffect(() => {
    let active = true;
    api<{ items: HistoryItem[] }>("/sales/customer-proposals" + query)
      .then((r) => {
        if (active) setHistory(r.items);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [analysisId, accountId]);
  function edit<K extends keyof ProposalOptions>(
    key: K,
    value: ProposalOptions[K],
  ) {
    setOptions((o) => ({ ...o, [key]: value }));
    setReviewed(false);
    setMessage("");
  }
  async function save() {
    if (!deck) return;
    setBusy(true);
    setMessage("");
    try {
      const body = {
        accountId,
        analysisId,
        parentId: saved?.id || "",
        options,
      };
      const payload = JSON.stringify(body);
      if (request.current?.payload !== payload)
        request.current = { payload, id: crypto.randomUUID() };
      const r = await api<SavedProposal>("/sales/customer-proposals", "POST", {
        ...body,
        requestId: request.current.id,
      });
      setSaved(r);
      setOptions(r.deck.options);
      setHistory((h) => [r, ...h.filter((v) => v.id !== r.id)]);
      setMessage(
        "提案資料を保存しました。内容を確認してダウンロードできます。",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function load(id: string) {
    if (
      dirty &&
      saved &&
      !window.confirm("未保存の変更があります。保存済みの版を開きますか？")
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const r = await api<SavedProposal>(
        "/sales/customer-proposals/" + id + query,
      );
      setSaved(r);
      setOptions(r.deck.options);
      setReviewed(false);
      setMessage(
        "保存時の内容を開きました。編集後に保存すると、新しい版として残ります。",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function pptx() {
    if (!deck || dirty || !reviewed) return;
    setBusy(true);
    setMessage("");
    try {
      await (await import("./proposal-pptx")).downloadProposalPptx(deck);
      setMessage(
        "PowerPointファイルを作成しました。送付前にPowerPointで表示を確認してください。",
      );
    } catch {
      setMessage(
        "PowerPointを生成できませんでした。再試行するか、掲載内容を減らしてください。",
      );
    } finally {
      setBusy(false);
    }
  }
  function print() {
    if (!preview.current || dirty || !reviewed) return;
    document.getElementById("worknest-printout")?.remove();
    const copy = preview.current.cloneNode(true) as HTMLElement;
    copy.id = "worknest-printout";
    copy.classList.add("proposal-printout");
    document.body.append(copy);
    window.addEventListener("afterprint", () => copy.remove(), { once: true });
    window.print();
  }
  return (
    <section
      className="customer-proposal prep-no-print"
      aria-label="顧客向け提案資料"
    >
      <header className="proposal-editor-heading">
        <div>
          <span className="proposal-eyebrow">CUSTOMER PROPOSAL</span>
          <h3>分析を、商談で使える提案資料へ</h3>
          <p>内容を選択・編集 → 共有保存 → 確認 → PowerPoint／PDF出力</p>
        </div>
        <span className="badge">{dirty ? "未保存の編集" : "保存済みの版"}</span>
      </header>
      <p>
        保存先はこのワークスペースです。顧客への送信は行いません。数値と根拠は保存済み分析に基づき、提案文は担当者が編集します。
      </p>
      {history.length > 0 && (
        <label>
          保存した提案資料
          <select
            aria-label="保存した提案資料"
            value={saved?.id || ""}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) void load(e.target.value);
            }}
          >
            <option value="">保存履歴から開く</option>
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {new Date(h.createdAt).toLocaleString("ja-JP")} · {h.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset disabled={busy} className="proposal-fields">
        <legend>1. 提案の内容を整える</legend>
        <div className="prep-grid">
          {(
            [
              ["title", "資料タイトル", 100],
              ["recipient", "提出先", 120],
              ["issuer", "提出元", 80],
              ["presenter", "作成者", 80],
            ] as const
          ).map(([k, label, max]) => (
            <label key={k}>
              {label}
              <input
                aria-label={label}
                maxLength={max}
                value={options[k]}
                onChange={(e) => edit(k, e.target.value)}
              />
            </label>
          ))}
          <label>
            資料日付
            <input
              aria-label="資料日付"
              type="date"
              value={options.issuedOn}
              onChange={(e) => edit("issuedOn", e.target.value)}
            />
          </label>
          <label>
            CVの定義
            <input
              aria-label="CVの定義"
              placeholder="例：応募完了。未確認の場合は未確認と資料に表示"
              maxLength={300}
              value={options.cvDefinition}
              onChange={(e) => edit("cvDefinition", e.target.value)}
            />
          </label>
        </div>
        {(
          [
            ["overview", "提案サマリー", 2000],
            ["conditions", "比較条件", 1000],
            ["nextSteps", "次のアクション", 2000],
          ] as const
        ).map(([k, label, max]) => (
          <label key={k}>
            {label}
            <textarea
              aria-label={label}
              rows={3}
              maxLength={max}
              value={options[k]}
              onChange={(e) => edit(k, e.target.value)}
            />
          </label>
        ))}
        <details>
          <summary>
            注目する{report.placement ? "配信面" : "KW"}を選ぶ（
            {options.rowIndices.length}/8）
          </summary>
          <div className="proposal-choices">
            {report.rows.map((r, i) => (
              <label className="proposal-check" key={i}>
                <input
                  type="checkbox"
                  checked={options.rowIndices.includes(i)}
                  disabled={
                    !options.rowIndices.includes(i) &&
                    options.rowIndices.length >= 8
                  }
                  onChange={(e) =>
                    edit(
                      "rowIndices",
                      e.target.checked
                        ? [...options.rowIndices, i]
                        : options.rowIndices.filter((n) => n !== i),
                    )
                  }
                />
                {r.keyword}
              </label>
            ))}
          </div>
        </details>
        <h4>掲載する改善提案（{options.findings.length}/6）</h4>
        {report.findings.map((f, i) => {
          const selected = options.findings.find((v) => v.index === i);
          return (
            <div className="proposal-finding" key={i}>
              <label className="proposal-check">
                <input
                  type="checkbox"
                  checked={!!selected}
                  disabled={!selected && options.findings.length >= 6}
                  onChange={(e) =>
                    edit(
                      "findings",
                      e.target.checked
                        ? [
                            ...options.findings,
                            { index: i, proposal: f.proposal },
                          ]
                        : options.findings.filter((v) => v.index !== i),
                    )
                  }
                />
                {f.title}
              </label>
              {selected && (
                <>
                  <p>
                    <strong>根拠：</strong>
                    {f.evidence}
                  </p>
                  <label>
                    顧客向けの提案文
                    <textarea
                      aria-label={`顧客向けの提案文 ${i + 1}`}
                      rows={3}
                      maxLength={3000}
                      value={selected.proposal}
                      onChange={(e) =>
                        edit(
                          "findings",
                          options.findings.map((v) =>
                            v.index === i
                              ? { ...v, proposal: e.target.value }
                              : v,
                          ),
                        )
                      }
                    />
                  </label>
                </>
              )}
            </div>
          );
        })}
        {!report.findings.length && (
          <p>
            提案候補はありません。提案サマリー・次のアクションに検討事項を入力できます。
          </p>
        )}
        {!report.placement && report.rows.some((r) => r.index.length > 0) && (
          <>
            <label className="proposal-check">
              <input
                type="checkbox"
                checked={options.includeCompetition}
                onChange={(e) => edit("includeCompetition", e.target.checked)}
              />
              選択したKWの競合広告主比較を掲載する
            </label>
            {options.includeCompetition && (
              <label className="proposal-check">
                <input
                  type="checkbox"
                  checked={options.includeCompetitorNames}
                  onChange={(e) =>
                    edit("includeCompetitorNames", e.target.checked)
                  }
                />
                競合の実名を掲載する（初期設定は匿名）
              </label>
            )}
          </>
        )}
        <label className="proposal-check">
          <input
            type="checkbox"
            checked={options.includeSourceNames}
            onChange={(e) => edit("includeSourceNames", e.target.checked)}
          />
          元ファイル名を出典に掲載する
        </label>
      </fieldset>
      <div className="proposal-actions">
        <button
          className="button primary"
          disabled={busy || !deck || !dirty}
          onClick={() => void save()}
        >
          {busy
            ? "処理中…"
            : saved
              ? "新しい版として保存"
              : "提案資料を共有保存"}
        </button>
        <span>過去の版を残します。元の分析結果は変更しません。</span>
      </div>
      {validation && (
        <p role="alert" className="form-error">
          {validation}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <h4>2. 提出内容を確認する · {deck?.slides.length || 0}ページ</h4>
      <p>
        保存した版を出力します。スライド内の数値・文章はPowerPointで再編集できます。PDFはブラウザーの印刷画面から保存してください。
      </p>
      <label className="proposal-check">
        <input
          type="checkbox"
          aria-label="提案資料の提出内容を確認済み"
          checked={reviewed}
          disabled={busy || dirty || !deck}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        提出先・期間・数値の定義・提案文・掲載情報を確認した
      </label>
      <div className="proposal-actions">
        <button
          className="button primary"
          disabled={busy || dirty || !reviewed || !deck}
          onClick={() => void pptx()}
        >
          PowerPointをダウンロード
        </button>
        <button
          className="button"
          disabled={busy || dirty || !reviewed || !deck}
          onClick={print}
        >
          提案資料をPDF保存
        </button>
      </div>
      {deck && (
        <div
          className="proposal-preview"
          ref={preview}
          aria-label="提案スライドのプレビュー"
        >
          {deck.slides.map((s, i) => (
            <SlidePreview
              key={i}
              slide={s}
              footer={`${deck.issuedOn} · ${i + 1} / ${deck.slides.length}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
function SlidePreview({
  slide: s,
  footer,
}: {
  slide: ProposalSlide;
  footer: string;
}) {
  return (
    <article className={`proposal-slide proposal-${s.kind}`}>
      <h4>{s.title}</h4>
      {s.kind === "text" || s.kind === "cover" ? (
        <div className="proposal-lines">
          {s.lines.map((line, i) => (
            <div key={i}>{line || "\u00a0"}</div>
          ))}
        </div>
      ) : s.kind === "table" ? (
        <>
          <table>
            <thead>
              <tr>
                {s.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="proposal-caption">{s.caption}</p>
        </>
      ) : (
        <>
          <div className="proposal-bars">
            {s.series.map((series) => {
              const max = Math.max(
                0,
                ...series.values.filter((v): v is number => v !== null),
              );
              return (
                <div key={series.label}>
                  <h5>{series.label}</h5>
                  {series.values.map((v, j) => (
                    <div className="proposal-bar-item" key={j}>
                      <span>
                        期間{j ? "B" : "A"}　{series.formatted[j]}
                      </span>
                      <div className="proposal-bar-track">
                        <i
                          className={j ? "current" : ""}
                          style={{
                            width: `${v !== null && max > 0 ? (v / max) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="proposal-caption">{s.caption}</p>
        </>
      )}
      <footer>{footer}</footer>
    </article>
  );
}
