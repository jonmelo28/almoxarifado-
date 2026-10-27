import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool, rows } from "../shared/db.js";
let db;
try {
  db = await pool.getConnection();
  const [[selected]] = await db.query(
    "SELECT DATABASE() AS name, VERSION() AS version",
  );
  if (!selected.name) throw new Error("Nenhum banco selecionado.");
  console.log(
    `Banco selecionado: ${selected.name}; MySQL: ${selected.version}`,
  );
  const [[lock]] = await db.query(
    "SELECT GET_LOCK('almoxarifado_migrations',10) AS acquired",
  );
  if (!lock.acquired) throw new Error("Outra migração está em execução.");
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (nome VARCHAR(190) PRIMARY KEY, checksum CHAR(64) NOT NULL, concluida BOOLEAN NOT NULL DEFAULT FALSE, criada_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  const dir = new URL("../../../database/migrations/", import.meta.url);
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(new URL(name, dir), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    const existing = await rows(
      "SELECT * FROM schema_migrations WHERE nome=?",
      [name],
      db,
    );
    if (existing.length) {
      if (existing[0].checksum !== hash || !existing[0].concluida)
        throw new Error(
          `Migração alterada ou incompleta: ${name}. Inspecione manualmente; DDL MySQL não é transacional.`,
        );
      continue;
    }
    await rows(
      "INSERT INTO schema_migrations (nome,checksum) VALUES (?,?)",
      [name, hash],
      db,
    );
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.query(statement);
    await rows(
      "UPDATE schema_migrations SET concluida=TRUE WHERE nome=?",
      [name],
      db,
    );
    console.log(`Aplicada: ${name}`);
  }
} catch (error) {
  console.error("Migração interrompida:", error.code || error.message);
  process.exitCode = 1;
} finally {
  if (db) {
    await db
      .query("SELECT RELEASE_LOCK('almoxarifado_migrations')")
      .catch(() => {});
    db.release();
  }
  await pool.end();
}
