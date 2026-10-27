import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/Auth";
import { useData } from "../hooks/useData";
import Lookup from "../components/Lookup";
import {
  Title,
  Field,
  Notice,
  Loading,
  Badge,
  Modal,
  Pagination,
} from "../components/UI";
import { api, errorText, date, time, localDay } from "../services/api";

function offsetDay(day, offset) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
const blank = (responsible = "") => ({
  responsavel_id: responsible,
  titulo: "",
  descricao: "",
  hora_inicio: "08:00",
  hora_fim: "09:00",
  prioridade: "MEDIA",
  observacoes: "",
});

function DailyPlanner({ day, setDay }) {
  const [page, setPage] = useState(1);
  const [responsible, setResponsible] = useState("");
  const [form, setForm] = useState(() => blank());
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState([]);
  const [copying, setCopying] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const params = new URLSearchParams({
    data_programada: day,
    page,
    limit: 20,
    ...(responsible ? { responsavel_id: responsible } : {}),
  });
  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useData(`/tarefas?${params}`);
  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        ...form,
        responsavel_id: Number(form.responsavel_id),
        data_programada: day,
      };
      if (editing)
        await api.patch(`/tarefas/${editing.id}`, payload, {
          headers: { "X-Record-Version": editing.atualizado_em },
        });
      else await api.post("/tarefas", payload);
      setSuccess(
        editing
          ? "Tarefa atualizada."
          : "Tarefa adicionada. Você já pode cadastrar a próxima.",
      );
      setForm(blank(form.responsavel_id));
      setEditing(null);
      reload();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function edit(task) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.get(`/tarefas/${task.id}`);
      if (data.status !== "PENDENTE")
        throw {
          response: {
            data: { error: "Somente tarefas pendentes podem ser editadas." },
          },
        };
      setEditing(data);
      setForm(
        Object.fromEntries(
          Object.keys(blank()).map((key) => [
            key,
            ["hora_inicio", "hora_fim"].includes(key)
              ? data[key].slice(0, 5)
              : (data[key] ?? blank()[key]),
          ]),
        ),
      );
      document
        .getElementById("planner-editor")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  function toggle(taskId) {
    setSelected((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );
  }
  const tasks = data?.data || [];
  return (
    <>
      <section className="panel planner-date">
        <button
          disabled={busy}
          aria-label="Dia anterior"
          onClick={() => setDay(offsetDay(day, -1))}
        >
          ←
        </button>
        <Field
          label="Dia do planejamento"
          type="date"
          required
          value={day}
          disabled={busy}
          onChange={(event) => event.target.value && setDay(event.target.value)}
        />
        <button
          disabled={busy}
          aria-label="Dia seguinte"
          onClick={() => setDay(offsetDay(day, 1))}
        >
          →
        </button>
        <button disabled={busy} onClick={() => setDay(localDay())}>
          Hoje
        </button>
        <strong>
          {data?.total ?? 0} tarefa(s) neste dia
          {responsible ? " para o responsável filtrado" : ""}
        </strong>
      </section>
      <Notice error>{error || loadError}</Notice>
      <Notice>{success}</Notice>
      <div className="planner-grid">
        <section className="panel form-panel" id="planner-editor">
          <h2>
            {editing ? `Editar tarefa #${editing.id}` : "Adicionar tarefa"}
          </h2>
          <p>
            Programação de {date(day)}. Ao salvar, o responsável permanece
            selecionado para a próxima tarefa.
          </p>
          <form onSubmit={save}>
            <fieldset disabled={busy} className="planner-fields">
              <Lookup
                entity="usuarios"
                label="Responsável pela tarefa"
                required
                value={String(form.responsavel_id)}
                onChange={(value) => set("responsavel_id", value)}
              />
              <Field
                label="Título da tarefa"
                required
                minLength={3}
                maxLength={160}
                value={form.titulo}
                onChange={(event) => set("titulo", event.target.value)}
              />
              <div className="form-grid">
                <Field
                  label="Início"
                  type="time"
                  required
                  value={form.hora_inicio}
                  onChange={(event) => set("hora_inicio", event.target.value)}
                />
                <Field
                  label="Fim"
                  type="time"
                  required
                  min={form.hora_inicio}
                  value={form.hora_fim}
                  onChange={(event) => set("hora_fim", event.target.value)}
                />
              </div>
              <Field label="Prioridade">
                <select
                  value={form.prioridade}
                  onChange={(event) => set("prioridade", event.target.value)}
                >
                  {["BAIXA", "MEDIA", "ALTA"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Descrição">
                <textarea
                  maxLength={5000}
                  value={form.descricao}
                  onChange={(event) => set("descricao", event.target.value)}
                />
              </Field>
              <Field label="Observações do planejamento">
                <textarea
                  maxLength={5000}
                  value={form.observacoes}
                  onChange={(event) => set("observacoes", event.target.value)}
                />
              </Field>
              <div className="form-footer">
                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setForm(blank(form.responsavel_id));
                    }}
                  >
                    Cancelar edição
                  </button>
                )}
                <button className="primary" type="submit">
                  {busy
                    ? "Salvando…"
                    : editing
                      ? "Salvar alterações"
                      : "Adicionar e continuar"}
                </button>
              </div>
            </fieldset>
          </form>
        </section>
        <section className="panel planner-tasks">
          <h2>Tarefas de {date(day)}</h2>
          <Lookup
            entity="usuarios"
            label="Filtrar responsável"
            value={responsible}
            onChange={(value) => {
              setResponsible(value);
              setPage(1);
              setSelected([]);
            }}
          />
          <div className="planner-selection">
            <label className="check">
              <input
                type="checkbox"
                disabled={!tasks.length || loading || busy}
                checked={
                  tasks.length > 0 &&
                  tasks.every((task) => selected.includes(task.id))
                }
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [
                          ...new Set([
                            ...selected,
                            ...tasks.map((task) => task.id),
                          ]),
                        ]
                      : selected.filter(
                          (id) => !tasks.some((task) => task.id === id),
                        ),
                  )
                }
              />
              Selecionar página
            </label>
            <button
              disabled={!selected.length || busy || selected.length > 100}
              onClick={() => setCopying(selected)}
            >{`Copiar selecionadas (${selected.length})`}</button>
          </div>
          {selected.length > 100 && (
            <Notice error>Selecione até 100 tarefas por cópia.</Notice>
          )}
          {loading ? (
            <Loading />
          ) : !tasks.length ? (
            <p>
              Nenhuma tarefa neste dia. Use o formulário para começar o
              planejamento.
            </p>
          ) : (
            tasks.map((task) => (
              <article className="planner-task" key={task.id}>
                <div className="planner-task-heading">
                  <label className="check">
                    <input
                      type="checkbox"
                      disabled={busy}
                      aria-label={`Selecionar ${task.titulo}`}
                      checked={selected.includes(task.id)}
                      onChange={() => toggle(task.id)}
                    />
                    <strong>
                      {time(task.hora_inicio)}–{time(task.hora_fim)} ·{" "}
                      {task.titulo}
                    </strong>
                  </label>
                  <Badge value={task.status} />
                </div>
                <p>
                  {task.responsavel} · Prioridade{" "}
                  {task.prioridade.toLowerCase()}
                </p>
                <div className="actions">
                  <Link to={`/tarefas/${task.id}`}>Detalhes</Link>
                  <button
                    disabled={busy || task.status !== "PENDENTE"}
                    onClick={() => edit(task)}
                  >
                    {editing?.id === task.id ? "Em edição" : "Editar tarefa"}
                  </button>
                  <button disabled={busy} onClick={() => setCopying([task.id])}>
                    Copiar para dias ou colaboradores
                  </button>
                </div>
                {task.status !== "PENDENTE" && (
                  <small>
                    A execução já foi registrada; você pode copiar esta tarefa
                    como uma nova pendente.
                  </small>
                )}
              </article>
            ))
          )}
          <Pagination page={page} setPage={setPage} total={data?.total} />
        </section>
      </div>
      {copying && (
        <CopyTasks
          day={day}
          taskIds={copying}
          onClose={() => setCopying(null)}
          onSuccess={(total) => {
            setCopying(null);
            setSelected([]);
            setSuccess(
              `${total} tarefa(s) copiadas. Selecione a data de destino para consultar.`,
            );
            reload();
          }}
        />
      )}
    </>
  );
}

