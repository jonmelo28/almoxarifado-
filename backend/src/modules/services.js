import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { DateTime } from "luxon";
import { rows, transaction, audit } from "../shared/db.js";
import {
  allow,
  own,
  ensure,
  page,
  stockBalance,
  transition,
  milli,
  decimal,
  id,
} from "../shared/domain.js";
import {
  userSchema,
  materialSchema,
  movementSchema,
  taskSchema,
} from "../shared/schemas.js";
import { config } from "../config/env.js";
import {
  botPermissionCatalog,
  effectiveBotPermissions,
  loadBotPermissions,
  requireBotPermission,
  entityPermission,
} from "../shared/botPermissions.js";
export { loadBotPermissions };
export async function getBotPermissions(actor, userId) {
  allow(actor, "ADM");
  const [user] = await rows(`SELECT ${publicUser} FROM usuarios WHERE id=?`, [
    id.parse(userId),
  ]);
  ensure(user, 404, "Colaborador não encontrado.");
  const [record] = await rows(
    "SELECT versao FROM permissoes_bot WHERE usuario_id=?",
    [user.id],
  );
  return {
    usuario: user,
    versao: record?.versao || 0,
    permissoes: await loadBotPermissions(user),
    catalogo: botPermissionCatalog.map(({ key, label, group, roles }) => ({
      key,
      label,
      group,
      disponivel: roles.includes(user.papel),
    })),
  };
}
export async function saveBotPermissions(actor, userId, input) {
  allow(actor, "ADM");
  const parsed = z
    .object({
      versao: z.number().int().nonnegative(),
      permissoes: z
        .object(
          Object.fromEntries(
            botPermissionCatalog.map(({ key }) => [key, z.boolean()]),
          ),
        )
        .strict(),
    })
    .strict()
    .parse(input);
  const target = id.parse(userId);
  await transaction(async (db) => {
    const [user] = await rows(
      "SELECT id,papel FROM usuarios WHERE id=? FOR UPDATE",
      [target],
      db,
    );
    ensure(user, 404, "Colaborador não encontrado.");
    const [record] = await rows(
      "SELECT versao FROM permissoes_bot WHERE usuario_id=? FOR UPDATE",
      [target],
      db,
    );
    ensure(
      (record?.versao || 0) === parsed.versao,
      409,
      "Permissões alteradas desde a consulta. Recarregue a tela.",
    );
    const permissions = effectiveBotPermissions(user.papel, parsed.permissoes);
    ensure(
      botPermissionCatalog.every(
        ({ key }) => !parsed.permissoes[key] || permissions[key],
      ),
      422,
      "Permissão incompatível com o perfil do usuário.",
    );
    await rows(
      "INSERT INTO permissoes_bot (usuario_id,permissoes,versao) VALUES (?,?,1) ON DUPLICATE KEY UPDATE permissoes=VALUES(permissoes),versao=versao+1",
      [target, JSON.stringify(permissions)],
      db,
    );
    await audit(db, actor, "PERMISSOES_BOT", "usuarios", target, {
      permissoes: permissions,
    });
  });
  return getBotPermissions(actor, target);
}
export const publicUser =
  "id,nome,email,identificacao,papel,ativo,bloqueado,telegram_id,criado_em,atualizado_em";
