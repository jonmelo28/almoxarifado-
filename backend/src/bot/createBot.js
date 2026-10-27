import { Telegraf, Markup } from "telegraf";
import { rows as defaultRows } from "../shared/db.js";
import { ensure, allow } from "../shared/domain.js";
import * as defaultServices from "../modules/services.js";
import {
  privateChat,
  parseMovement,
  today,
  taskText,
  formatQuantity,
} from "./handlers.js";
import { registerAdmin } from "./admin.js";
import { conversationCleanup, deleteMessages } from "./conversation.js";
import {
  callbackPermission,
  effectiveBotPermissions,
} from "../shared/botPermissions.js";
export function createBot({
  token,
  services = defaultServices,
  rows = defaultRows,
}) {
  const bot = new Telegraf(token);
  const flows = new Map();
  bot.use(conversationCleanup());
  bot.use(async (ctx, next) => {
    if (!privateChat(ctx)) return;
    try {
      await next();
    } catch (error) {
      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
      await ctx.reply(
        error.status
          ? error.message
          : error.name === "ZodError"
            ? "Dados inválidos. Confira o formato informado."
            : "Não foi possível concluir. Tente novamente.",
      );
      console.error(
        JSON.stringify({
          level: "error",
          component: "bot",
          code: error.code || error.status || "INTERNAL",
        }),
      );
    }
  });
  bot.start(async (ctx, next) => {
    const [linked] = await rows("SELECT id FROM usuarios WHERE telegram_id=?", [
      String(ctx.from.id),
    ]);
    if (linked) {
      flows.delete(ctx.from.id);
      return next();
    }
    if (ctx.startPayload) {
      await services.bindTelegram(ctx.startPayload, ctx.from.id);
      return ctx.reply("Conta vinculada. Use /menu.");
    }
    await ctx.reply(
      "Solicite ao administrador um código de vínculo ou gere pelo seu perfil no painel. Envie /vincular seguido do código. Depois de vincular, você pode limpar a conversa sem perder o acesso.",
    );
  });
  bot.command("vincular", async (ctx) => {
    const token = ctx.message.text.split(/\s+/)[1];
    if (!token) {
      flows.set(ctx.from.id, {
        mode: "vincular",
        expires: Date.now() + 5 * 60000,
      });
      return ctx.reply(
        "No painel, clique em Vincular Telegram, próximo ao seu perfil. Copie o código gerado e envie aqui na próxima mensagem. Você também pode colar o comando completo copiado do painel. Use /cancelar para sair. Não envie o token do BotFather.",
      );
    }
    await services.bindTelegram(token, ctx.from.id);
    flows.delete(ctx.from.id);
    await ctx.reply("Vínculo concluído. Use /menu.");
  });
  bot.use(async (ctx, next) => {
    const flow = flows.get(ctx.from.id);
    if (flow?.mode !== "vincular" || !ctx.message?.text) return next();
    const text = ctx.message.text.trim();
    if (/^\/cancelar(?:@\w+)?$/.test(text)) {
      flows.delete(ctx.from.id);
      return ctx.reply(
        "Vinculação cancelada. Use /vincular para tentar novamente.",
      );
    }
    if (text.startsWith("/")) return next();
    if (flow.expires < Date.now()) {
      flows.delete(ctx.from.id);
      return ctx.reply(
        "A espera pelo código expirou. Gere um novo código no painel e envie /vincular.",
      );
    }
    ensure(
      /^[A-Za-z0-9_-]{43}$/.test(text),
      422,
      "Envie somente o código gerado em Vincular Telegram no painel, ou cole o comando completo copiado de lá. Não use o token do BotFather.",
    );
    await services.bindTelegram(text, ctx.from.id);
    flows.delete(ctx.from.id);
    await ctx.reply("Vínculo concluído. Use /menu.");
  });
  bot.use(async (ctx, next) => {
    const [user] = await rows("SELECT id FROM usuarios WHERE telegram_id=?", [
      String(ctx.from.id),
    ]);
    ensure(user, 401, "Conta não vinculada. Gere um token pelo painel.");
    ctx.actor = {
      ...(await services.currentUser(user.id)),
      origem: "telegram",
    };
    ctx.actor.botPermissions = services.loadBotPermissions
      ? await services.loadBotPermissions(ctx.actor)
      : effectiveBotPermissions(ctx.actor.papel);
    ensure(
      ctx.actor.botPermissions.acessar_bot,
      403,
      "Seu acesso ao bot está desabilitado. Consulte o administrador.",
    );
    const permission =
      ctx.callbackQuery?.data && callbackPermission(ctx.callbackQuery.data);
    if (permission)
      ensure(
        ctx.actor.botPermissions[permission],
        403,
        "Operação não permitida no bot para sua conta. Consulte o administrador.",
      );
    const reply = ctx.reply.bind(ctx);
    ctx.reply = (text, extra = {}) => {
      if (extra.reply_markup?.inline_keyboard) {
        extra = {
          ...extra,
          reply_markup: {
            ...extra.reply_markup,
            inline_keyboard: extra.reply_markup.inline_keyboard
              .map((row) =>
                row.filter((button) => {
                  const key =
                    button.callback_data &&
                    callbackPermission(button.callback_data);
                  return !key || ctx.actor.botPermissions[key];
                }),
              )
              .filter((row) => row.length),
          },
        };
      }
      return reply(text, extra);
    };
    return next();
  });
  registerAdmin(bot, {
    services,
    onNavigate: (ctx) => flows.delete(ctx.from.id),
  });
  const buttons = (actor) =>
    Markup.inlineKeyboard([
      [
        Markup.button.callback("Tarefas de hoje", "hoje"),
        Markup.button.callback("Próximas tarefas", "proximas"),
      ],
      [
        Markup.button.callback("Estoque", "estoque"),
        Markup.button.callback("Minha movimentação", "historico"),
      ],
      [
        Markup.button.callback("Registrar saída", "saida"),
        Markup.button.callback("Devolução", "devolucao"),
      ],
      ...(actor.papel !== "COLABORADOR"
        ? [
            [
              Markup.button.callback("Entrada", "entrada"),
              Markup.button.callback("Programar tarefa", "programar"),
            ],
            [
              Markup.button.callback("Resumo da equipe", "resumo"),
              Markup.button.callback("Agenda da equipe", "equipe:1"),
            ],
          ]
        : []),
      ...(actor.papel === "ADM"
        ? [
            [Markup.button.callback("Administração completa", "adm:menu")],
            [
              Markup.button.callback("Usuários", "usuarios"),
              Markup.button.callback("Auditoria", "auditoria"),
            ],
          ]
        : []),
      [Markup.button.callback("Cancelar formulário", "cancelar")],
    ]);
  bot.start((ctx) =>
    ctx.reply(
      "Seu vínculo permanece ativo. Escolha uma operação.",
      buttons(ctx.actor),
    ),
  );
  bot.command("menu", (ctx) => {
    flows.delete(ctx.from.id);
    return ctx.reply("Almoxarifado · Escolha uma operação", buttons(ctx.actor));
  });
  bot.command("limpar", async (ctx) => {
    flows.delete(ctx.from.id);
    const last = ctx.message.message_id;
    const complete = await deleteMessages(
      ctx,
      Array.from({ length: Math.min(last, 100) }, (_, index) => last - index),
    );
    await ctx.reply(
      complete
        ? "Conversa limpa. Escolha uma operação."
        : "Limpeza parcial: o Telegram não permitiu apagar algumas mensagens. Escolha uma operação.",
      buttons(ctx.actor),
    );
  });
  bot.command("cancelar", async (ctx) => {
    flows.delete(ctx.from.id);
    await ctx.reply("Formulário cancelado.");
  });
  async function renderTasks(ctx, kind, page = 1) {
    await ctx.answerCbQuery();
    if (kind === "equipe") allow(ctx.actor, "ADM", "GESTOR");
    const result = await services.list(ctx.actor, "tarefas", {
      page,
      limit: 10,
      ...(kind !== "proximas"
        ? { data_programada: today() }
        : { proximas: "true" }),
      ...(kind === "equipe" ? {} : { responsavel_id: ctx.actor.id }),
    });
    for (const t of result.data)
      await ctx.reply(
        taskText(t),
        Markup.inlineKeyboard([
          [Markup.button.callback("Detalhes", `tarefa:${t.id}`)],
        ]),
      );
    const nav = [];
    if (page > 1)
      nav.push(Markup.button.callback("Anterior", `${kind}:${page - 1}`));
    if (page * 10 < result.total)
      nav.push(Markup.button.callback("Próxima", `${kind}:${page + 1}`));
    await ctx.reply(
      `${result.total} tarefa(s) · página ${page}`,
      Markup.inlineKeyboard([nav]),
    );
  }
  bot.action(/^(hoje|proximas)$/, (ctx) => renderTasks(ctx, ctx.match[1]));
  bot.action(/^(hoje|proximas|equipe):(\d+)$/, (ctx) =>
    renderTasks(ctx, ctx.match[1], Number(ctx.match[2])),
  );
  bot.action(/^tarefa:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const t = await services.detail(ctx.actor, "tarefas", ctx.match[1]);
    await ctx.reply(
      taskText(t),
      Markup.inlineKeyboard(
        t.status === "PENDENTE"
          ? [[Markup.button.callback("Iniciar", `iniciar:${t.id}`)]]
          : t.status === "EM_ANDAMENTO"
            ? [[Markup.button.callback("Concluir", `concluir:${t.id}`)]]
            : [],
      ),
    );
  });
  bot.action(/^(iniciar|concluir):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (ctx.match[1] === "iniciar") {
      const task = await services.detail(ctx.actor, "tarefas", ctx.match[2]);
      ensure(task.status === "PENDENTE", 409, "Esta tarefa não está pendente.");
      flows.set(ctx.from.id, {
        mode: "iniciar",
        taskId: ctx.match[2],
        actorId: ctx.actor.id,
        expires: Date.now() + 5 * 60000,
      });
      return ctx.reply(
        `Informe a justificativa para iniciar a tarefa #${task.id} (5 a 1000 caracteres). Use /cancelar para sair.`,
      );
    }
    const result = await services.changeTask(
      ctx.actor,
      ctx.match[2],
      ctx.match[1],
    );
    await ctx.reply(`Tarefa #${result.id}: ${result.status}.`);
  });
  async function renderRecords(ctx, entity, page = 1) {
    await ctx.answerCbQuery();
    const history = entity === "historico";
    const result = await services.list(
      ctx.actor,
      history ? "movimentacoes" : "materiais",
      {
        page,
        limit: 10,
        ...(history ? { proprio: "true" } : { ativo: "true" }),
      },
    );
    const text = result.data
      .map((m) =>
        history
          ? `#${m.id} ${m.tipo} · ${m.material} · ${formatQuantity(m.quantidade)}`
          : `#${m.id} ${m.codigo} · ${m.nome}: ${formatQuantity(m.saldo)} ${m.unidade}`,
      )
      .join("\n");
    const nav = [];
    if (page > 1)
      nav.push(Markup.button.callback("Anterior", `${entity}:${page - 1}`));
    if (page * 10 < result.total)
      nav.push(Markup.button.callback("Próxima", `${entity}:${page + 1}`));
    await ctx.reply(
      (text || "Nenhum registro encontrado.") +
        `\n${result.total} registro(s) · página ${page}`,
      Markup.inlineKeyboard([nav]),
    );
  }
  bot.action(/^(estoque|historico)$/, (ctx) =>
    renderRecords(ctx, ctx.match[1]),
  );
  bot.action(/^(estoque|historico):(\d+)$/, (ctx) =>
    renderRecords(ctx, ctx.match[1], Number(ctx.match[2])),
  );
  bot.action(/^(saida|entrada|devolucao|programar)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const mode = ctx.match[1];
    if (["entrada", "programar"].includes(mode))
      allow(ctx.actor, "ADM", "GESTOR");
    flows.set(ctx.from.id, { mode, expires: Date.now() + 5 * 60000 });
    await ctx.reply(
      mode === "programar"
        ? "Envie: ID responsável | título | AAAA-MM-DD | HH:mm início | HH:mm fim | BAIXA/MEDIA/ALTA.\nUse /cancelar para sair."
        : "Envie: ID material quantidade motivo\nExemplo de formato: 12 2.500 Uso na manutenção\nUse /cancelar para sair.",
    );
  });
  bot.action("cancelar", async (ctx) => {
    await ctx.answerCbQuery();
    flows.delete(ctx.from.id);
    await ctx.reply("Formulário cancelado.");
  });
  bot.action("resumo", async (ctx) => {
    await ctx.answerCbQuery();
    allow(ctx.actor, "ADM", "GESTOR");
    const d = await services.dashboard(ctx.actor);
    await ctx.reply(
      `Equipe: ${d.colaboradores} ativos\nEstoque baixo: ${d.estoque_baixo}\nTarefas hoje: ${d.tarefas.map((t) => `${t.status}: ${t.total}`).join(", ") || "nenhuma"}\nAtrasadas: ${d.atrasadas}`,
    );
  });
  for (const entity of ["usuarios", "auditoria"])
    bot.action(entity, async (ctx) => {
      await ctx.answerCbQuery();
      allow(ctx.actor, "ADM");
      const r = await services.list(ctx.actor, entity, { limit: 10 });
      await ctx.reply(
        r.data
          .map((x) =>
            entity === "usuarios"
              ? `#${x.id} ${x.nome} · ${x.papel}`
              : `#${x.id} ${x.acao} · ${x.entidade} #${x.entidade_id}`,
          )
          .join("\n") || "Nenhum registro.",
      );
    });
  bot.on("text", async (ctx) => {
    const f = flows.get(ctx.from.id);
    if (!f) return ctx.reply("Use /menu para começar.");
    if (f.expires < Date.now()) {
      flows.delete(ctx.from.id);
      return ctx.reply("Formulário expirado. Use /menu.");
    }
    if (f.mode === "iniciar") {
      ensure(
        ctx.actor.botPermissions.tarefas_iniciar,
        403,
        "Iniciar tarefas não está permitido no bot para sua conta.",
      );
      ensure(
        f.actorId === ctx.actor.id,
        403,
        "A conta vinculada mudou. Abra a tarefa novamente.",
      );
      const observacoes = ctx.message.text.trim();
      ensure(
        observacoes.length >= 5 && observacoes.length <= 1000,
        422,
        "Informe uma justificativa de 5 a 1000 caracteres.",
      );
      const result = await services.changeTask(ctx.actor, f.taskId, "iniciar", {
        observacoes,
      });
      flows.delete(ctx.from.id);
      return ctx.reply(
        `Tarefa #${result.id}: ${result.status}. Justificativa registrada.`,
        buttons(ctx.actor),
      );
    }
    if (f.mode === "programar") {
      ensure(
        ctx.actor.botPermissions.tarefas_programar,
        403,
        "Programar tarefas não está permitido no bot para sua conta.",
      );
      const [
        responsavel,
        titulo,
        data_programada,
        hora_inicio,
        hora_fim,
        prioridade,
      ] = ctx.message.text.split("|").map((s) => s.trim());
      const r = await services.saveTask(ctx.actor, {
        responsavel_id: Number(responsavel),
        titulo,
        data_programada,
        hora_inicio,
        hora_fim,
        prioridade,
        descricao: "",
        observacoes: "",
      });
      flows.delete(ctx.from.id);
      return ctx.reply(`Tarefa #${r.id} programada.`);
    }
    const data = parseMovement(
      ctx.message.text,
      ctx.actor,
      ctx.update.update_id,
    );
    ensure(
      ctx.actor.botPermissions[f.mode],
      403,
      "Esta movimentação não está permitida no bot para sua conta.",
    );
    data.tipo = { saida: "SAIDA", entrada: "ENTRADA", devolucao: "DEVOLUCAO" }[
      f.mode
    ];
    const r = await services.move(ctx.actor, data);
    flows.delete(ctx.from.id);
    await ctx.reply(
      `Movimentação #${r.id} confirmada. Saldo: ${formatQuantity(r.saldo_posterior)}.`,
    );
  });
  return bot;
}
