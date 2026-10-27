import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, rows, transaction } from "../../src/shared/db.js";
import * as services from "../../src/modules/services.js";
import { config } from "../../src/config/env.js";
import bcrypt from "bcrypt";
import request from "supertest";
import { createApp } from "../../src/app.js";
const enabled = process.env.RUN_MYSQL_TESTS === "1";
after(() => pool.end());
test(
  "integração MySQL: estoque, concorrência, rollback, tarefas, idempotência, auditoria e vínculo",
  { skip: !enabled },
  async () => {
    assert.match(
      config.db.database,
      /_test$/,
      "Use banco exclusivo com sufixo _test e migre-o antes.",
    );
    const tag = randomUUID().slice(0, 8);
    const r = await rows(
      "INSERT INTO usuarios (nome,email,identificacao,senha_hash,papel) VALUES (?,?,?,?,'ADM')",
      [
        "Teste " + tag,
        tag + "@example.com",
        tag,
        await bcrypt.hash("Senha-integracao-123", 12),
      ],
    );
    const actor = {
      ...(await services.currentUser(r.insertId)),
      origem: "cli",
    };
    const app = createApp({
      secret: "test-integration-session-secret-1234567890",
    });
    try {
      const agent = request.agent(app);
      const csrf = (await agent.get("/api/v1/auth/csrf").expect(200)).body
        .token;
      const auth = await agent
        .post("/api/v1/auth/login")
        .set("X-CSRF-Token", csrf)
        .send({ email: tag + "@example.com", senha: "Senha-integracao-123" })
        .expect(200);
      const stored = await rows("SELECT data FROM sessoes");
      assert.ok(stored.some((s) => JSON.parse(s.data).userId === actor.id));
      await agent.get("/api/v1/dashboard").expect(200);
      await agent
        .post("/api/v1/auth/logout")
        .set("X-CSRF-Token", auth.body.csrf)
        .expect(204);
      await agent.get("/api/v1/auth/me").expect(401);
    } finally {
      await app.locals.sessionStore.close();
    }
    await services.saveSettings(actor, { permitir_sobreposicao: false });
    const telegramActor = { ...actor, origem: "telegram" };
    const accessData = {
      nome: "Acesso " + tag,
      email: "acesso-" + tag + "@example.com",
      identificacao: "ACCESS-" + tag,
      papel: "COLABORADOR",
      ativo: true,
      bloqueado: false,
      senha: "Senha-integracao-123",
    };
    const access = await services.saveUser(telegramActor, accessData);
    const collaborator = await services.currentUser(access.id);
    const initialBotPermissions = await services.getBotPermissions(
      actor,
      access.id,
    );
    assert.equal(initialBotPermissions.permissoes.estoque_ver, true);
    assert.equal(initialBotPermissions.permissoes.usuarios_editar, false);
    await assert.rejects(services.getBotPermissions(collaborator, access.id), {
      status: 403,
    });
    await assert.rejects(
      services.saveBotPermissions(actor, access.id, {
        versao: 0,
        permissoes: {
          ...initialBotPermissions.permissoes,
          usuarios_editar: true,
        },
      }),
      { status: 422 },
    );
    const restricted = await services.saveBotPermissions(actor, access.id, {
      versao: 0,
      permissoes: {
        ...initialBotPermissions.permissoes,
        estoque_ver: false,
        notificacoes: false,
      },
    });
    assert.equal(restricted.versao, 1);
    await assert.rejects(
      services.list({ ...collaborator, origem: "telegram" }, "materiais"),
      { status: 403 },
    );
    await services.list({ ...collaborator, origem: "painel" }, "materiais");
    await assert.rejects(
      services.saveBotPermissions(actor, access.id, {
        versao: 0,
        permissoes: initialBotPermissions.permissoes,
      }),
      { status: 409 },
    );
    const [notificationPermission] = await rows(
      "SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(permissoes,'$.notificacoes')),'true')='true' AS allowed FROM permissoes_bot WHERE usuario_id=?",
      [access.id],
    );
    assert.equal(notificationPermission.allowed, 0);
    const [permissionAudit] = await rows(
      "SELECT ator_id FROM auditoria WHERE acao='PERMISSOES_BOT' AND entidade_id=? ORDER BY id DESC LIMIT 1",
      [access.id],
    );
    assert.equal(permissionAudit.ator_id, actor.id);
    await services.saveBotPermissions(actor, access.id, {
      versao: 1,
      permissoes: initialBotPermissions.permissoes,
    });
    for (const papel of ["COLABORADOR", "GESTOR"]) {
      await assert.rejects(
        services.linkToken({ ...collaborator, papel }, actor.id),
        { status: 403 },
      );
    }
    await assert.rejects(services.linkToken(actor, 4294967295), {
      status: 404,
    });
    const previousLink = await services.linkToken(actor, access.id);
    const adminAgent = request.agent(app);
    const adminCsrf = (await adminAgent.get("/api/v1/auth/csrf")).body.token;
    const adminLogin = await adminAgent
      .post("/api/v1/auth/login")
      .set("X-CSRF-Token", adminCsrf)
      .send({ email: tag + "@example.com", senha: "Senha-integracao-123" })
      .expect(200);
    const permissionsResponse = await adminAgent
      .get(`/api/v1/usuarios/${access.id}/permissoes-bot`)
      .expect(200);
    await adminAgent
      .patch(`/api/v1/usuarios/${access.id}/permissoes-bot`)
      .send({
        versao: permissionsResponse.body.versao,
        permissoes: permissionsResponse.body.permissoes,
      })
      .expect(403);
    await adminAgent
      .patch(`/api/v1/usuarios/${access.id}/permissoes-bot`)
      .set("X-CSRF-Token", adminLogin.body.csrf)
      .send({
        versao: permissionsResponse.body.versao,
        permissoes: permissionsResponse.body.permissoes,
      })
      .expect(200);
    await adminAgent
      .post(`/api/v1/usuarios/${access.id}/telegram-token`)
      .expect(403);
    const generatedLink = await adminAgent
      .post(`/api/v1/usuarios/${access.id}/telegram-token`)
      .set("X-CSRF-Token", adminLogin.body.csrf)
      .expect(201);
    assert.equal(generatedLink.body.expira_em_minutos, 10);
    await assert.rejects(
      services.bindTelegram(previousLink.token, "800" + access.id),
      { status: 403 },
    );
    await services.bindTelegram(generatedLink.body.token, "800" + access.id);
    assert.equal(
      String((await services.currentUser(access.id)).telegram_id),
      "800" + access.id,
    );
    assert.equal((await services.currentUser(actor.id)).telegram_id, null);
    await assert.rejects(
      services.bindTelegram(generatedLink.body.token, "801" + access.id),
      { status: 403 },
    );
    const [linkAudit] = await rows(
      "SELECT ator_id FROM auditoria WHERE acao='GERAR_VINCULO' AND entidade_id=? ORDER BY id DESC LIMIT 1",
      [access.id],
    );
    assert.equal(linkAudit.ator_id, actor.id);
    const accessBefore = await services.detail(actor, "usuarios", access.id);
    const editData = { ...accessData, papel: "GESTOR", bloqueado: true };
    delete editData.senha;
    await services.saveUser(
      telegramActor,
      editData,
      access.id,
      accessBefore.atualizado_em,
    );
    await assert.rejects(services.currentUser(access.id));
    await assert.rejects(services.linkToken(actor, access.id), { status: 409 });
    await assert.rejects(
      services.saveUser(
        telegramActor,
        { ...editData, bloqueado: false },
        access.id,
        "1900-01-01 00:00:00.000",
      ),
    );
    await assert.rejects(
      services.saveUser(
        telegramActor,
        {
          nome: actor.nome,
          email: actor.email,
          identificacao: actor.identificacao,
          papel: "COLABORADOR",
          ativo: true,
          bloqueado: false,
        },
        actor.id,
      ),
    );
    await services.saveSettings(
      telegramActor,
      { permitir_sobreposicao: true },
      false,
    );
    await assert.rejects(
      services.saveSettings(
        telegramActor,
        { permitir_sobreposicao: false },
        false,
      ),
    );
    await services.saveSettings(
      telegramActor,
      { permitir_sobreposicao: false },
      true,
    );
    const [adminAudit] = await rows(
      "SELECT COUNT(*) AS n FROM auditoria WHERE ator_id=? AND origem='telegram' AND acao IN ('EDITAR','CONFIGURAR')",
      [actor.id],
    );
    assert.ok(adminAudit.n >= 3);
    const c = await services.saveCategory(actor, { nome: "Teste " + tag });
    const m = await services.saveMaterial(actor, {
      nome: "Material " + tag,
      descricao: "Integração",
      categoria_id: c.id,
      unidade: "UN",
      estoque_minimo: "2",
      ativo: true,
    });
    assert.match(m.codigo, /^[0-9]+$/);
    const materialInput = {
      nome: "Sequência " + tag,
      categoria_id: c.id,
      unidade: "UN",
      estoque_minimo: "0",
      ativo: true,
    };
    const concurrentMaterials = await Promise.all([
      services.saveMaterial(actor, materialInput),
      services.saveMaterial(telegramActor, materialInput),
    ]);
    assert.deepEqual(
      concurrentMaterials
        .map((item) => BigInt(item.codigo))
        .sort((a, b) => (a < b ? -1 : 1)),
      [BigInt(m.codigo) + 1n, BigInt(m.codigo) + 2n],
    );
    await services.saveMaterial(
      actor,
      { ...materialInput, nome: "Editado " + tag },
      m.id,
    );
    assert.equal(
      (await services.detail(actor, "materiais", m.id)).codigo,
      m.codigo,
    );
    await assert.rejects(
      services.saveMaterial(actor, { ...materialInput, codigo: "999" }),
      { name: "ZodError" },
    );
    await assert.rejects(
      services.saveMaterial(
        telegramActor,
        {
          nome: "Material " + tag,
          descricao: "Integração",
          categoria_id: c.id,
          unidade: "UN",
          estoque_minimo: "2",
          ativo: true,
        },
        m.id,
        "1900-01-01 00:00:00.000",
      ),
    );
    await assert.rejects(
      services.saveCategory(
        telegramActor,
        { nome: "Nome alterado" },
        c.id,
        "Nome antigo incorreto",
      ),
    );
    const payload = {
      material_id: m.id,
      tipo: "ENTRADA",
      quantidade: "10",
      motivo: "Teste integração",
      chave_idempotencia: "entrada-" + tag,
    };
    const initial = await services.move(actor, payload);
    assert.equal(initial.saldo_posterior, "10.000");
    assert.equal((await services.move(actor, payload)).id, initial.id);
    await assert.rejects(
      services.move(actor, { ...payload, quantidade: "11" }),
    );
    const concurrent = await Promise.allSettled(
      [1, 2].map((n) =>
        services.move(actor, {
          ...payload,
          tipo: "SAIDA",
          quantidade: "7",
          chave_idempotencia: `saida-${tag}-${n}`,
        }),
      ),
    );
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await services.detail(actor, "materiais", m.id)).saldo,
      "3.000",
    );
    const [before] = await rows("SELECT COUNT(*) AS n FROM auditoria");
    await assert.rejects(
      services.move(actor, {
        ...payload,
        tipo: "SAIDA",
        quantidade: "4",
        chave_idempotencia: "fail-" + tag,
      }),
    );
    const [afterAudit] = await rows("SELECT COUNT(*) AS n FROM auditoria");
    assert.equal(before.n, afterAudit.n);
    await assert.rejects(
      transaction(async (db) => {
        await rows("UPDATE materiais SET saldo=999 WHERE id=?", [m.id], db);
        throw new Error("rollback forçado");
      }),
    );
    assert.equal(
      (await services.detail(actor, "materiais", m.id)).saldo,
      "3.000",
    );
    const task = {
      responsavel_id: actor.id,
      titulo: "Tarefa " + tag,
      data_programada: "2030-01-01",
      hora_inicio: "08:00",
      hora_fim: "09:00",
      prioridade: "MEDIA",
    };
    const t = await services.saveTask(actor, task);
    await assert.rejects(
      services.saveTask(telegramActor, task, t.id, "1900-01-01 00:00:00.000"),
    );
    await assert.rejects(services.saveTask(actor, task));
    await assert.rejects(services.changeTask(actor, t.id, "concluir"));
    await assert.rejects(services.changeTask(telegramActor, t.id, "iniciar"), {
      name: "ZodError",
    });
    await services.changeTask(telegramActor, t.id, "iniciar", {
      observacoes: "Início autorizado após conferência",
    });
    const [startHistory] = await rows(
      "SELECT dados FROM historico_tarefas WHERE tarefa_id=? ORDER BY id DESC LIMIT 1",
      [t.id],
    );
    const historyData =
      typeof startHistory.dados === "string"
        ? JSON.parse(startHistory.dados)
        : startHistory.dados;
    assert.equal(historyData.observacoes, "Início autorizado após conferência");
    await services.changeTask(actor, t.id, "concluir");
    assert.equal(
      (await services.detail(actor, "tarefas", t.id)).status,
      "CONCLUIDA",
    );
    const token = await services.linkToken(actor);
    const duplicated = await adminAgent
      .post("/api/v1/tarefas/duplicar")
      .set("X-CSRF-Token", adminLogin.body.csrf)
      .send({ tarefas: [t.id], dias: ["2030-01-02", "2030-01-03"] })
      .expect(201);
    assert.equal(duplicated.body.total, 2);
    const copiedTask = await services.detail(
      actor,
      "tarefas",
      duplicated.body.tarefas[0].id,
    );
    assert.equal(copiedTask.status, "PENDENTE");
    assert.equal(copiedTask.inicio_real, null);
    assert.equal(copiedTask.conclusao_real, null);
    assert.equal(copiedTask.observacoes, "");
    assert.equal(copiedTask.responsavel_id, actor.id);
    await adminAgent
      .patch(`/api/v1/tarefas/${copiedTask.id}`)
      .set("X-CSRF-Token", adminLogin.body.csrf)
      .set("X-Record-Version", "1900-01-01 00:00:00.000")
      .send({ ...task, data_programada: copiedTask.data_programada })
      .expect(409);
    await services.saveTask(actor, { ...task, data_programada: "2030-01-05" });
    const [copyAuditBefore] = await rows("SELECT COUNT(*) AS n FROM auditoria");
    const [copyNotificationsBefore] = await rows(
      "SELECT COUNT(*) AS n FROM notificacoes",
    );
    await assert.rejects(
      services.duplicateTasks(actor, {
        tarefas: [t.id],
        dias: ["2030-01-04", "2030-01-05"],
      }),
      { status: 409 },
    );
    const [rolledBackDay] = await rows(
      "SELECT COUNT(*) AS n FROM tarefas WHERE responsavel_id=? AND data_programada='2030-01-04'",
      [actor.id],
    );
    assert.equal(rolledBackDay.n, 0);
    const [copyAuditAfter] = await rows("SELECT COUNT(*) AS n FROM auditoria");
    const [copyNotificationsAfter] = await rows(
      "SELECT COUNT(*) AS n FROM notificacoes",
    );
    assert.equal(copyAuditAfter.n, copyAuditBefore.n);
    assert.equal(copyNotificationsAfter.n, copyNotificationsBefore.n);
    await assert.rejects(
      services.duplicateTasks(actor, { tarefas: [t.id], dias: ["2030-02-30"] }),
      { name: "ZodError" },
    );
    await assert.rejects(
      services.duplicateTasks(actor, { tarefas: [t.id], dias: ["2030-01-01"] }),
      { status: 422 },
    );
    await services.bindTelegram(token.token, "900" + String(actor.id));
    const destination = await services.saveUser(actor, {
      ...accessData,
      nome: "Destino " + tag,
      email: "destino-" + tag + "@example.com",
      identificacao: "DEST-" + tag,
    });
    const reassigned = await services.duplicateTasks(actor, {
      tarefas: [t.id],
      dias: ["2030-01-01"],
      responsavel_id: destination.id,
    });
    const reassignedTask = await services.detail(
      actor,
      "tarefas",
      reassigned.tarefas[0].id,
    );
    assert.equal(reassignedTask.responsavel_id, destination.id);
    assert.equal(reassignedTask.status, "PENDENTE");
    assert.equal(
      (await services.detail(actor, "tarefas", t.id)).responsavel_id,
      actor.id,
    );
    await assert.rejects(
      services.duplicateTasks(actor, {
        tarefas: [t.id],
        dias: ["2030-01-01"],
        responsavel_id: destination.id,
      }),
      { status: 409 },
    );
    await assert.rejects(
      services.duplicateTasks(actor, {
        tarefas: [t.id],
        dias: ["2030-01-02"],
        responsavel_id: access.id,
      }),
      { status: 422 },
    );
    await assert.rejects(
      services.duplicateTasks(actor, {
        tarefas: [t.id],
        dias: ["2030-01-01"],
        responsavel_id: actor.id,
      }),
      { status: 422 },
    );
    await assert.rejects(
      services.bindTelegram(token.token, "901" + String(actor.id)),
    );
    const pendingReplacement = await services.linkToken(actor);
    await assert.rejects(
      services.bindTelegram(pendingReplacement.token, "902" + actor.id),
      { status: 409 },
    );
    assert.equal(
      String((await services.currentUser(actor.id)).telegram_id),
      "900" + actor.id,
    );
    await adminAgent
      .delete(`/api/v1/usuarios/${actor.id}/telegram-vinculo`)
      .expect(403);
    await adminAgent
      .delete(`/api/v1/usuarios/${actor.id}/telegram-vinculo`)
      .set("X-CSRF-Token", adminLogin.body.csrf)
      .expect(204);
    assert.equal((await services.currentUser(actor.id)).telegram_id, null);
    await assert.rejects(
      services.bindTelegram(pendingReplacement.token, "902" + actor.id),
      { status: 403 },
    );
    const [revokeAudit] = await rows(
      "SELECT ator_id FROM auditoria WHERE acao='REVOGAR_VINCULO_TELEGRAM' AND entidade_id=? ORDER BY id DESC LIMIT 1",
      [actor.id],
    );
    assert.equal(revokeAudit.ator_id, actor.id);
    const freshLink = await services.linkToken(actor);
    await services.bindTelegram(freshLink.token, "902" + actor.id);
    assert.equal(
      String((await services.currentUser(actor.id)).telegram_id),
      "902" + actor.id,
    );
  },
);
