import { test, expect } from "@playwright/test";
const day = "2030-01-01";
const user = {
  id: 1,
  nome: "Pessoa teste",
  papel: "ADM",
  ativo: true,
  bloqueado: false,
};
const sample = (id, titulo) => ({
  id,
  titulo,
  responsavel_id: 1,
  responsavel: user.nome,
  descricao: "Conferir itens",
  observacoes: "",
  data_programada: day,
  hora_inicio: id === 1 ? "08:00" : "09:00",
  hora_fim: id === 1 ? "09:00" : "10:00",
  prioridade: "MEDIA",
  status: "PENDENTE",
  atualizado_em: "2030-01-01 00:00:00.000",
});
async function setup(page, tasks = []) {
  const state = { tasks, copies: null, version: null };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    let data;
    if (path === "/auth/me") data = { user, csrf: "csrf-test" };
    else if (path === "/auth/csrf") data = { token: "csrf-test" };
    else if (path === "/usuarios/1") data = user;
    else if (path === "/usuarios") data = { data: [user], total: 1 };
    else if (path === "/tarefas/duplicar") {
      state.copies = request.postDataJSON();
      data = { total: state.copies.tarefas.length * state.copies.dias.length };
    } else if (path === "/tarefas" && request.method() === "POST") {
      const task = {
        ...sample(state.tasks.length + 1, ""),
        ...request.postDataJSON(),
      };
      state.tasks.push(task);
      data = { id: task.id };
    } else if (/^\/tarefas\/\d+$/.test(path)) {
      const id = Number(path.split("/").pop());
      const task = state.tasks.find((task) => task.id === id);
      if (request.method() === "PATCH") {
        state.version = request.headers()["x-record-version"];
        Object.assign(task, request.postDataJSON());
      }
      data = task;
    } else if (path === "/tarefas") {
      const tasks = state.tasks.filter(
        (task) =>
          task.data_programada === url.searchParams.get("data_programada"),
      );
      data = { data: tasks, total: tasks.length };
    } else data = {};
    await route.fulfill({ json: data });
  });
  return state;
}
test("planejamento cadastra tarefas em sequência e edita sem sair do dia", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto(`/tarefas/planejamento?dia=${day}`);
  await page
    .getByRole("combobox", { name: "Responsável pela tarefa", exact: true })
    .selectOption("1");
  await page
    .getByLabel("Título da tarefa", { exact: true })
    .fill("Primeira tarefa");
  await page.getByRole("button", { name: "Adicionar e continuar" }).click();
  await expect(page.getByText(/Tarefa adicionada/)).toBeVisible();
  await expect(
    page.getByLabel("Título da tarefa", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", {
      name: "Responsável pela tarefa",
      exact: true,
    }),
  ).toHaveValue("1");
  await page
    .getByLabel("Título da tarefa", { exact: true })
    .fill("Segunda tarefa");
  await page.getByLabel("Início", { exact: true }).fill("09:00");
  await page.getByLabel("Fim", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Adicionar e continuar" }).click();
  await expect(page.locator("article.planner-task")).toHaveCount(2);
  await page
    .locator("article.planner-task")
    .filter({ hasText: "Primeira tarefa" })
    .getByRole("button", { name: "Editar tarefa", exact: true })
    .click();
  await page
    .getByLabel("Título da tarefa", { exact: true })
    .fill("Primeira revisada");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(
    page.getByText("Tarefa atualizada.", { exact: true }),
  ).toBeVisible();
  expect(state.tasks[0].titulo).toBe("Primeira revisada");
  expect(state.version).toBe("2030-01-01 00:00:00.000");
  expect(state.tasks.every((task) => task.data_programada === day)).toBe(true);
});
test("planejamento copia seleção para várias datas sem datas duplicadas", async ({
  page,
}) => {
  const state = await setup(page, [
    sample(1, "Inspeção"),
    sample(2, "Limpeza"),
  ]);
  await page.goto(`/tarefas/planejamento?dia=${day}`);
  await page.getByRole("checkbox", { name: "Selecionar página" }).check();
  await page.getByRole("button", { name: "Copiar selecionadas (2)" }).click();
  await page.getByRole("button", { name: "Adicionar data" }).click();
  await page.getByRole("button", { name: "Adicionar data" }).click();
  await page.getByLabel("Data de destino", { exact: true }).fill("2030-01-03");
  await page.getByRole("button", { name: "Adicionar data" }).click();
  await page.getByRole("button", { name: "Confirmar cópia" }).click();
  await expect(page.getByText(/4 tarefa\(s\) copiadas/)).toBeVisible();
  expect(state.copies).toEqual({
    tarefas: [1, 2],
    dias: ["2030-01-02", "2030-01-03"],
  });
});
test("conflito de cópia mantém seleção e informa erro", async ({ page }) => {
  await setup(page, [sample(1, "Inspeção")]);
  await page.route("**/api/v1/tarefas/duplicar", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Conflito de horário. Nenhuma cópia foi criada." },
    }),
  );
  await page.goto(`/tarefas/planejamento?dia=${day}`);
  await page
    .getByRole("button", { name: "Copiar para dias ou colaboradores" })
    .click();
  await page.getByRole("button", { name: "Adicionar data" }).click();
  await page.getByRole("button", { name: "Confirmar cópia" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Nenhuma cópia foi criada",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("copia para outro colaborador no mesmo dia", async ({ page }) => {
  const state = await setup(page, [sample(1, "Inspeção")]);
  await page.route("**/api/v1/usuarios?*", (route) =>
    route.fulfill({
      json: {
        data: [user, { ...user, id: 2, nome: "Outro colaborador" }],
        total: 2,
      },
    }),
  );
  await page.goto(`/tarefas/planejamento?dia=${day}`);
  await page
    .getByRole("button", { name: "Copiar para dias ou colaboradores" })
    .click();
  await expect(
    page.getByRole("button", { name: "Usar mesmo dia" }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", {
      name: "Colaborador de destino (opcional)",
      exact: true,
    })
    .selectOption("2");
  await page.getByRole("button", { name: "Usar mesmo dia" }).click();
  await page.getByRole("button", { name: "Confirmar cópia" }).click();
  await expect(page.getByText(/1 tarefa\(s\) copiadas/)).toBeVisible();
  expect(state.copies).toEqual({
    tarefas: [1],
    dias: [day],
    responsavel_id: 2,
  });
});
test("planejamento funciona em celular e navega entre dias", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, [sample(1, "Inspeção")]);
  await page.goto(`/tarefas/planejamento?dia=${day}`);
  await expect(
    page.getByRole("heading", { name: "Planejamento diário", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dia seguinte", exact: true }).click();
  await expect(
    page.getByLabel("Dia do planejamento", { exact: true }),
  ).toHaveValue("2030-01-02");
  await expect(page.getByText(/Nenhuma tarefa neste dia/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
