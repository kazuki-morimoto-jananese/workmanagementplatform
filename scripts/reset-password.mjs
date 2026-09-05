import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openStore, hashPassword } from "../server/store.mjs";

const email = process.argv[2]?.trim().toLowerCase();
const directory = process.env.DATA_DIR || "./data";
if (
  !email ||
  !process.stdin.isTTY ||
  !existsSync(resolve(directory, "worknest.sqlite"))
) {
  console.error(
    "Usage: node --env-file-if-exists=.env scripts/reset-password.mjs user@company.co.jp\nRun in an interactive terminal in the existing project directory.",
  );
  process.exit(1);
}
const store = openStore(directory);
const user = store.userByEmail(email);
if (!user) {
  console.error("Account not found.");
  store.db.close();
  process.exit(1);
}
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
const prompt = createInterface({
  input: process.stdin,
  output,
  terminal: true,
});
try {
  process.stdout.write("New temporary password (12+ characters, hidden): ");
  muted = true;
  const password = await prompt.question("");
  muted = false;
  process.stdout.write("\n");
  if (password.length < 12 || password.length > 256)
    throw new Error("Password must contain 12–256 characters.");
  process.stdout.write("Confirm password (hidden): ");
  muted = true;
  const confirmation = await prompt.question("");
  muted = false;
  process.stdout.write("\n");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  const hash = await hashPassword(password);
  store.transaction(() => {
    const current = store.user(user.id);
    store.saveUser({ ...current, password: hash, mustChangePassword: true });
    store.db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
  });
  console.log(
    "Password reset. Existing sessions are revoked. A password change will be required on next login.",
  );
} catch (error) {
  muted = false;
  console.error("\n" + error.message);
  process.exitCode = 1;
} finally {
  prompt.close();
  store.db.close();
}
