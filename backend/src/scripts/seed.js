import { pool, rows, transaction } from "../shared/db.js";
if (process.env.NODE_ENV !== "development") {
  console.error("Seed exige NODE_ENV=development explícito.");
  process.exitCode = 1;
} else {
  await transaction(async (db) => {
    for (const name of [
      "Consumíveis",
      "Ferramentas",
      "Equipamentos de proteção",
    ])
      await rows(
        "INSERT INTO categorias (nome) VALUES (?) ON DUPLICATE KEY UPDATE nome=VALUES(nome)",
        [name],
        db,
      );
  });
  console.log(
    "Categorias de desenvolvimento adicionadas. Nenhuma credencial ou saldo fictício criado.",
  );
}
await pool.end();