function CopyTasks({ day, taskIds, onClose, onSuccess }) {
  const [responsible, setResponsible] = useState("");
  const [days, setDays] = useState([]);
  const [candidate, setCandidate] = useState(offsetDay(day, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function addDays(values) {
    setDays((current) =>
      [
        ...new Set([
          ...current,
          ...values.filter((value) => value && (value !== day || responsible)),
        ]),
      ].sort(),
    );
  }
  async function copy(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api.post("/tarefas/duplicar", {
        tarefas: taskIds,
        dias: days,
        ...(responsible ? { responsavel_id: Number(responsible) } : {}),
      });
      onSuccess(result.data.total);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Copiar tarefas" onClose={() => !busy && onClose()}>
      <p>
        {taskIds.length} tarefa(s) selecionada(s). As cópias mantêm título,
        descrição, horário e prioridade e começam pendentes, sem registros de
        execução. Escolha outro colaborador abaixo ou deixe sem selecionar para
        manter os responsáveis originais.
      </p>
      <Notice error>{error}</Notice>
      <fieldset className="planner-fields" disabled={busy}>
        <Lookup
          entity="usuarios"
          label="Colaborador de destino (opcional)"
          value={responsible}
          onChange={(value) => {
            setResponsible(value);
            if (!value)
              setDays((current) => current.filter((value) => value !== day));
          }}
        />
        <button
          type="button"
          disabled={!responsible}
          onClick={() => addDays([day])}
        >
          Usar mesmo dia
        </button>
      </fieldset>
      <div className="planner-date">
        <Field
          label="Data de destino"
          type="date"
          value={candidate}
          disabled={busy}
          onChange={(event) => setCandidate(event.target.value)}
        />
        <button
          type="button"
          disabled={busy || !candidate || (candidate === day && !responsible)}
          onClick={() => addDays([candidate])}
        >
          Adicionar data
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            addDays(
              Array.from({ length: 7 }, (_, index) =>
                offsetDay(day, index + 1),
              ),
            )
          }
        >
          Próximos 7 dias
        </button>
      </div>
      <div className="planner-dates">
        {days.map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-label={`Remover ${date(value)}`}
            onClick={() =>
              setDays((current) => current.filter((day) => day !== value))
            }
          >
            {date(value)} ×
          </button>
        ))}
      </div>
      <p>
        {days.length} dia(s) · {days.length * taskIds.length} nova(s) tarefa(s).
        Máximo de 31 dias e 200 cópias por operação. Se houver conflito, nenhuma
        cópia será salva.
      </p>
      <form onSubmit={copy}>
        <div className="form-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              busy ||
              !days.length ||
              days.length > 31 ||
              days.length * taskIds.length > 200
            }
          >
            {busy ? "Copiando…" : "Confirmar cópia"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function TaskPlanner() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const value = params.get("dia");
  const day =
    value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
      ? value
      : localDay();
  if (user.papel === "COLABORADOR")
    return <Notice error>Acesso não autorizado.</Notice>;
  return (
    <>
      <Title
        title="Planejamento diário"
        description="Escolha o dia, organize a equipe e reaproveite o planejamento em outras datas."
      >
        <Link className="button" to="/tarefas">
          Ver agenda
        </Link>
      </Title>
      <DailyPlanner
        key={day}
        day={day}
        setDay={(day) => setParams({ dia: day })}
      />
    </>
  );
}
