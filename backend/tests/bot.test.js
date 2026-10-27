import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createBot } from "../src/bot/createBot.js";
import { pool } from "../src/shared/db.js";
import { effectiveBotPermissions } from "../src/shared/botPermissions.js";
const actor = {
  id: 7,
  nome: "Teste",
  papel: "COLABORADOR",
  ativo: true,
  bloqueado: false,
};
after(() => pool.end());
function fixture(overrides = {}, linked = true) {
  const calls = [];
  const services = {
    currentUser: async () => actor,
    detail: async () => ({
      id: 3,
      responsavel_id: 7,
      titulo: "Inspeção",
      data_programada: "2026-10-23",
      hora_inicio: "08:00",
      hora_fim: "09:00",
      status: "PENDENTE",
      prioridade: "MEDIA",
    }),
    list: async () => ({ data: [] }),
    changeTask: async (a, id, action, input) => {
      calls.push({ a, id, action, input });
      return { id, status: "EM_ANDAMENTO" };
    },
    ...overrides,
  };
  const bot = createBot({
    token: "123456:TEST-ONLY",
    services,
    rows: async () => (linked ? [{ id: 7 }] : []),
  });
  bot.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: "Teste",
    username: "test_bot",
  };
  // Telegraf cria uma instância Telegram por update; context.telegram é substituído pelo middleware de teste.
  bot.use(() => {});
  return { bot, calls };
}
function update(data, chatType = "private") {
  return {
    update_id: 1,
    callback_query: {
      id: "callback-test",
      from: { id: 99, is_bot: false, first_name: "Teste" },
      chat_instance: "test",
      data,
      message: { message_id: 1, date: 1, chat: { id: 99, type: chatType } },
    },
  };
}
// A API Telegram fica inteiramente substituída em teste; nenhuma conexão externa é feita.
let sentMessageId = 100;
async function run(bot, payload) {
  const replies = [];
  const original = bot.handleUpdate.bind(bot);
  const middleware = bot.middleware();
  bot.middleware = () => async (ctx, next) => {
    ctx.telegram.callApi = async (method, data) => {
      replies.push({ method, data });
      return method === "sendMessage" ? { message_id: ++sentMessageId } : true;
    };
    return middleware(ctx, next);
  };
  try {
    await original(payload);
  } finally {
    bot.middleware = () => middleware;
  }
  return replies;
}
test("iniciar aguarda justificativa e chama serviço com ator vinculado", async () => {
  const { bot, calls } = fixture();
  await run(bot, update("iniciar:3"));
  assert.equal(calls.length, 0);
  const replies = await run(bot, message("Iniciando a inspeção programada"));
  assert.equal(calls[0].id, "3");
  assert.equal(calls[0].a.id, 7);
  assert.equal(calls[0].a.origem, "telegram");
  assert.equal(calls[0].input.observacoes, "Iniciando a inspeção programada");
  assert.ok(
    replies.some(
      (r) => r.method === "sendMessage" && r.data.text.includes("EM_ANDAMENTO"),
    ),
  );
});
test("justificativa inválida não inicia e pode ser corrigida", async () => {
  const { bot, calls } = fixture();
  await run(bot, update("iniciar:3"));
  await run(bot, message("ok"));
  assert.equal(calls.length, 0);
  await run(bot, message("Materiais conferidos para iniciar"));
  assert.equal(calls.length, 1);
});
test("cancelar início não muda a tarefa", async () => {
  const { bot, calls } = fixture();
  await run(bot, update("iniciar:3"));
  await run(bot, message("/cancelar"));
  await run(bot, message("Não deve executar"));
  assert.equal(calls.length, 0);
});
test("limpeza automática remove resposta anterior e mensagem recebida", async () => {
  const { bot } = fixture();
  const menu = await run(bot, message("/menu"));
  const menuId = sentMessageId;
  assert.ok(menu.some((r) => r.method === "sendMessage"));
  const next = await run(bot, message("/menu"));
  const deletions = next.filter((r) => r.method === "deleteMessages");
  assert.ok(deletions.some((r) => r.data.message_ids.includes(menuId)));
  assert.ok(deletions.some((r) => r.data.message_ids.includes(2)));
  assert.ok(deletions.every((r) => r.data.chat_id === 99));
});
test("limpar tenta somente os últimos 100 IDs e mantém novo menu", async () => {
  const { bot } = fixture();
  const command = message("/limpar");
  command.message.message_id = 250;
  const replies = await run(bot, command);
  const bulk = replies.find(
    (r) => r.method === "deleteMessages" && r.data.message_ids.length === 100,
  );
  assert.equal(Math.min(...bulk.data.message_ids), 151);
  assert.equal(Math.max(...bulk.data.message_ids), 250);
  assert.ok(replies.some((r) => r.data.text?.includes("Conversa limpa")));
});
test("callback administrativo forjado é recusado para colaborador", async () => {
  const { bot } = fixture();
  const replies = await run(bot, update("usuarios"));
  assert.ok(
    replies.some(
      (r) =>
        r.method === "sendMessage" &&
        /não autorizada|não permitida/.test(r.data.text),
    ),
  );
});
test("permissão individual oculta botão e bloqueia callback forjado", async () => {
  let listed = false;
  const { bot } = fixture({
    loadBotPermissions: async () =>
      effectiveBotPermissions("COLABORADOR", { estoque_ver: false }),
    list: async () => {
      listed = true;
      return { data: [], total: 0 };
    },
  });
  const menu = await run(bot, message("/menu"));
  assert.ok(
    !menu
      .flatMap(
        (reply) => reply.data.reply_markup?.inline_keyboard?.flat() || [],
      )
      .some((button) => button.callback_data === "estoque"),
  );
  const denied = await run(bot, update("estoque"));
  assert.equal(listed, false);
  assert.ok(denied.some((reply) => reply.data.text?.includes("não permitida")));
});
test("revogação de iniciar durante formulário impede gravação", async () => {
  let enabled = true;
  const { bot, calls } = fixture({
    loadBotPermissions: async () =>
      effectiveBotPermissions("COLABORADOR", { tarefas_iniciar: enabled }),
  });
  await run(bot, update("iniciar:3"));
  enabled = false;
  await run(bot, message("Justificativa para iniciar"));
  assert.equal(calls.length, 0);
});
test("desativar acesso bloqueia comandos sem consultar operações", async () => {
  const { bot } = fixture({
    loadBotPermissions: async () =>
      effectiveBotPermissions("COLABORADOR", { acessar_bot: false }),
  });
  const replies = await run(bot, message("/menu"));
  assert.ok(
    replies.some((reply) =>
      reply.data.text?.includes("acesso ao bot está desabilitado"),
    ),
  );
  assert.ok(!replies.some((reply) => reply.data.reply_markup));
});
test("callbacks em grupo são ignorados", async () => {
  const { bot, calls } = fixture();
  const replies = await run(bot, update("iniciar:3", "group"));
  assert.equal(calls.length, 0);
  assert.equal(replies.length, 0);
});
test("estoque do bot exibe unidade inteira e fração com vírgula", async () => {
  const { bot } = fixture({
    list: async () => ({
      data: [
        { id: 1, codigo: "1", nome: "Luva", saldo: "1.000", unidade: "UN" },
        { id: 2, codigo: "2", nome: "Óleo", saldo: "1.250", unidade: "L" },
      ],
      total: 2,
    }),
  });
  const replies = await run(bot, update("estoque"));
  const text = replies.map((reply) => reply.data.text || "").join("\n");
  assert.ok(text.includes("Luva: 1 UN"));
  assert.ok(text.includes("Óleo: 1,25 L"));
  assert.ok(!text.includes("1.000"));
});
test("permissões são recarregadas a cada callback", async () => {
  const { bot, calls } = fixture({
    currentUser: async () => {
      const e = new Error("Conta indisponível.");
      e.status = 401;
      throw e;
    },
  });
  const replies = await run(bot, update("iniciar:3"));
  assert.equal(calls.length, 0);
  assert.ok(replies.some((r) => r.data.text?.includes("Conta indisponível")));
});
function message(text) {
  const command = text.startsWith("/") ? text.split(/\s+/)[0] : null;
  return {
    update_id: 2,
    message: {
      message_id: 2,
      date: 1,
      from: { id: 99, is_bot: false, first_name: "Teste" },
      chat: { id: 99, type: "private" },
      text,
      ...(command
        ? {
            entities: [
              { type: "bot_command", offset: 0, length: command.length },
            ],
          }
        : {}),
    },
  };
}
test("vincular sem argumento pede código e aceita a próxima mensagem", async () => {
  const bindings = [];
  const { bot } = fixture({
    bindTelegram: async (token, id) => bindings.push({ token, id }),
  });
  const prompt = await run(bot, message("/vincular"));
  assert.ok(prompt.some((r) => r.data.text?.includes("próxima mensagem")));
  assert.equal(bindings.length, 0);
  const token = "a".repeat(43);
  const replies = await run(bot, message(token));
  assert.deepEqual(bindings, [{ token, id: 99 }]);
  assert.ok(replies.some((r) => r.data.text?.includes("Vínculo concluído")));
});
test("limpar conversa e enviar start mantém o vínculo e abre menu", async () => {
  let bindings = 0;
  const { bot } = fixture({
    bindTelegram: async () => {
      bindings++;
    },
  });
  await run(bot, message("/limpar"));
  const replies = await run(bot, message("/start"));
  assert.equal(bindings, 0);
  assert.ok(
    replies.some(
      (reply) =>
        reply.data.text?.includes("vínculo permanece ativo") &&
        reply.data.reply_markup,
    ),
  );
});
test("start com código antigo não tenta revincular conta já vinculada", async () => {
  let bindings = 0;
  const { bot } = fixture({
    bindTelegram: async () => {
      bindings++;
    },
  });
  const replies = await run(bot, message("/start codigo-ja-utilizado"));
  assert.equal(bindings, 0);
  assert.ok(
    replies.some((reply) =>
      reply.data.text?.includes("vínculo permanece ativo"),
    ),
  );
});
test("nova instância reconhece vínculo persistido sem memória de conversa", async () => {
  const first = fixture();
  await run(first.bot, message("/menu"));
  const restarted = fixture();
  const replies = await run(restarted.bot, message("/start"));
  assert.ok(
    replies.some((reply) =>
      reply.data.text?.includes("vínculo permanece ativo"),
    ),
  );
});
test("start sem vínculo solicita código e conta bloqueada não recebe menu", async () => {
  const unlinked = fixture({}, false);
  const reply = await run(unlinked.bot, message("/start"));
  assert.ok(
    reply.some((item) => item.data.text?.includes("Solicite ao administrador")),
  );
  const blocked = fixture({
    currentUser: async () => {
      throw Object.assign(new Error("Conta indisponível."), { status: 401 });
    },
  });
  const denied = await run(blocked.bot, message("/start"));
  assert.ok(denied.some((item) => item.data.text === "Conta indisponível."));
  assert.ok(!denied.some((item) => item.data.reply_markup));
});
test("vincular aceita comando completo copiado do painel", async () => {
  const bindings = [];
  const { bot } = fixture({
    bindTelegram: async (token) => bindings.push(token),
  });
  const token = "b".repeat(43);
  await run(bot, message("/vincular"));
  await run(bot, message("/vincular " + token));
  assert.deepEqual(bindings, [token]);
});
test("vinculação pendente pode ser cancelada sem conta vinculada", async () => {
  const { bot } = fixture();
  await run(bot, message("/vincular"));
  const replies = await run(bot, message("/cancelar"));
  assert.ok(replies.some((r) => r.data.text?.includes("Vinculação cancelada")));
});
test("vinculação pendente recusa texto inválido sem tentar vincular", async () => {
  let attempted = false;
  const { bot } = fixture({
    bindTelegram: async () => {
      attempted = true;
    },
  });
  await run(bot, message("/vincular"));
  await run(bot, message("token"));
  assert.equal(attempted, false);
});

