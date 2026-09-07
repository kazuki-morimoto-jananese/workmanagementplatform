import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { headerRow, sheetText, type ExcelSheet } from "./excel-import";

type Props = {
  disabled: boolean;
  onChange: (text: string, source: string) => void;
  onLoading: (loading: boolean) => void;
};
export function SalesImportFile({ disabled, onChange, onLoading }: Props) {
  const [sheets, setSheets] = useState<ExcelSheet[]>([]);
  const [selected, setSelected] = useState(0);
  const [firstRow, setFirstRow] = useState(1);
  const [filename, setFilename] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);
  const active = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      worker.current?.terminate();
      clearTimeout(timer.current);
      onLoading(false);
    };
  }, [onLoading]);

  function apply(sheet: ExcelSheet, row: number, name: string) {
    setError("");
    try {
      onChange(
        sheetText(sheet, row),
        `${name} / ${sheet.name} / 見出し${row}行`,
      );
    } catch (e) {
      onChange("", "");
      setError((e as Error).message);
    }
  }
  async function open(file?: File) {
    if (!file) return;
    onChange("", "");
    setSheets([]);
    setError("");
    setFilename(file.name);
    const excel = /\.xlsx$/i.test(file.name);
    if (!excel && !/\.(csv|tsv|txt)$/i.test(file.name)) {
      setError(
        ".xlsx / .csv / .tsv / .txtを選択してください。旧形式の.xlsは.xlsxで保存し直してください。",
      );
      return;
    }
    if (file.size > (excel ? 10_000_000 : 1_500_000)) {
      setError(
        excel
          ? "Excelは10MBまでです。対象シートだけのファイルに分けてください。"
          : "ファイルが大きすぎます。対象行を分けてください。",
      );
      return;
    }
    setLoading(true);
    onLoading(true);
    try {
      if (!excel) {
        const text = await file.text();
        if (active.current) onChange(text, file.name);
        return;
      }
      const buffer = await file.arrayBuffer();
      if (!active.current) return;
      const loaded = await new Promise<ExcelSheet[]>((resolve, reject) => {
        const w = new Worker(new URL("./excel.worker.ts", import.meta.url), {
          type: "module",
        });
        worker.current = w;
        timer.current = setTimeout(
          () =>
            reject(
              new Error(
                "読み取りがタイムアウトしました。対象シートだけのファイルに分けてください。",
              ),
            ),
          30_000,
        );
        w.onmessage = (event) =>
          event.data.error
            ? reject(new Error(event.data.error))
            : resolve(event.data.sheets);
        w.onerror = () =>
          reject(
            new Error(
              "Excelを読み取れませんでした。.xlsx形式で保存し直してください。",
            ),
          );
        w.postMessage(buffer, [buffer]);
      });
      if (!active.current) return;
      if (!loaded.length) throw new Error("シートがありません。");
      setSheets(loaded);
      setSelected(0);
      const row = headerRow(loaded[0].rows);
      setFirstRow(row);
      apply(loaded[0], row, file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      worker.current?.terminate();
      worker.current = null;
      clearTimeout(timer.current);
      setLoading(false);
      onLoading(false);
    }
  }
  return (
    <>
      <label className="sales-file-input">
        <Upload size={15} /> Excel / CSV / TSV を選択
        <input
          aria-label="営業マスタファイル"
          type="file"
          accept=".xlsx,.csv,.tsv,.txt"
          disabled={disabled || loading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void open(file);
          }}
        />
      </label>
      {loading && <p role="status">Excel・ファイルを読み取り中…</p>}
      {error && (
        <p role="alert" className="sales-preview-error">
          {error}
        </p>
      )}
      {filename && !loading && (
        <p className="sales-muted sales-file-name">選択ファイル：{filename}</p>
      )}
      {sheets.length > 0 && (
        <div className="sales-mapping-grid sales-excel-options">
          <label>
            対象シート
            <select
              aria-label="Excelの対象シート"
              disabled={disabled}
              value={selected}
              onChange={(e) => {
                const index = Number(e.target.value),
                  row = headerRow(sheets[index].rows);
                setSelected(index);
                setFirstRow(row);
                apply(sheets[index], row, filename);
              }}
            >
              {sheets.map((sheet, i) => (
                <option key={i} value={i}>
                  {sheet.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            見出し行
            <select
              aria-label="Excelの見出し行"
              disabled={disabled}
              value={firstRow}
              onChange={(e) => {
                const row = Number(e.target.value);
                setFirstRow(row);
                apply(sheets[selected], row, filename);
              }}
            >
              {sheets[selected].rows.slice(0, 50).map((row, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}行目：
                  {row.filter(Boolean).slice(0, 3).join(" / ").slice(0, 100)}
                </option>
              ))}
            </select>
          </label>
          <p>
            対象月とシート名を確認してください。数式は保存済みの計算結果を読み取り、再計算しません。未計算や計算エラーは空欄になるため、元のスプシで計算完了後にダウンロードしてください。IDの先頭ゼロは文字列として保存してください。
          </p>
        </div>
      )}
    </>
  );
}
