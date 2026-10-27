import { randomBytes, randomUUID } from "node:crypto";
import { Markup, Input } from "telegraf";
import { z } from "zod";
import { allow, ensure, csv, page as validatePage } from "../shared/domain.js";
import { entityPermission } from "../shared/botPermissions.js";
import { formatQuantity, quantityFields } from "./handlers.js";
import {
  userSchema,
  materialSchema,
  taskSchema,
  movementSchema,
} from "../shared/schemas.js";

const button = (label, data) => Markup.button.callback(label, data);
const names = {
  configuracoes: "Configurações",
  transicao: "Alteração de tarefa",
  iniciar: "Início de tarefa",
  cancelar: "Cancelamento de tarefa",
  usuarios: "Colaboradores",
  materiais: "Materiais",
  categorias: "Categorias",
  tarefas: "Tarefas",
  movimentacoes: "Movimentações",
  auditoria: "Auditoria",
};
const field = (key, label, type = "text", options = {}) => ({
  key,
  label,
  type,
  ...options,
});
const forms = {
  usuarios: [
    field("nome", "Nome completo"),
    field("email", "Email", "email"),
    field("identificacao", "Identificação interna"),
    field("papel", "Perfil", "enum", {
      choices: ["ADM", "GESTOR", "COLABORADOR"],
      default: "COLABORADOR",
    }),
    field("ativo", "Cadastro ativo?", "bool", { default: true }),
    field("bloqueado", "Conta bloqueada?", "bool", { default: false }),
    field("senha", "Senha (12 a 72 bytes UTF-8)", "password"),
  ],
  materiais: [
    field("nome", "Nome do material"),
    field("descricao", "Descrição", "text", { default: "" }),
    field(
      "categoria_id",
      "ID da categoria (consulte Categorias no menu ADM)",
      "id",
    ),
    field("unidade", "Unidade", "enum", {
      choices: ["UN", "KG", "L", "M"],
      default: "UN",
    }),
    field("estoque_minimo", "Estoque mínimo (use ponto decimal)", "decimal", {
      default: "0",
    }),
    field("ativo", "Material ativo?", "bool", { default: true }),
  ],
  categorias: [field("nome", "Nome da categoria")],
  tarefas: [
    field("responsavel_id", "ID do colaborador responsável", "id"),
    field("titulo", "Título da tarefa"),
    field("descricao", "Descrição", "text", { default: "" }),
    field(
      "data_programada",
      "Data programada (DD/MM/AAAA ou AAAA-MM-DD)",
      "date",
    ),
    field("hora_inicio", "Início programado (HH:mm)", "time"),
    field("hora_fim", "Fim programado (HH:mm)", "time"),
    field("prioridade", "Prioridade", "enum", {
      choices: ["BAIXA", "MEDIA", "ALTA"],
      default: "MEDIA",
    }),
    field("observacoes", "Observações", "text", { default: "" }),
  ],
  movimentacoes: [
    field("material_id", "ID do material", "id"),
    field("tipo", "Tipo da movimentação", "enum", {
      choices: ["ENTRADA", "SAIDA", "DEVOLUCAO", "AJUSTE", "ESTORNO"],
      default: "ENTRADA",
    }),
    field(
      "quantidade",
      "Quantidade; em AJUSTE, variação positiva ou negativa",
      "decimal",
    ),
    field("motivo", "Motivo (mínimo 5 caracteres)"),
    field("beneficiario_id", "ID do beneficiário (opcional)", "id", {
      default: null,
    }),
    field("tarefa_id", "ID da tarefa relacionada (opcional)", "id", {
      default: null,
    }),
    field(
      "estorno_de",
      "ID da movimentação original para ESTORNO; demais tipos: -",
      "id",
      { default: null },
    ),
  ],
  cancelar: [
    field("motivo", "Motivo do cancelamento (mínimo 5 caracteres)"),
    field("observacoes", "Observações", "text", { default: "" }),
  ],
  iniciar: [
    field("observacoes", "Justificativa para iniciar (5 a 1000 caracteres)"),
  ],
};
const schemas = {
  iniciar: z.object({ observacoes: z.string().trim().min(5).max(1000) }),
  usuarios: userSchema,
  materiais: materialSchema,
  tarefas: taskSchema,
  movimentacoes: movementSchema,
  categorias: z.object({ nome: z.string().trim().min(2).max(100) }),
  cancelar: z.object({
    motivo: z.string().min(5).max(1000),
    observacoes: z.string().max(5000),
  }),
};
const filterFields = {
  usuarios: [
    field("q", "Nome ou identificação", "text", { default: "" }),
    field("papel", "Perfil (ADM/GESTOR/COLABORADOR ou -)", "text", {
      default: "",
    }),
    field("situacao", "Situação (ATIVO/INATIVO/BLOQUEADO ou -)", "text", {
      default: "",
    }),
  ],
  materiais: [
    field("q", "Nome ou código", "text", { default: "" }),
    field("baixo", "Somente estoque baixo?", "bool", { default: false }),
  ],
  tarefas: [
    field("q", "Título", "text", { default: "" }),
    field("data_programada", "Data (DD/MM/AAAA ou - para todas)", "date", {
      default: "",
    }),
    field("responsavel_id", "ID do responsável (ou - para todos)", "id", {
      default: null,
    }),
    field(
      "status",
      "Status (PENDENTE/EM_ANDAMENTO/CONCLUIDA/CANCELADA ou -)",
      "text",
      { default: "" },
    ),
    field("prioridade", "Prioridade (BAIXA/MEDIA/ALTA ou -)", "text", {
      default: "",
    }),
  ],
  movimentacoes: [
    field("q", "Material ou motivo", "text", { default: "" }),
    field("material_id", "ID material (ou - para todos)", "id", {
      default: null,
    }),
    field(
      "tipo",
      "Tipo (ENTRADA/SAIDA/DEVOLUCAO/AJUSTE/ESTORNO ou -)",
      "text",
      { default: "" },
    ),
    field("de", "Data inicial (DD/MM/AAAA ou -)", "date", { default: "" }),
    field("ate", "Data final (DD/MM/AAAA ou -)", "date", { default: "" }),
  ],
  auditoria: [
    field("q", "Ação, recurso ou responsável", "text", { default: "" }),
  ],
};
const display = (value) =>
  value === null || value === ""
    ? "—"
    : typeof value === "boolean"
      ? value
        ? "Sim"
        : "Não"
      : String(value);
