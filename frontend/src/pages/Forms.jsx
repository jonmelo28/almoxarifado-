import Lookup from "../components/Lookup";
import { useState, useEffect } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
  Link,
} from "react-router-dom";
import { Save, ArrowLeft } from "lucide-react";
import { api, errorText, localDay } from "../services/api";
import { useData } from "../hooks/useData";
import { useAuth } from "../contexts/Auth";
import { Title, Field, Notice, Loading, Modal } from "../components/UI";
const defaults = {
  materiais: {
    nome: "",
    descricao: "",
    categoria_id: "",
    unidade: "UN",
    estoque_minimo: "0",
    ativo: true,
  },
  usuarios: {
    nome: "",
    email: "",
    identificacao: "",
    papel: "COLABORADOR",
    ativo: true,
    bloqueado: false,
    senha: "",
  },
  tarefas: {
    responsavel_id: "",
    titulo: "",
    descricao: "",
    data_programada: localDay(),
    hora_inicio: "08:00",
    hora_fim: "09:00",
    prioridade: "MEDIA",
    observacoes: "",
  },
};
export default function RecordForm({ entity }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState(() => ({
    ...defaults[entity],
    ...(entity === "tarefas" ? { data_programada: localDay() } : {}),
  }));
  const [error, setError] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const { data: categories, reload: reloadCategories } = useData("/categorias");
  const [category, setCategory] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    api
      .get(`/${entity}/${id}`)
      .then(({ data }) => {
        if (!active) return;
        if (entity === "materiais") setMaterialCode(data.codigo);
        const value = Object.fromEntries(
          Object.keys(defaults[entity]).map((k) => [
            k,
            data[k] ?? defaults[entity][k],
          ]),
        );
        for (const key of ["ativo", "bloqueado"])
          if (key in value) value[key] = Boolean(value[key]);
        if (entity === "tarefas") {
          value.hora_inicio = value.hora_inicio.slice(0, 5);
          value.hora_fim = value.hora_fim.slice(0, 5);
        }
        setForm(value);
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, entity]);
  if (
    (entity !== "tarefas" && user.papel !== "ADM") ||
    (entity === "tarefas" && user.papel === "COLABORADOR")
  )
    return <Notice error>Acesso não autorizado.</Notice>;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const input = (key, label, type = "text", extra = {}) => (
    <Field
      label={label}
      type={type}
      value={form[key]}
      onChange={(e) => set(key, e.target.value)}
      required
      {...extra}
    />
  );
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload = { ...form };
      if (entity === "usuarios" && !payload.senha) delete payload.senha;
      for (const key of ["responsavel_id", "categoria_id"])
        if (key in payload) payload[key] = Number(payload[key]);
      if (id) await api.patch(`/${entity}/${id}`, payload);
      else await api.post("/" + entity, payload);
      nav("/" + entity, { state: { success: "Cadastro salvo com sucesso." } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveCategory(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = categoryId
        ? await api.patch(`/categorias/${categoryId}`, { nome: category })
        : await api.post("/categorias", { nome: category });
      set("categoria_id", r.data.id);
      setCategory("");
      setCategoryId("");
      setCategoryOpen(false);
      reloadCategories();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  return (
    <>
      <Title
        title={`${id ? "Editar" : "Novo cadastro"} · ${{ materiais: "Material", usuarios: "Colaborador", tarefas: "Tarefa" }[entity]}`}
        description="Preencha os dados abaixo para manter a operação organizada."
      >
        <Link className="button" to={"/" + entity}>
          <ArrowLeft size={17} /> Voltar
        </Link>
      </Title>
      <Notice error>{error}</Notice>
      <form className="panel form-panel" onSubmit={submit}>
        <h2>Informações do cadastro</h2>
        <div className="form-grid">
          {entity === "materiais" && (
            <>
              <Field label="Código do material">
                <input
                  value={id ? materialCode : "Gerado automaticamente ao salvar"}
                  readOnly
                />
              </Field>
              {input("nome", "Nome do material", "text", {
                maxLength: 160,
                minLength: 2,
              })}
              <Field label="Categoria">
                <select
                  required
                  value={form.categoria_id}
                  onChange={(e) => set("categoria_id", e.target.value)}
                >
                  <option value="">Selecione</option>
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="field">
                <span>Gerenciar categorias</span>
                <button
                  type="button"
                  onClick={() => {
                    setCategoryId("");
                    setCategory("");
                    setCategoryOpen(true);
                  }}
                >
                  Nova / editar categoria
                </button>
              </div>
              <Field label="Unidade de medida">
                <select
                  disabled={Boolean(id)}
                  value={form.unidade}
                  onChange={(e) => set("unidade", e.target.value)}
                >
                  {["UN", "KG", "L", "M"].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
              {input("estoque_minimo", "Estoque mínimo", "number", {
                min: 0,
                step: form.unidade === "UN" ? "1" : "0.001",
              })}
              <Field label="Descrição">
                <textarea
                  maxLength={4000}
                  value={form.descricao}
                  onChange={(e) => set("descricao", e.target.value)}
                />
              </Field>
            </>
          )}
          {entity === "usuarios" && (
            <>
              {input("nome", "Nome completo", "text", {
                maxLength: 120,
                minLength: 2,
              })}
              {input("email", "Email", "email")}
              {input("identificacao", "Identificação interna", "text", {
                maxLength: 60,
              })}
              <Field label="Perfil de acesso">
                <select
                  value={form.papel}
                  onChange={(e) => set("papel", e.target.value)}
                >
                  {["COLABORADOR", "GESTOR", "ADM"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              {input(
                "senha",
                id ? "Nova senha (opcional)" : "Senha inicial",
                "password",
                {
                  required: !id,
                  minLength: 12,
                  maxLength: 72,
                  autoComplete: "new-password",
                },
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.bloqueado}
                  onChange={(e) => set("bloqueado", e.target.checked)}
                />{" "}
                Conta bloqueada
              </label>
            </>
          )}
          {entity === "tarefas" && (
            <>
              <Lookup
                entity="usuarios"
                label="Colaborador responsável"
                required
                value={form.responsavel_id}
                onChange={(v) => set("responsavel_id", v)}
              />
              {input("titulo", "Título", "text", {
                minLength: 3,
                maxLength: 160,
              })}
              {input("data_programada", "Data programada", "date")}
              {input("hora_inicio", "Início programado", "time")}
              {input("hora_fim", "Fim programado", "time")}
              <Field label="Prioridade">
                <select
                  value={form.prioridade}
                  onChange={(e) => set("prioridade", e.target.value)}
                >
                  {["BAIXA", "MEDIA", "ALTA"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Descrição">
                <textarea
                  maxLength={5000}
                  value={form.descricao}
                  onChange={(e) => set("descricao", e.target.value)}
                />
              </Field>
              <Field label="Observações">
                <textarea
                  maxLength={5000}
                  value={form.observacoes}
                  onChange={(e) => set("observacoes", e.target.value)}
                />
              </Field>
            </>
          )}
          {entity !== "tarefas" && (
            <label className="check">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => set("ativo", e.target.checked)}
              />{" "}
              Cadastro ativo
            </label>
          )}
        </div>
        <div className="form-footer">
          <Link className="button" to={"/" + entity}>
            Cancelar
          </Link>
          <button className="primary" disabled={busy}>
            <Save size={17} />
            {busy ? "Salvando…" : "Salvar cadastro"}
          </button>
        </div>
      </form>
      {categoryOpen && (
        <Modal
          title="Gerenciar categorias"
          onClose={() => setCategoryOpen(false)}
        >
          <form onSubmit={saveCategory}>
            <Field label="Categoria existente (opcional)">
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setCategory(
                    categories.find((c) => c.id === Number(e.target.value))
                      ?.nome || "",
                  );
                }}
              >
                <option value="">Criar nova</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Nome"
              required
              minLength={2}
              maxLength={100}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <button className="primary" disabled={busy}>
              Salvar categoria
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function MovementForm() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [form, setForm] = useState({
    material_id: params.get("material") || "",
    tipo: params.get("tipo") || "SAIDA",
    quantidade: "",
    motivo: "",
    beneficiario_id: "",
    tarefa_id: "",
    estorno_de: params.get("original") || "",
    chave_idempotencia: crypto.randomUUID(),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { data: selected } = useData(
    form.material_id ? `/materiais/${form.material_id}` : "/auth/me",
  );
  const set = (k, v) => setForm({ ...form, [k]: v });
  async function submit() {
    setBusy(true);
    try {
      const p = {
        ...form,
        material_id: Number(form.material_id),
        quantidade: form.tipo === "ESTORNO" ? "1" : form.quantidade,
      };
      for (const key of ["beneficiario_id", "tarefa_id", "estorno_de"])
        p[key] = p[key] ? Number(p[key]) : null;
      await api.post("/movimentacoes", p);
      nav("/movimentacoes", {
        state: {
          success: "Movimentação confirmada e registrada no histórico.",
        },
      });
    } catch (e) {
      setError(errorText(e));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title
        title="Registrar movimentação"
        description="O saldo será calculado pelo servidor e a operação ficará registrada no histórico."
      />
      <Notice error>{error}</Notice>
      <form
        className="panel form-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setConfirm(true);
        }}
      >
        <div className="form-grid">
          <Field label="Tipo">
            <select
              value={form.tipo}
              onChange={(e) => set("tipo", e.target.value)}
            >
              {[
                "SAIDA",
                "DEVOLUCAO",
                ...(user.papel !== "COLABORADOR" ? ["ENTRADA"] : []),
                ...(user.papel === "ADM" ? ["AJUSTE", "ESTORNO"] : []),
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Lookup
            entity="materiais"
            label="Material"
            active
            required
            value={form.material_id}
            onChange={(v) => set("material_id", v)}
          />
          {form.tipo === "ESTORNO" ? (
            <Field
              label="ID da movimentação original"
              type="number"
              min={1}
              required
              value={form.estorno_de}
              onChange={(e) => set("estorno_de", e.target.value)}
            />
          ) : (
            <Field
              label={
                form.tipo === "AJUSTE"
                  ? "Variação de saldo (positivo ou negativo)"
                  : "Quantidade"
              }
              type="number"
              step={selected?.unidade === "UN" ? "1" : "0.001"}
              min={
                form.tipo === "AJUSTE"
                  ? undefined
                  : selected?.unidade === "UN"
                    ? "1"
                    : "0.001"
              }
              required
              value={form.quantidade}
              onChange={(e) => set("quantidade", e.target.value)}
            />
          )}
          <Field
            label="Motivo / justificativa"
            required
            minLength={5}
            maxLength={500}
            value={form.motivo}
            onChange={(e) => set("motivo", e.target.value)}
          />
          {user.papel !== "COLABORADOR" && (
            <Lookup
              entity="usuarios"
              label="Beneficiário (opcional)"
              value={form.beneficiario_id}
              onChange={(v) => set("beneficiario_id", v)}
            />
          )}
          <Lookup
            entity="tarefas"
            label="Tarefa relacionada (opcional)"
            value={form.tarefa_id}
            onChange={(v) => set("tarefa_id", v)}
          />
        </div>
        <div className="form-footer">
          <Link className="button" to="/movimentacoes">
            Cancelar
          </Link>
          <button className="primary">Revisar movimentação</button>
        </div>
      </form>
      {confirm && (
        <Modal
          title="Confirmar movimentação"
          onClose={() => !busy && setConfirm(false)}
        >
          <p>
            <strong>{form.tipo}</strong> · {selected?.nome}
          </p>
          <p>
            {form.tipo === "ESTORNO"
              ? `Estorno da movimentação #${form.estorno_de}`
              : `Quantidade: ${form.quantidade} ${selected?.unidade}`}
          </p>
          <p>Motivo: {form.motivo}</p>
          <p>
            A operação será auditada. Correções exigem movimentação
            compensatória.
          </p>
          <button className="primary" disabled={busy} onClick={submit}>
            {busy ? "Confirmando…" : "Confirmar operação"}
          </button>
        </Modal>
      )}
    </>
  );
}
