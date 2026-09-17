import { digest, id, now } from "./store.mjs";
const fail = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
const text = (v, max, required = false) => {
  fail(
    typeof v === "string" && v.length <= max && (!required || v.trim()),
    "入力項目・文字数を確認してください。",
  );
  return v.trim();
};
export const builtinPrepTemplates = [
  {
    id: "builtin-initial",
    name: "初回商談",
    orgUnitId: "",
    version: 1,
    builtin: true,
    agenda:
      "採用・事業の目標と期限\n現在の課題・配信状況\n予算と意思決定の流れ\n次回までのアクション",
    items: [
      "顧客の目標と課題を確認する",
      "決裁者・実務担当者を確認する",
      "予算・期限・次回接点を確認する",
    ],
  },
  {
    id: "builtin-review",
    name: "運用定例・改善提案",
    orgUnitId: "",
    version: 1,
    builtin: true,
    agenda:
      "前回の決定事項と未完了タスク\n当月実績・ヨミ・予算の確認\nCPA・CV定義と競合状況の確認\n改善施策の合意・実施日・検証日",
    items: [
      "前回の決定事項と未完了タスクを確認する",
      "比較期間・抽出条件・CV定義を揃える",
      "改善施策の期待成果と検証日を決める",
    ],
  },
];
export function templateById(store, tid) {
  return (
    builtinPrepTemplates.find((t) => t.id === tid) ||
    store.get("meetingPrepTemplates", tid)
  );
}
export function checklistInput(value) {
  fail(Array.isArray(value) && value.length <= 30, "確認項目は30件までです。");
  const ids = new Set();
  return value.map((item) => {
    fail(item && typeof item === "object", "確認項目を確認してください。");
    const key = text(item.id, 100, true);
    fail(
      !ids.has(key) && typeof item.done === "boolean",
      "確認項目のID・チェック状態を確認してください。",
    );
    ids.add(key);
    return {
      id: key,
      label: text(item.label, 200, true),
      done: item.done,
      note: text(item.note ?? "", 1000),
    };
  });
}
export function prepareDraft(store, body, previous) {
  let agenda = text(body.agenda ?? previous?.agenda ?? "", 4000);
  let checklist = checklistInput(body.checklist ?? previous?.checklist ?? []);
  const templateSources = [...(previous?.templateSources || [])];
  if (body.applyTemplate) {
    const template = templateById(store, body.applyTemplate.id);
    fail(
      template && !template.archived,
      "テンプレートが見つからないか、利用停止されています。",
      404,
    );
    fail(
      body.applyTemplate.version === template.version,
      "テンプレートが更新されています。選び直してください。",
      409,
    );
    const key = template.id + ":" + template.version;
    if (!templateSources.some((s) => s.key === key)) {
      fail(
        templateSources.length < 10,
        "1つの議題に追加できるテンプレートは10版までです。",
      );
      const normalized = (s) =>
        s.normalize("NFKC").replace(/\s/g, "").toLowerCase();
      const labels = new Set(checklist.map((c) => normalized(c.label)));
      for (const label of template.items)
        if (!labels.has(normalized(label))) {
          checklist.push({ id: id(), label, done: false, note: "" });
          labels.add(normalized(label));
        }
      checklist = checklistInput(checklist);
      const addition = `【${template.name}】\n${template.agenda}`;
      if (!agenda.includes(addition))
        agenda = text([agenda, addition].filter(Boolean).join("\n\n"), 4000);
      templateSources.push({
        key,
        id: template.id,
        name: template.name,
        version: template.version,
        agenda: template.agenda,
        items: template.items,
        appliedAt: now(),
      });
    }
  }
  return { agenda, checklist, templateSources };
}
export function createPreparationTemplates({ store }) {
  return async ({ p, method, body, user, reply }) => {
    if (p !== "/sales/preparation-templates") return false;
    if (method === "GET")
      return reply(200, {
        templates: [
          ...builtinPrepTemplates,
          ...store
            .all("meetingPrepTemplates")
            .filter((t) => user.role === "admin" || !t.archived),
        ],
      });
    if (method !== "POST") return false;
    fail(
      user.role === "admin",
      "共通テンプレートの編集は管理者のみです。",
      403,
    );
    const previous = body.id
      ? store.get("meetingPrepTemplates", body.id)
      : null;
    fail(!body.id || previous, "テンプレートが見つかりません。", 404);
    fail(
      body.version === (previous?.version || 0),
      "テンプレートが更新されました。再読み込みしてください。",
      409,
    );
    const name = text(body.name, 100, true),
      agenda = text(body.agenda, 3000),
      orgUnitId = text(body.orgUnitId || "", 100);
    fail(
      !orgUnitId || store.get("orgUnits", orgUnitId),
      "組織を選び直してください。",
    );
    fail(
      Array.isArray(body.items) && body.items.length <= 20,
      "共通の確認項目は20件までです。",
    );
    const items = [...new Set(body.items.map((s) => text(s, 200, true)))];
    fail(typeof body.archived === "boolean", "利用状態を確認してください。");
    const requestId = text(body.requestId || "", 100, !previous);
    const rid = previous?.id || digest(user.id + ":prep-template:" + requestId);
    const input = { name, agenda, orgUnitId, items, archived: body.archived },
      inputHash = digest(JSON.stringify(input));
    const duplicate = !previous && store.get("meetingPrepTemplates", rid);
    if (duplicate) {
      fail(
        duplicate.inputHash === inputHash,
        "同じ保存IDに異なる内容があります。",
        409,
      );
      return reply(200, duplicate);
    }
    if (!previous)
      fail(
        store.all("meetingPrepTemplates").length < 50,
        "共通テンプレートは50件までです。既存のテンプレートを更新してください。",
        409,
      );
    const value = {
      ...input,
      id: rid,
      inputHash,
      version: (previous?.version || 0) + 1,
      updatedAt: now(),
      updatedBy: user.id,
    };
    store.put("meetingPrepTemplates", value);
    return reply(previous ? 200 : 201, value);
  };
}
