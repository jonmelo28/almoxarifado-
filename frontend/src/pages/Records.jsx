import { useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import Lookup from "../components/Lookup";
import {
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
  Pencil,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "../contexts/Auth";
import { useData } from "../hooks/useData";
import {
  Title,
  Toolbar,
  Pagination,
  DataTable,
  Loading,
  Notice,
  Badge,
  Modal,
} from "../components/UI";
import {
  api,
  errorText,
  date,
  time,
  number,
  localDay,
  instant,
} from "../services/api";
const config = {
  materiais: {
    title: "Materiais",
    description: "Catálogo e disponibilidade do seu almoxarifado.",
  },
  usuarios: {
    title: "Colaboradores",
    description: "Pessoas, acessos e responsabilidades da equipe.",
  },
  movimentacoes: {
    title: "Movimentações",
    description: "Entradas, saídas e rastreabilidade de cada operação.",
  },
  tarefas: {
    title: "Agenda de tarefas",
    description: "Organize a programação e acompanhe a execução.",
  },
  auditoria: {
    title: "Auditoria",
    description: "Histórico de operações críticas do sistema.",
  },
};
export default function Records({ entity }) {
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [telegram, setTelegram] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [telegramError, setTelegramError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  async function generateTelegram(record) {
    setGenerating(true);
    setTelegramError("");
    setCopied(false);
    try {
      const { data } = await api.post(`/usuarios/${record.id}/telegram-token`);
      setTelegram({ ...data, nome: record.nome });
    } catch (error) {
      setTelegramError(errorText(error));
    } finally {
      setGenerating(false);
    }
  }
  const [page, setPage] = useState(1);
  const [day, setDay] = useState(entity === "tarefas" ? localDay() : "");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [role, setRole] = useState("");
  const [situation, setSituation] = useState("");
  const [responsible, setResponsible] = useState("");
  const [material, setMaterial] = useState(
    searchParams.get("material_id") || "",
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [low, setLow] = useState(searchParams.get("baixo") === "true");
  const params = new URLSearchParams({
    q,
    page: String(page),
    limit: "20",
    ...(entity === "usuarios"
      ? {
          ...(role ? { papel: role } : {}),
          ...(situation ? { situacao: situation } : {}),
        }
      : {}),
    ...(entity === "tarefas"
      ? {
          ...(day ? { data_programada: day } : {}),
          ...(status ? { status } : {}),
          ...(priority ? { prioridade: priority } : {}),
          ...(responsible ? { responsavel_id: responsible } : {}),
        }
      : {}),
    ...(entity === "materiais" && low ? { baixo: "true" } : {}),
    ...(entity === "movimentacoes"
      ? {
          ...(status ? { tipo: status } : {}),
          ...(material ? { material_id: material } : {}),
          ...(from ? { de: from } : {}),
          ...(to ? { ate: to } : {}),
        }
      : {}),
  });
  const { data, error, loading, reload } = useData(`/${entity}?${params}`);
  const cfg = config[entity];
  const edit = (r) => (
    <Link
      className="table-action"
      aria-label={`Editar ${r.nome || r.titulo}`}
      to={`/${entity}/${r.id}/editar`}
    >
      <Pencil size={16} />
    </Link>
  );
  let columns;
  if (entity === "materiais")
    columns = [
      {
        key: "codigo",
        label: "Código",
        render: (r) => <span className="code">{r.codigo}</span>,
      },
      {
        key: "nome",
        label: "Material",
        render: (r) => (
          <div className="cell-stack">
            <strong>{r.nome}</strong>
            <small>{r.categoria}</small>
          </div>
        ),
      },
      { key: "unidade", label: "Unidade" },
      {
        key: "saldo",
        label: "Disponível",
        render: (r) => (
          <strong
            className={
              Number(r.saldo) < Number(r.estoque_minimo) ? "text-amber" : ""
            }
          >
            {number(r.saldo)}
          </strong>
        ),
      },
      {
        key: "estoque_minimo",
        label: "Mínimo",
        render: (r) => number(r.estoque_minimo),
      },
      {
        key: "ativo",
        label: "Situação",
        render: (r) => (
          <Badge
            value={
              !r.ativo
                ? "INATIVO"
                : Number(r.saldo) < Number(r.estoque_minimo)
                  ? "ESTOQUE BAIXO"
                  : "ATIVO"
            }
          />
        ),
      },
      {
        key: "actions",
        label: "Ações",
        render: (r) => (
          <div className="actions">
            <Link
              className="table-action"
              to={`/movimentacoes?material_id=${r.id}`}
              title="Histórico"
            >
              <ExternalLink size={16} />
            </Link>
            {user.papel === "ADM" && edit(r)}
          </div>
        ),
      },
    ];
  if (entity === "usuarios")
    columns = [
      {
        key: "nome",
        label: "Colaborador",
        render: (r) => (
          <div className="cell-stack">
            <strong>{r.nome}</strong>
            <small>{r.email}</small>
          </div>
        ),
      },
      { key: "identificacao", label: "Identificação" },
      {
        key: "papel",
        label: "Perfil",
        render: (r) => <Badge value={r.papel} />,
      },
      {
        key: "ativo",
        label: "Situação",
        render: (r) => (
          <Badge
            value={r.bloqueado ? "BLOQUEADO" : r.ativo ? "ATIVO" : "INATIVO"}
          />
        ),
      },
      {
        key: "telegram_id",
        label: "Telegram",
        render: (r) => (r.telegram_id ? "Vinculado" : "Não vinculado"),
      },
      ...(user.papel === "ADM"
        ? [
            {
              key: "actions",
              label: "Ações",
              render: (r) => (
                <div className="actions">
                  {edit(r)}
                  <Link
                    to={`/permissoes-bot?usuario=${r.id}`}
                    aria-label={`Permissões do bot para ${r.nome}`}
                  >
                    Permissões do bot
                  </Link>
                  <button
                    type="button"
                    disabled={generating || !r.ativo || Boolean(r.bloqueado)}
                    aria-label={`Gerar vínculo Telegram para ${r.nome}`}
                    onClick={() => generateTelegram(r)}
                  >
                    Gerar vínculo Telegram
                  </button>
                  {r.telegram_id && (
                    <button
                      type="button"
                      disabled={generating}
                      onClick={() => {
                        setTelegramError("");
                        setRevoking(r);
                      }}
                      aria-label={`Revogar vínculo Telegram de ${r.nome}`}
                    >
                      Revogar vínculo Telegram
                    </button>
                  )}
                </div>
              ),
            },
          ]
        : []),
    ];
  if (entity === "movimentacoes")
    columns = [
      { key: "id", label: "#" },
      {
        key: "criado_em",
        label: "Data",
        render: (r) => <span>{instant(r.criado_em)}</span>,
      },
      { key: "material", label: "Material" },
      { key: "tipo", label: "Tipo", render: (r) => <Badge value={r.tipo} /> },
      {
        key: "quantidade",
        label: "Quantidade",
        render: (r) => number(r.quantidade),
      },
      {
        key: "saldo_posterior",
        label: "Saldo após",
        render: (r) => number(r.saldo_posterior),
      },
      { key: "responsavel", label: "Responsável" },
      { key: "motivo", label: "Justificativa" },
      { key: "origem", label: "Origem" },
      ...(user.papel === "ADM"
        ? [
            {
              key: "actions",
              label: "Correção",
              render: (r) =>
                r.tipo !== "ESTORNO" && (
                  <Link
                    to={`/movimentacoes/nova?tipo=ESTORNO&original=${r.id}&material=${r.material_id}`}
                  >
                    Estornar
                  </Link>
                ),
            },
          ]
        : []),
    ];
  if (entity === "tarefas")
    columns = [
      {
        key: "titulo",
        label: "Tarefa",
        render: (r) => (
          <Link className="cell-stack" to={`/tarefas/${r.id}`}>
            <strong>{r.titulo}</strong>
            <small>#{r.id}</small>
          </Link>
        ),
      },
      { key: "responsavel", label: "Responsável" },
      {
        key: "data_programada",
        label: "Data",
        render: (r) => date(r.data_programada),
      },
      {
        key: "hora_inicio",
        label: "Horário",
        render: (r) => `${time(r.hora_inicio)} – ${time(r.hora_fim)}`,
      },
      {
        key: "prioridade",
        label: "Prioridade",
        render: (r) => <Badge value={r.prioridade} />,
      },
      {
        key: "status",
        label: "Status",
        render: (r) => <Badge value={r.status} />,
      },
      {
        key: "actions",
        label: "Detalhes",
        render: (r) => (
          <Link className="table-action" to={`/tarefas/${r.id}`}>
            <ExternalLink size={16} />
          </Link>
        ),
      },
    ];
  if (entity === "auditoria")
    columns = [
      { key: "id", label: "#" },
      { key: "criado_em", label: "Data", render: (r) => instant(r.criado_em) },
      { key: "ator", label: "Responsável" },
      { key: "acao", label: "Ação" },
      {
        key: "entidade",
        label: "Recurso",
        render: (r) => `${r.entidade} #${r.entidade_id}`,
      },
      { key: "origem", label: "Origem" },
      {
        key: "dados",
        label: "Alterações",
        render: (r) => (
          <details>
            <summary>Ver dados</summary>
            <pre>
              {JSON.stringify(
                typeof r.dados === "string" ? JSON.parse(r.dados) : r.dados,
                null,
                2,
              )}
            </pre>
          </details>
        ),
      },
    ];
  function filter(setter, value) {
    setter(value);
    setPage(1);
  }
  return (
    <>
      <Title title={cfg.title} description={cfg.description}>
        {entity === "tarefas" && user.papel !== "COLABORADOR" && (
          <Link
            className="button primary"
            to={`/tarefas/planejamento?dia=${day || localDay()}`}
          >
            Planejar dia
          </Link>
        )}
        {entity === "movimentacoes" ? (
          <>
            {user.papel !== "COLABORADOR" && (
              <Link className="button" to="/movimentacoes/nova?tipo=ENTRADA">
                <ArrowDownToLine size={17} /> Entrada
              </Link>
            )}
            <Link
              className="button primary"
              to="/movimentacoes/nova?tipo=SAIDA"
            >
              <ArrowUpFromLine size={17} /> Saída
            </Link>
            <Link className="button" to="/movimentacoes/nova?tipo=DEVOLUCAO">
              Devolução
            </Link>
            {user.papel === "ADM" && (
              <Link className="button" to="/movimentacoes/nova?tipo=AJUSTE">
                Ajuste
              </Link>
            )}
          </>
        ) : (
          ((["materiais", "usuarios"].includes(entity) &&
            user.papel === "ADM") ||
            (entity === "tarefas" && user.papel !== "COLABORADOR")) && (
            <Link className="button primary" to={`/${entity}/nova`}>
              <Plus size={17} /> Novo cadastro
            </Link>
          )
        )}
      </Title>
      <Notice>{location.state?.success}</Notice>
      <Notice error>{telegramError}</Notice>
      {revoking && (
        <Modal
          title="Revogar vínculo Telegram"
          onClose={() => !generating && setRevoking(null)}
        >
          <p>
            Revogar o vínculo de {revoking.nome}? Essa conta do Telegram perderá
            o acesso e os códigos de vínculo pendentes serão invalidados. Para
            vincular novamente, gere outro código.
          </p>
          <button
            type="button"
            disabled={generating}
            onClick={() => setRevoking(null)}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={generating}
            onClick={async () => {
              setGenerating(true);
              setTelegramError("");
              try {
                await api.delete(`/usuarios/${revoking.id}/telegram-vinculo`);
                setRevoking(null);
                setTelegram(null);
                reload();
              } catch (error) {
                setTelegramError(errorText(error));
              } finally {
                setGenerating(false);
              }
            }}
          >
            {generating ? "Revogando…" : "Confirmar revogação"}
          </button>
        </Modal>
      )}
      {telegram && (
        <Modal
          title={`Vincular Telegram · ${telegram.nome}`}
          onClose={() => setTelegram(null)}
        >
          <p>
            Envie este comando para {telegram.nome}. O colaborador deve copiá-lo
            e enviá-lo no chat privado do bot, sem precisar acessar o portal.
          </p>
          <p>
            Válido por {telegram.expira_em_minutos} minutos e para um único uso.
            Gerar outro código invalida o anterior. Para trocar uma conta do
            Telegram já vinculada, o ADM precisa revogar o vínculo atual no
            painel.
          </p>
          <code className="token">/vincular {telegram.token}</code>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `/vincular ${telegram.token}`,
                );
                setCopied(true);
              } catch {
                setTelegramError("Copie o comando manualmente.");
              }
            }}
          >
            {copied ? "Comando copiado" : "Copiar comando"}
          </button>
        </Modal>
      )}
      <section className="panel">
        <Toolbar q={q} setQ={(v) => filter(setQ, v)}>
          {entity === "usuarios" && (
            <>
              <select
                aria-label="Perfil"
                value={role}
                onChange={(e) => filter(setRole, e.target.value)}
              >
                <option value="">Todos os perfis</option>
                {["ADM", "GESTOR", "COLABORADOR"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <select
                aria-label="Situação"
                value={situation}
                onChange={(e) => filter(setSituation, e.target.value)}
              >
                <option value="">Todas as situações</option>
                {["ATIVO", "INATIVO", "BLOQUEADO"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </>
          )}
          {entity === "materiais" && (
            <label className="check">
              <input
                type="checkbox"
                checked={low}
                onChange={(e) => filter(setLow, e.target.checked)}
              />{" "}
              Estoque baixo
            </label>
          )}
          {entity === "tarefas" && (
            <>
              <input
                aria-label="Data da agenda"
                type="date"
                value={day}
                onChange={(e) => filter(setDay, e.target.value)}
              />
              <select
                aria-label="Status"
                value={status}
                onChange={(e) => filter(setStatus, e.target.value)}
              >
                <option value="">Todos os status</option>
                {["PENDENTE", "EM_ANDAMENTO", "CONCLUIDA", "CANCELADA"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
              <select
                aria-label="Prioridade"
                value={priority}
                onChange={(e) => filter(setPriority, e.target.value)}
              >
                <option value="">Todas as prioridades</option>
                {["BAIXA", "MEDIA", "ALTA"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              {user.papel !== "COLABORADOR" && (
                <Lookup
                  entity="usuarios"
                  label="Colaborador"
                  value={responsible}
                  onChange={(v) => filter(setResponsible, v)}
                />
              )}
            </>
          )}
          {entity === "movimentacoes" && (
            <>
              <select
                aria-label="Tipo"
                value={status}
                onChange={(e) => filter(setStatus, e.target.value)}
              >
                <option value="">Todos os tipos</option>
                {["ENTRADA", "SAIDA", "DEVOLUCAO", "AJUSTE", "ESTORNO"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
              <input
                aria-label="ID material"
                type="number"
                placeholder="ID material"
                value={material}
                onChange={(e) => filter(setMaterial, e.target.value)}
              />
              <input
                aria-label="De"
                type="date"
                value={from}
                onChange={(e) => filter(setFrom, e.target.value)}
              />
              <input
                aria-label="Até"
                type="date"
                value={to}
                onChange={(e) => filter(setTo, e.target.value)}
              />
            </>
          )}
        </Toolbar>
        <Notice error>{error}</Notice>
        {loading ? (
          <Loading />
        ) : (
          <DataTable columns={columns} rows={data?.data} />
        )}
        <Pagination page={page} setPage={setPage} total={data?.total} />
      </section>
    </>
  );
}
