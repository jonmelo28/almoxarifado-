import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Play, Check, Ban } from "lucide-react";
import { useData } from "../hooks/useData";
import { useAuth } from "../contexts/Auth";
import { api, errorText, date, time, instant, number } from "../services/api";
import {
  Title,
  Notice,
  Loading,
  Badge,
  Modal,
  Field,
  DataTable,
  Pagination,
} from "../components/UI";
export function TaskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: t, error, loading, reload } = useData("/tarefas/" + id);
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/tarefas/${id}/${action}`, {
        motivo: reason,
        observacoes: note,
      });
      setAction("");
      reload();
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  if (error) return <Notice error>{error}</Notice>;
  return (
    <>
      <Title
        title={t.titulo}
        description={`Tarefa #${t.id} · ${date(t.data_programada)} · ${time(t.hora_inicio)}–${time(t.hora_fim)}`}
      >
        <Link className="button" to="/tarefas">
          Voltar à agenda
        </Link>
        {t.status === "PENDENTE" && user.papel !== "COLABORADOR" && (
          <Link className="button" to={`/tarefas/${id}/editar`}>
            Editar
          </Link>
        )}
      </Title>
      <section className="panel form-panel">
        <div className="actions">
          <Badge value={t.status} />
          <Badge value={t.prioridade} />
        </div>
        <h2>Descrição</h2>
        <p className="preserve">{t.descricao || "Sem descrição adicional."}</p>
        <dl className="detail-grid">
          <div>
            <dt>Início real</dt>
            <dd>
              {t.inicio_real ? instant(t.inicio_real) : "Ainda não iniciada"}
            </dd>
          </div>
          <div>
            <dt>Conclusão real</dt>
            <dd>
              {t.conclusao_real
                ? instant(t.conclusao_real)
                : "Ainda não concluída"}
            </dd>
          </div>
          <div>
            <dt>Responsável</dt>
            <dd>Colaborador #{t.responsavel_id}</dd>
          </div>
          <div>
            <dt>Observações</dt>
            <dd className="preserve">{t.observacoes || "—"}</dd>
          </div>
        </dl>
        {t.motivo_cancelamento && (
          <Notice error>Cancelamento: {t.motivo_cancelamento}</Notice>
        )}
        <div className="actions">
          {t.status === "PENDENTE" && (
            <button className="primary" onClick={() => setAction("iniciar")}>
              <Play size={16} /> Iniciar tarefa
            </button>
          )}
          {t.status === "EM_ANDAMENTO" && (
            <button className="primary" onClick={() => setAction("concluir")}>
              <Check size={16} /> Concluir tarefa
            </button>
          )}
          {["PENDENTE", "EM_ANDAMENTO"].includes(t.status) &&
            user.papel !== "COLABORADOR" && (
              <button onClick={() => setAction("cancelar")}>
                <Ban size={16} /> Cancelar tarefa
              </button>
            )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Histórico da tarefa</h2>
        </div>
        <DataTable
          columns={[
            {
              key: "criado_em",
              label: "Data",
              render: (r) => instant(r.criado_em),
            },
            { key: "ator", label: "Responsável" },
            {
              key: "dados",
              label: "Alteração",
              render: (r) => (
                <details>
                  <summary>Ver alteração</summary>
                  <pre>
                    {JSON.stringify(
                      typeof r.dados === "string"
                        ? JSON.parse(r.dados)
                        : r.dados,
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ),
            },
          ]}
          rows={t.historico}
        />
      </section>
      {action && (
        <Modal
          title={`Confirmar: ${action}`}
          onClose={() => !busy && setAction("")}
        >
          <form onSubmit={submit}>
            <Notice error>{failure}</Notice>
            {action === "cancelar" && (
              <Field
                label="Motivo de cancelamento"
                required
                minLength={5}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            <Field label="Observações">
              <textarea
                maxLength={5000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <button className="primary" disabled={busy}>
              {busy ? "Salvando…" : "Confirmar"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Reports() {
  const { user } = useAuth();
  const [type, setType] = useState("estoque");
  const [page, setPage] = useState(1);
  const [day, setDay] = useState("");
  const [error, setError] = useState("");
  const params = new URLSearchParams({
    page: String(page),
    limit: "20",
    ...(type === "tarefas" && day ? { data_programada: day } : {}),
  });
  const {
    data,
    loading,
    error: loadError,
  } = useData(`/relatorios/${type}?${params}`);
  if (user.papel === "COLABORADOR")
    return <Notice error>Acesso não autorizado.</Notice>;
  async function download() {
    try {
      const r = await api.get(`/relatorios/${type}?${params}&formato=csv`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-pagina-${page}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const columns =
    type === "estoque"
      ? [
          { key: "codigo", label: "Código" },
          { key: "nome", label: "Material" },
          { key: "saldo", label: "Saldo", render: (r) => number(r.saldo) },
          {
            key: "estoque_minimo",
            label: "Mínimo",
            render: (r) => number(r.estoque_minimo),
          },
          { key: "unidade", label: "Unidade" },
        ]
      : type === "tarefas"
        ? [
            { key: "titulo", label: "Tarefa" },
            { key: "responsavel", label: "Responsável" },
            {
              key: "data_programada",
              label: "Data",
              render: (r) => date(r.data_programada),
            },
            {
              key: "status",
              label: "Status",
              render: (r) => <Badge value={r.status} />,
            },
            {
              key: "conclusao_real",
              label: "Conclusão",
              render: (r) => instant(r.conclusao_real),
            },
          ]
        : [
            { key: "material", label: "Material" },
            { key: "tipo", label: "Tipo" },
            {
              key: "quantidade",
              label: "Quantidade",
              render: (r) => number(r.quantidade),
            },
            { key: "responsavel", label: "Responsável" },
            { key: "motivo", label: "Motivo" },
          ];
  return (
    <>
      <Title
        title="Relatórios"
        description="Consulte dados operacionais e exporte a página filtrada em CSV."
      >
        <button onClick={download}>
          <Download size={17} /> Exportar página CSV
        </button>
      </Title>
      <section className="panel">
        <div className="toolbar">
          <select
            aria-label="Relatório"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="estoque">Posição de estoque</option>
            <option value="tarefas">Tarefas previstas e executadas</option>
            <option value="consumo">Consumo e movimentações</option>
          </select>
          {type === "tarefas" && (
            <input
              aria-label="Data"
              type="date"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setPage(1);
              }}
            />
          )}
        </div>
        <Notice error>{error || loadError}</Notice>
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
export function Settings() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useData("/configuracoes");
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  if (user.papel !== "ADM")
    return <Notice error>Acesso não autorizado.</Notice>;
  async function save(e) {
    setBusy(true);
    try {
      await api.patch("/configuracoes", {
        permitir_sobreposicao: e.target.checked,
      });
      setSuccess("Configuração atualizada.");
      reload();
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title
        title="Configurações"
        description="Políticas operacionais do ambiente."
      />
      <Notice error>{error || failure}</Notice>
      <Notice>{success}</Notice>
      {loading ? (
        <Loading />
      ) : (
        <section className="panel form-panel">
          <h2>Programação de tarefas</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(data?.permitir_sobreposicao)}
              disabled={busy}
              onChange={save}
            />{" "}
            Permitir sobreposição de horários para o mesmo colaborador
          </label>
          <p>
            Quando desabilitada, a API impede agendamentos conflitantes. A
            mudança vale para novas operações.
          </p>
        </section>
      )}
    </>
  );
}
