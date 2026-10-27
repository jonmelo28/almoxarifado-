import { test, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import session from "express-session";
import { createApp } from "../src/app.js";
import { AppError } from "../src/shared/domain.js";
import { pool } from "../src/shared/db.js";
const user = {
  id: 1,
  nome: "Teste",
  papel: "COLABORADOR",
  ativo: true,
  bloqueado: false,
};
function fixture() {
  let blocked = false;
  const store = new session.MemoryStore();
  const app = createApp({
    secret: "test-only-session-secret-1234567890",
    store,
    authenticate: async () => {
      if (blocked) throw new AppError(401, "Conta indisponível.");
      return user;
    },
    verifyLogin: async (email, password) => {
      if (email !== "teste@example.com" || password !== "senha-correta")
        throw new AppError(401, "Email ou senha inválidos.");
      return user;
    },
  });
  return {
    app,
    agent: request.agent(app),
    block: () => {
      blocked = true;
    },
  };
}
async function login(agent) {
  const csrf = (await agent.get("/api/v1/auth/csrf")).body.token;
  return agent
    .post("/api/v1/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ email: "teste@example.com", senha: "senha-correta" });
}
after(() => pool.end());
test("colaborador não gera vínculo Telegram para outra conta", async () => {
  const { agent } = fixture();
  const result = await login(agent);
  await agent
    .post("/api/v1/usuarios/2/telegram-token")
    .set("X-CSRF-Token", result.body.csrf)
    .expect(403);
});
test("somente ADM consulta e altera permissões do bot", async () => {
  const { agent } = fixture();
  const result = await login(agent);
  await agent.get("/api/v1/usuarios/1/permissoes-bot").expect(403);
  await agent
    .patch("/api/v1/usuarios/1/permissoes-bot")
    .set("X-CSRF-Token", result.body.csrf)
    .send({})
    .expect(403);
});
test("colaborador não pode revogar o vínculo Telegram", async () => {
  const { agent } = fixture();
  const result = await login(agent);
  await agent
    .delete("/api/v1/usuarios/1/telegram-vinculo")
    .set("X-CSRF-Token", result.body.csrf)
    .expect(403);
});
test("rotas privadas exigem sessão", async () => {
  const { agent } = fixture();
  await agent.get("/api/v1/auth/me").expect(401);
});
test("colaborador não pode duplicar tarefas", async () => {
  const { agent } = fixture();
  const result = await login(agent);
  await agent
    .post("/api/v1/tarefas/duplicar")
    .set("X-CSRF-Token", result.body.csrf)
    .send({ tarefas: [1], dias: ["2030-01-02"] })
    .expect(403);
});
test("CSRF também protege login", async () => {
  const { agent } = fixture();
  await agent
    .post("/api/v1/auth/login")
    .send({ email: "teste@example.com", senha: "senha-correta" })
    .expect(403);
});
test("login regenera sessão, define HttpOnly e logout invalida acesso", async () => {
  const { agent } = fixture();
  const before = await agent.get("/api/v1/auth/csrf");
  const result = await login(agent);
  assert.equal(result.status, 200);
  assert.notEqual(result.body.csrf, before.body.token);
  assert.match(result.headers["set-cookie"][0], /HttpOnly/);
  assert.match(result.headers["set-cookie"][0], /SameSite=Lax/);
  await agent.get("/api/v1/auth/me").expect(200);
  await agent
    .post("/api/v1/auth/logout")
    .set("X-CSRF-Token", result.body.csrf)
    .expect(204);
  await agent.get("/api/v1/auth/me").expect(401);
});
test("senha incorreta não cria sessão autenticada", async () => {
  const { agent } = fixture();
  const r = await agent.get("/api/v1/auth/csrf");
  await agent
    .post("/api/v1/auth/login")
    .set("X-CSRF-Token", r.body.token)
    .send({ email: "teste@example.com", senha: "errada" })
    .expect(401);
  await agent.get("/api/v1/auth/me").expect(401);
});
test("bloqueio invalida sessão existente na próxima requisição", async () => {
  const { agent, block } = fixture();
  await login(agent);
  block();
  await agent.get("/api/v1/auth/me").expect(401);
});
test("colaborador não cadastra usuários nem materiais", async () => {
  const { agent } = fixture();
  const result = await login(agent);
  for (const entity of ["usuarios", "materiais"])
    await agent
      .post("/api/v1/" + entity)
      .set("X-CSRF-Token", result.body.csrf)
      .send({})
      .expect(403);
});
test("colaborador não consulta equipe, auditoria ou configurações", async () => {
  const { agent } = fixture();
  await login(agent);
  for (const entity of [
    "usuarios",
    "auditoria",
    "configuracoes",
    "relatorios/estoque",
  ])
    await agent.get("/api/v1/" + entity).expect(403);
});
test("sessão não permite mutação sem CSRF válido", async () => {
  const { agent } = fixture();
  await login(agent);
  await agent
    .post("/api/v1/movimentacoes")
    .set("X-CSRF-Token", "incorreto")
    .send({})
    .expect(403);
});
test("login valida payload e não expõe stack", async () => {
  const { agent } = fixture();
  const r = await agent.get("/api/v1/auth/csrf");
  const result = await agent
    .post("/api/v1/auth/login")
    .set("X-CSRF-Token", r.body.token)
    .send({ email: "invalido", senha: "" })
    .expect(422);
  assert.equal(result.body.stack, undefined);
});
test("CORS permite somente origem configurada", async () => {
  const { agent } = fixture();
  const result = await agent
    .get("/api/v1/auth/csrf")
    .set("Origin", "https://evil.example");
  assert.notEqual(
    result.headers["access-control-allow-origin"],
    "https://evil.example",
  );
});
