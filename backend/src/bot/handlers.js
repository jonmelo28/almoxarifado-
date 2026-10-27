import { DateTime } from "luxon";
import { config } from "../config/env.js";
import { ensure } from "../shared/domain.js";
export { formatQuantity, quantityFields } from "../shared/formatQuantity.js";
export function privateChat(ctx) {
  return ctx.chat?.type === "private";
}
export function parseMovement(text, actor, updateId) {
  const [material, quantidade, ...reason] = text.trim().split(/\s+/);
  ensure(
    material && quantidade && reason.join(" ").length >= 5,
    422,
    "Informe: código numérico do material, quantidade e motivo (mínimo 5 caracteres).",
  );
  return {
    material_id: Number(material),
    quantidade,
    motivo: reason.join(" "),
    tipo: "SAIDA",
    chave_idempotencia: `telegram:${actor.id}:${updateId}`,
  };
}
export function today() {
  return DateTime.now().setZone(config.timezone).toISODate();
}
export function taskText(t) {
  return `#${t.id} · ${t.titulo}\n${t.data_programada.split("-").reverse().join("/")} · ${t.hora_inicio.slice(0, 5)}–${t.hora_fim.slice(0, 5)}\n${t.status} · ${t.prioridade}\n${t.descricao || ""}`;
}
