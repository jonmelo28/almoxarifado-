import { useState, useEffect } from "react";
import { useData } from "../hooks/useData";
import { api } from "../services/api";
export default function Lookup({
  entity,
  label,
  value,
  onChange,
  required = false,
  active = false,
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const { data, error, loading } = useData(
    `/${entity}?${new URLSearchParams({ q, page: String(page), limit: "20", ...(active ? { ativo: "true" } : {}) })}`,
  );
  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    const controller = new AbortController();
    api
      .get(`/${entity}/${value}`, { signal: controller.signal })
      .then((r) => setSelected(r.data))
      .catch(() => {});
    return () => controller.abort();
  }, [entity, value]);
  const options = data?.data || [];
  const display = (r) =>
    entity === "materiais"
      ? `${r.codigo} · ${r.nome} (${r.saldo} ${r.unidade})`
      : entity === "tarefas"
        ? `#${r.id} · ${r.titulo}`
        : `${r.nome} · #${r.id}`;
  return (
    <div className="field lookup">
      <label>
        <span>{label}</span>
        <input
          type="search"
          aria-label={`Pesquisar ${label}`}
          placeholder="Pesquisar…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <select
        aria-label={label}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{loading ? "Carregando…" : "Selecione"}</option>
        {selected && !options.some((r) => r.id === Number(value)) && (
          <option value={selected.id}>{display(selected)}</option>
        )}
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {display(r)}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
      <div className="lookup-pages">
        <small>
          {data?.total || 0} resultado(s) · página {page}
        </small>
        <button
          type="button"
          disabled={page === 1}
          aria-label={`Página anterior de ${label}`}
          onClick={() => setPage(page - 1)}
        >
          ←
        </button>
        <button
          type="button"
          disabled={!data || page * 20 >= data.total}
          aria-label={`Próxima página de ${label}`}
          onClick={() => setPage(page + 1)}
        >
          →
        </button>
      </div>
    </div>
  );
}
