import { spawn } from "node:child_process";
const backend = spawn(
  process.execPath,
  ["--watch", "--env-file-if-exists=.env", "server/index.mjs"],
  { stdio: "inherit" },
);
const frontend = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    backend.kill();
    frontend.kill();
    process.exit();
  });
for (const child of [backend, frontend])
  child.on("exit", (code) => {
    backend.kill();
    frontend.kill();
    process.exit(code || 0);
  });