function parseAnswer(f, text) {
  if (f.type === "bool") {
    ensure(
      ["sim", "não", "nao", "true", "false"].includes(text.toLowerCase()),
      422,
      "Responda Sim ou Não.",
    );
    return ["sim", "true"].includes(text.toLowerCase());
  }
  if (f.type === "id")
    return z.coerce.number().int().positive().max(4294967295).parse(text);
  if (f.type === "enum") return z.enum(f.choices).parse(text.toUpperCase());
  if (f.type === "email") return z.string().email().max(190).parse(text);
  if (f.type === "decimal")
    return z
      .string()
      .regex(/^-?\d{1,12}(\.\d{1,3})?$/)
      .parse(text);
  if (f.type === "time")
    return z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .parse(text);
  if (f.type === "date") {
    const date = text.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");
    return taskSchema.innerType().shape.data_programada.parse(date);
  }
  if (f.type === "password") return userSchema.shape.senha.unwrap().parse(text);
  return z.string().max(4000).parse(text);
}

export function registerAdmin(bot, { services, onNavigate = () => {} }) {
  const states = new Map();
  const filters = new Map();
  const getFilters = (ctx, entity) => filters.get(ctx.from.id)?.[entity] || {};
  function setFilters(ctx, entity, value) {
    filters.set(ctx.from.id, { ...filters.get(ctx.from.id), [entity]: value });
  }
  function startState(ctx, value) {
    for (const [userId, state] of states) {
      if (state.expires <= Date.now()) states.delete(userId);
    }
    const state = {
      ...value,
      nonce: randomBytes(8).toString("hex"),
      expires: Date.now() + 5 * 60000,
      actorId: ctx.actor.id,
    };
    states.set(ctx.from.id, state);
    return state;
  }
  function valid(ctx, state) {
    ensure(
      state && state.actorId === ctx.actor.id && state.expires > Date.now(),
      409,
      "Operação expirada ou já utilizada. Abra /admin novamente.",
    );
    const key =
      state.operation === "filter"
        ? entityPermission(state.entity)
        : {
            usuarios: "usuarios_editar",
            materiais: "materiais_editar",
            categorias: "categorias_editar",
            tarefas: "tarefas_programar",
            configuracoes: "configuracoes",
            iniciar: "tarefas_iniciar",
            cancelar: "tarefas_cancelar",
          }[state.entity] ||
          (state.entity === "transicao"
            ? { iniciar: "tarefas_iniciar", concluir: "tarefas_concluir" }[
                state.data.acao
              ]
            : null) ||
          (state.entity === "movimentacoes"
            ? {
                SAIDA: "saida",
                ENTRADA: "entrada",
                DEVOLUCAO: "devolucao",
                AJUSTE: "ajuste",
                ESTORNO: "estorno",
              }[state.data.tipo] || "movimentacoes_ver"
            : null);
    ensure(
      !key || ctx.actor.botPermissions[key],
      403,
      "Operação não permitida no bot para sua conta. Consulte o administrador.",
    );
  }
  async function menu(ctx) {
    allow(ctx.actor, "ADM");
    states.delete(ctx.from.id);
    onNavigate(ctx);
    return ctx.reply(
      "Administração · Todas as operações do portal",
      Markup.inlineKeyboard([
        [
          button("Configurações", "adm:settings"),
          button("Dashboard", "adm:dashboard"),
        ],
        [
          button("Colaboradores", "adm:list:usuarios:1"),
          button("Materiais", "adm:list:materiais:1"),
        ],
        [
          button("Categorias", "adm:list:categorias:1"),
          button("Movimentações", "adm:list:movimentacoes:1"),
        ],
        [
          button("Tarefas", "adm:list:tarefas:1"),
          button("Auditoria", "adm:list:auditoria:1"),
        ],
        [
          button("Relatório estoque", "adm:report:materiais:1"),
          button("Relatório tarefas", "adm:report:tarefas:1"),
        ],
        [button("Relatório consumo", "adm:report:movimentacoes:1")],
      ]),
    );
  }
  async function ask(ctx, state) {
    const f = state.fields[state.index];
    const existing = state.data[f.key];
    const optional =
      existing !== undefined ||
      f.default !== undefined ||
      (f.type === "password" && state.id);
    const prompt = `${names[state.entity] || "Tarefa"} · ${state.index + 1}/${state.fields.length}\n${f.label}${f.type !== "password" && optional ? `\nValor ao enviar -: ${display(existing === undefined ? f.default : existing)}` : ""}${optional ? "\nEnvie - para manter o valor ou deixar vazio." : ""}\n/cancelar encerra o formulário.`;
    const choices = f.type === "bool" ? ["Sim", "Não"] : f.choices;
    await ctx.reply(
      prompt,
      Markup.inlineKeyboard(
        choices
          ? choices.map((choice, index) => [
              button(
                choice,
                `adm:answer:${state.nonce}:${state.index}:${index}`,
              ),
            ])
          : [],
      ),
    );
  }
  async function review(ctx, state) {
    state.mode = "confirm";
    const lines = Object.entries(state.data)
      .filter(([key]) => key !== "chave_idempotencia")
      .map(
        ([key, value]) =>
          `${forms[state.entity]?.find((f) => f.key === key)?.label || { permitir_sobreposicao: "Permitir sobreposição", acao: "Ação" }[key] || key}: ${key === "senha" ? "••••••••" : key === "quantidade" && state.data.tipo === "ESTORNO" ? "Calculada automaticamente" : quantityFields.has(key) ? formatQuantity(value) : display(value)}`,
      );
    await ctx.reply(
      `Revisar ${names[state.entity] || "operação"}${state.id ? ` #${state.id}` : ""}\n${lines.join("\n").slice(0, 3200)}\nNada será alterado até confirmar.`,
      Markup.inlineKeyboard([
        [
          button("Confirmar", `adm:confirm:${state.nonce}`),
          button("Cancelar", `adm:cancel:${state.nonce}`),
        ],
      ]),
    );
  }
  async function accept(ctx, value) {
    const state = states.get(ctx.from.id);
    valid(ctx, state);
    ensure(
      state.mode === "form",
      409,
      "Use os botões de confirmação ou /cancelar.",
    );
    const f = state.fields[state.index];
    try {
      if (value === "-") {
        ensure(
          state.data[f.key] !== undefined ||
            f.default !== undefined ||
            (f.type === "password" && state.id),
          422,
          "Este campo é obrigatório.",
        );
        if (state.data[f.key] === undefined && f.default !== undefined)
          state.data[f.key] = f.default;
      } else state.data[f.key] = parseAnswer(f, value.trim());
    } catch (error) {
      await ctx.reply(
        error.status
          ? error.message
          : "Valor inválido. Confira o formato solicitado.",
      );
      return ask(ctx, state);
    }
    if (f.type === "password" && value !== "-")
      await ctx.deleteMessage().catch(() => {});
    if (
      state.entity === "movimentacoes" &&
      f.key === "tipo" &&
      state.data.tipo === "ESTORNO"
    ) {
      state.data.quantidade = "1";
      state.fields = state.fields.filter((f) => f.key !== "quantidade");
    }
    if (state.index + 1 < state.fields.length) {
      state.index++;
      return ask(ctx, state);
    }
    if (state.operation === "filter") {
      const query = Object.fromEntries(
        Object.entries(state.data)
          .filter(([, v]) => v !== "" && v !== null)
          .map(([k, v]) => [k, typeof v === "boolean" ? String(v) : v]),
      );
      setFilters(ctx, state.entity, query);
      states.delete(ctx.from.id);
      return renderList(ctx, state.entity, 1);
    }
    if (state.entity === "movimentacoes" && state.data.tipo === "ESTORNO")
      state.data.quantidade = "1";
    const result = schemas[state.entity].safeParse(state.data);
    if (!result.success) {
      await ctx.reply(
        "Revise o cadastro: " +
          result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
      );
      state.index = 0;
      return ask(ctx, state);
    }
    state.data = result.data;
    return review(ctx, state);
  }
  async function startForm(ctx, entity, id) {
    ensure(forms[entity], 404, "Formulário não encontrado.");
    let old;
    if (id) {
      old =
        entity === "categorias"
          ? (await services.categories(ctx.actor)).find(
              (c) => c.id === Number(id),
            )
          : await services.detail(ctx.actor, entity, id);
      ensure(old, 404, "Registro não encontrado.");
    }
    let fields = forms[entity];
    if (entity === "materiais" && old)
      fields = fields.filter((f) => f.key !== "unidade");
    const data = {};
    if (old)
      for (const f of forms[entity]) {
        if (f.type === "password") continue;
        data[f.key] =
          f.type === "bool"
            ? Boolean(old[f.key])
            : f.type === "time"
              ? old[f.key].slice(0, 5)
              : old[f.key];
      }
    if (entity === "movimentacoes") data.chave_idempotencia = randomUUID();
    const state = startState(ctx, {
      mode: "form",
      entity,
      id: id ? Number(id) : undefined,
      data,
      index: 0,
      fields,
      version: old?.atualizado_em,
      expectedName: old?.nome,
    });
    onNavigate(ctx);
    await ask(ctx, state);
  }
  async function renderList(ctx, entity, p = 1, report = false) {
    ensure(names[entity], 404, "Recurso não encontrado.");
    const page = validatePage({ page: p, limit: 5 }).page;
    states.delete(ctx.from.id);
    onNavigate(ctx);
    let result;
    if (entity === "categorias") {
      const all = await services.categories(ctx.actor);
      result = { data: all.slice((page - 1) * 5, page * 5), total: all.length };
    } else
      result = await services.list(ctx.actor, entity, {
        ...getFilters(ctx, entity),
        page,
        limit: 5,
      });
    await ctx.reply(
      `${report ? "Relatório · " : ""}${names[entity]} · ${result.total} registro(s) · página ${page}`,
    );
    for (const item of result.data) {
      const title =
        item.nome ||
        item.titulo ||
        `${item.tipo || item.acao} · ${item.material || item.entidade}`;
      await ctx.reply(
        `#${item.id} · ${title}${item.papel ? `\n${item.papel} · ${item.bloqueado ? "Bloqueado" : item.ativo ? "Ativo" : "Inativo"}` : ""}${item.saldo !== undefined ? `\nSaldo: ${formatQuantity(item.saldo)} ${item.unidade}` : ""}${item.status ? `\n${item.data_programada} · ${item.hora_inicio.slice(0, 5)} · ${item.status}` : ""}`,
        Markup.inlineKeyboard([
          [button("Detalhes", `adm:detail:${entity}:${item.id}`)],
        ]),
      );
    }
    const prefix = report ? "report" : "list";
    const nav = [];
    if (page > 1)
      nav.push(button("Anterior", `adm:${prefix}:${entity}:${page - 1}`));
    if (page * 5 < result.total)
      nav.push(button("Próxima", `adm:${prefix}:${entity}:${page + 1}`));
    const controls = [];
    if (forms[entity])
      controls.push(
        button(
          entity === "movimentacoes"
            ? "Registrar movimentação"
            : "Novo cadastro",
          `adm:new:${entity}`,
        ),
      );
    if (filterFields[entity])
      controls.push(button("Filtros", `adm:filter:${entity}`));
    if (report)
      controls.push(
        button("Exportar esta página CSV", `adm:csv:${entity}:${page}`),
      );
    await ctx.reply(
      result.total
        ? "Escolha uma ação:"
        : "Nenhum registro encontrado. Escolha uma ação:",
      Markup.inlineKeyboard(
        [nav, controls, [button("Menu ADM", "adm:menu")]].filter(
          (row) => row.length,
        ),
      ),
    );
  }
  async function detail(ctx, entity, id) {
    const item =
      entity === "categorias"
        ? (await services.categories(ctx.actor)).find(
            (c) => c.id === Number(id),
          )
        : entity === "auditoria"
          ? (await services.list(ctx.actor, "auditoria", { id, limit: 1 }))
              .data[0]
          : await services.detail(ctx.actor, entity, id);
    ensure(item, 404, "Registro não encontrado.");
    const text = Object.entries(item)
      .filter(
        ([k]) =>
          !["fingerprint", "chave_idempotencia", "telegram_id"].includes(k),
      )
      .map(
        ([k, v]) =>
          `${k}: ${quantityFields.has(k) ? formatQuantity(v) : typeof v === "object" ? JSON.stringify(v) : display(v)}`,
      )
      .join("\n");
    const actions = [];
    if (
      ["usuarios", "materiais", "categorias"].includes(entity) ||
      (entity === "tarefas" && item.status === "PENDENTE")
    )
      actions.push([button("Editar cadastro", `adm:edit:${entity}:${id}`)]);
    if (entity === "usuarios")
      actions.push([
        button(item.bloqueado ? "Desbloquear" : "Bloquear", `adm:access:${id}`),
      ]);
    if (entity === "tarefas") {
      if (item.status === "PENDENTE")
        actions.push([button("Iniciar", `adm:task:iniciar:${id}`)]);
      if (item.status === "EM_ANDAMENTO")
        actions.push([button("Concluir", `adm:task:concluir:${id}`)]);
      if (["PENDENTE", "EM_ANDAMENTO"].includes(item.status))
        actions.push([button("Cancelar tarefa", `adm:task:cancelar:${id}`)]);
    }
    if (entity === "movimentacoes" && item.tipo !== "ESTORNO")
      actions.push([button("Estornar", `adm:reverse:${id}`)]);
    actions.push([button("Menu ADM", "adm:menu")]);
    if (text.length > 3900)
      await ctx.replyWithDocument(
        Input.fromBuffer(Buffer.from(text, "utf8"), `${entity}-${id}.txt`),
      );
    await ctx.reply(text.slice(0, 3900), Markup.inlineKeyboard(actions));
  }
  bot.command("admin", (ctx) => menu(ctx));
  bot.action(/^adm:(.*)$/, async (ctx) => {
    allow(ctx.actor, "ADM");
    await ctx.answerCbQuery();
    onNavigate(ctx);
    const [action, entity, arg] = ctx.match[1].split(":");
    if (action === "menu") return menu(ctx);
    if (action === "dashboard") {
      const data = await services.dashboard(ctx.actor);
      return ctx.reply(
        `Dashboard\nMateriais ativos: ${data.materiais}\nEstoque baixo: ${data.estoque_baixo}\nColaboradores: ${data.colaboradores}\nTarefas: ${data.tarefas.map((t) => `${t.status}: ${t.total}`).join(", ") || "nenhuma"}\nAtrasadas: ${data.atrasadas}`,
      );
    }
    if (action === "list" || action === "report")
      return renderList(ctx, entity, Number(arg), action === "report");
    if (action === "new" || action === "edit")
      return startForm(ctx, entity, arg);
    if (action === "detail") return detail(ctx, entity, arg);
    if (action === "filter") {
      ensure(filterFields[entity], 404, "Filtro não encontrado.");
      const state = startState(ctx, {
        mode: "form",
        operation: "filter",
        entity,
        index: 0,
        fields: filterFields[entity],
        data: { ...getFilters(ctx, entity) },
      });
      onNavigate(ctx);
      return ask(ctx, state);
    }
    if (action === "csv") {
      ensure(
        ["materiais", "tarefas", "movimentacoes"].includes(entity),
        404,
        "Relatório não encontrado.",
      );
      const page = validatePage({ page: arg, limit: 5 }).page;
      const result = await services.list(ctx.actor, entity, {
        ...getFilters(ctx, entity),
        page,
        limit: 5,
      });
      return ctx.replyWithDocument(
        Input.fromBuffer(
          Buffer.from(csv(result.data), "utf8"),
          `${entity}-pagina-${page}.csv`,
        ),
      );
    }
    if (action === "settings") {
      states.delete(ctx.from.id);
      const value = await services.settings(ctx.actor);
      return ctx.reply(
        `Sobreposição de tarefas: ${value.permitir_sobreposicao ? "permitida" : "bloqueada"}`,
        Markup.inlineKeyboard([
          [button("Alterar política", "adm:toggle")],
          [button("Menu ADM", "adm:menu")],
        ]),
      );
    }
    if (action === "toggle") {
      const old = await services.settings(ctx.actor);
      return review(
        ctx,
        startState(ctx, {
          entity: "configuracoes",
          data: { permitir_sobreposicao: !old.permitir_sobreposicao },
          expected: old.permitir_sobreposicao,
        }),
      );
    }
    if (action === "access") {
      const old = await services.detail(ctx.actor, "usuarios", entity);
      const data = Object.fromEntries(
        forms.usuarios
          .filter((f) => f.key !== "senha")
          .map((f) => [
            f.key,
            f.type === "bool" ? Boolean(old[f.key]) : old[f.key],
          ]),
      );
      data.bloqueado = !data.bloqueado;
      return review(
        ctx,
        startState(ctx, {
          entity: "usuarios",
          id: old.id,
          data,
          version: old.atualizado_em,
        }),
      );
    }
    if (action === "task") {
      const id = Number(arg);
      await services.detail(ctx.actor, "tarefas", id);
      if (entity === "cancelar") {
        const state = startState(ctx, {
          mode: "form",
          entity: "cancelar",
          id,
          index: 0,
          fields: forms.cancelar,
          data: {},
        });
        onNavigate(ctx);
        return ask(ctx, state);
      }
      ensure(["iniciar", "concluir"].includes(entity), 422, "Ação inválida.");
      if (entity === "iniciar") {
        onNavigate(ctx);
        return ask(
          ctx,
          startState(ctx, {
            mode: "form",
            entity: "iniciar",
            id,
            index: 0,
            fields: forms.iniciar,
            data: {},
          }),
        );
      }
      return review(
        ctx,
        startState(ctx, { entity: "transicao", id, data: { acao: entity } }),
      );
    }
    if (action === "reverse") {
      const original = await services.detail(
        ctx.actor,
        "movimentacoes",
        entity,
      );
      ensure(
        original.tipo !== "ESTORNO",
        409,
        "Não é possível estornar outro estorno.",
      );
      const state = startState(ctx, {
        mode: "form",
        entity: "movimentacoes",
        index: 0,
        fields: [
          field("motivo", "Justificativa do estorno (mínimo 5 caracteres)"),
        ],
        data: {
          material_id: original.material_id,
          tipo: "ESTORNO",
          quantidade: "1",
          estorno_de: original.id,
          chave_idempotencia: randomUUID(),
        },
      });
      onNavigate(ctx);
      return ask(ctx, state);
    }
    if (action === "answer") {
      const state = states.get(ctx.from.id);
      valid(ctx, state);
      ensure(
        state.mode === "form" &&
          state.nonce === entity &&
          state.index === Number(arg),
        409,
        "Botão de formulário desatualizado.",
      );
      const index = Number(ctx.match[1].split(":")[3]);
      const f = state.fields[state.index];
      const choices = f.type === "bool" ? ["Sim", "Não"] : f.choices;
      ensure(choices && choices[index] !== undefined, 422, "Opção inválida.");
      return accept(ctx, choices[index]);
    }
    if (action === "confirm" || action === "cancel") {
      const state = states.get(ctx.from.id);
      valid(ctx, state);
      ensure(
        state.nonce === entity && state.mode === "confirm",
        409,
        "Confirmação desatualizada.",
      );
      states.delete(ctx.from.id);
      if (action === "cancel")
        return ctx.reply("Operação cancelada. Nenhuma alteração realizada.");
      const saves = {
        usuarios: services.saveUser,
        materiais: services.saveMaterial,
        categorias: services.saveCategory,
        tarefas: services.saveTask,
      };
      if (saves[state.entity])
        await saves[state.entity](
          ctx.actor,
          state.data,
          state.id,
          state.entity === "categorias" ? state.expectedName : state.version,
        );
      else if (state.entity === "configuracoes")
        await services.saveSettings(ctx.actor, state.data, state.expected);
      else if (state.entity === "movimentacoes")
        await services.move(ctx.actor, state.data);
      else if (state.entity === "cancelar")
        await services.changeTask(ctx.actor, state.id, "cancelar", state.data);
      else if (state.entity === "iniciar")
        await services.changeTask(ctx.actor, state.id, "iniciar", state.data);
      else if (state.entity === "transicao")
        await services.changeTask(ctx.actor, state.id, state.data.acao);
      else ensure(false, 422, "Operação inválida.");
      return ctx.reply(
        "Operação concluída e registrada na auditoria.",
        Markup.inlineKeyboard([[button("Menu ADM", "adm:menu")]]),
      );
    }
    ensure(false, 404, "Opção administrativa não encontrada.");
  });
  bot.use(async (ctx, next) => {
    if (ctx.callbackQuery && !ctx.callbackQuery.data?.startsWith("adm:")) {
      states.delete(ctx.from.id);
      return next();
    }
    const state = states.get(ctx.from.id);
    if (!state || !ctx.message?.text) return next();
    if (/^\/cancelar(?:@\w+)?$/.test(ctx.message.text.trim())) {
      states.delete(ctx.from.id);
      return ctx.reply("Operação administrativa cancelada.");
    }
    if (ctx.message.text.startsWith("/")) {
      states.delete(ctx.from.id);
      return next();
    }
    allow(ctx.actor, "ADM");
    return accept(ctx, ctx.message.text);
  });
  return { cancel: (ctx) => states.delete(ctx.from.id) };
}
