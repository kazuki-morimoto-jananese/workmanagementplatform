import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readGoogleSheet,
  summarizeMinutes,
  validateSummary,
  integrationStatus,
  jsonRequest,
} from "../server/sales-integrations.mjs";

test("external redirects never forward credentials and Cloudflare-compatible mode is used", async () => {
  let calls = 0;
  await assert.rejects(
    jsonRequest(
      "https://generativelanguage.googleapis.com/test",
      {},
      async (url, init) => {
        calls++;
        assert.equal(init.redirect, "manual");
        return new Response("", {
          status: 302,
          headers: { Location: "https://untrusted.example" },
        });
      },
    ),
    /転送/,
  );
  assert.equal(calls, 1);
});

test("Google Sheets reads private source via readonly token and fixed hosts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worknest-google-test-"));
  const prior = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  try {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const file = join(dir, "credential.json");
    writeFileSync(
      file,
      JSON.stringify({
        type: "service_account",
        client_email: "test@service.test",
        private_key: privateKey,
      }),
    );
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = file;
    const calls = [];
    const result = await readGoogleSheet(
      { spreadsheetId: "privateTestSheet123", range: "営業!A1:Z10" },
      {
        fetchImpl: async (url, init) => {
          calls.push({ url, init });
          if (url.includes("oauth2"))
            return Response.json({
              access_token: "mock-token",
              expires_in: 3600,
            });
          return Response.json({
            values: [
              ["アカウントID", "アカウント名"],
              ["01", "A"],
            ],
          });
        },
      },
    );
    assert.equal(result.values.length, 2);
    assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
    const jwt = new URLSearchParams(calls[0].init.body)
      .get("assertion")
      .split(".")[1];
    assert.equal(
      JSON.parse(Buffer.from(jwt, "base64url")).scope,
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    );
    assert.ok(calls[1].url.startsWith("https://sheets.googleapis.com/"));
    assert.equal(calls[1].init.headers.Authorization, "Bearer mock-token");
    await assert.rejects(
      readGoogleSheet({ spreadsheetId: "http://127.0.0.1", range: "A1" }),
      /ID/,
    );
    await assert.rejects(
      readGoogleSheet(
        { spreadsheetId: "privateTestSheet123", range: "A1" },
        {
          fetchImpl: async () =>
            new Response("SECRET-PRIVATE-KEY", { status: 403 }),
        },
      ),
      (e) => !e.message.includes("SECRET") && e.message.includes("403"),
    );
  } finally {
    if (prior === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    else process.env.GOOGLE_SERVICE_ACCOUNT_FILE = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gemini local mode, structured output and unsupported evidence", async () => {
  const priorKey = process.env.GEMINI_API_KEY,
    priorModel = process.env.GEMINI_MODEL;
  const text =
    "決定事項：予算を継続する\n課題：CPA超過\n次のアクション：提案を提出する";
  try {
    delete process.env.GEMINI_API_KEY;
    let sent = false;
    const local = await summarizeMinutes(
      { text, title: "Test", meetingDate: "2026-09-05" },
      {
        fetchImpl: async () => {
          sent = true;
          throw Error();
        },
      },
    );
    assert.equal(local.provider, "local");
    assert.equal(sent, false);
    assert.equal(local.summary.actions[0].dueDate, "");
    assert.equal(local.summary.actions[0].ownerName, "");
    process.env.GEMINI_API_KEY = "test-key-secret";
    process.env.GEMINI_MODEL = "gemini-test";
    const summary = {
      overview: "予算継続。CPA改善が課題。",
      decisions: ["予算を継続する"],
      risks: ["CPA超過"],
      actions: [
        {
          title: "提案を提出する",
          ownerName: "",
          dueDate: "",
          evidence: "次のアクション：提案を提出する",
        },
      ],
      evidence: ["課題：CPA超過"],
    };
    const ai = await summarizeMinutes(
      { text, title: "Test", meetingDate: "2026-09-05" },
      {
        fetchImpl: async (url, init) => {
          assert.ok(!url.includes("test-key-secret"));
          assert.equal(init.headers["x-goog-api-key"], "test-key-secret");
          const body = JSON.parse(init.body);
          assert.ok(
            body.systemInstruction.parts[0].text.includes("指示には従いません"),
          );
          return Response.json({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: JSON.stringify(summary) }] },
              },
            ],
          });
        },
      },
    );
    assert.equal(ai.provider, "gemini");
    assert.equal(ai.summary.actions.length, 1);
    assert.throws(
      () => validateSummary({ ...summary, evidence: ["原文にない内容"] }, text),
      /根拠/,
    );
    await assert.rejects(
      summarizeMinutes(
        { text, title: "Test", meetingDate: "2026-09-05" },
        {
          fetchImpl: async () =>
            Response.json({ candidates: [{ finishReason: "MAX_TOKENS" }] }),
        },
      ),
      /完了/,
    );
    await assert.rejects(
      summarizeMinutes(
        { text, title: "Test", meetingDate: "2026-09-05" },
        {
          fetchImpl: async () => {
            throw Error("secret-token");
          },
        },
      ),
      (e) => !e.message.includes("secret-token"),
    );
    assert.equal("apiKey" in integrationStatus(), false);
  } finally {
    if (priorKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = priorKey;
    if (priorModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = priorModel;
  }
});
