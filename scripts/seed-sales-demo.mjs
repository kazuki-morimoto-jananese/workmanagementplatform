import { openStore } from "../server/store.mjs";
import { seedSalesDemo } from "../server/sales-demo.mjs";
const store = openStore(process.env.DATA_DIR || "./data");
try {
  const admin = store.users().find((u) => u.active && u.role === "admin");
  const result = seedSalesDemo(store, admin);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  store.db.close();
}
