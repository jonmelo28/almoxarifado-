import axios from "axios";
export const api = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  timeout: 20000,
});
let csrf;
export const setCsrf = (token) => {
  csrf = token;
};
let appTimezone = "America/Sao_Paulo";
export const setTimezone = (timezone) => {
  appTimezone = timezone || "America/Sao_Paulo";
};
export async function initCsrf() {
  csrf = (await api.get("/auth/csrf")).data.token;
}
api.interceptors.request.use(async (request) => {
  if (!["get", "head", "options"].includes(request.method)) {
    if (!csrf) await initCsrf();
    request.headers["X-CSRF-Token"] = csrf;
  }
  return request;
});
export const errorText = (error) =>
  error.response?.data?.issues
    ?.map((i) => `${i.campo || "Formulário"}: ${i.mensagem}`)
    .join(" · ") ||
  error.response?.data?.error ||
  "Não foi possível conectar à API. Verifique se o backend está em execução.";
export const date = (s) =>
  s ? s.slice(0, 10).split("-").reverse().join("/") : "—";
export const time = (s) => s?.slice(0, 5) || "—";
export const localDay = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: appTimezone }).format(
    new Date(),
  );
export const instant = (value) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: appTimezone,
        dateStyle: "short",
        timeStyle: "short",
      }).format(
        new Date(value.replace(" ", "T") + (value.endsWith("Z") ? "" : "Z")),
      )
    : "—";
export const number = (value) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
