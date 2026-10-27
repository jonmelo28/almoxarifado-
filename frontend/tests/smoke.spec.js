import { test, expect } from "@playwright/test";
// Dados exclusivos de teste: a aplicação distribuída não possui modo demo ou fallback fictício.
const user = {
  id: 1,
  nome: "Administrador de teste",
  papel: "ADM",
  ativo: true,
  bloqueado: false,
};
const material = {
  id: 1,
  codigo: "MAT-001",
  nome: "Luva de teste",
  categoria: "EPI",
  categoria_id: 1,
  descricao: "Material teste",
  unidade: "UN",
  saldo: "10.000",
  estoque_minimo: "2.000",
  ativo: true,
};
const task = {
  id: 1,
  titulo: "Inspeção de teste",
  descricao: "Conferir equipamento",
  responsavel: "Teste",
  responsavel_id: 1,
  data_programada: "2026-10-23",
  hora_inicio: "08:00:00",
  hora_fim: "09:00:00",
  prioridade: "MEDIA",
  status: "PENDENTE",
  observacoes: "",
  historico: [],
};
const collection = (data) => ({ data, total: data.length, page: 1, limit: 20 });
test("relatórios exibem inteiros sem zeros decimais e frações com vírgula", async ({
  page,
}) => {
  await page.route("**/api/v1/relatorios/estoque?*", (route) =>
    route.fulfill({
      json: collection([
        { ...material, saldo: "1.000", estoque_minimo: "1.250" },
      ]),
    }),
  );
  await page.route("**/api/v1/relatorios/consumo?*", (route) =>
    route.fulfill({
      json: collection([
        {
          material: "Luva",
          tipo: "SAIDA",
          quantidade: "1.000",
          responsavel: "Teste",
          motivo: "Consumo teste",
        },
      ]),
    }),
  );
  await page.goto("/relatorios");
  await expect(
    page.getByRole("cell", { name: "1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "1,25", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "1.000", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Relatório", exact: true })
    .selectOption("consumo");
  await expect(
    page.getByRole("cell", { name: "1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "1.000", exact: true }),
  ).toHaveCount(0);
});
test("ADM revoga vínculo somente após confirmar no painel", async ({
  page,
}) => {
  let revoked = false;
  await page.route(/\/api\/v1\/usuarios(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: collection([{ ...user, telegram_id: revoked ? null : 99 }]),
    }),
  );
  await page.route("**/api/v1/usuarios/1/telegram-vinculo", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    revoked = true;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/usuarios");
  await page
    .getByRole("button", {
      name: "Revogar vínculo Telegram de Administrador de teste",
    })
    .click();
  expect(revoked).toBe(false);
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(revoked).toBe(false);
  await page
    .getByRole("button", {
      name: "Revogar vínculo Telegram de Administrador de teste",
    })
    .click();
  await page.getByRole("button", { name: "Confirmar revogação" }).click();
  await expect(page.getByText("Não vinculado", { exact: true })).toBeVisible();
  expect(revoked).toBe(true);
});
test("ADM seleciona permissões do bot e salva por usuário", async ({
  page,
}) => {
  const config = {
    usuario: { id: 1, nome: "Administrador de teste", papel: "ADM" },
    versao: 0,
    permissoes: {
      acessar_bot: true,
      estoque_ver: true,
      usuarios_editar: false,
    },
    catalogo: [
      {
        key: "acessar_bot",
        label: "Acessar o bot",
        group: "Acesso",
        disponivel: true,
      },
      {
        key: "estoque_ver",
        label: "Consultar estoque",
        group: "Estoque",
        disponivel: true,
      },
      {
        key: "usuarios_editar",
        label: "Cadastrar colaboradores",
        group: "Administração",
        disponivel: false,
      },
    ],
  };
  let saved;
  await page.route("**/api/v1/usuarios/1/permissoes-bot", async (route) => {
    if (route.request().method() === "PATCH") {
      saved = route.request().postDataJSON();
      config.permissoes = saved.permissoes;
      config.versao++;
    }
    await route.fulfill({ json: config });
  });
  await page.goto("/permissoes-bot?usuario=1");
  await expect(
    page.getByRole("heading", { name: "Permissões do bot", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Cadastrar colaboradores/ }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Consultar estoque", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Salvar permissões" }).click();
  await expect(page.getByText(/Permissões salvas/)).toBeVisible();
  expect(saved.permissoes.estoque_ver).toBe(false);
  expect(saved.versao).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Consultar estoque", exact: true }),
  ).not.toBeChecked();
});
test("colaborador não acessa tela administrativa de permissões", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: { user: { ...user, papel: "COLABORADOR" }, csrf: "test-csrf" },
    }),
  );
  await page.goto("/permissoes-bot");
  await expect(
    page.getByText("Acesso não autorizado.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Permissões do bot", exact: true }),
  ).toHaveCount(0);
});
test("material novo recebe código automático sem envio pelo formulário", async ({
  page,
}) => {
  let payload;
  await page.route("**/api/v1/materiais", async (route) => {
    if (route.request().method() === "POST") {
      payload = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { id: 2, codigo: "2" } });
    } else await route.fulfill({ json: collection([material]) });
  });
  await page.goto("/materiais/nova");
  await expect(page.getByLabel("Código do material")).toHaveAttribute(
    "readonly",
    "",
  );
  await page.getByLabel("Nome do material").fill("Material automático");
  await page
    .getByRole("combobox", { name: "Categoria", exact: true })
    .selectOption("1");
  await page.getByRole("button", { name: /Salvar cadastro/ }).click();
  await expect(page).toHaveURL(/\/materiais$/);
  expect(payload).not.toHaveProperty("codigo");
});
test("ADM gera comando Telegram para o colaborador sem login dele", async ({
  page,
}) => {
  await page.route("**/api/v1/usuarios/1/telegram-token", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      status: 201,
      json: { token: "codigo-colaborador-teste", expira_em_minutos: 10 },
    });
  });
  await page.goto("/usuarios");
  await page
    .getByRole("button", {
      name: "Gerar vínculo Telegram para Administrador de teste",
    })
    .click();
  await expect(
    page.getByText("/vincular codigo-colaborador-teste", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/sem precisar acessar o portal/)).toBeVisible();
});
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let data;
    if (path === "/auth/me")
      data = { user, csrf: "test-csrf", timezone: "America/Sao_Paulo" };
    else if (path === "/auth/csrf") data = { token: "test-csrf" };
    else if (path === "/categorias") data = [{ id: 1, nome: "EPI" }];
    else if (path === "/configuracoes") data = { permitir_sobreposicao: false };
    else if (path === "/dashboard")
      data = {
        materiais: 1,
        estoque_baixo: 0,
        colaboradores: 1,
        atrasadas: 0,
        tarefas: [{ status: "PENDENTE", total: 1 }],
        movimentacoes: [],
        consumo: [],
        data: "2026-10-23",
      };
    else if (path === "/materiais/1") data = material;
    else if (path === "/usuarios/1")
      data = {
        ...user,
        email: "teste@example.com",
        identificacao: "T01",
        telegram_id: null,
      };
    else if (path === "/tarefas/1") data = task;
    else if (path === "/materiais" || path === "/relatorios/estoque")
      data = collection([material]);
    else if (path === "/usuarios")
      data = collection([
        { ...user, email: "teste@example.com", identificacao: "T01" },
      ]);
    else if (path === "/tarefas") data = collection([task]);
    else data = collection([]);
    await route.fulfill({ json: data });
  });
});
for (const [path, title] of [
  ["/", "Visão geral"],
  ["/materiais", "Materiais"],
  ["/usuarios", "Colaboradores"],
  ["/tarefas", "Agenda de tarefas"],
  ["/movimentacoes", "Movimentações"],
  ["/auditoria", "Auditoria"],
  ["/relatorios", "Relatórios"],
  ["/configuracoes", "Configurações"],
  ["/materiais/nova", "Novo cadastro · Material"],
  ["/usuarios/nova", "Novo cadastro · Colaborador"],
  ["/tarefas/nova", "Novo cadastro · Tarefa"],
  ["/materiais/1/editar", "Editar · Material"],
  ["/tarefas/1", "Inspeção de teste"],
  ["/movimentacoes/nova?tipo=SAIDA", "Registrar movimentação"],
]) {
  test(`tela ${path} renderiza sem erro JavaScript`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    if (path.includes("/nova") || path.includes("/editar"))
      await expect(page.locator("form")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
test("formulário de saída revisa valores antes de enviar", async ({ page }) => {
  await page.goto("/movimentacoes/nova?tipo=SAIDA");
  await page
    .getByRole("combobox", { name: "Material", exact: true })
    .selectOption("1");
  await page.getByLabel("Quantidade", { exact: true }).fill("2");
  await page.getByLabel("Motivo / justificativa").fill("Consumo de teste");
  await page.getByRole("button", { name: "Revisar movimentação" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Quantidade: 2 UN");
});
test("menu funciona em celular", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Materiais", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Materiais", exact: true }),
  ).toBeVisible();
});
