import { useEffect, useState } from "react";
import type { Data } from "./types";
import { organizationName } from "./types";
import type { GoogleApi } from "./GoogleWorkflows";
import { OrganizationSelect, AuditHistory } from "./WorkspaceAdmin";
import type {
  PrepCheck,
  PrepTemplate,
  PrepTemplateSource,
} from "./customer-hub-types";
import "./customer-hub.css";
export function PreparationTemplates({
  api,
  data,
  disabled,
  checklist,
  sources,
  onChange,
  onApply,
}: {
  api: GoogleApi;
  data: Data;
  disabled: boolean;
  checklist: PrepCheck[];
  sources: PrepTemplateSource[];
  onChange: (items: PrepCheck[]) => void;
  onApply: (t: PrepTemplate) => Promise<void>;
}) {
  const [templates, setTemplates] = useState<PrepTemplate[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [item, setItem] = useState(""),
    [editor, setEditor] = useState<PrepTemplate | "new" | null>(null),
    [busy, setBusy] = useState(false);
  const reload = async () =>
    setTemplates(
      (await api<{ templates: PrepTemplate[] }>("/sales/preparation-templates"))
        .templates,
    );
  useEffect(() => {
    let active = true;
    api<{ templates: PrepTemplate[] }>("/sales/preparation-templates")
      .then((r) => {
        if (active) setTemplates(r.templates);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const template = templates.find((t) => t.id === selected);
  return (
    <div className="prep-templates">
      <h4>商談準備のテンプレート</h4>
      <p className="sales-muted">
        議題・確認項目を追加して保存します。入力済みの議題やチェック状態を保持し、同じ版の二重追加を防ぎます。
      </p>
      <label>
        共通テンプレート
        <select
          aria-label="商談準備テンプレート"
          disabled={busy || disabled}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">選択してください</option>
          {templates
            .filter((t) => !t.archived)
            .map((t) => (
              <option value={t.id} key={t.id}>
                {t.name} ·{" "}
                {t.orgUnitId
                  ? organizationName(data.orgUnits || [], t.orgUnitId)
                  : "全社共通"}{" "}
                · v{t.version}
              </option>
            ))}
        </select>
      </label>
      {template && (
        <div className="prep-template-preview">
          <h4>{template.name}</h4>
          <pre>{template.agenda}</pre>
          <ul>
            {template.items.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <button
            className="button"
            disabled={
              busy ||
              disabled ||
              !!template.archived ||
              sources.some(
                (s) => s.key === template.id + ":" + template.version,
              )
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onApply(template);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            議題・確認項目に追加して保存
          </button>
        </div>
      )}
      {sources.length > 0 && (
        <p className="sales-muted">
          適用済み：{sources.map((s) => `${s.name} v${s.version}`).join(" / ")}
          。適用時の内容を保存しています。
        </p>
      )}
      <h4>
        確認チェックリスト · {checklist.filter((c) => c.done).length}/
        {checklist.length}
      </h4>
      <div className="prep-checklist">
        {checklist.map((c) => (
          <div className="prep-check-row" key={c.id}>
            <label>
              <input
                type="checkbox"
                disabled={disabled || busy}
                checked={c.done}
                onChange={(e) =>
                  onChange(
                    checklist.map((v) =>
                      v.id === c.id ? { ...v, done: e.target.checked } : v,
                    ),
                  )
                }
              />
              {c.label}
            </label>
            <input
              aria-label={`${c.label}の確認メモ`}
              placeholder="確認結果・補足（任意）"
              maxLength={1000}
              disabled={disabled || busy}
              value={c.note}
              onChange={(e) =>
                onChange(
                  checklist.map((v) =>
                    v.id === c.id ? { ...v, note: e.target.value } : v,
                  ),
                )
              }
            />
            <button
              type="button"
              className="text-button"
              disabled={disabled || busy}
              onClick={() => onChange(checklist.filter((v) => v.id !== c.id))}
            >
              この確認項目を削除
            </button>
          </div>
        ))}
      </div>
      <label>
        確認項目を追加
        <input
          aria-label="新しい確認項目"
          maxLength={200}
          disabled={disabled || busy || checklist.length >= 30}
          value={item}
          onChange={(e) => setItem(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="button"
        disabled={disabled || busy || !item.trim() || checklist.length >= 30}
        onClick={() => {
          onChange([
            ...checklist,
            {
              id: crypto.randomUUID(),
              label: item.trim(),
              done: false,
              note: "",
            },
          ]);
          setItem("");
        }}
      >
        確認項目を追加
      </button>
      <p className="sales-muted">
        チェック・メモ・削除は「議題・チェックリストを保存」で確定します。
      </p>
      {data.user.role === "admin" && (
        <details>
          <summary>チーム共通のテンプレートを管理</summary>
          <p>
            組織名は分類用で、閲覧制限ではありません。作成・更新は管理者、適用は全メンバーが利用できます。
          </p>
          <div className="customer-toolbar">
            <button
              className="button"
              disabled={!!editor}
              onClick={() => setEditor("new")}
            >
              共通テンプレートを作成
            </button>
            <button
              className="button"
              disabled={!!editor || !template}
              onClick={() => setEditor(template!)}
            >
              {template?.builtin
                ? "標準をコピーして編集"
                : "選択したテンプレートを編集"}
            </button>
            <button
              className="button"
              disabled={!!editor}
              onClick={() => reload().catch((e) => setError(e.message))}
            >
              テンプレートを再読み込み
            </button>
          </div>
          {templates
            .filter((t) => t.archived)
            .map((t) => (
              <p key={t.id}>
                {t.name}（利用停止中）{" "}
                <button
                  className="button"
                  disabled={!!editor}
                  onClick={() => setEditor(t)}
                >
                  内容・利用状態を編集
                </button>
              </p>
            ))}
          {editor && (
            <TemplateEditor
              key={typeof editor === "string" ? "new" : editor.id}
              api={api}
              data={data}
              template={editor === "new" ? undefined : editor}
              onCancel={() => setEditor(null)}
              onSaved={async () => {
                await reload();
                setEditor(null);
              }}
            />
          )}
        </details>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
function TemplateEditor({
  api,
  data,
  template,
  onCancel,
  onSaved,
}: {
  api: GoogleApi;
  data: Data;
  template?: PrepTemplate;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState(false),
    [requestId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="prep-template-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        setError("");
        try {
          await api("/sales/preparation-templates", "POST", {
            ...f,
            id: template?.builtin ? undefined : template?.id,
            version: template?.builtin ? 0 : template?.version || 0,
            requestId,
            items: String(f.items || "")
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean),
            archived: f.archived === "on",
          });
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4>共通テンプレートの編集</h4>
      <label>
        テンプレート名
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={
            template
              ? template.name + (template.builtin ? "（チーム用）" : "")
              : ""
          }
        />
      </label>
      <label>
        対象組織（分類）
        <OrganizationSelect
          name="orgUnitId"
          units={data.orgUnits || []}
          defaultValue={template?.orgUnitId || ""}
        />
      </label>
      <label>
        議題のひな形
        <textarea
          name="agenda"
          aria-label="議題のひな形"
          rows={5}
          maxLength={3000}
          defaultValue={template?.agenda || ""}
        />
      </label>
      <label>
        共通の確認項目（1行1項目・20項目まで）
        <textarea
          name="items"
          aria-label="共通の確認項目（1行1項目・20項目まで）"
          rows={6}
          maxLength={4020}
          defaultValue={template?.items.join("\n") || ""}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="archived"
          defaultChecked={template?.archived || false}
        />
        新しい議題への適用を停止する
      </label>
      <p>
        変更しても適用済みの顧客の議題は変わりません。保存前の入力は画面を切り替えると失われます。
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="customer-toolbar">
        <button className="button primary" disabled={busy}>
          共通テンプレートを保存
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onCancel}
        >
          テンプレート編集を取り消す
        </button>
      </div>
      {template && !template.builtin && (
        <>
          <button
            type="button"
            className="button"
            onClick={() => setHistory(!history)}
          >
            テンプレートの変更履歴
          </button>
          {history && (
            <AuditHistory
              request={api}
              members={data.members}
              kind="meetingPrepTemplates"
              recordId={template.id}
            />
          )}
        </>
      )}
    </form>
  );
}
