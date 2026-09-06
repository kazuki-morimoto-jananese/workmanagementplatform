import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  googleDocumentId,
  readGoogleDocument,
  validateExtraction,
  extractMinuteNumbers,
  numericLiteral,
} from "../server/minute-integrations.mjs";
test("Drive documents use fixed hosts, read-only scope and stable revisions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-doc-test-"));
  const prior = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  try {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const file = join(directory, "credential.json");
    writeFileSync(
      file,
      JSON.stringify({
        type: "service_account",
        client_email: "test@service.test",
        private_key: privateKey,
      }),
    );
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = file;
    for (const bad of [
      "http://docs.google.com/document/d/documentTest123456",
      "https://evil.test/document/d/documentTest123456",
      "https://docs.google.com@evil.test/document/d/documentTest123456",
      "https://docs.google.com/document/d/../../etc",
    ])
      assert.throws(() => googleDocumentId(bad));
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (url.includes("oauth2"))
        return Response.json({ access_token: "mock-token", expires_in: 3600 });
      if (url.includes("/export?"))
        return new Response("Google議事録\n予算 300万円");
      return Response.json({
        name: "営業定例",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-09-06T00:00:00Z",
        trashed: false,
      });
    };
    const result = await readGoogleDocument(
      "https://docs.google.com/document/d/documentTest123456/edit",
      { fetchImpl },
    );
    assert.match(result.text, /予算 300万円/);
    const jwt = new URLSearchParams(calls[0].init.body)
      .get("assertion")
      .split(".")[1];
    assert.equal(
      JSON.parse(Buffer.from(jwt, "base64url")).scope,
      "https://www.googleapis.com/auth/drive.readonly",
    );
    assert.ok(
      calls
        .slice(1)
        .every((c) =>
          c.url.startsWith("https://www.googleapis.com/drive/v3/files/"),
        ),
    );
    assert.ok(calls.every((c) => c.init.redirect === "error"));
    await assert.rejects(
      readGoogleDocument(result.sourceUrl, {
        fetchImpl: async (url, init) =>
          url.includes("/export?")
            ? new Response("SECRET", { status: 403 })
            : fetchImpl(url, init),
      }),
      (e) => e.status === 503 && !e.message.includes("SECRET"),
    );
    await assert.rejects(
      readGoogleDocument(result.sourceUrl, {
        fetchImpl: async (url, init) =>
          url.endsWith("fields=modifiedTime")
            ? Response.json({ modifiedTime: "changed" })
            : fetchImpl(url, init),
      }),
      (e) => e.status === 409,
    );
  } finally {
    if (prior === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    else process.env.GOOGLE_SERVICE_ACCOUNT_FILE = prior;
    rmSync(directory, { recursive: true, force: true });
  }
});
test("Gemini numeric extraction verifies evidence, currency units, month and schema", async () => {
  const minute = {
    targetMonth: "2026-09",
    meetingDate: "2026-09-06",
    text: "9月のスタンバイ着地ヨミは300万円。Indeed CPAは1,500円。",
  };
  const value = {
    month: "2026-09",
    fields: [
      {
        path: "forecast",
        value: 3000000,
        literal: "300万円",
        evidence: "9月のスタンバイ着地ヨミは300万円。",
      },
    ],
  };
  assert.equal(numericLiteral("１．５億円"), 150000000);
  assert.equal(validateExtraction(value, minute).fields[0].value, 3000000);
  assert.throws(() =>
    validateExtraction({ ...value, month: "2026-10" }, minute),
  );
  for (const change of [
    { value: 300 },
    { evidence: "作り話" },
    { literal: "500万円" },
    { path: "__proto__.polluted" },
    { value: -1 },
    { value: null },
  ])
    assert.throws(() =>
      validateExtraction(
        { ...value, fields: [{ ...value.fields[0], ...change }] },
        minute,
      ),
    );
  assert.throws(() =>
    validateExtraction(
      { ...value, fields: [value.fields[0], value.fields[0]] },
      minute,
    ),
  );
  const priorKey = process.env.GEMINI_API_KEY,
    priorModel = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_API_KEY = "fake-key-for-test";
    process.env.GEMINI_MODEL = "test-model";
    let calls = 0;
    const output = await extractMinuteNumbers(minute, {
      fetchImpl: async (url, init) => {
        calls++;
        assert.ok(url.startsWith("https://generativelanguage.googleapis.com/"));
        assert.ok(!url.includes("fake-key"));
        const payload = JSON.parse(init.body);
        assert.equal(
          payload.generationConfig.responseMimeType,
          "application/json",
        );
        assert.match(
          payload.systemInstruction.parts[0].text,
          /予算と消化額を混同しない/,
        );
        return Response.json({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(value) }] } },
          ],
        });
      },
    });
    assert.deepEqual(output, value);
    assert.equal(calls, 1);
  } finally {
    if (priorKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = priorKey;
    if (priorModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = priorModel;
  }
});
