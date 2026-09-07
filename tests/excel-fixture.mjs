import { zipSync, strToU8 } from "fflate";
const xml = (v) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
export function excelFixture() {
  const sheet = (rows) =>
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (row, i) =>
          `<row r="${i + 1}">${row
            .map((cell, j) => {
              const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
              if (cell && typeof cell === "object")
                return `<c r="${ref}"><f>${cell.formula}</f><v>${cell.value}</v></c>`;
              if (typeof cell === "number")
                return `<c r="${ref}"><v>${cell}</v></c>`;
              return `<c r="${ref}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
            })
            .join("")}</row>`,
      )
      .join("")}</sheetData></worksheet>`;
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "xl/workbook.xml":
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="説明" sheetId="1" r:id="rId1"/><sheet name="営業マスタ" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheet([
      ["営業マスタのシートを選択してください。"],
    ]),
    "xl/worksheets/sheet2.xml": sheet([
      ["当月のテスト用営業マスタ"],
      [
        "アカウントID",
        "アカウント名",
        "今週Gトレ",
        "今月ヨミ",
        "当月担当者",
        "スタンバイ予算",
        "IndeedCPA",
      ],
      [
        "B001",
        "株式会社ブラウザーテスト",
        { formula: "1240000/2", value: 620000 },
        900000,
        "森本 一輝",
        800000,
        4000,
      ],
      ["0007", '架空の"Excel"社\nテスト部', 0, "", "", 0, ""],
    ]),
  };
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([path, value]) => [path, strToU8(value)]),
      ),
    ),
  );
}
