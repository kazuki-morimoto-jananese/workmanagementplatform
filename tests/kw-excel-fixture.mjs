import { zipSync, strToU8 } from "fflate";
export function kwExcelFixture() {
  const rows = [
    ["テスト用のKW実績"],
    ["keyword", "company_key", "cost", "click", "cv", "impression"],
    ["派遣", "OWN", 1000, 100, 10, 1000],
    ["軽作業", "OWN", 1000, 100, 10, 1000],
    ["派遣", "COMP", 1000000, 1000, 100, 10000],
  ];
  const sheet = (items) =>
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${items.map((row, i) => `<row r="${i + 1}">${row.map((v, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}"${typeof v === "number" ? "" : ' t="inlineStr"'}>${typeof v === "number" ? `<v>${v}</v>` : `<is><t>${v}</t></is>`}</c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const files = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="説明" sheetId="1" r:id="rId1"/><sheet name="KW実績" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": sheet([["KW実績シートを選択"]]),
    "xl/worksheets/sheet2.xml": sheet(rows),
  };
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, strToU8(v)]),
      ),
    ),
  );
}
