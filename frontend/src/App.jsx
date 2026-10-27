import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/Auth";
import { Loading } from "./components/UI";
import Layout from "./layouts/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Records from "./pages/Records";
import RecordForm, { MovementForm } from "./pages/Forms";
import { TaskDetail, Reports, Settings } from "./pages/Operations";
import BotPermissions from "./pages/BotPermissions";
import TaskPlanner from "./pages/TaskPlanner";
function Private() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <Layout /> : <Navigate to="/login" replace />;
}
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Private />}>
            <Route index element={<Dashboard />} />
            {[
              "materiais",
              "usuarios",
              "tarefas",
              "movimentacoes",
              "auditoria",
            ].map((entity) => (
              <Route
                key={entity}
                path={"/" + entity}
                element={<Records key={entity} entity={entity} />}
              />
            ))}
            {["materiais", "usuarios", "tarefas"].map((entity) => (
              <Route
                key={entity}
                path={"/" + entity + "/nova"}
                element={<RecordForm key={entity + "new"} entity={entity} />}
              />
            ))}
            {["materiais", "usuarios", "tarefas"].map((entity) => (
              <Route
                key={entity}
                path={"/" + entity + "/:id/editar"}
                element={<RecordForm key={entity + "edit"} entity={entity} />}
              />
            ))}
            <Route path="/tarefas/:id" element={<TaskDetail />} />
            <Route path="/tarefas/planejamento" element={<TaskPlanner />} />
            <Route path="/movimentacoes/nova" element={<MovementForm />} />
            <Route path="/relatorios" element={<Reports />} />
            <Route path="/configuracoes" element={<Settings />} />
            <Route path="/permissoes-bot" element={<BotPermissions />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
