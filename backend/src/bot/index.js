import { DateTime } from "luxon";
import { config } from "../config/env.js";
import { pool, rows, transaction } from "../shared/db.js";
import { ensure } from "../shared/domain.js";
import * as services from "../modules/services.js";
import { today } from "./handlers.js";
import { createBot } from "./createBot.js";
ensure(process.env.BOT_TOKEN, 500, "Configure BOT_TOKEN no .env.");
const bot = createBot({ token: process.env.BOT_TOKEN });
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const tasks = await rows(
      "SELECT * FROM tarefas WHERE data_programada=? AND status='PENDENTE'",
      [today()],
    );
    const now = DateTime.now().setZone(config.timezone);
    for (const t of tasks) {
      const time = DateTime.fromISO(`${t.data_programada}T${t.hora_inicio}`, {
        zone: config.timezone,
      });
      const minutes = time.diff(now, "minutes").minutes;
      if (minutes >= 0 && minutes <= 15)
        await services.notify(
          pool,
          t.responsavel_id,
          `lembrete:${t.id}:${t.data_programada}:${t.hora_inicio}`,
          `Lembrete: ${t.titulo} começa às ${t.hora_inicio.slice(0, 5)}.`,
        );
    }
    // Um worker deve operar por token. A transação mantém lock durante envio e evita concorrência entre workers locais.
    for (let i = 0; i < 20; i++) {
      const sent = await transaction(async (db) => {
        const [n] = await rows(
          "SELECT n.*,u.telegram_id FROM notificacoes n JOIN usuarios u ON u.id=n.usuario_id LEFT JOIN permissoes_bot p ON p.usuario_id=u.id WHERE n.enviada_em IS NULL AND n.tentativas<10 AND (n.proxima_tentativa IS NULL OR n.proxima_tentativa<=UTC_TIMESTAMP()) AND u.telegram_id IS NOT NULL AND u.ativo=TRUE AND u.bloqueado=FALSE AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.permissoes,'$.acessar_bot')),'true')='true' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p.permissoes,'$.notificacoes')),'true')='true' ORDER BY n.id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [],
          db,
        );
        if (!n) return false;
        try {
          await bot.telegram.sendMessage(n.telegram_id, n.mensagem);
          await rows(
            "UPDATE notificacoes SET enviada_em=UTC_TIMESTAMP(3) WHERE id=?",
            [n.id],
            db,
          );
        } catch {
          await rows(
            "UPDATE notificacoes SET tentativas=tentativas+1,proxima_tentativa=UTC_TIMESTAMP()+INTERVAL 5 MINUTE WHERE id=?",
            [n.id],
            db,
          );
        }
        return true;
      });
      if (!sent) break;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        component: "notificacoes",
        code: error.code || "INTERNAL",
      }),
    );
  } finally {
    ticking = false;
  }
}
const timer = setInterval(tick, 60000);
timer.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    clearInterval(timer);
    bot.stop(signal);
    pool.end();
  });
if (process.env.BOT_MODE === "webhook") {
  ensure(
    config.production &&
      process.env.BOT_WEBHOOK_URL?.startsWith("https://") &&
      /^[A-Za-z0-9_-]{32,256}$/.test(process.env.BOT_WEBHOOK_SECRET || ""),
    500,
    "Webhook exige produção, HTTPS e segredo válido (32+ caracteres).",
  );
  const url = new URL(process.env.BOT_WEBHOOK_URL);
  await bot.launch({
    webhook: {
      domain: url.origin,
      hookPath: url.pathname,
      port: Number(process.env.BOT_PORT || 3001),
      host: "127.0.0.1",
      secretToken: process.env.BOT_WEBHOOK_SECRET,
    },
  });
} else await bot.launch();
