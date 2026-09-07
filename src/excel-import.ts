export type ExcelSheet = { name: string; rows: string[][] };

export function headerRow(rows: string[][]): number {
  const clean = (v: string) => v.normalize("NFKC").replace(/\s/g, "");
  const found = rows
    .slice(0, 50)
    .findIndex(
      (r) =>
        r.some((v) => clean(v) === "アカウントID") &&
        r.some((v) => clean(v) === "アカウント名"),
    );
  return found < 0 ? 1 : found + 1;
}

export function sheetText(sheet: ExcelSheet, firstRow: number): string {
  if (
    !Number.isInteger(firstRow) ||
    firstRow < 1 ||
    firstRow > sheet.rows.length
  )
    throw new Error("見出し行を選択してください。");
  const rows = sheet.rows
    .slice(firstRow - 1)
    .filter((r) => r.some((v) => v.trim()));
  if (rows.length > 5001)
    throw new Error(
      "1回の取込は5,000件までです。Excelの対象行を分けてください。",
    );
  if (rows.some((r) => r.length > 200))
    throw new Error("1回の取込は200列までです。必要な列に絞ってください。");
  const result = rows
    .map((r) => r.map((v) => '"' + v.replaceAll('"', '""') + '"').join("\t"))
    .join("\n");
  if (new TextEncoder().encode(JSON.stringify(result)).length > 1_500_000)
    throw new Error("表が大きすぎます。対象行・列を分けてください。");
  return result;
}
