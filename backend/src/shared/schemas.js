import { z } from "zod";
import { id, quantity, roles } from "./domain.js";
export const userSchema = z
  .object({
    nome: z.string().trim().min(2).max(120),
    email: z
      .string()
      .email()
      .max(190)
      .transform((s) => s.toLowerCase()),
    identificacao: z.string().trim().min(1).max(60),
    papel: z.enum(roles),
    ativo: z.boolean().default(true),
    bloqueado: z.boolean().default(false),
    senha: z
      .string()
      .min(12)
      .max(72)
      .refine(
        (s) => Buffer.byteLength(s, "utf8") <= 72,
        "Senha deve ter até 72 bytes UTF-8.",
      )
      .optional(),
  })
  .strict();
export const materialSchema = z
  .object({
    nome: z.string().trim().min(2).max(160),
    descricao: z.string().max(4000).default(""),
    categoria_id: id,
    unidade: z.enum(["UN", "KG", "L", "M"]),
    estoque_minimo: quantity.refine(
      (v) => !v.startsWith("-"),
      "Mínimo deve ser positivo.",
    ),
    ativo: z.boolean().default(true),
  })
  .strict();
export const movementSchema = z
  .object({
    material_id: id,
    tipo: z.enum(["ENTRADA", "SAIDA", "DEVOLUCAO", "AJUSTE", "ESTORNO"]),
    quantidade: quantity,
    beneficiario_id: id.nullish(),
    tarefa_id: id.nullish(),
    motivo: z.string().trim().min(5).max(500),
    chave_idempotencia: z.string().min(8).max(100),
    estorno_de: id.nullish(),
  })
  .strict();
export const taskSchema = z
  .object({
    responsavel_id: id,
    titulo: z.string().trim().min(3).max(160),
    descricao: z.string().max(5000).default(""),
    data_programada: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((s) => {
        const d = new Date(s + "T12:00:00Z");
        return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
      }, "Data inválida."),
    hora_inicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    hora_fim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    prioridade: z.enum(["BAIXA", "MEDIA", "ALTA"]),
    observacoes: z.string().max(5000).default(""),
  })
  .strict()
  .refine(
    (t) => t.hora_fim > t.hora_inicio,
    "Horário final deve ser posterior ao inicial.",
  );
