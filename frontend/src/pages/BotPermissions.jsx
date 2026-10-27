import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/Auth";
import Lookup from "../components/Lookup";
import { Title, Notice, Loading } from "../components/UI";
import { api, errorText } from "../services/api";

function PermissionEditor({ userId }) {
  const [data, setData] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api
      .get(`/usuarios/${userId}/permissoes-bot`, { signal: controller.signal })
      .then(({ data }) => {
        setData(data);
        setPermissions(data.permissoes);
      })
      .catch((error) => {
        if (error.code !== "ERR_CANCELED") setError(errorText(error));
      });
    return () => controller.abort();
  }, [userId]);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.patch(`/usuarios/${userId}/permissoes-bot`, {
        versao: data.versao,
        permissoes: permissions,
      });
      setData(result.data);
      setPermissions(result.data.permissoes);
      setSuccess(
        "Permissões salvas. A alteração vale na próxima interação com o bot.",
      );
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  if (!data) return error ? <Notice error>{error}</Notice> : <Loading />;
  const groups = [...new Set(data.catalogo.map((item) => item.group))];
  return (
    <form className="panel form-panel bot-permissions" onSubmit={save}>
      <h2>
        {data.usuario.nome} · {data.usuario.papel}
      </h2>
      <p>
        Marque as operações permitidas no Telegram. Opções indisponíveis exigem
        outro perfil. Desativar o acesso ao bot também suspende suas
        notificações.
      </p>
      <p>
        Para acessar os botões de iniciar e concluir, mantenha também a consulta
        de tarefas habilitada.
      </p>
      <Notice error>{error}</Notice>
      <Notice>{success}</Notice>
      <fieldset disabled={busy} aria-label="Operações permitidas no bot">
        <div className="form-grid">
          {groups.map((group) => (
            <section className="permission-group" key={group}>
              <h3>{group}</h3>
              {data.catalogo
                .filter((item) => item.group === group)
                .map((item) => (
                  <label className="check" key={item.key}>
                    <input
                      type="checkbox"
                      checked={Boolean(permissions[item.key])}
                      disabled={
                        !item.disponivel ||
                        (item.key !== "acessar_bot" && !permissions.acessar_bot)
                      }
                      onChange={(event) => {
                        setPermissions((current) => ({
                          ...current,
                          [item.key]: event.target.checked,
                        }));
                        setSuccess("");
                      }}
                    />
                    {item.label}
                    {!item.disponivel && " (indisponível para este perfil)"}
                  </label>
                ))}
            </section>
          ))}
        </div>
        <div className="form-footer">
          <button
            type="button"
            onClick={() => {
              setPermissions(
                Object.fromEntries(
                  data.catalogo.map((item) => [item.key, item.disponivel]),
                ),
              );
              setSuccess("");
            }}
          >
            Restaurar padrão do perfil
          </button>
          <button className="primary" type="submit">
            {busy ? "Salvando…" : "Salvar permissões"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export default function BotPermissions() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const userId = params.get("usuario") || "";
  if (user.papel !== "ADM")
    return <Notice error>Acesso não autorizado.</Notice>;
  return (
    <>
      <Title
        title="Permissões do bot"
        description="Defina o acesso ao Telegram para cada colaborador."
      />
      <section className="panel form-panel">
        <Lookup
          entity="usuarios"
          label="Colaborador"
          value={userId}
          onChange={(value) => setParams(value ? { usuario: value } : {})}
        />
      </section>
      {userId ? (
        <PermissionEditor key={userId} userId={userId} />
      ) : (
        <Notice>Selecione um colaborador para configurar as permissões.</Notice>
      )}
    </>
  );
}
