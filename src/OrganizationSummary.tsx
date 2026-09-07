import type { OrgUnit } from "./types";
import { organizationName } from "./types";
import type { PlanningRow } from "./sales-planning";
import { belongsTo } from "./sales-organization";
const yen = (values: (number | null)[]) =>
  values.some((v) => v !== null)
    ? "¥" +
      values
        .reduce<number>((sum, v) => sum + (v ?? 0), 0)
        .toLocaleString("ja-JP")
    : "—";
export function OrganizationSummary({
  units,
  rows,
  selected,
  select,
}: {
  units: OrgUnit[];
  rows: PlanningRow[];
  selected: string;
  select: (id: string) => void;
}) {
  const children = units.filter((u) =>
    selected === "all" ? !u.parentId : u.parentId === selected,
  );
  const groups = children.map((u) => ({
    id: u.id,
    name: u.name,
    rows: rows.filter((r) => belongsTo(units, r.orgUnitId, u.id)),
  }));
  const direct = rows.filter((r) =>
    selected === "all" || selected === "unassigned"
      ? belongsTo(units, r.orgUnitId, "unassigned")
      : r.orgUnitId === selected,
  );
  if (direct.length)
    groups.push({
      id: selected === "all" ? "unassigned" : selected,
      name: selected === "all" ? "所属未設定" : "この組織に直接所属",
      rows: direct,
    });
  return (
    <section className="panel sales-organization" aria-label="組織別営業サマリー">
      <h2>組織別営業サマリー</h2>
      <label>
        集計する組織{" "}
        <select
          aria-label="営業サマリーの組織"
          value={selected}
          onChange={(e) => select(e.target.value)}
        >
          <option value="all">会社全体</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {organizationName(units, u.id)}
            </option>
          ))}
          <option value="unassigned">所属未設定</option>
        </select>
      </label>
      <p>
        部 → グループ →
        チームを選ぶと、下の指標・アカウント一覧も切り替わります。個人目標の所属を基準に集計します。所属未設定は別表示し、二重計上しません。
      </p>
      <div className="sales-table-scroll">
        <table className="sales-table">
          <thead>
            <tr>
              <th>組織</th>
              <th>担当者数</th>
              <th>個人目標合計</th>
              <th>Gトレ</th>
              <th>ヨミ</th>
              <th>ヨミ未入力</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <th>
                  <button className="button" onClick={() => select(g.id)}>
                    {g.name}
                  </button>
                </th>
                <td>{g.rows.length}</td>
                <td>{yen(g.rows.map((r) => r.target))}</td>
                <td>{yen(g.rows.map((r) => r.trend))}</td>
                <td>{yen(g.rows.map((r) => r.forecast))}</td>
                <td>{g.rows.reduce((s, r) => s + r.missing, 0)}件</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!units.length && (
        <p>
          設定 →
          組織と所属で組織を登録し、個人目標の編集画面で各担当者の所属を指定してください。
        </p>
      )}
    </section>
  );
}
