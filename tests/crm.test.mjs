import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase, digest } from "../server/store.mjs";
import { createApp } from "../server/index.mjs";
test("CRM permissions, staged integration, idempotency, conflicts, rotation and follow-up", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  for (const name of ["admin", "member"]) {
    store.saveUser({
      id: name,
      name,
      email: name + "@example.test",
      active: true,
      role: name,
      mustChangePassword: false,
    });
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(digest(name), name, Date.now() + 600000);
  }
  store.put("projects", { id: "project", name: "Team", rules: [], fields: [] });
  const app = createApp({
    store,
    production: false,
    allowedDomain: "",
    timers: false,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = async (path, body, user = "admin", secret) => {
    const r = await fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "X-Worknest": "1",
        "Content-Type": "application/json",
        ...(secret
          ? { Authorization: "Bearer " + secret }
          : { Cookie: "worknest_session=" + user }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal(
      (await call("/crm/tokens", { name: "SFA" }, "member")).status,
      403,
    );
    let issued = await call("/crm/tokens", { name: "SFA" });
    assert.equal(issued.status, 201);
    const token = issued.data.secret;
    assert.ok(!JSON.stringify(store.all("integrationTokens")).includes(token));
    assert.ok(
      !JSON.stringify((await call("/crm/bootstrap")).data).includes(token),
    );
    assert.equal(
      (await call("/crm/bootstrap", undefined, "none", token)).status,
      401,
    );
    const body = {
      requestId: "one",
      contacts: [{ externalId: "abc", name: "Example", consent: "unknown" }],
    };
    const staged = await call("/integrations/v1/contacts", body, "none", token);
    assert.equal(staged.status, 202);
    assert.equal(store.all("crmContacts").length, 0);
    assert.equal(
      (await call("/integrations/v1/contacts", body, "none", token)).data
        .duplicate,
      true,
    );
    assert.equal(
      (
        await call(
          "/integrations/v1/contacts",
          { ...body, contacts: [{ ...body.contacts[0], name: "Changed" }] },
          "none",
          token,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          "/crm/batches/apply",
          { id: staged.data.id, action: "apply" },
          "member",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/crm/batches/apply", {
          id: staged.data.id,
          action: "apply",
        })
      ).status,
      200,
    );
    let contact = store.all("crmContacts")[0];
    assert.ok(contact.id);
    assert.equal(contact.version, 1);
    const nextBatch = await call(
      "/integrations/v1/contacts",
      { ...body, requestId: "two" },
      "none",
      token,
    );
    const edited = await call(
      "/crm/contacts",
      { ...contact, notes: "manual", nextContact: "2026-09-15" },
      "member",
    );
    assert.equal(edited.status, 200);
    assert.equal(
      (
        await call("/crm/batches/apply", {
          id: nextBatch.data.id,
          action: "apply",
        })
      ).status,
      409,
    );
    assert.equal(store.get("crmContacts", contact.id).notes, "manual");
    const followup = await call(
      "/crm/followup",
      { id: contact.id, projectId: "project" },
      "member",
    );
    assert.equal(followup.status, 201);
    const updateResponse = await fetch(
      base + "/api/tasks/" + followup.data.id,
      {
        method: "PATCH",
        headers: {
          "X-Worknest": "1",
          "Content-Type": "application/json",
          Cookie: "worknest_session=member",
        },
        body: JSON.stringify({
          version: followup.data.version,
          status: "progress",
        }),
      },
    );
    assert.equal(updateResponse.status, 200);
    assert.equal(
      (
        await call(
          "/crm/followup",
          { id: contact.id, projectId: "project" },
          "member",
        )
      ).data.id,
      followup.data.id,
    );
    const rotated = await call("/crm/tokens/rotate", { id: issued.data.id });
    assert.equal(rotated.status, 201);
    assert.equal(
      (await call("/integrations/v1/contacts", body, "none", token)).status,
      401,
    );
    assert.equal(
      (
        await call(
          "/integrations/v1/contacts",
          body,
          "none",
          rotated.data.secret,
        )
      ).data.duplicate,
      true,
    );
    const third = await call(
      "/integrations/v1/contacts",
      { ...body, requestId: "three" },
      "none",
      rotated.data.secret,
    );
    assert.equal(
      (await call("/crm/batches/apply", { id: third.data.id, action: "apply" }))
        .status,
      200,
    );
    assert.equal(store.all("crmContacts").length, 1);
    contact = store.get("crmContacts", contact.id);
    assert.equal(contact.notes, "manual");
    await call("/crm/contacts", { ...contact, consent: "denied" });
    assert.equal(
      (await call("/crm/followup", { id: contact.id, projectId: "project" }))
        .status,
      400,
    );
    const audit = store.db
      .prepare("SELECT count(*) AS n FROM audit_log WHERE kind='crmContacts'")
      .get();
    assert.ok(audit.n >= 3);
    assert.equal(
      (await call("/crm/bootstrap", undefined, "member")).data.tokens.length,
      0,
    );
    await call("/crm/tokens/revoke", { id: rotated.data.id });
    assert.equal(
      (
        await call(
          "/integrations/v1/contacts",
          body,
          "none",
          rotated.data.secret,
        )
      ).status,
      401,
    );
  } finally {
    await app.close();
  }
});