function adminFixture(overrides = {}) {
  const saved = [];
  const admin = { ...actor, papel: "ADM" };
  const account = {
    id: 8,
    nome: "Pessoa teste",
    email: "pessoa@example.com",
    identificacao: "P08",
    papel: "COLABORADOR",
    ativo: 1,
    bloqueado: 0,
    atualizado_em: "2026-10-23 12:00:00.000",
  };
  const settings = { permitir_sobreposicao: false };
  const fixtureResult = fixture({
    currentUser: async () => admin,
    settings: async () => settings,
    saveSettings: async (...args) =>
      saved.push({ type: "configuracoes", args }),
    detail: async (a, entity, id) =>
      entity === "usuarios"
        ? { ...account, id: Number(id) }
        : {
            id: Number(id),
            material_id: 2,
            tipo: "ENTRADA",
            status: "PENDENTE",
          },
    categories: async () => [{ id: 1, nome: "EPI" }],
    list: async () => ({ data: [], total: 0 }),
    ...Object.fromEntries(
      [
        "saveUser",
        "saveMaterial",
        "saveCategory",
        "saveTask",
        "move",
        "changeTask",
      ].map((type) => [
        type,
        async (...args) => {
          saved.push({ type, args });
          return { id: 1 };
        },
      ]),
    ),
    ...overrides,
  });
  return { ...fixtureResult, saved, admin, account };
}
function actionFrom(replies, prefix) {
  const actions = replies.flatMap(
    (r) => r.data.reply_markup?.inline_keyboard?.flat() || [],
  );
  const found = actions.find((b) => b.callback_data?.startsWith(prefix));
  assert.ok(found, `Botão esperado: ${prefix}`);
  return found.callback_data;
}
async function answerAll(bot, answers) {
  let replies;
  for (const text of answers) replies = await run(bot, message(text));
  return replies;
}
test("ADM recebe menu completo e perfis operacionais não acessam /admin", async () => {
  const { bot } = adminFixture();
  const replies = await run(bot, message("/admin"));
  assert.ok(actionFrom(replies, "adm:list:usuarios"));
  assert.ok(actionFrom(replies, "adm:report:materiais"));
  for (const papel of ["GESTOR", "COLABORADOR"]) {
    const f = adminFixture({ currentUser: async () => ({ ...actor, papel }) });
    const denied = await run(f.bot, message("/admin"));
    assert.ok(denied.some((r) => r.data.text?.includes("não autorizada")));
  }
});
test("configuração só muda após confirmação e botão não executa duas vezes", async () => {
  const { bot, saved } = adminFixture();
  const review = await run(bot, update("adm:toggle"));
  assert.equal(saved.length, 0);
  const callback = actionFrom(review, "adm:confirm:");
  await run(bot, update(callback));
  await run(bot, update(callback));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].args[0].origem, "telegram");
  assert.deepEqual(saved[0].args[1], { permitir_sobreposicao: true });
  assert.equal(saved[0].args[2], false);
});
test("cancelar confirmação não altera configuração", async () => {
  const { bot, saved } = adminFixture();
  const review = await run(bot, update("adm:toggle"));
  await run(bot, update(actionFrom(review, "adm:cancel:")));
  assert.equal(saved.length, 0);
});
test("revogação individual invalida confirmação administrativa pendente", async () => {
  let enabled = true;
  const { bot, saved } = adminFixture({
    loadBotPermissions: async () =>
      effectiveBotPermissions("ADM", { configuracoes: enabled }),
  });
  const review = await run(bot, update("adm:toggle"));
  enabled = false;
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved.length, 0);
});
test("confirmação expira em cinco minutos", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const { bot, saved } = adminFixture();
  const review = await run(bot, update("adm:toggle"));
  now += 301000;
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved.length, 0);
});
test("confirmação recusa ADM que perdeu o perfil após revisão", async () => {
  let papel = "ADM";
  const { bot, saved } = adminFixture({
    currentUser: async () => ({ ...actor, papel }),
  });
  const review = await run(bot, update("adm:toggle"));
  papel = "GESTOR";
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved.length, 0);
});
test("callback de outro usuário vinculado não reutiliza a confirmação anterior", async () => {
  let id = 7;
  const { bot, saved } = adminFixture({
    currentUser: async () => ({ ...actor, id, papel: "ADM" }),
  });
  const review = await run(bot, update("adm:toggle"));
  id = 9;
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved.length, 0);
});
test("cadastro de usuário oculta senha na revisão e só salva após confirmar", async () => {
  const { bot, saved } = adminFixture();
  await run(bot, update("adm:new:usuarios"));
  const password = "Senha-teste-12345";
  const review = await answerAll(bot, [
    "Pessoa nova",
    "novo@example.com",
    "NOVO-01",
    "GESTOR",
    "Sim",
    "Não",
    password,
  ]);
  assert.equal(saved.length, 0);
  assert.ok(!JSON.stringify(review).includes(password));
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved[0].type, "saveUser");
  assert.equal(saved[0].args[1].papel, "GESTOR");
  assert.equal(saved[0].args[1].senha, password);
});
test("edição de usuário conserva campos e envia versão revisada", async () => {
  const { bot, saved, account } = adminFixture();
  await run(bot, update("adm:edit:usuarios:8"));
  const review = await answerAll(bot, ["-", "-", "-", "GESTOR", "-", "-", "-"]);
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved[0].args[1].nome, account.nome);
  assert.equal(saved[0].args[1].papel, "GESTOR");
  assert.equal(saved[0].args[1].senha, undefined);
  assert.equal(saved[0].args[2], 8);
  assert.equal(saved[0].args[3], account.atualizado_em);
});
test("bloqueio de usuário exige confirmação", async () => {
  const { bot, saved } = adminFixture();
  const review = await run(bot, update("adm:access:8"));
  assert.equal(saved.length, 0);
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved[0].args[1].bloqueado, true);
});
test("estoque administrativo e detalhe removem zeros decimais desnecessários", async () => {
  const material = {
    id: 1,
    nome: "Luva",
    saldo: "1.000",
    estoque_minimo: "2.500",
    unidade: "UN",
  };
  const { bot } = adminFixture({
    list: async () => ({ data: [material], total: 1 }),
    detail: async () => material,
  });
  const list = await run(bot, update("adm:list:materiais:1"));
  assert.ok(list.some((reply) => reply.data.text?.includes("Saldo: 1 UN")));
  const detail = await run(bot, update("adm:detail:materiais:1"));
  assert.ok(
    detail.some(
      (reply) =>
        reply.data.text?.includes("saldo: 1\n") &&
        reply.data.text.includes("estoque_minimo: 2,5"),
    ),
  );
});
test("ADM informa justificativa e confirma antes de iniciar tarefa", async () => {
  const { bot, saved } = adminFixture();
  await run(bot, update("adm:task:iniciar:3"));
  assert.equal(saved.length, 0);
  const review = await run(bot, message("Equipe pronta para a execução"));
  assert.equal(saved.length, 0);
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved[0].type, "changeTask");
  assert.equal(saved[0].args[2], "iniciar");
  assert.equal(saved[0].args[3].observacoes, "Equipe pronta para a execução");
});
test("cadastro de material e categoria usam os serviços compartilhados", async () => {
  const { bot, saved } = adminFixture();
  await run(bot, update("adm:new:materiais"));
  const review = await answerAll(bot, [
    "Luva teste",
    "-",
    "1",
    "UN",
    "2",
    "Sim",
  ]);
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved[0].type, "saveMaterial");
  assert.equal(saved[0].args[1].estoque_minimo, "2");
  await run(bot, update("adm:new:categorias"));
  const category = await answerAll(bot, ["Ferramentas teste"]);
  await run(bot, update(actionFrom(category, "adm:confirm:")));
  assert.equal(saved[1].type, "saveCategory");
});
test("tarefas aceitam data brasileira e cancelamento justificado", async () => {
  const { bot, saved } = adminFixture();
  await run(bot, update("adm:new:tarefas"));
  const review = await answerAll(bot, [
    "8",
    "Manutenção teste",
    "-",
    "24/10/2026",
    "08:00",
    "09:00",
    "ALTA",
    "-",
  ]);
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved[0].type, "saveTask");
  assert.equal(saved[0].args[1].data_programada, "2026-10-24");
  await run(bot, update("adm:task:cancelar:3"));
  const cancel = await answerAll(bot, ["Mudança de programação", "-"]);
  await run(bot, update(actionFrom(cancel, "adm:confirm:")));
  assert.equal(saved[1].type, "changeTask");
  assert.equal(saved[1].args[2], "cancelar");
  assert.equal(saved[1].args[3].motivo, "Mudança de programação");
});
test("ajuste e estorno são confirmados e têm chave idempotente", async () => {
  const { bot, saved } = adminFixture();
  await run(bot, update("adm:new:movimentacoes"));
  const review = await answerAll(bot, [
    "2",
    "AJUSTE",
    "-2",
    "Correção de inventário",
    "-",
    "-",
    "-",
  ]);
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved[0].type, "move");
  assert.equal(saved[0].args[1].quantidade, "-2");
  assert.ok(saved[0].args[1].chave_idempotencia);
  await run(bot, update("adm:reverse:5"));
  const reverse = await answerAll(bot, ["Corrigir entrada duplicada"]);
  await run(bot, update(actionFrom(reverse, "adm:confirm:")));
  assert.equal(saved[1].args[1].estorno_de, 5);
  assert.equal(saved[1].args[1].tipo, "ESTORNO");
});
test("relatórios enviam CSV com proteção contra fórmulas", async () => {
  const { bot } = adminFixture({
    list: async () => ({ data: [{ id: 1, nome: "=SUM(1)" }], total: 1 }),
  });
  const replies = await run(bot, update("adm:csv:materiais:1"));
  const file = replies.find((r) => r.method === "sendDocument");
  assert.ok(file);
  assert.ok(file.data.document.source.toString("utf8").includes("'=SUM(1)"));
});
test("detalhe de auditoria consulta somente o registro selecionado", async () => {
  let query;
  const { bot } = adminFixture({
    list: async (a, entity, q) => {
      query = q;
      return {
        data: [{ id: 12, acao: "EDITAR", entidade: "usuarios" }],
        total: 1,
      };
    },
  });
  await run(bot, update("adm:detail:auditoria:12"));
  assert.equal(query.id, "12");
});
test("botões de opções avançam o formulário e recusam cliques antigos", async () => {
  const { bot, saved } = adminFixture();
  await run(bot, update("adm:new:usuarios"));
  const prompt = await answerAll(bot, [
    "Pessoa nova",
    "nova@example.com",
    "NOVA-01",
  ]);
  const option = actionFrom(prompt, "adm:answer:");
  const next = await run(bot, update(option));
  assert.ok(next.some((r) => r.data.text?.includes("Cadastro ativo")));
  const stale = await run(bot, update(option));
  assert.ok(stale.some((r) => r.data.text?.includes("desatualizado")));
  assert.equal(saved.length, 0);
});
test("filtro de agenda converte datas e preserva o escopo da consulta", async () => {
  let query;
  const { bot } = adminFixture({
    list: async (a, entity, q) => {
      query = q;
      return { data: [], total: 0 };
    },
  });
  await run(bot, update("adm:filter:tarefas"));
  await answerAll(bot, ["-", "24/10/2026", "8", "PENDENTE", "ALTA"]);
  assert.equal(query.data_programada, "2026-10-24");
  assert.equal(query.responsavel_id, 8);
  assert.equal(query.status, "PENDENTE");
});
test("estorno pelo formulário não pede quantidade arbitrária", async () => {
  const { bot, saved } = adminFixture();
  await run(bot, update("adm:new:movimentacoes"));
  const prompt = await answerAll(bot, ["2", "ESTORNO"]);
  assert.ok(prompt.some((r) => r.data.text?.includes("Motivo")));
  const review = await answerAll(bot, ["Corrigir lançamento", "-", "-", "5"]);
  assert.ok(
    review.some((r) => r.data.text?.includes("Calculada automaticamente")),
  );
  await run(bot, update(actionFrom(review, "adm:confirm:")));
  assert.equal(saved[0].args[1].tipo, "ESTORNO");
  assert.equal(saved[0].args[1].estorno_de, 5);
});
