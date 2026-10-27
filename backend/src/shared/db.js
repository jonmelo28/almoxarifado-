import mysql from "mysql2/promise";
import { config } from "../config/env.js";
export const pool = mysql.createPool(config.db);
pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+00:00'");
});
export async function rows(sql, values = [], db = pool) {
  const [result] = await db.execute(sql, values);
  return result;
}
export async function transaction(work) {
  const db = await pool.getConnection();
  try {
    await db.query("SET time_zone = '+00:00'");
    await db.beginTransaction();
    const result = await work(db);
    await db.commit();
    return result;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}
export async function audit(db, actor, action, entity, id, data = {}) {
  const result = await rows(
    "INSERT INTO auditoria (ator_id,acao,entidade,entidade_id,dados,origem) VALUES (?,?,?,?,?,?)",
    [
      actor.id,
      action,
      entity,
      id,
      JSON.stringify(data),
      actor.origem || "painel",
    ],
    db,
  );
  return result.insertId;
}
