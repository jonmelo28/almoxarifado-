import { z } from "zod";
import { formatQuantity, quantityFields } from "./formatQuantity.js";
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function ensure(condition, status, message) {
  if (!condition) throw new AppError(status, message);
}
export function allow(actor, ...roles) {
  ensure(
    actor && actor.ativo && !actor.bloqueado,
    401,
    "Autenticação necessária.",
  );
  ensure(roles.includes(actor.papel), 403, "Operação não autorizada.");
}
export function own(actor, id) {
  ensure(
    actor.papel !== "COLABORADOR" || actor.id === Number(id),
    403,
    "Recurso não autorizado.",
  );
}
export const id = z.coerce.number().int().positive().max(4294967295);
export const quantity = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,3})?$/, "Use um decimal com até três casas.");
export function milli(value) {
  ensure(
    /^-?\d{1,12}(\.\d{1,3})?$/.test(String(value)),
    422,
    "Quantidade inválida.",
  );
  const negative = String(value).startsWith("-");
  const [whole, fraction = ""] = String(value).replace("-", "").split(".");
  const n = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return negative ? -n : n;
}
export function decimal(value) {
  const negative = value < 0n;
  const n = negative ? -value : value;
  return `${negative ? "-" : ""}${n / 1000n}.${String(n % 1000n).padStart(3, "0")}`;
}
export function stockBalance(balance, amount, type, unit) {
  const n = milli(amount);
  ensure(
    type === "AJUSTE" || type === "ESTORNO" || n > 0n,
    422,
    "Quantidade deve ser positiva.",
  );
  ensure(n !== 0n, 422, "Quantidade não pode ser zero.");
  ensure(
    unit !== "UN" || n % 1000n === 0n,
    422,
    "Unidade UN exige quantidade inteira.",
  );
  const next = milli(balance) + (type === "SAIDA" ? -n : n);
  ensure(next >= 0n, 409, "Estoque insuficiente.");
  ensure(next <= 999999999999999n, 422, "Saldo excede o limite.");
  return decimal(next);
}
export function transition(status, action) {
  const next = {
    iniciar: ["PENDENTE", "EM_ANDAMENTO"],
    concluir: ["EM_ANDAMENTO", "CONCLUIDA"],
    cancelar: ["PENDENTE,EM_ANDAMENTO", "CANCELADA"],
  }[action];
  ensure(
    next && next[0].split(",").includes(status),
    409,
    "Transição de tarefa inválida.",
  );
  return next[1];
}
export function csv(records) {
  const cell = (value) =>
    `"${String(value ?? "")
      .replace(/^[\s]*[=+\-@\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  if (!records.length) return "\uFEFF";
  const keys = Object.keys(records[0]);
  return (
    "\uFEFF" +
    [
      keys.map(cell).join(";"),
      ...records.map((r) =>
        keys
          .map((k) =>
            cell(
              quantityFields.has(k) && /^-?\d+(\.\d{1,3})?$/.test(String(r[k]))
                ? formatQuantity(r[k])
                : r[k],
            ),
          )
          .join(";"),
      ),
    ].join("\r\n")
  );
}
export function page(query) {
  return z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      q: z.string().max(160).default(""),
    })
    .parse(query);
}
export const roles = ["ADM", "GESTOR", "COLABORADOR"];
