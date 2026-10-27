import { createServer } from "vite";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// Vite no processo principal evita processos órfãos na limpeza de árvores cmd.exe no Windows.
const server = await createServer({
  root: fileURLToPath(new URL("../frontend", import.meta.url)),
  configFile: fileURLToPath(
    new URL("../frontend/vite.config.js", import.meta.url),
  ),
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
try {
  await server.listen();
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
      ),
      "test",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: { ...process.env, E2E_SERVER_MANAGED: "1" } },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await server.close();
}
