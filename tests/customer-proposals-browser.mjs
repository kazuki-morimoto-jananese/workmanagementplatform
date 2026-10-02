import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

export async function runCustomerProposalChecks(page) {
  // Placement analysis from the preceding test is saved and selected.
  await page
    .getByRole("button", { name: "顧客向け提案資料を作成", exact: true })
    .click();
  const editor = page.getByRole("region", {
    name: "顧客向け提案資料",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "PowerPointをダウンロード" }),
  ).toBeDisabled();
  await editor
    .getByLabel("資料タイトル", { exact: true })
    .fill("顧客提案テスト");
  await editor
    .getByLabel("提案サマリー", { exact: true })
    .fill("配信構成とCV計測を確認し、小規模テストの条件を相談します。");
  await page
    .getByRole("button", { name: "提案資料の編集を閉じる", exact: true })
    .click();
  await page
    .getByRole("button", { name: "顧客向け提案資料を作成", exact: true })
    .click();
  await expect(editor.getByLabel("提案サマリー", { exact: true })).toHaveValue(
    "配信構成とCV計測を確認し、小規模テストの条件を相談します。",
  );
  await editor.getByLabel("CVの定義", { exact: true }).fill("応募完了");
  await editor
    .getByLabel("次のアクション", { exact: true })
    .fill("双方で計測条件を確認し、来週に検証日を合意する。");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/sales/customer-proposals") &&
      r.request().method() === "POST",
  );
  await editor
    .getByRole("button", { name: "提案資料を共有保存", exact: true })
    .click();
  const savedResponse = await response;
  assert.equal(savedResponse.status(), 201);
  const saved = await savedResponse.json();
  assert.equal(saved.deck.options.cvDefinition, "応募完了");
  assert(
    saved.deck.slides.some(
      (s) =>
        s.kind === "table" &&
        s.rows.some((r) => r[0] === "消化額" && r[2] === "1,000 円"),
    ),
  );
  await editor.getByLabel("提案資料の提出内容を確認済み").check();
  const downloading = page.waitForEvent("download");
  await editor
    .getByRole("button", { name: "PowerPointをダウンロード", exact: true })
    .click();
  const file = await downloading;
  assert(file.suggestedFilename().endsWith(".pptx"));
  const zip = unzipSync(readFileSync(await file.path()));
  const slides = Object.keys(zip).filter((k) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(k),
  );
  assert.equal(slides.length, saved.deck.slides.length);
  const xml = slides.map((k) => strFromU8(zip[k]));
  assert(xml.some((s) => s.includes("1,000 円")));
  assert(xml.some((s) => s.includes("応募完了")));
  assert(xml.some((s) => s.includes("LINE")));
  for (const secret of [
    "placement-before.xlsx",
    "placement-after.csv",
    "account-browser",
    "SHA-256",
    "9000000000000000001",
  ])
    assert(!xml.join("").includes(secret), secret);
  assert.equal(
    await page.evaluate(
      (texts) =>
        texts.every(
          (s) =>
            !new DOMParser()
              .parseFromString(s, "application/xml")
              .querySelector("parsererror"),
        ),
      xml,
    ),
    true,
  );
  assert(xml.every((s) => s.includes("<p:sp>"))); // Editable shapes, not flattened images.
  await expect(
    editor.getByRole("button", { name: "PowerPointをダウンロード" }),
  ).toBeEnabled();
  await editor
    .getByRole("button", { name: "提案資料をPDF保存", exact: true })
    .click();
  await expect(page.locator("#worknest-printout")).toContainText(
    "顧客提案テスト",
  );
  assert.equal(
    await page.locator("#worknest-printout .proposal-slide").count(),
    saved.deck.slides.length,
  );
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  assert(pdf.length > 3000);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await editor
    .getByLabel("提案サマリー", { exact: true })
    .fill("改訂版のサマリー");
  await expect(
    editor.getByRole("button", { name: "PowerPointをダウンロード" }),
  ).toBeDisabled();
  await editor
    .getByRole("button", { name: "新しい版として保存", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText("保存しました");
  await editor
    .getByLabel("保存した提案資料", { exact: true })
    .selectOption(saved.id);
  await expect(editor.getByLabel("提案サマリー", { exact: true })).toHaveValue(
    saved.deck.options.overview,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await editor
    .locator(".proposal-slide")
    .first()
    .screenshot({ path: "artifacts/customer-proposal-preview.png" });
  // KW history uses the same flow and template, without replacing the LINE source.
  await page.getByRole("button", { name: /^KW期間比較 · / }).click();
  await page
    .getByRole("button", { name: "顧客向け提案資料を作成", exact: true })
    .click();
  await expect(page.getByLabel("資料タイトル", { exact: true })).toHaveValue(
    "キーワード分析と改善提案",
  );
  await page
    .getByRole("button", { name: "提案資料を共有保存", exact: true })
    .click();
  await page.getByLabel("提案資料の提出内容を確認済み").check();
  const kwDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PowerPointをダウンロード", exact: true })
    .click();
  assert((await kwDownload).suggestedFilename().endsWith(".pptx"));
  console.log(
    "Customer proposals passed: LINE and KW PPTX, valid XML, editable text, redaction, PDF, immutable history, edits require reconfirmation, mobile.",
  );
}