export async function verifyLogin(email, password) {
  const [u] = await rows("SELECT * FROM usuarios WHERE email=?", [
    email.toLowerCase(),
  ]);
  const hash =
    u?.senha_hash ||
    "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxAGY8jmijOfO1dHJcZbCkD8k8W";
  const valid = await bcrypt.compare(password, hash);
  ensure(
    u && valid && u.ativo && !u.bloqueado,
    401,
    "Email ou senha inválidos.",
  );
  return u;
}
export async function currentUser(userId, db) {
  const [u] = await rows(
    `SELECT ${publicUser} FROM usuarios WHERE id=?`,
    [userId],
    db,
  );
  ensure(u && u.ativo && !u.bloqueado, 401, "Conta indisponível.");
  return u;
}
export async function list(actor, entity, query = {}) {
  await requireBotPermission(actor, entityPermission(entity));
  if (
    entity === "tarefas" &&
    actor.papel !== "COLABORADOR" &&
    Number(query.responsavel_id) !== actor.id
  )
    await requireBotPermission(actor, "equipe_ver");
  allow(actor, "ADM", "GESTOR", "COLABORADOR");
  const p = page(query);
  const conditions = [];
  const values = [];
  let select,
    from,
    order = "x.id DESC";
  if (entity === "materiais") {
    select = "x.*, c.nome AS categoria";
    from = "materiais x JOIN categorias c ON c.id=x.categoria_id";
    if (p.q) {
      conditions.push("(x.nome LIKE ? OR x.codigo LIKE ?)");
      values.push(`%${p.q}%`, `%${p.q}%`);
    }
    if (query.baixo === "true") conditions.push("x.saldo < x.estoque_minimo");
    if (query.ativo !== undefined) {
      conditions.push("x.ativo=?");
      values.push(query.ativo === "true");
    }
  } else if (entity === "usuarios") {
    allow(actor, "ADM", "GESTOR");
    select = publicUser
      .split(",")
      .map((c) => "x." + c)
      .join(",");
    from = "usuarios x";
    if (p.q) {
      conditions.push("(x.nome LIKE ? OR x.identificacao LIKE ?)");
      values.push(`%${p.q}%`, `%${p.q}%`);
    }
    if (query.papel) {
      conditions.push("x.papel=?");
      values.push(z.enum(["ADM", "GESTOR", "COLABORADOR"]).parse(query.papel));
    }
    if (query.situacao) {
      const state = z
        .enum(["ATIVO", "INATIVO", "BLOQUEADO"])
        .parse(query.situacao);
      conditions.push(
        state === "BLOQUEADO"
          ? "x.bloqueado=TRUE"
          : state === "INATIVO"
            ? "x.ativo=FALSE"
            : "x.ativo=TRUE AND x.bloqueado=FALSE",
      );
    }
  } else if (entity === "tarefas") {
    select = "x.*,u.nome AS responsavel";
    from = "tarefas x JOIN usuarios u ON u.id=x.responsavel_id";
    order = "x.data_programada,x.hora_inicio,x.id";
    if (actor.papel === "COLABORADOR") {
      conditions.push("x.responsavel_id=?");
      values.push(actor.id);
    } else if (query.responsavel_id) {
      conditions.push("x.responsavel_id=?");
      values.push(id.parse(query.responsavel_id));
    }
    for (const key of ["data_programada", "status", "prioridade"])
      if (query[key]) {
        conditions.push(`x.${key}=?`);
        values.push(z.string().max(30).parse(query[key]));
      }
    if (p.q) {
      conditions.push("x.titulo LIKE ?");
      values.push(`%${p.q}%`);
    }
  } else if (entity === "movimentacoes") {
    select = "x.*,m.nome AS material,u.nome AS responsavel";
    from =
      "movimentacoes x JOIN materiais m ON m.id=x.material_id JOIN usuarios u ON u.id=x.responsavel_id";
    if (actor.papel === "COLABORADOR") {
      conditions.push("x.responsavel_id=?");
      values.push(actor.id);
    }
    if (query.material_id) {
      conditions.push("x.material_id=?");
      values.push(id.parse(query.material_id));
    }
    if (query.tipo) {
      conditions.push("x.tipo=?");
      values.push(z.string().max(20).parse(query.tipo));
    }
    for (const [key, op] of [
      ["de", ">="],
      ["ate", "<"],
    ])
      if (query[key]) {
        const date = z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .parse(query[key]);
        const d = DateTime.fromISO(date, { zone: config.timezone });
        ensure(d.isValid, 422, "Data inválida.");
        conditions.push(`x.criado_em ${op} ?`);
        values.push(
          (key === "ate" ? d.plus({ days: 1 }) : d)
            .toUTC()
            .toFormat("yyyy-MM-dd HH:mm:ss"),
        );
      }
  } else if (entity === "auditoria") {
    allow(actor, "ADM");
    select = "x.*,u.nome AS ator";
    from = "auditoria x JOIN usuarios u ON u.id=x.ator_id";
    if (query.id) {
      conditions.push("x.id=?");
      values.push(id.parse(query.id));
    }
    if (p.q) {
      conditions.push("(x.acao LIKE ? OR x.entidade LIKE ? OR u.nome LIKE ?)");
      values.push(`%${p.q}%`, `%${p.q}%`, `%${p.q}%`);
    }
  } else ensure(false, 404, "Recurso não encontrado.");
  if (entity === "movimentacoes" && p.q) {
    conditions.push("(m.nome LIKE ? OR x.motivo LIKE ?)");
    values.push(`%${p.q}%`, `%${p.q}%`);
  }
  if (
    entity === "movimentacoes" &&
    query.proprio === "true" &&
    actor.papel !== "COLABORADOR"
  ) {
    conditions.push("x.responsavel_id=?");
    values.push(actor.id);
  }
  if (entity === "tarefas" && query.proximas === "true") {
    conditions.push("x.data_programada>=?");
    values.push(DateTime.now().setZone(config.timezone).toISODate());
  }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const [count] = await rows(
    `SELECT COUNT(*) AS total FROM ${from}${where}`,
    values,
  );
  const data = await rows(
    `SELECT ${select} FROM ${from}${where} ORDER BY ${order} LIMIT ${p.limit} OFFSET ${(p.page - 1) * p.limit}`,
    values,
  );
  return { data, total: count.total, page: p.page, limit: p.limit };
}
export async function detail(actor, entity, resourceId) {
  await requireBotPermission(actor, entityPermission(entity));
  allow(actor, "ADM", "GESTOR", "COLABORADOR");
  const n = id.parse(resourceId);
  let result;
  if (entity === "usuarios") {
    allow(actor, "ADM", "GESTOR");
    [result] = await rows(`SELECT ${publicUser} FROM usuarios WHERE id=?`, [n]);
  } else if (["materiais", "tarefas", "movimentacoes"].includes(entity)) {
    [result] = await rows(`SELECT * FROM ${entity} WHERE id=?`, [n]);
  } else ensure(false, 404, "Recurso não encontrado.");
  ensure(result, 404, "Registro não encontrado.");
  if (entity === "tarefas") own(actor, result.responsavel_id);
  if (entity === "movimentacoes") own(actor, result.responsavel_id);
  if (entity === "tarefas")
    result.historico = await rows(
      "SELECT h.*,u.nome AS ator FROM historico_tarefas h JOIN usuarios u ON u.id=h.ator_id WHERE tarefa_id=? ORDER BY h.id",
      [n],
    );
  return result;
}
export async function saveUser(actor, input, userId, expectedVersion) {
  await requireBotPermission(actor, "usuarios_editar");
  allow(actor, "ADM");
  const data = userSchema.parse(input);
  ensure(userId || data.senha, 422, "Senha é obrigatória.");
  if (userId && Number(userId) === actor.id)
    ensure(
      data.papel === "ADM" && data.ativo && !data.bloqueado,
      409,
      "Não remova seu próprio acesso administrativo.",
    );
  return transaction(async (db) => {
    allow(await currentUser(actor.id, db), "ADM");
    const fields = { ...data };
    delete fields.senha;
    if (data.senha) fields.senha_hash = await bcrypt.hash(data.senha, 12);
    if (userId) {
      const n = id.parse(userId);
      const [old] = await rows(
        "SELECT id,atualizado_em FROM usuarios WHERE id=? FOR UPDATE",
        [n],
        db,
      );
      ensure(old, 404, "Usuário não encontrado.");
      ensure(
        expectedVersion === undefined || old.atualizado_em === expectedVersion,
        409,
        "Usuário alterado desde a revisão. Abra o cadastro novamente.",
      );
      await update(db, "usuarios", n, fields);
      await audit(db, actor, "EDITAR", "usuarios", n, {
        ...data,
        senha: undefined,
      });
      return { id: n };
    }
    const result = await insert(db, "usuarios", fields);
    await audit(db, actor, "CRIAR", "usuarios", result.insertId, {
      ...data,
      senha: undefined,
    });
    return { id: result.insertId };
  });
}
async function insert(db, table, fields) {
  const keys = Object.keys(fields);
  return rows(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    Object.values(fields),
    db,
  );
}
async function update(db, table, n, fields) {
  return rows(
    `UPDATE ${table} SET ${Object.keys(fields)
      .map((k) => `${k}=?`)
      .join(",")} WHERE id=?`,
    [...Object.values(fields), n],
    db,
  );
}
export async function saveMaterial(actor, input, materialId, expectedVersion) {
  await requireBotPermission(actor, "materiais_editar");
  allow(actor, "ADM");
  const data = materialSchema.parse(input);
  ensure(
    data.unidade !== "UN" || milli(data.estoque_minimo) % 1000n === 0n,
    422,
    "Mínimo em UN exige inteiro.",
  );
  return transaction(async (db) => {
    if (materialId) {
      const n = id.parse(materialId);
      const [old] = await rows(
        "SELECT * FROM materiais WHERE id=? FOR UPDATE",
        [n],
        db,
      );
      ensure(old, 404, "Material não encontrado.");
      ensure(
        expectedVersion === undefined || old.atualizado_em === expectedVersion,
        409,
        "Material alterado desde a revisão. Abra o cadastro novamente.",
      );
      ensure(
        old.unidade === data.unidade,
        409,
        "Unidade não pode ser alterada após cadastro.",
      );
      await update(db, "materiais", n, data);
      await audit(db, actor, "EDITAR", "materiais", n, data);
      return { id: n, codigo: old.codigo };
    }
    const [sequence] = await rows(
      "SELECT ultimo_codigo FROM sequencias_materiais WHERE id=1 FOR UPDATE",
      [],
      db,
    );
    ensure(
      sequence,
      500,
      "Sequência de materiais não configurada. Execute as migrações.",
    );
    const codigo = (BigInt(sequence.ultimo_codigo) + 1n).toString();
    ensure(
      codigo.length <= 60,
      409,
      "Limite da sequência de materiais atingido.",
    );
    await rows(
      "UPDATE sequencias_materiais SET ultimo_codigo=? WHERE id=1",
      [codigo],
      db,
    );
    data.codigo = codigo;
    const r = await insert(db, "materiais", data);
    await audit(db, actor, "CRIAR", "materiais", r.insertId, data);
    return { id: r.insertId, codigo };
  });
}
export async function categories(actor) {
  await requireBotPermission(actor, "estoque_ver");
  allow(actor, "ADM", "GESTOR", "COLABORADOR");
  return rows("SELECT * FROM categorias ORDER BY nome");
}
export async function saveCategory(actor, input, categoryId, expectedName) {
  await requireBotPermission(actor, "categorias_editar");
  allow(actor, "ADM");
  const nome = z.string().trim().min(2).max(100).parse(input.nome);
  return transaction(async (db) => {
    if (categoryId) {
      const n = id.parse(categoryId);
      const [old] = await rows(
        "SELECT nome FROM categorias WHERE id=? FOR UPDATE",
        [n],
        db,
      );
      ensure(old, 404, "Categoria não encontrada.");
      ensure(
        expectedName === undefined || old.nome === expectedName,
        409,
        "Categoria alterada desde a revisão. Abra novamente.",
      );
      const r = await rows(
        "UPDATE categorias SET nome=? WHERE id=?",
        [nome, n],
        db,
      );
      ensure(r.affectedRows, 404, "Categoria não encontrada.");
      await audit(db, actor, "EDITAR", "categorias", n, { nome });
      return { id: n };
    }
    const r = await rows(
      "INSERT INTO categorias (nome) VALUES (?)",
      [nome],
      db,
    );
    await audit(db, actor, "CRIAR", "categorias", r.insertId, { nome });
    return { id: r.insertId };
  });
}
export async function move(actor, input) {
  await requireBotPermission(
    actor,
    {
      SAIDA: "saida",
      ENTRADA: "entrada",
      DEVOLUCAO: "devolucao",
      AJUSTE: "ajuste",
      ESTORNO: "estorno",
    }[input.tipo],
  );
  allow(actor, "ADM", "GESTOR", "COLABORADOR");
  const data = movementSchema.parse(input);
  if (["AJUSTE", "ESTORNO"].includes(data.tipo)) allow(actor, "ADM");
  if (data.tipo === "ENTRADA") allow(actor, "ADM", "GESTOR");
  if (actor.papel === "COLABORADOR") {
    ensure(
      !data.beneficiario_id || data.beneficiario_id === actor.id,
      403,
      "Beneficiário não autorizado.",
    );
    data.beneficiario_id = actor.id;
  }
  ensure(
    (data.tipo === "ESTORNO") === Boolean(data.estorno_de),
    422,
    "Informe a movimentação original somente para estorno.",
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
  const replay = async (db) => {
    const [existing] = await rows(
      "SELECT * FROM movimentacoes WHERE responsavel_id=? AND chave_idempotencia=?",
      [actor.id, data.chave_idempotencia],
      db,
    );
    if (existing)
      ensure(
        existing.fingerprint === fingerprint,
        409,
        "Chave idempotente já utilizada com outro conteúdo.",
      );
    return existing;
  };
  try {
    return await transaction(async (db) => {
      const previous = await replay(db);
      if (previous) return previous;
      const [material] = await rows(
        "SELECT * FROM materiais WHERE id=? FOR UPDATE",
        [data.material_id],
        db,
      );
      ensure(material && material.ativo, 404, "Material indisponível.");
      const repeated = await replay(db);
      if (repeated) return repeated;
      if (data.beneficiario_id) await currentUser(data.beneficiario_id, db);
      if (data.tarefa_id) {
        const [t] = await rows(
          "SELECT * FROM tarefas WHERE id=? FOR UPDATE",
          [data.tarefa_id],
          db,
        );
        ensure(t, 404, "Tarefa não encontrada.");
        own(actor, t.responsavel_id);
        ensure(
          !data.beneficiario_id || data.beneficiario_id === t.responsavel_id,
          422,
          "Beneficiário difere do responsável da tarefa.",
        );
      }
      let amount = data.quantidade;
      if (data.tipo === "ESTORNO") {
        const [original] = await rows(
          "SELECT * FROM movimentacoes WHERE id=? FOR UPDATE",
          [data.estorno_de],
          db,
        );
        ensure(
          original &&
            original.material_id === data.material_id &&
            original.tipo !== "ESTORNO",
          422,
          "Movimentação original inválida.",
        );
        ensure(
          !(
            await rows(
              "SELECT id FROM movimentacoes WHERE estorno_de=?",
              [original.id],
              db,
            )
          ).length,
          409,
          "Movimentação já estornada.",
        );
        amount = decimal(
          milli(original.saldo_anterior) - milli(original.saldo_posterior),
        );
      }
      const balance = stockBalance(
        material.saldo,
        amount,
        data.tipo,
        material.unidade,
      );
      const auditId = await audit(
        db,
        actor,
        "MOVIMENTAR",
        "materiais",
        material.id,
        {
          tipo: data.tipo,
          quantidade: amount,
          anterior: material.saldo,
          posterior: balance,
        },
      );
      await rows(
        "UPDATE materiais SET saldo=? WHERE id=?",
        [balance, material.id],
        db,
      );
      const r = await insert(db, "movimentacoes", {
        ...data,
        quantidade: amount,
        beneficiario_id: data.beneficiario_id ?? null,
        tarefa_id: data.tarefa_id ?? null,
        estorno_de: data.estorno_de ?? null,
        responsavel_id: actor.id,
        saldo_anterior: material.saldo,
        saldo_posterior: balance,
        origem: actor.origem || "painel",
        auditoria_id: auditId,
        fingerprint,
      });
      if (milli(balance) < milli(material.estoque_minimo)) {
        const admins = await rows(
          "SELECT id FROM usuarios WHERE papel IN ('ADM','GESTOR') AND ativo=TRUE AND bloqueado=FALSE",
          [],
          db,
        );
        for (const u of admins)
          await notify(
            db,
            u.id,
            `estoque:${r.insertId}:${u.id}`,
            `Estoque baixo: ${material.nome}, saldo ${balance} ${material.unidade}.`,
          );
      }
      return (
        await rows("SELECT * FROM movimentacoes WHERE id=?", [r.insertId], db)
      )[0];
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      const existing = await replay();
      if (existing) return existing;
    }
    throw error;
  }
}
export async function notify(db, userId, key, message) {
  await rows(
    "INSERT INTO notificacoes (usuario_id,chave,mensagem) VALUES (?,?,?) ON DUPLICATE KEY UPDATE chave=VALUES(chave)",
    [userId, key, message],
    db,
  );
}
export async function settings(actor) {
  await requireBotPermission(actor, "configuracoes");
  allow(actor, "ADM");
  return Object.fromEntries(
    (await rows("SELECT * FROM configuracoes")).map((r) => [
      r.chave,
      r.valor === "true",
    ]),
  );
}
export async function saveSettings(actor, input, expectedValue) {
  await requireBotPermission(actor, "configuracoes");
  allow(actor, "ADM");
  const data = z
    .object({ permitir_sobreposicao: z.boolean() })
    .strict()
    .parse(input);
  return transaction(async (db) => {
    const [old] = await rows(
      "SELECT valor FROM configuracoes WHERE chave='permitir_sobreposicao' FOR UPDATE",
      [],
      db,
    );
    ensure(
      expectedValue === undefined || (old.valor === "true") === expectedValue,
      409,
      "Configuração alterada desde a revisão. Abra novamente.",
    );
    await rows(
      "UPDATE configuracoes SET valor=? WHERE chave='permitir_sobreposicao'",
      [String(data.permitir_sobreposicao)],
      db,
    );
    await audit(db, actor, "CONFIGURAR", "configuracoes", 0, data);
    return data;
  });
}
export async function saveTask(actor, input, taskId, expectedVersion) {
  await requireBotPermission(actor, "tarefas_programar");
  allow(actor, "ADM", "GESTOR");
  const data = taskSchema.parse(input);
  return transaction((db) =>
    saveTaskInTransaction(db, actor, data, taskId, expectedVersion),
  );
}
async function saveTaskInTransaction(db, actor, data, taskId, expectedVersion) {
  const responsible = await rows(
    "SELECT * FROM usuarios WHERE id=? FOR UPDATE",
    [data.responsavel_id],
    db,
  );
  ensure(
    responsible[0]?.ativo && !responsible[0]?.bloqueado,
    422,
    "Responsável indisponível.",
  );
  let old;
  if (taskId) {
    [old] = await rows(
      "SELECT * FROM tarefas WHERE id=? FOR UPDATE",
      [id.parse(taskId)],
      db,
    );
    ensure(old, 404, "Tarefa não encontrada.");
    ensure(
      expectedVersion === undefined || old.atualizado_em === expectedVersion,
      409,
      "Tarefa alterada desde a revisão. Abra novamente.",
    );
    ensure(
      old.status === "PENDENTE",
      409,
      "Somente tarefas pendentes podem ser editadas.",
    );
  }
  const [setting] = await rows(
    "SELECT valor FROM configuracoes WHERE chave='permitir_sobreposicao'",
    [],
    db,
  );
  if (setting.valor !== "true") {
    const conflicts = await rows(
      "SELECT id FROM tarefas WHERE responsavel_id=? AND data_programada=? AND status<>'CANCELADA' AND hora_inicio<? AND hora_fim>? AND id<>? FOR UPDATE",
      [
        data.responsavel_id,
        data.data_programada,
        data.hora_fim,
        data.hora_inicio,
        old?.id || 0,
      ],
      db,
    );
    ensure(
      !conflicts.length,
      409,
      "Conflito de horário para este colaborador.",
    );
  }
  let n;
  if (old) {
    n = old.id;
    await update(db, "tarefas", n, data);
  } else {
    n = (await insert(db, "tarefas", { ...data, criador_id: actor.id }))
      .insertId;
  }
  await rows(
    "INSERT INTO historico_tarefas (tarefa_id,ator_id,dados) VALUES (?,?,?)",
    [n, actor.id, JSON.stringify({ antes: old || null, depois: data })],
    db,
  );
  await audit(db, actor, old ? "EDITAR" : "CRIAR", "tarefas", n, data);
  await notify(
    db,
    data.responsavel_id,
    `tarefa:${n}:${randomBytes(8).toString("hex")}`,
    `Tarefa ${old ? "atualizada" : "programada"} #${n}: ${data.titulo}, ${data.data_programada} às ${data.hora_inicio}.`,
  );
  return { id: n };
}
export async function duplicateTasks(actor, input) {
  allow(actor, "ADM", "GESTOR");
  await requireBotPermission(actor, "tarefas_programar");
  const unique = (values) => new Set(values).size === values.length;
  const { tarefas, dias, responsavel_id } = z
    .object({
      responsavel_id: id.optional(),
      tarefas: z.array(id).min(1).max(100).refine(unique, "Tarefas repetidas."),
      dias: z
        .array(taskSchema.innerType().shape.data_programada)
        .min(1)
        .max(31)
        .refine(unique, "Datas repetidas."),
    })
    .strict()
    .parse(input);
  ensure(
    tarefas.length * dias.length <= 200,
    422,
    "Copie no máximo 200 tarefas por operação.",
  );
  return transaction(async (db) => {
    const sources = await rows(
      `SELECT * FROM tarefas WHERE id IN (${tarefas.map(() => "?").join(",")}) ORDER BY responsavel_id,hora_inicio,id`,
      tarefas,
      db,
    );
    ensure(
      sources.length === tarefas.length,
      404,
      "Uma das tarefas selecionadas não foi encontrada.",
    );
    ensure(
      !sources.some(
        (task) =>
          dias.includes(task.data_programada) &&
          (!responsavel_id || responsavel_id === task.responsavel_id),
      ),
      422,
      "Para copiar no mesmo dia, escolha um colaborador diferente do original.",
    );
    const created = [];
    for (const source of sources) {
      for (const day of [...dias].sort()) {
        const data = taskSchema.parse({
          responsavel_id: responsavel_id ?? source.responsavel_id,
          titulo: source.titulo,
          descricao: source.descricao,
          data_programada: day,
          hora_inicio: source.hora_inicio.slice(0, 5),
          hora_fim: source.hora_fim.slice(0, 5),
          prioridade: source.prioridade,
          observacoes: "",
        });
        try {
          created.push(await saveTaskInTransaction(db, actor, data));
        } catch (error) {
          if (error.status)
            error.message = `${source.titulo} em ${day.split("-").reverse().join("/")}: ${error.message} Nenhuma cópia foi criada.`;
          throw error;
        }
      }
    }
    await audit(db, actor, "DUPLICAR_TAREFAS", "tarefas", tarefas[0], {
      originais: tarefas,
      responsavel_destino: responsavel_id ?? null,
      dias,
      criadas: created.map((task) => task.id),
    });
    return { total: created.length, tarefas: created };
  });
}
export async function changeTask(actor, taskId, action, input = {}) {
  await requireBotPermission(
    actor,
    {
      iniciar: "tarefas_iniciar",
      concluir: "tarefas_concluir",
      cancelar: "tarefas_cancelar",
    }[action],
  );
  allow(actor, "ADM", "GESTOR", "COLABORADOR");
  return transaction(async (db) => {
    const [t] = await rows(
      "SELECT * FROM tarefas WHERE id=? FOR UPDATE",
      [id.parse(taskId)],
      db,
    );
    ensure(t, 404, "Tarefa não encontrada.");
    own(actor, t.responsavel_id);
    if (action === "cancelar") allow(actor, "ADM", "GESTOR");
    const status = transition(t.status, action);
    const note = z
      .string()
      .max(5000)
      .parse(input.observacoes || "");
    const reason =
      action === "cancelar"
        ? z.string().trim().min(5).max(1000).parse(input.motivo)
        : null;
    if (action === "iniciar" && actor.origem === "telegram")
      z.string().trim().min(5).max(1000).parse(note);
    const time =
      action === "iniciar"
        ? ",inicio_real=UTC_TIMESTAMP(3)"
        : action === "concluir"
          ? ",conclusao_real=UTC_TIMESTAMP(3)"
          : "";
    await rows(
      `UPDATE tarefas SET status=?,observacoes=?,motivo_cancelamento=?${time} WHERE id=?`,
      [status, note || t.observacoes, reason, t.id],
      db,
    );
    await rows(
      "INSERT INTO historico_tarefas (tarefa_id,ator_id,dados) VALUES (?,?,?)",
      [
        t.id,
        actor.id,
        JSON.stringify({
          antes: t.status,
          status,
          observacoes: note,
          motivo: reason,
        }),
      ],
      db,
    );
    await audit(db, actor, action.toUpperCase(), "tarefas", t.id, {
      antes: t.status,
      status,
      observacoes: note,
    });
    return { id: t.id, status };
  });
}
export async function dashboard(actor) {
  await requireBotPermission(actor, "equipe_ver");
  allow(actor, "ADM", "GESTOR", "COLABORADOR");
  const today = DateTime.now().setZone(config.timezone).toISODate();
  const start = DateTime.fromISO(today, { zone: config.timezone })
    .toUTC()
    .toFormat("yyyy-MM-dd HH:mm:ss");
  const scope = actor.papel === "COLABORADOR" ? " AND responsavel_id=?" : "";
  const params = actor.papel === "COLABORADOR" ? [today, actor.id] : [today];
  const [materials] = await rows(
    "SELECT COUNT(*) AS materiais, COALESCE(SUM(saldo<estoque_minimo),0) AS estoque_baixo FROM materiais WHERE ativo=TRUE",
  );
  const tasks = await rows(
    `SELECT status,COUNT(*) AS total FROM tarefas WHERE data_programada=?${scope} GROUP BY status`,
    params,
  );
  const consumption = await rows(
    `SELECT tipo,COUNT(*) AS total FROM movimentacoes WHERE criado_em>=?${scope} GROUP BY tipo`,
    actor.papel === "COLABORADOR" ? [start, actor.id] : [start],
  );
  const [late] = await rows(
    `SELECT COUNT(*) AS atrasadas FROM tarefas WHERE status IN ('PENDENTE','EM_ANDAMENTO') AND (data_programada<? OR (data_programada=? AND hora_fim<?))${scope}`,
    [
      today,
      today,
      DateTime.now().setZone(config.timezone).toFormat("HH:mm:ss"),
      ...(actor.papel === "COLABORADOR" ? [actor.id] : []),
    ],
  );
  const [users] =
    actor.papel !== "COLABORADOR"
      ? await rows(
          "SELECT COUNT(*) AS colaboradores FROM usuarios WHERE ativo=TRUE AND bloqueado=FALSE",
        )
      : [{ colaboradores: null }];
  const trend = await rows(
    `SELECT DATE_FORMAT(criado_em,'%Y-%m-%d') AS data,COUNT(*) AS total FROM movimentacoes WHERE tipo='SAIDA' AND criado_em>=UTC_TIMESTAMP()-INTERVAL 7 DAY${scope} GROUP BY DATE_FORMAT(criado_em,'%Y-%m-%d') ORDER BY data`,
    actor.papel === "COLABORADOR" ? [actor.id] : [],
  );
  return {
    ...materials,
    ...users,
    ...late,
    tarefas: tasks,
    movimentacoes: consumption,
    consumo: trend,
    data: today,
    fuso: config.timezone,
  };
}
export async function linkToken(actor, userId) {
  allow(actor, "ADM", "GESTOR", "COLABORADOR");
  if (userId !== undefined) allow(actor, "ADM");
  const targetId = id.parse(userId ?? actor.id);
  const token = randomBytes(32).toString("base64url");
  await transaction(async (db) => {
    const [target] = await rows(
      "SELECT id,ativo,bloqueado FROM usuarios WHERE id=? FOR UPDATE",
      [targetId],
      db,
    );
    ensure(target, 404, "Colaborador não encontrado.");
    ensure(
      target.ativo && !target.bloqueado,
      409,
      "A conta deve estar ativa e desbloqueada para gerar o vínculo.",
    );
    await rows(
      "DELETE FROM tokens_vinculacao_telegram WHERE usuario_id=?",
      [targetId],
      db,
    );
    await rows(
      "INSERT INTO tokens_vinculacao_telegram (token_hash,usuario_id,expira_em) VALUES (?,?,UTC_TIMESTAMP(3)+INTERVAL 10 MINUTE)",
      [createHash("sha256").update(token).digest("hex"), targetId],
      db,
    );
    await audit(db, actor, "GERAR_VINCULO", "usuarios", targetId);
  });
  return { token, expira_em_minutos: 10 };
}
export async function revokeTelegram(actor, userId) {
  allow(actor, "ADM");
  const targetId = id.parse(userId);
  await transaction(async (db) => {
    const [target] = await rows(
      "SELECT id FROM usuarios WHERE id=? FOR UPDATE",
      [targetId],
      db,
    );
    ensure(target, 404, "Colaborador não encontrado.");
    await rows(
      "UPDATE usuarios SET telegram_id=NULL WHERE id=?",
      [targetId],
      db,
    );
    await rows(
      "DELETE FROM tokens_vinculacao_telegram WHERE usuario_id=?",
      [targetId],
      db,
    );
    await audit(db, actor, "REVOGAR_VINCULO_TELEGRAM", "usuarios", targetId);
  });
}
export async function bindTelegram(token, telegramId) {
  return transaction(async (db) => {
    const [t] = await rows(
      "SELECT * FROM tokens_vinculacao_telegram WHERE token_hash=? AND usado_em IS NULL AND expira_em>UTC_TIMESTAMP(3) FOR UPDATE",
      [createHash("sha256").update(token).digest("hex")],
      db,
    );
    ensure(t, 403, "Token inválido ou expirado.");
    const [target] = await rows(
      "SELECT telegram_id FROM usuarios WHERE id=? FOR UPDATE",
      [t.usuario_id],
      db,
    );
    ensure(
      target &&
        (target.telegram_id === null ||
          String(target.telegram_id) === String(telegramId)),
      409,
      "Esta conta já possui vínculo Telegram. O administrador deve revogá-lo no painel antes de trocar a conta.",
    );
    const actor = await currentUser(t.usuario_id, db);
    await rows(
      "UPDATE usuarios SET telegram_id=? WHERE id=?",
      [String(telegramId), actor.id],
      db,
    );
    await rows(
      "UPDATE tokens_vinculacao_telegram SET usado_em=UTC_TIMESTAMP(3) WHERE token_hash=?",
      [t.token_hash],
      db,
    );
    await audit(
      db,
      { ...actor, origem: "telegram" },
      "VINCULAR_TELEGRAM",
      "usuarios",
      actor.id,
    );
    return actor;
  });
}
