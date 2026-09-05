import { emptyMedia } from "./sales-import.mjs";

const DEMO_SET = "sales-three-month-v1";
const key = (...parts) => JSON.stringify(parts);
const round = (value) => Math.round(value / 1000) * 1000;
const shiftDay = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const monday = (day) =>
  shiftDay(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
export function demoPeriods(today) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
    new Date(today).toISOString().slice(0, 10) !== today
  )
    throw new Error("デモの基準日が不正です。");
  const current = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  return [-1, 0, 1].map((offset) => {
    const d = new Date(current);
    d.setUTCMonth(d.getUTCMonth() + offset);
    const month = d.toISOString().slice(0, 7);
    const next = new Date(d);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const end = shiftDay(next.toISOString().slice(0, 10), -1);
    return { month, offset, reportWeek: monday(offset < 0 ? end : today), end };
  });
}

export function seedSalesDemo(
  store,
  user,
  {
    today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
  } = {},
) {
  if (!user?.active || user.role !== "admin")
    throw Object.assign(new Error("デモの追加は管理者のみ操作できます。"), {
      status: 403,
    });
  const periods = demoPeriods(today);
  const created = {};
  const stamp = new Date().toISOString();
  const projectId = "demo-sfa-project-v1";
  const members = store.users().filter((member) => member.active);
  const catalog = [
    [
      "みらいキャリア",
      "TOP30",
      15000000,
      15800000,
      17500000,
      1.03,
      28000,
      24000,
      "看護師採用",
      "応募単価の改善と増額の最終合意",
    ],
    [
      "東都ワークス",
      "重点",
      7000000,
      5800000,
      7400000,
      0.9,
      19000,
      23000,
      "物流拠点採用",
      "増額稟議の停滞を解消",
    ],
    [
      "リーフ採用支援",
      "育成",
      4000000,
      3200000,
      4600000,
      0.96,
      14000,
      17000,
      "介護職採用",
      "Gトレと顧客予算の差異を確認",
    ],
    [
      "ハーバーリテール",
      "重点",
      3000000,
      3500000,
      4200000,
      1.08,
      11000,
      18000,
      "店舗スタッフ採用",
      "好調な配信を他エリアへ展開",
    ],
    [
      "ひかりフードサービス",
      "育成",
      2500000,
      2100000,
      2400000,
      0.88,
      18000,
      16000,
      "飲食店採用",
      "応募導線を改善してCPAを抑制",
    ],
    [
      "ソラテック採用",
      "新規",
      1500000,
      1700000,
      2200000,
      1.04,
      9500,
      14000,
      "エンジニア採用",
      "試験配信の成果から本導入へ",
    ],
  ];
  const put = (kind, record) => {
    const old = store.get(kind, record.id);
    if (old) {
      const ownedAccount =
        record.accountId &&
        old.accountId === record.accountId &&
        store.get("salesAccounts", record.accountId)?.demoSet === DEMO_SET;
      const ownedProject =
        kind === "projects" &&
        store
          .all("salesAccounts")
          .some((a) => a.projectId === record.id && a.demoSet === DEMO_SET);
      if (old.demoSet !== DEMO_SET && !ownedAccount && !ownedProject)
        throw Object.assign(
          new Error(
            "デモ用IDが既存データと競合しています。既存データは変更していません。",
          ),
          { status: 409 },
        );
      return;
    }
    store.put(kind, { ...record, isDemo: true, demoSet: DEMO_SET });
    created[kind] = (created[kind] || 0) + 1;
  };
  store.transaction(() => {
    put("projects", {
      id: projectId,
      name: "デモ：営業アクション",
      description: "3か月の架空データ。実際の売上・顧客ではありません。",
      color: "sage",
      icon: "megaphone",
      status: "ontrack",
      dueDate: periods[2].end,
      fields: [],
      rules: [],
      ownerId: user.id,
    });
    catalog.forEach(
      (
        [
          name,
          category,
          base,
          currentForecast,
          nextForecast,
          previousRatio,
          cpa,
          acceptableCpa,
          goal,
          issue,
        ],
        i,
      ) => {
        const aid = `demo-sfa-v1-${String(i + 1).padStart(2, "0")}`;
        const owner = members[i % members.length] || user;
        put("salesAccounts", {
          id: aid,
          name: `デモ：${name}`,
          category,
          status: "利用中",
          ownerId: owner.id,
          ownerName: owner.name,
          group: i < 3 ? "デモ重点営業G" : "デモ新規営業G",
          agency: "",
          projectId,
          customerGoal: goal,
          customerIssues: issue,
          lastContactAt: shiftDay(today, i === 2 ? -22 : -i),
          importedAt: stamp,
          version: 1,
        });
        periods.forEach(({ month, offset, reportWeek, end }) => {
          const target = round(
            base * (offset < 0 ? 0.9 : offset > 0 ? 1.15 : 1),
          );
          const finalForecast =
            offset < 0
              ? round(target * previousRatio)
              : offset > 0
                ? nextForecast
                : currentForecast;
          const progress =
            offset < 0
              ? 1
              : Math.min(0.95, Number(today.slice(8)) / Number(end.slice(8)));
          const media = emptyMedia();
          for (const [medium, factor] of [
            ["stanby", 1],
            ["indeed", 1.8],
            ["box", 1.1],
          ]) {
            const spend =
              offset > 0 ? null : round(finalForecast * progress * factor);
            const cv =
              spend === null
                ? null
                : Math.max(
                    1,
                    Math.round(
                      spend / (cpa * (medium === "stanby" ? 1 : 0.85)),
                    ),
                  );
            media[medium] = {
              ...media[medium],
              budget: round(target * factor),
              spend,
              cv,
              cpa: spend === null ? null : Math.round(spend / cv),
              hires: cv === null ? null : Math.max(1, Math.round(cv * 0.09)),
              ...(medium !== "stanby" ? { months: 8 + i + offset } : {}),
            };
          }
          media.acceptableCpa = acceptableCpa;
          const trend =
            offset === 0 && i === 2
              ? 0
              : round(finalForecast * (offset < 0 ? 1 : 0.97));
          put("salesMasters", {
            id: key(aid, month),
            accountId: aid,
            month,
            previousActual:
              offset > 0
                ? null
                : offset === 0
                  ? round(round(base * 0.9) * previousRatio)
                  : round(base * 0.85),
            previousGTrend: round(trend * 0.96),
            gTrend: trend,
            target,
            nextTarget: offset < 0 ? base : round(base * 1.15),
            media,
            raw: {
              データ種別: "架空デモ",
              対象月: month,
              見どころ: issue,
              期間:
                offset < 0
                  ? "前月の確定結果"
                  : offset > 0
                    ? "翌月の計画。実績は未発生"
                    : "当月の進捗と着地予測",
            },
            importedAt: stamp,
            sourceName: "3か月営業デモ",
          });
          [-14, -7, 0].forEach((shift, revision) => {
            // One account deliberately carries forward last week's input.
            if (offset === 0 && i === 2 && shift === 0) return;
            const weekOf = shiftDay(reportWeek, shift);
            const forecast = round(
              finalForecast *
                [i % 2 ? 1.07 : 0.9, i % 2 ? 1.03 : 0.96, 1][revision],
            );
            const observedAt =
              offset < 0 ? shiftDay(end, shift) : shiftDay(today, shift);
            const reviewMedia = structuredClone(media);
            for (const medium of ["stanby", "indeed", "box"]) {
              if (observedAt < `${month}-01` || offset > 0) {
                for (const metric of ["spend", "cv", "cpa", "hires"])
                  reviewMedia[medium][metric] = null;
              } else if (shift < 0) {
                const fraction =
                  Number(observedAt.slice(8)) /
                  (offset < 0 ? Number(end.slice(8)) : Number(today.slice(8)));
                reviewMedia[medium].spend = round(
                  media[medium].spend * fraction,
                );
                reviewMedia[medium].cv = Math.max(
                  1,
                  Math.round(media[medium].cv * fraction),
                );
                reviewMedia[medium].hires = Math.max(
                  1,
                  Math.round(media[medium].hires * fraction),
                );
                reviewMedia[medium].cpa = Math.round(
                  reviewMedia[medium].spend / reviewMedia[medium].cv,
                );
              }
            }
            const review = {
              id: key(aid, month, weekOf),
              accountId: aid,
              month,
              weekOf,
              forecast,
              aggressive: round(Math.max(forecast, finalForecast * 1.15)),
              probability: [70, 50, 40, 80, 45, 75][i],
              reason: `【架空デモ】${month}の${offset < 0 ? "締め結果" : "着地見込み"}。${issue}。${revision === 2 ? "最新の顧客合意を反映" : "前回の確認時点の予測"}。`,
              nextAction: `${issue}の次回提案を準備する`,
              customerGoal: goal,
              customerIssues: issue,
              funnel: [
                "条件合意",
                "提案中",
                "予算確認",
                "増額合意",
                "改善提案",
                "本導入審査",
              ][i],
              effectiveProposal: i === 2 ? "unknown" : "yes",
              budgetTrend:
                i % 2 ? "増額の稟議を確認中" : "採用計画に合わせ増額を検討",
              observedAt,
              media: reviewMedia,
              version: 1,
              updatedAt: `${observedAt}T09:00:00+09:00`,
              updatedBy: owner.id,
            };
            put("salesReviews", review);
            put("salesHistory", {
              id: `demo-history-${aid}-${month}-${weekOf}`,
              kind: "review",
              accountId: aid,
              month,
              weekOf,
              forecast,
              reason: review.reason,
              updatedAt: review.updatedAt,
              updatedBy: owner.id,
              record: review,
            });
          });
          const oid = `demo-opp-${aid}-${month}`;
          const stage =
            offset < 0
              ? i === 1
                ? "lost"
                : "won"
              : [
                  "negotiation",
                  "proposal",
                  "discovery",
                  "won",
                  "proposal",
                  "negotiation",
                ][i];
          put("salesOpportunities", {
            id: oid,
            accountId: aid,
            title: `デモ：${month} ${goal}の追加予算`,
            amount: round(base * 0.12),
            probability:
              stage === "won"
                ? 100
                : stage === "lost"
                  ? 0
                  : [75, 50, 30, 100, 40, 65][i],
            stage,
            expectedCloseDate: `${month}-${String(14 + i * 2).padStart(2, "0")}`,
            ownerId: owner.id,
            nextAction: issue,
            lastActivityAt: offset < 0 ? end : shiftDay(today, -i),
            version: 1,
            updatedAt: stamp,
          });
          const minuteId = `demo-minute-${aid}-${month}`;
          const taskId = `demo-task-${aid}-${month}`;
          const action = `${goal}の改善提案を提出する`;
          const text = `【架空デモ】${month} ${offset > 0 ? "翌月計画ミーティング" : "月次営業定例"}\n決定事項：月間目標 ${target.toLocaleString("ja-JP")}円、担当者ヨミ ${finalForecast.toLocaleString("ja-JP")}円を共有。\n課題：${issue}。\n次のアクション：${action}。\n${offset > 0 ? "翌月の消化実績は未発生。予算と見込みのみを確認。" : "媒体別の消化額、CPA、採用数を確認し、実行タスクを共有。"}`;
          const evidence = `次のアクション：${action}。`;
          put("salesMinutes", {
            id: minuteId,
            accountId: aid,
            opportunityId: oid,
            title: `デモ：${month} ${offset > 0 ? "翌月予算計画" : "営業定例"}`,
            meetingDate: offset < 0 ? end : today,
            targetMonth: month,
            text,
            sourceUrl: "",
            createdAt: stamp,
            createdBy: owner.id,
            status: "completed",
            summary: {
              overview: text.split("\n").slice(1, 3).join("\n"),
              decisions: [text.split("\n")[1]],
              risks: [text.split("\n")[2]],
              actions: [
                { title: action, ownerName: owner.name, dueDate: "", evidence },
              ],
              evidence: [evidence],
            },
            summaryProvider: "local",
            summaryError: "",
            taskLinks: [{ actionIndex: 0, taskId }],
            version: 1,
          });
          put("tasks", {
            id: taskId,
            accountId: aid,
            minuteId,
            minuteActionIndex: 0,
            title: `デモ：${month} ${name} ${action}`,
            description: `架空データの操作確認用。\n${text}`,
            projectIds: [projectId],
            status:
              offset < 0
                ? "done"
                : offset > 0
                  ? "todo"
                  : ["progress", "todo", "review", "done", "todo", "progress"][
                      i
                    ],
            priority: i < 2 ? "high" : "medium",
            assigneeId: owner.id,
            startDate:
              offset < 0
                ? `${month}-01`
                : offset > 0
                  ? `${month}-01`
                  : shiftDay(today, -3),
            dueDate:
              offset < 0
                ? end
                : offset > 0
                  ? `${month}-15`
                  : shiftDay(today, i === 1 ? -2 : i + 2),
            tags: ["デモ", "営業"],
            dependencies: [],
            custom: {},
            links: [],
            comments: [],
            approval: null,
            version: 1,
            createdAt: stamp,
            createdBy: user.id,
            updatedAt: stamp,
          });
          if (offset <= 0)
            for (const [n, type] of ["meeting", "proposal"].entries())
              put("salesActivities", {
                id: `demo-activity-${aid}-${month}-${type}`,
                accountId: aid,
                type,
                date: offset < 0 ? shiftDay(end, -n) : shiftDay(today, -n),
                notes: `【架空デモ】${goal}について${type === "meeting" ? "予算と課題を確認" : "改善提案を提出"}`,
                userId: owner.id,
                createdAt: stamp,
              });
        });
      },
    );
  });
  return {
    periods,
    created,
    totalCreated: Object.values(created).reduce((a, b) => a + b, 0),
    accounts: 6,
  };
}
