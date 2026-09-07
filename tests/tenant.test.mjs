import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTenant } from "../scripts/prepare-tenant.mjs";
test("company provisioning creates isolated configuration and refuses overwrites and unsafe IDs", () => {
  const root = mkdtempSync(join(tmpdir(), "worknest-tenant-"));
  try {
    const one = prepareTenant({
      root,
      slug: "one",
      origin: "https://one.example.com",
      emailDomain: "example.com",
    });
    const two = prepareTenant({
      root,
      slug: "two",
      origin: "https://two.example.com",
      emailDomain: "other.example",
    });
    const read = (dir, file) =>
      JSON.parse(readFileSync(join(dir, file), "utf8"));
    assert.notEqual(
      read(one, "wrangler.json").name,
      read(two, "wrangler.json").name,
    );
    assert.notEqual(
      read(one, "secrets.json").SETUP_TOKEN,
      read(two, "secrets.json").SETUP_TOKEN,
    );
    assert.equal(
      read(one, "secrets.json").APP_ORIGIN,
      "https://one.example.com",
    );
    assert.throws(() =>
      prepareTenant({
        root,
        slug: "one",
        origin: "https://one.example.com",
        emailDomain: "example.com",
      }),
    );
    assert.throws(() =>
      prepareTenant({
        root,
        slug: "../bad",
        origin: "https://one.example.com",
        emailDomain: "example.com",
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
