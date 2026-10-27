import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
export const config = {
  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === "production",
  frontend: process.env.FRONTEND_URL || "http://localhost:5173",
  timezone: process.env.APP_TIMEZONE || "America/Sao_Paulo",
  secret: process.env.SESSION_SECRET,
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "almoxarifado_app",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "almoxarifado",
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    timezone: "Z",
    dateStrings: true,
    decimalNumbers: false,
    charset: "utf8mb4",
  },
};
export function checkSecret() {
  if (!config.secret || config.secret.length < 32)
    throw new Error(
      "Configure SESSION_SECRET com pelo menos 32 caracteres aleatórios.",
    );
}
