import {
  LoaderCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Inbox,
} from "lucide-react";
import { useEffect, useRef } from "react";
export function Notice({ error, children }) {
  return children ? (
    <div
      role={error ? "alert" : "status"}
      className={`notice ${error ? "error" : "success"}`}
    >
      {children}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} /> Carregando dados…
    </div>
  );
}
export function Empty() {
  return (
    <div className="empty">
      <Inbox size={35} />
      <strong>Nenhum registro encontrado</strong>
      <span>Altere os filtros ou cadastre um novo registro.</span>
    </div>
  );
}
export function Badge({ value }) {
  return (
    <span className={`badge ${String(value).toLowerCase()}`}>
      {String(value).replaceAll("_", " ")}
    </span>
  );
}
export function Title({ eyebrow = "OPERAÇÕES", title, description, children }) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Field({ label, children, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}
export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("button,input,select,textarea")?.focus();
    return () => previous?.focus();
  }, []);
  function keys(e) {
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") {
      const nodes = [
        ...ref.current.querySelectorAll(
          "button:not(:disabled),input,select,textarea,a[href]",
        ),
      ];
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={keys}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Fechar"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Toolbar({ q, setQ, children }) {
  return (
    <div className="toolbar">
      <label className="search">
        <Search size={18} />
        <input
          aria-label="Pesquisar"
          placeholder="Pesquisar registros…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {children}
    </div>
  );
}
export function Pagination({ page, setPage, total = 0, limit = 20 }) {
  return (
    <div className="pagination">
      <span>
        {total} registro(s) · Página {page} de{" "}
        {Math.max(1, Math.ceil(total / limit))}
      </span>
      <div>
        <button
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          aria-label="Próxima página"
          disabled={page * limit >= total}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
export function DataTable({ columns, rows }) {
  return !rows?.length ? (
    <Empty />
  ) : (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.render ? c.render(r) : (r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
