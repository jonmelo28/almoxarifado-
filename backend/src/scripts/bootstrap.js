import bcrypt from "bcrypt";
import { z } from "zod";
import { pool, rows, audit } from "../shared/db.js";
let db;
try {
  db = await pool.getConnection();
  const email = z
    .string()
    .email()
    .parse(process.env.ADMIN_BOOTSTRAP_EMAIL)
    .toLowerCase();
  const password = z
    .string()
    .min(12)
    .max(72)
    .refine((s) => Buffer.byteLength(s, "utf8") <= 72)
    .parse(process.env.ADMIN_BOOTSTRAP_PASSWORD);
  const [[lock]] = await db.query(
    "SELECT GET_LOCK('almoxarifado_bootstrap',10) AS acquired",
  );
  if (!lock.acquired) throw new Error("Bootstrap em execução.");
  await db.beginTransaction();
  if (
    (await rows("SELECT id FROM usuarios WHERE papel='ADM' LIMIT 1", [], db))
      .length
  )
    throw new Error("Já existe administrador. Use o painel.");
  const result = await rows(
    "INSERT INTO usuarios (nome,email,identificacao,senha_hash,papel) VALUES (?,?,?,?,'ADM')",
    ["Administrador", email, "ADM-BOOTSTRAP", await bcrypt.hash(password, 12)],
    db,
  );
  await audit(
    db,
    { id: result.insertId, origem: "cli" },
    "BOOTSTRAP",
    "usuarios",
    result.insertId,
  );
  await db.commit();
  console.log("Administrador criado. Remova a senha de bootstrap do .env.");
} catch (error) {
  if (db) await db.rollback();
  console.error(
    "Bootstrap interrompido:",
    error.code ||
      (error.name === "ZodError"
        ? "Verifique email e senha (12 a 72 caracteres)."
        : error.message),
  );
  process.exitCode = 1;
} finally {
  if (db) {
    await db
      .query("SELECT RELEASE_LOCK('almoxarifado_bootstrap')")
      .catch(() => {});
    db.release();
  }
  await pool.end();
}
