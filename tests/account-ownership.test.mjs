import test from "node:test";
import assert from "node:assert/strict";
import {
  accountOwnedBy,
  accountInOwnerFilter,
} from "../src/account-ownership.ts";
test("Owner IDs are authoritative; unique normalized names support unlinked masters", () => {
  const user = { id: "one", name: "担当 一郎" },
    other = { id: "two", name: "担当 二郎" };
  assert(
    accountOwnedBy({ ownerId: "one", ownerName: "" }, user, [user, other]),
  );
  assert(
    !accountOwnedBy({ ownerId: "two", ownerName: user.name }, user, [
      user,
      other,
    ]),
  );
  assert(
    accountOwnedBy({ ownerId: "", ownerName: "担当　一郎" }, user, [
      user,
      other,
    ]),
  );
  assert(
    !accountOwnedBy({ ownerId: "", ownerName: user.name }, user, [
      user,
      { id: "dup", name: user.name },
    ]),
  );
  assert(
    accountInOwnerFilter({ ownerId: "two", ownerName: "" }, "two", user, [
      user,
      other,
    ]),
  );
  assert(
    accountInOwnerFilter(
      { ownerId: "", ownerName: "未登録担当" },
      "name:未登録担当",
      user,
      [user, other],
    ),
  );
});
