import { createApp } from "./app.js";
import { config, checkSecret } from "./config/env.js";
import { pool } from "./shared/db.js";
checkSecret();
await pool.query("SELECT 1");
const app = createApp();
const server = app.listen(config.port, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      level: "info",
      message: "API iniciada",
      port: config.port,
    }),
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await app.locals.sessionStore.close();
      await pool.end();
      process.exit(0);
    }),
  );
