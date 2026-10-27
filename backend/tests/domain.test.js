import { test } from "node:test";
import assert from "node:assert/strict";
import {
  milli,
  decimal,
  stockBalance,
  transition,
  allow,
  own,
  page,
  csv,
} from "../src/shared/domain.js";
import {
  taskSchema,
  materialSchema,
  movementSchema,
  userSchema,
} from "../src/shared/schemas.js";
import { privateChat, parseMovement, taskText } from "../src/bot/handlers.js";
const actor = { id: 1, papel: "COLABORADOR", ativo: true, bloqueado: false };
test("decimais somam 0.1 + 0.2 exatamente", () =>
  assert.equal(decimal(milli("0.1") + milli("0.2")), "0.300"));
test("conversão negativa preserva sinal e precisão", () =>
  assert.equal(decimal(milli("-100.001")), "-100.001"));
test("decimal rejeita precisão excessiva, NaN e expoentes", () => {
  for (const v of ["0.0001", "NaN", "1e3", "Infinity"])
    assert.throws(() => milli(v));
});
test("entrada e devolução aumentam saldo", () => {
  assert.equal(stockBalance("1", "2", "ENTRADA", "UN"), "3.000");
  assert.equal(stockBalance("1", "2", "DEVOLUCAO", "UN"), "3.000");
});
test("saída não permite saldo negativo", () =>
  assert.throws(() => stockBalance("1", "2", "SAIDA", "UN"), /insuficiente/));
test("saída permite zerar saldo", () =>
  assert.equal(stockBalance("1", "1", "SAIDA", "UN"), "0.000"));
test("unidade discreta rejeita frações", () =>
  assert.throws(() => stockBalance("1", "0.001", "SAIDA", "UN"), /inteira/));
test("unidade contínua aceita milésimos", () =>
  assert.equal(stockBalance("1", "0.001", "SAIDA", "KG"), "0.999"));
test("ajuste aceita variação negativa e impede saldo negativo", () => {
  assert.equal(stockBalance("3", "-2", "AJUSTE", "UN"), "1.000");
  assert.throws(() => stockBalance("1", "-2", "AJUSTE", "UN"));
});
test("quantidade zero ou negativa rejeitada em entrada e saída", () => {
  assert.throws(() => stockBalance("1", "0", "SAIDA", "UN"));
  assert.throws(() => stockBalance("1", "-1", "ENTRADA", "UN"));
});
test("saldo respeita limite DECIMAL(15,3)", () =>
  assert.throws(() =>
    stockBalance("999999999999.999", "0.001", "ENTRADA", "KG"),
  ));
test("máquina de estados permite ciclo normal", () => {
  assert.equal(transition("PENDENTE", "iniciar"), "EM_ANDAMENTO");
  assert.equal(transition("EM_ANDAMENTO", "concluir"), "CONCLUIDA");
});
test("máquina de estados rejeita conclusão prematura e reabertura", () => {
  assert.throws(() => transition("PENDENTE", "concluir"));
  assert.throws(() => transition("CONCLUIDA", "iniciar"));
  assert.throws(() => transition("CANCELADA", "cancelar"));
});
test("cancelamento permitido só para tarefa aberta", () => {
  assert.equal(transition("PENDENTE", "cancelar"), "CANCELADA");
  assert.equal(transition("EM_ANDAMENTO", "cancelar"), "CANCELADA");
});
test("perfis impedem escalonamento", () => {
  assert.throws(() => allow(actor, "ADM"));
  assert.doesNotThrow(() => allow(actor, "COLABORADOR"));
  assert.throws(() => allow({ ...actor, bloqueado: true }, "COLABORADOR"));
});
test("IDOR impede acesso a outro responsável", () => {
  assert.throws(() => own(actor, 2));
  assert.doesNotThrow(() => own(actor, 1));
});
test("paginação possui limites rígidos", () => {
  assert.equal(page({}).limit, 20);
  assert.throws(() => page({ limit: 101 }));
  assert.throws(() => page({ page: -1 }));
});
test("CSV neutraliza fórmulas, aspas e células com espaços iniciais", () => {
  const result = csv([{ nome: "=SUM(1)", nota: "  +cmd", texto: '"teste"' }]);
  assert.ok(result.includes("'=SUM(1)"));
  assert.ok(result.includes("'  +cmd"));
  assert.ok(result.includes('""teste""'));
});
test("CSV formata quantidades e preserva códigos e proteção de fórmulas", () => {
  const result = csv([
    {
      codigo: "001.000",
      saldo: "1.000",
      estoque_minimo: "1.250",
      quantidade: "=SUM(1)",
    },
  ]);
  assert.ok(result.includes('"001.000";"1";"1,25";"\'=SUM(1)"'));
});
const task = {
  responsavel_id: 1,
  titulo: "Manutenção",
  data_programada: "2026-10-23",
  hora_inicio: "08:00",
  hora_fim: "09:00",
  prioridade: "MEDIA",
};
test("agenda valida datas civis reais e ordem de horários", () => {
  assert.equal(taskSchema.parse(task).descricao, "");
  assert.throws(() =>
    taskSchema.parse({ ...task, data_programada: "2026-02-30" }),
  );
  assert.throws(() => taskSchema.parse({ ...task, hora_fim: "07:00" }));
});
test("CRUD de materiais não aceita saldo fornecido pelo cliente", () =>
  assert.throws(() =>
    materialSchema.parse({
      nome: "Luva",
      categoria_id: 1,
      unidade: "UN",
      estoque_minimo: "1",
      saldo: "999",
    }),
  ));
test("cadastro de usuário não aceita telegram_id arbitrário", () =>
  assert.throws(() =>
    userSchema.parse({
      nome: "Teste",
      email: "a@example.com",
      identificacao: "1",
      papel: "ADM",
      telegram_id: "1",
    }),
  ));
test("movimentação exige motivo e chave idempotente", () =>
  assert.throws(() =>
    movementSchema.parse({
      material_id: 1,
      tipo: "SAIDA",
      quantidade: "1",
      motivo: "x",
    }),
  ));
test("Telegram somente em chats privados", () => {
  assert.equal(privateChat({ chat: { type: "private" } }), true);
  assert.equal(privateChat({ chat: { type: "group" } }), false);
});
test("formulário Telegram inclui idempotência por update", () => {
  const data = parseMovement("12 2.500 Uso manutenção", actor, 42);
  assert.equal(data.material_id, 12);
  assert.equal(data.quantidade, "2.500");
  assert.equal(data.chave_idempotencia, "telegram:1:42");
  assert.throws(() => parseMovement("12", actor, 42));
});
test("detalhes do bot usam data brasileira e horário programado", () =>
  assert.match(
    taskText({
      ...task,
      id: 1,
      status: "PENDENTE",
      hora_inicio: "08:00:00",
      hora_fim: "09:00:00",
    }),
    /23\/10\/2026 · 08:00–09:00/,
  ));
