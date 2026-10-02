import pptxgen from "pptxgenjs";
import type { CustomerProposal } from "../shared/customer-proposal.mjs";

// No binary, customer data, images or fonts leave the browser during export.
export async function downloadProposalPptx(deck: CustomerProposal) {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = deck.options.presenter || "Worknest";
  pptx.company = deck.options.issuer;
  pptx.subject = "分析結果に基づく改善提案";
  pptx.title = deck.title;
  pptx.theme = { headFontFace: "Yu Gothic", bodyFontFace: "Yu Gothic" };
  const color = {
    ink: "213C42",
    green: "315B49",
    pale: "EFF5F2",
    muted: "526770",
    line: "D4E0DB",
    blue: "4D7293",
  };
  deck.slides.forEach((s, index) => {
    const slide = pptx.addSlide();
    const cover = s.kind === "cover";
    slide.background = { color: cover ? color.green : "FFFFFF" };
    const ink = cover ? "FFFFFF" : color.ink;
    const text = (
      str: string,
      x: number,
      y: number,
      w: number,
      h: number,
      size = 18,
      extra = {},
    ) =>
      slide.addText(str, {
        x,
        y,
        w,
        h,
        fontFace: "Yu Gothic",
        fontSize: size,
        color: ink,
        margin: 0,
        lang: "ja-JP",
        valign: "middle",
        ...extra,
      });
    if (!cover)
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 0.14,
        h: 7.5,
        fill: { color: color.green },
        line: { color: color.green },
      });
    text(s.title, 0.65, 0.45, 12, 0.55, 26, { bold: true });
    if (s.kind === "cover" || s.kind === "text") {
      s.lines.forEach((line, i) =>
        text(line, 0.75, 1.5 + i * 0.405, 11.85, 0.39, cover ? 21 : 19),
      );
    } else if (s.kind === "table") {
      const widths =
        s.headers.length === 4
          ? [2.25, 3.15, 3.15, 3.15]
          : [2.3, 1.7, 1.95, 1.95, 1.95, 1.95];
      [s.headers, ...s.rows].forEach((row, ri) => {
        let x = 0.65;
        row.forEach((cell, ci) => {
          slide.addShape(pptx.ShapeType.rect, {
            x,
            y: 1.5 + ri * 0.52,
            w: widths[ci],
            h: 0.52,
            fill: {
              color: ri === 0 ? color.green : ri % 2 ? color.pale : "FFFFFF",
            },
            line: { color: color.line, width: 0.5 },
          });
          text(cell, x + 0.09, 1.51 + ri * 0.52, widths[ci] - 0.18, 0.49, 13, {
            color: ri === 0 ? "FFFFFF" : color.ink,
            bold: ri === 0,
            align: ci === 0 ? "left" : "right",
            fit: "shrink",
          });
          x += widths[ci];
        });
      });
      text(s.caption, 0.7, 6.05, 11.9, 0.72, 13, { color: color.muted });
    } else {
      s.series.forEach((series, i) => {
        const x = 0.75 + i * 4.15;
        text(series.label, x, 1.6, 3.65, 0.5, 22, { bold: true });
        const max = Math.max(
          0,
          ...series.values.filter((v): v is number => v !== null),
        );
        series.values.forEach((v, j) => {
          const y = 2.65 + j * 1.4;
          text(
            `期間${j ? "B" : "A"}  ${series.formatted[j]}`,
            x,
            y - 0.35,
            3.65,
            0.35,
            14,
          );
          slide.addShape(pptx.ShapeType.rect, {
            x,
            y: y + 0.1,
            w: 3.6,
            h: 0.38,
            fill: { color: color.pale },
            line: { color: color.pale },
          });
          if (v !== null && v > 0 && max > 0)
            slide.addShape(pptx.ShapeType.rect, {
              x,
              y: y + 0.1,
              w: (3.6 * v) / max,
              h: 0.38,
              fill: { color: j ? color.green : color.blue },
              line: { color: j ? color.green : color.blue },
            });
        });
      });
      text(s.caption, 0.7, 6.05, 11.9, 0.7, 13, { color: color.muted });
    }
    text(
      `${deck.issuedOn}  ·  ${index + 1} / ${deck.slides.length}`,
      0.7,
      7.05,
      12,
      0.22,
      10,
      { color: cover ? "D7E7DF" : color.muted, align: "right" },
    );
  });
  const name = deck.title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 65);
  await pptx.writeFile({
    fileName: `${name}_${deck.issuedOn}.pptx`,
    compression: true,
  });
}
