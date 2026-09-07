import readExcelFile from "read-excel-file/web-worker";

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const sheets = await readExcelFile(event.data, {
      parseNumber: (value) => value,
    });
    let cells = 0;
    const result = sheets.map((sheet) => ({
      name: sheet.sheet,
      rows: sheet.data.map((row) => {
        cells += row.length;
        if (cells > 500_000)
          throw new Error(
            "ブックが大きすぎます。対象シートだけのExcelを用意してください。",
          );
        return row.map((value) =>
          value instanceof Date
            ? value.toISOString().slice(0, 10)
            : String(value ?? ""),
        );
      }),
    }));
    self.postMessage({ sheets: result });
  } catch {
    self.postMessage({
      error:
        "Excelを読み取れませんでした。暗号化されていない.xlsx形式で、対象シートを小さくして保存し直してください。",
    });
  }
};
