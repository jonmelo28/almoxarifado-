import { Link } from "react-router-dom";
import {
  Package,
  TriangleAlert,
  CalendarCheck,
  Users,
  ArrowUpRight,
  Plus,
  ArrowDownToLine,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import { useData } from "../hooks/useData";
import { useAuth } from "../contexts/Auth";
import { Title, Loading, Notice, Badge, Empty } from "../components/UI";
import { date, time } from "../services/api";
export default function Dashboard() {
  const { user } = useAuth();
  const { data: d, error, loading } = useData("/dashboard");
  const { data: agenda } = useData(
    `/tarefas?limit=6${d ? `&data_programada=${d.data}` : ""}`,
  );
  if (loading) return <Loading />;
  if (error) return <Notice error>{error}</Notice>;
  const count = d.tarefas.reduce((n, t) => n + Number(t.total), 0);
  const done = Number(
    d.tarefas.find((t) => t.status === "CONCLUIDA")?.total || 0,
  );
  const cards = [
    [
      "Materiais ativos",
      d.materiais,
      Package,
      "blue",
      "Catálogo do almoxarifado",
    ],
    [
      "Abaixo do mínimo",
      d.estoque_baixo,
      TriangleAlert,
      "amber",
      "Materiais que precisam de atenção",
    ],
    [
      "Tarefas do dia",
      count,
      CalendarCheck,
      "teal",
      `${done} concluídas · ${d.atrasadas} atrasadas`,
    ],
    ...(d.colaboradores !== null
      ? [
          [
            "Colaboradores ativos",
            d.colaboradores,
            Users,
            "purple",
            "Equipe disponível",
          ],
        ]
      : []),
  ];
  return (
    <>
      <Title
        eyebrow="SEU DIA, EM UM SÓ LUGAR"
        title="Visão geral"
        description={`Acompanhe seu estoque e a programação da equipe · ${date(d.data)}`}
      >
        <Link className="button" to="/movimentacoes/nova?tipo=SAIDA">
          <ArrowDownToLine size={17} /> Registrar saída
        </Link>
        {user.papel !== "COLABORADOR" && (
          <Link className="button primary" to="/tarefas/nova">
            <Plus size={17} /> Nova tarefa
          </Link>
        )}
      </Title>
      <div className="stats">
        {cards.map(([label, value, Icon, color, note]) => (
          <article className="stat" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <div className={`stat-icon ${color}`}>
                <Icon size={21} />
              </div>
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <div className="daily-summary" aria-label="Resumo de hoje">
        <strong>Movimentações de hoje</strong>
        <span>
          Entradas:{" "}
          <b>{d.movimentacoes.find((m) => m.tipo === "ENTRADA")?.total || 0}</b>
        </span>
        <span>
          Saídas:{" "}
          <b>{d.movimentacoes.find((m) => m.tipo === "SAIDA")?.total || 0}</b>
        </span>
        <span>
          Pendentes:{" "}
          <b>{d.tarefas.find((t) => t.status === "PENDENTE")?.total || 0}</b>
        </span>
        <span>
          Concluídas: <b>{done}</b>
        </span>
      </div>
      {Number(d.estoque_baixo) > 0 && (
        <Link to="/materiais?baixo=true" className="stock-alert">
          <TriangleAlert size={20} />
          <div>
            <strong>Estoque precisa de atenção</strong>
            <span>
              {d.estoque_baixo} material(is) abaixo do estoque mínimo.
            </span>
          </div>
          <ArrowUpRight size={20} />
        </Link>
      )}
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Consumo de materiais</h2>
              <p>Quantidade de saídas registradas · últimos 7 dias (UTC)</p>
            </div>
            <span className="tag">7 dias</span>
          </div>
          {d.consumo.length ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.consumo}>
                  <defs>
                    <linearGradient id="blue" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#377de4"
                        stopOpacity={0.25}
                      />
                      <stop offset="100%" stopColor="#377de4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#edf0f5" />
                  <XAxis
                    dataKey="data"
                    tickFormatter={(s) =>
                      s.slice(5).split("-").reverse().join("/")
                    }
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Saídas"
                    stroke="#377de4"
                    fill="url(#blue)"
                    strokeWidth={3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Execução de tarefas</h2>
              <p>Programação de hoje</p>
            </div>
          </div>
          {d.tarefas.length ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.tarefas}>
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(s) => s.replaceAll("_", " ")}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar
                    dataKey="total"
                    name="Tarefas"
                    fill="#229f91"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty />
          )}
        </section>
      </div>
      <section className="panel agenda">
        <div className="panel-heading">
          <div>
            <h2>Agenda de hoje</h2>
            <p>Próximos passos da sua operação</p>
          </div>
          <Link to="/tarefas">
            Ver agenda <ArrowUpRight size={15} />
          </Link>
        </div>
        {agenda?.data.length ? (
          agenda.data.map((t) => (
            <Link className="agenda-row" key={t.id} to={`/tarefas/${t.id}`}>
              <div className="agenda-time">
                {time(t.hora_inicio)}
                <small>{time(t.hora_fim)}</small>
              </div>
              <div className="agenda-task">
                <strong>{t.titulo}</strong>
                <span>{t.responsavel}</span>
              </div>
              <Badge value={t.prioridade} />
              <Badge value={t.status} />
              <ArrowUpRight size={18} />
            </Link>
          ))
        ) : (
          <Empty />
        )}
      </section>
    </>
  );
}
