import express from "express";
import helmet from "helmet";
import cors from "cors";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import { rateLimit } from "express-rate-limit";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config, checkSecret } from "./config/env.js";
import { pool, rows } from "./shared/db.js";
import { AppError, allow, ensure, csv } from "./shared/domain.js";
import * as services from "./modules/services.js";
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
export function createApp({
  store,
  secret = config.secret,
  authenticate = services.currentUser,
  verifyLogin = services.verifyLogin,
} = {}) {
  if (!secret) checkSecret();
  const app = express();
  if (config.production) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.frontend, credentials: true }));
  app.use(express.json({ limit: "64kb" }));
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set("X-Request-Id", req.requestId);
    res.set("Cache-Control", "no-store");
    next();
  });
  const MySQLStore = MySQLStoreFactory(session);
  const sessionStore =
    store ||
    new MySQLStore(
      {
        createDatabaseTable: false,
        schema: {
          tableName: "sessoes",
          columnNames: {
            session_id: "session_id",
            expires: "expires",
            data: "data",
          },
        },
      },
      pool,
    );
  app.locals.sessionStore = sessionStore;
  app.use(
    session({
      name: "almox.sid",
      secret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  const router = express.Router();
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Muitas requisições. Aguarde." },
    }),
  );
  router.get(
    "/health",
    asyncRoute(async (req, res) => {
      await rows("SELECT 1");
      res.json({ status: "ok" });
    }),
  );
  router.get("/auth/csrf", (req, res) => {
    req.session.csrf ||= randomBytes(32).toString("hex");
    res.json({ token: req.session.csrf });
  });
  router.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const sent = req.get("X-CSRF-Token") || "";
    const expected = req.session.csrf || "";
    if (
      !expected ||
      Buffer.byteLength(sent) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(sent), Buffer.from(expected))
    )
      return next(new AppError(403, "Token CSRF inválido. Atualize a página."));
    next();
  });
  router.post(
    "/auth/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Muitas tentativas. Aguarde 15 minutos." },
    }),
    asyncRoute(async (req, res) => {
      const data = z
        .object({
          email: z.string().email().max(190),
          senha: z.string().min(1).max(72),
        })
        .strict()
        .parse(req.body);
      const u = await verifyLogin(data.email, data.senha);
      await new Promise((resolve, reject) =>
        req.session.regenerate((error) => (error ? reject(error) : resolve())),
      );
      req.session.userId = u.id;
      req.session.csrf = randomBytes(32).toString("hex");
      res.json({
        user: await authenticate(u.id),
        csrf: req.session.csrf,
        timezone: config.timezone,
      });
    }),
  );
  router.use(
    asyncRoute(async (req, res, next) => {
      ensure(req.session.userId, 401, "Autenticação necessária.");
      req.actor = {
        ...(await authenticate(req.session.userId)),
        origem: "painel",
      };
      next();
    }),
  );
  router.get("/auth/me", (req, res) =>
    res.json({
      user: req.actor,
      csrf: req.session.csrf,
      timezone: config.timezone,
    }),
  );
  router.post(
    "/auth/logout",
    asyncRoute(async (req, res) => {
      await new Promise((resolve, reject) =>
        req.session.destroy((error) => (error ? reject(error) : resolve())),
      );
      res.clearCookie("almox.sid", {
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
      });
      res.status(204).end();
    }),
  );
  router.post(
    "/usuarios/:id/telegram-token",
    asyncRoute(async (req, res) =>
      res.status(201).json(await services.linkToken(req.actor, req.params.id)),
    ),
  );
  router.delete(
    "/usuarios/:id/telegram-vinculo",
    asyncRoute(async (req, res) => {
      await services.revokeTelegram(req.actor, req.params.id);
      res.status(204).end();
    }),
  );
  router.get(
    "/usuarios/:id/permissoes-bot",
    asyncRoute(async (req, res) =>
      res.json(await services.getBotPermissions(req.actor, req.params.id)),
    ),
  );
  router.patch(
    "/usuarios/:id/permissoes-bot",
    asyncRoute(async (req, res) =>
      res.json(
        await services.saveBotPermissions(req.actor, req.params.id, req.body),
      ),
    ),
  );
  router.post(
    "/auth/telegram-token",
    asyncRoute(async (req, res) =>
      res.status(201).json(await services.linkToken(req.actor)),
    ),
  );
  router.get(
    "/dashboard",
    asyncRoute(async (req, res) =>
      res.json(await services.dashboard(req.actor)),
    ),
  );
  for (const entity of [
    "usuarios",
    "materiais",
    "movimentacoes",
    "tarefas",
    "auditoria",
  ]) {
    router.get(
      "/" + entity,
      asyncRoute(async (req, res) =>
        res.json(await services.list(req.actor, entity, req.query)),
      ),
    );
    if (entity !== "auditoria")
      router.get(
        `/${entity}/:id`,
        asyncRoute(async (req, res) =>
          res.json(await services.detail(req.actor, entity, req.params.id)),
        ),
      );
  }
  for (const [entity, save] of [
    ["usuarios", services.saveUser],
    ["materiais", services.saveMaterial],
    ["tarefas", services.saveTask],
  ]) {
    router.post(
      "/" + entity,
      asyncRoute(async (req, res) =>
        res.status(201).json(await save(req.actor, req.body)),
      ),
    );
    router.patch(
      `/${entity}/:id`,
      asyncRoute(async (req, res) =>
        res.json(
          await save(
            req.actor,
            req.body,
            req.params.id,
            req.get("X-Record-Version"),
          ),
        ),
      ),
    );
  }
  router.get(
    "/categorias",
    asyncRoute(async (req, res) =>
      res.json(await services.categories(req.actor)),
    ),
  );
  router.post(
    "/categorias",
    asyncRoute(async (req, res) =>
      res.status(201).json(await services.saveCategory(req.actor, req.body)),
    ),
  );
  router.patch(
    "/categorias/:id",
    asyncRoute(async (req, res) =>
      res.json(await services.saveCategory(req.actor, req.body, req.params.id)),
    ),
  );
  router.post(
    "/movimentacoes",
    asyncRoute(async (req, res) =>
      res.status(201).json(await services.move(req.actor, req.body)),
    ),
  );
  router.post(
    "/tarefas/duplicar",
    asyncRoute(async (req, res) =>
      res.status(201).json(await services.duplicateTasks(req.actor, req.body)),
    ),
  );
  for (const action of ["iniciar", "concluir", "cancelar"])
    router.post(
      `/tarefas/:id/${action}`,
      asyncRoute(async (req, res) =>
        res.json(
          await services.changeTask(req.actor, req.params.id, action, req.body),
        ),
      ),
    );
  router.get(
    "/configuracoes",
    asyncRoute(async (req, res) =>
      res.json(await services.settings(req.actor)),
    ),
  );
  router.patch(
    "/configuracoes",
    asyncRoute(async (req, res) =>
      res.json(await services.saveSettings(req.actor, req.body)),
    ),
  );
  for (const [report, entity] of [
    ["estoque", "materiais"],
    ["tarefas", "tarefas"],
    ["consumo", "movimentacoes"],
  ])
    router.get(
      "/relatorios/" + report,
      asyncRoute(async (req, res) => {
        allow(req.actor, "ADM", "GESTOR");
        const result = await services.list(req.actor, entity, req.query);
        if (req.query.formato === "csv") {
          res.set(
            "Content-Disposition",
            `attachment; filename="${report}-pagina-${result.page}.csv"`,
          );
          res.type("text/csv; charset=utf-8").send(csv(result.data));
        } else res.json(result);
      }),
    );
  app.use("/api/v1", router);
  app.use((req, res) =>
    res.status(404).json({ error: "Rota não encontrada." }),
  );
  app.use((error, req, res, _next) => {
    const conflict = [
      "ER_DUP_ENTRY",
      "ER_NO_REFERENCED_ROW_2",
      "ER_LOCK_DEADLOCK",
      "ER_LOCK_WAIT_TIMEOUT",
    ].includes(error.code);
    const status =
      error.name === "ZodError" ? 422 : conflict ? 409 : error.status || 500;
    if (status >= 500)
      console.error(
        JSON.stringify({
          level: "error",
          requestId: req.requestId,
          status,
          code: error.code || "INTERNAL",
        }),
      );
    res.status(status).json({
      error:
        status === 422
          ? "Dados inválidos. Verifique os campos."
          : conflict
            ? "Conflito nos dados. Verifique duplicidades e vínculos ou tente novamente."
            : status >= 500
              ? "Não foi possível concluir a operação."
              : error.message,
      issues:
        error.name === "ZodError"
          ? error.issues.map((i) => ({
              campo: i.path.join("."),
              mensagem: i.message,
            }))
          : undefined,
      requestId: req.requestId,
    });
  });
  return app;
}
