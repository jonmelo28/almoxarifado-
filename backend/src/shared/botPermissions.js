import { rows } from "./db.js";
import { ensure } from "./domain.js";

const all = ["ADM", "GESTOR", "COLABORADOR"];
const management = ["ADM", "GESTOR"];
export const botPermissionCatalog = [
  ["acessar_bot", "Acessar o bot", "Acesso", all],
  ["notificacoes", "Receber notificações", "Acesso", all],
  ["tarefas_ver", "Consultar tarefas", "Tarefas", all],
  ["tarefas_iniciar", "Iniciar tarefas", "Tarefas", all],
  ["tarefas_concluir", "Concluir tarefas", "Tarefas", all],
  ["tarefas_programar", "Cadastrar e editar tarefas", "Tarefas", management],
  ["tarefas_cancelar", "Cancelar tarefas", "Tarefas", management],
  ["equipe_ver", "Consultar agenda e resumo da equipe", "Tarefas", management],
  ["estoque_ver", "Consultar estoque", "Estoque", all],
  ["saida", "Registrar saídas", "Movimentações", all],
  ["devolucao", "Registrar devoluções", "Movimentações", all],
  ["entrada", "Registrar entradas", "Movimentações", management],
  ["ajuste", "Ajustar estoque", "Movimentações", ["ADM"]],
  ["estorno", "Estornar movimentações", "Movimentações", ["ADM"]],
  ["movimentacoes_ver", "Consultar movimentações", "Movimentações", all],
  ["usuarios_ver", "Consultar colaboradores", "Administração", ["ADM"]],
  [
    "usuarios_editar",
    "Cadastrar e editar colaboradores",
    "Administração",
    ["ADM"],
  ],
  [
    "materiais_editar",
    "Cadastrar e editar materiais",
    "Administração",
    ["ADM"],
  ],
  [
    "categorias_editar",
    "Cadastrar e editar categorias",
    "Administração",
    ["ADM"],
  ],
  ["relatorios", "Exportar relatórios CSV", "Administração", ["ADM"]],
  ["auditoria", "Consultar auditoria", "Administração", ["ADM"]],
  [
    "configuracoes",
    "Consultar e alterar configurações",
    "Administração",
    ["ADM"],
  ],
].map(([key, label, group, roles]) => ({ key, label, group, roles }));

export function effectiveBotPermissions(role, overrides = {}) {
  return Object.fromEntries(
    botPermissionCatalog.map(({ key, roles }) => [
      key,
      roles.includes(role) && overrides[key] !== false,
    ]),
  );
}
export async function loadBotPermissions(actor, db) {
  const [record] = await rows(
    "SELECT permissoes FROM permissoes_bot WHERE usuario_id=?",
    [actor.id],
    db,
  );
  const overrides =
    typeof record?.permissoes === "string"
      ? JSON.parse(record.permissoes)
      : record?.permissoes;
  return effectiveBotPermissions(actor.papel, overrides);
}
export async function requireBotPermission(actor, key) {
  if (actor.origem !== "telegram") return;
  const permissions = await loadBotPermissions(actor);
  ensure(
    permissions.acessar_bot && permissions[key],
    403,
    "Operação não permitida no bot para sua conta. Consulte o administrador.",
  );
}
export function callbackPermission(data) {
  const [action, entity, arg] = data.split(":");
  if (action !== "adm")
    return {
      hoje: "tarefas_ver",
      proximas: "tarefas_ver",
      tarefa: "tarefas_ver",
      iniciar: "tarefas_iniciar",
      concluir: "tarefas_concluir",
      equipe: "equipe_ver",
      resumo: "equipe_ver",
      estoque: "estoque_ver",
      historico: "movimentacoes_ver",
      saida: "saida",
      entrada: "entrada",
      devolucao: "devolucao",
      programar: "tarefas_programar",
      usuarios: "usuarios_ver",
      auditoria: "auditoria",
    }[action];
  if (entity === "dashboard") return "equipe_ver";
  if (["settings", "toggle"].includes(entity)) return "configuracoes";
  if (entity === "access") return "usuarios_editar";
  if (entity === "reverse") return "estorno";
  if (entity === "csv") return "relatorios";
  if (entity === "task")
    return {
      iniciar: "tarefas_iniciar",
      concluir: "tarefas_concluir",
      cancelar: "tarefas_cancelar",
    }[arg];
  if (["new", "edit"].includes(entity))
    return {
      usuarios: "usuarios_editar",
      materiais: "materiais_editar",
      categorias: "categorias_editar",
      tarefas: "tarefas_programar",
      movimentacoes: "movimentacoes_ver",
    }[arg];
  if (["list", "report", "detail", "filter"].includes(entity))
    return entityPermission(arg);
}
export function entityPermission(entity) {
  return {
    usuarios: "usuarios_ver",
    materiais: "estoque_ver",
    categorias: "estoque_ver",
    tarefas: "tarefas_ver",
    movimentacoes: "movimentacoes_ver",
    auditoria: "auditoria",
  }[entity];
}
