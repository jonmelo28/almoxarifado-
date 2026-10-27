# Almox · Almoxarifado e gestão de tarefas

Aplicação local em português brasileiro: React/Vite, API Express, MySQL existente e Telegram/Telegraf. JavaScript ES Modules. Não utiliza Docker e não instala servidor de banco.

## Funcionalidades

Para duplicar tarefas de um colaborador para outro, use **Copiar para dias ou colaboradores** no planejamento diário (ou copie a seleção). Escolha o **Colaborador de destino** e as datas; **Usar mesmo dia** permite copiar para outra pessoa sem mudar a data. Sem selecionar um destino, cada tarefa mantém seu responsável original. As tarefas originais não são transferidas nem alteradas, e as cópias respeitam a disponibilidade do colaborador de destino.

Para organizar várias tarefas, abra **Planejamento diário** no menu lateral ou **Agenda de tarefas → Planejar dia** (ADM/GESTOR). Escolha a data, cadastre com **Adicionar e continuar** e edite as tarefas pendentes na mesma tela. O responsável permanece selecionado para o próximo cadastro. Use **Copiar para outros dias** em uma tarefa ou selecione várias para copiar em conjunto; adicione as datas de destino ou use **Próximos 7 dias**. As cópias começam pendentes, mantendo os dados de programação e sem histórico/observações de execução. Se houver conflito de horário, nenhuma cópia do lote é salva. É possível copiar até 100 tarefas para até 31 datas, limitado a 200 novas tarefas por operação. A lista é paginada; **Selecionar página** marca somente a página atual.

O ADM pode configurar o Telegram por pessoa em **Permissões do bot**, no menu lateral, ou pelo atalho da lista de colaboradores. Selecione o colaborador, marque as operações e clique em **Salvar permissões**. É possível controlar acesso ao bot, notificações, tarefas, estoque, movimentações e funções administrativas. As opções respeitam o perfil do usuário; **Restaurar padrão do perfil** prepara os acessos originais para salvar. Sem configuração individual, os acessos atuais são mantidos. Alterações são auditadas e bloqueiam também botões antigos e confirmações pendentes. As permissões do portal continuam determinadas pelo perfil. A versão atualizada exige a migração `003_bot_permissions.sql`; reinicie o processo do bot para carregar o novo código. Notificações suspensas permanecem pendentes e podem ser entregues ao reativar o acesso.

O cadastro de materiais gera código numérico sequencial automaticamente, no portal e no Telegram. O código não é editável; materiais antigos mantêm seus códigos. Em instalações existentes, execute `npm run migrate` para aplicar `002_material_codigo.sql` antes de iniciar a versão atualizada. A sequência começa após o maior código numérico existente, ou em 1 quando não houver.

- Login/logout, bcrypt, sessões MySQL, CSRF, rate limiting, cookies HttpOnly, bloqueio imediato na próxima requisição e autorização por perfil.
- Usuários e categorias administrados pelo ADM; catálogo com busca, filtros, paginação e desativação lógica.
- Entradas, saídas, devoluções, ajustes e estornos com transação, SELECT FOR UPDATE, aritmética BigInt em milésimos, idempotência e auditoria atômica.
- Agenda, conflitos de horário, edição de pendentes, início/conclusão/cancelamento e histórico, com isolamento por colaborador.
- Dashboard com dados da API, gráficos, relatórios paginados, CSV protegido contra fórmulas e auditoria consultável.
- Bot privado com vínculo por token de uso único, menus, formulários com expiração e cancelamento, estoque, tarefas, movimentações, consulta administrativa e notificações persistidas.

## Estrutura

```text
backend/src/
  app.js, server.js
  config/       ambiente
  shared/       SQL, transações, validação e regras puras
  modules/      serviços usados pela API e pelo bot
  bot/          comandos, callbacks e notificações
  scripts/      migrações, bootstrap, seed e diagnóstico
backend/tests/  testes unitários, HTTP e integração MySQL opt-in
frontend/src/
  components/, contexts/, hooks/, layouts/, pages/, services/
database/migrations/001_initial.sql
docs/PLANO.md, ARQUITETURA.md, API.md, OPERACAO.md
```

## Iniciar no Windows

Pré-requisitos: Node.js 22.12+ ou 24 LTS, npm, MySQL 8 instalado e em execução. Verifique `node --version`, `npm --version`. Se não estiverem no PATH, configure-o antes dos comandos.

Nesta máquina, é possível habilitar as instalações encontradas para o terminal atual:

```powershell
$env:Path = 'C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Microsoft\VisualStudio\NodeJs;C:\Users\jonatha melo\AppData\Roaming\npm;' + $env:Path
```

```powershell
npm install
Copy-Item .env.example .env
```

Edite `.env` localmente, sem compartilhar senhas no chat ou no Git. Gere SESSION_SECRET aleatório com:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

### MySQL existente

Abra o cliente MySQL/Workbench com sua conta administrativa e execute **uma vez**, escolhendo senhas próprias. Estes comandos são instruções, não são executados automaticamente pela aplicação.

```sql
CREATE DATABASE almoxarifado CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'almoxarifado_app'@'127.0.0.1' IDENTIFIED BY 'SUBSTITUA_POR_SENHA_FORTE';
GRANT SELECT, INSERT, UPDATE, DELETE ON almoxarifado.* TO 'almoxarifado_app'@'127.0.0.1';
CREATE USER 'almoxarifado_migrator'@'127.0.0.1' IDENTIFIED BY 'OUTRA_SENHA_FORTE';
GRANT SELECT, INSERT, UPDATE, CREATE, REFERENCES ON almoxarifado.* TO 'almoxarifado_migrator'@'127.0.0.1';
```

O servidor pode identificar conexões loopback como `localhost`; configure o host da conta conforme sua instalação. Não use root na aplicação. O usuário de exemplo não é presumido existente.

Configure DB_HOST, DB_PORT, DB_NAME, DB_USER e DB_PASSWORD. Para migrar, use temporariamente a conta migrator em variáveis de ambiente do terminal; depois remova as variáveis e mantenha a conta app no `.env`.

```powershell
$env:DB_USER = 'almoxarifado_migrator'
$env:DB_PASSWORD = 'SUA_SENHA_DE_MIGRACAO'
npm run migrate
Remove-Item Env:DB_USER
Remove-Item Env:DB_PASSWORD
```

Migrações verificam banco selecionado, registram checksum e não apagam tabelas. Tabelas inesperadas com os mesmos nomes interrompem o processo. Como DDL MySQL confirma implicitamente, uma migração interrompida exige inspeção manual; o runner não tenta refazer tabelas nem remover dados.

### Primeiro administrador

Configure ADMIN_BOOTSTRAP_EMAIL e ADMIN_BOOTSTRAP_PASSWORD (12–72 caracteres, respeitando o limite bcrypt de 72 bytes). Execute:

```powershell
npm run bootstrap
```

O comando recusa banco com ADM existente e usa lock para impedir bootstrap concorrente. Remova a senha de bootstrap do `.env` depois. Não há credencial padrão. Faça login, cadastre categorias, materiais e colaboradores; o saldo inicial deve ser registrado por ENTRADA.

```powershell
npm run dev
```

Painel: http://localhost:5173. API: http://127.0.0.1:3000/api/v1. Configure FRONTEND_URL com a origem exata usada pelo navegador. Vite encaminha `/api` à API. Backend e frontend separados: `npm run dev -w backend` e `npm run dev -w frontend`. `npm run seed` adiciona somente categorias, exige NODE_ENV=development explícito e não cria saldos ou usuários fictícios.

Essas são as portas padrão. Para usar outras portas, altere o `.env` da raiz e reinicie `npm run dev`. O Vite lê a porta do painel de FRONTEND_URL e encaminha `/api` para a porta definida em PORT. Exemplo: `FRONTEND_URL=http://localhost:5174`, `PORT=3032` e `BOT_PORT=3033`. Acesse o painel em http://localhost:5174; a porta do bot é usada somente no modo webhook.

### Acesso pela rede local

O comando `npm run dev` permite abrir o painel pelo IP da máquina, além de localhost: `http://IP_DA_MAQUINA:5174` quando FRONTEND_URL usa a porta 5174. O Vite escuta em `0.0.0.0` por padrão; FRONTEND_HOST permite alterar esse endereço (use `127.0.0.1` para restringir ao próprio computador). Reinicie `npm run dev` após atualizar a configuração. As chamadas `/api` continuam pelo proxy do painel, e a API permanece em loopback. Outros dispositivos precisam estar na mesma rede e a porta do painel precisa estar permitida no Firewall do Windows.

### Telegram

O vínculo é permanente no MySQL: limpar a conversa ou reiniciar o bot não o remove. Ao reabrir o chat e enviar `/start`, o bot reconhece a conta e mostra o menu, respeitando bloqueios e permissões. Somente o ADM pode remover o vínculo no painel, em **Colaboradores → Revogar vínculo Telegram**, com confirmação. A revogação também invalida os códigos pendentes. Para trocar de conta Telegram, revogue o vínculo e gere um novo código. Um código novo não substitui sozinho um vínculo existente.

Ao iniciar uma tarefa no bot, informe uma justificativa de 5 a 1000 caracteres. A tarefa só muda de status depois do envio válido; no menu ADM, também é necessária a confirmação final. A justificativa é registrada nas observações, no histórico da tarefa e na auditoria. Use `/cancelar` para desistir; a solicitação expira em cinco minutos.

O bot limpa automaticamente as respostas anteriores de navegação e as mensagens de entrada processadas, mantendo a tela atual. Essa limpeza acompanha mensagens desde a inicialização do processo e não apaga dados do sistema. Para reduzir mensagens já acumuladas, envie `/limpar`: o bot tenta apagar os últimos 100 IDs de mensagens da conversa privada e mostra um novo menu. O Telegram normalmente só permite apagar mensagens de até 48 horas; mensagens antigas podem precisar ser removidas manualmente no aplicativo. Falhas na limpeza não impedem as operações. Relatórios em arquivo e notificações enviadas pelo worker não entram no acompanhamento automático, mas podem ser alcançados por `/limpar`.

O ADM também pode gerar o vínculo de outra pessoa: no painel, abra **Colaboradores**, clique em **Gerar vínculo Telegram** na linha desejada e copie o comando para repassar ao colaborador. Ele só precisa enviar o comando no chat privado do bot, sem fazer login no portal. O código vale por 10 minutos e um único uso; gerar outro invalida o anterior. A conta deve estar ativa e desbloqueada. A geração fica registrada na auditoria em nome do ADM.

Crie um bot no BotFather e coloque seu token somente em BOT_TOKEN no `.env`.

```powershell
npm run bot
```

No painel, use o ícone de vínculo junto ao perfil. No chat privado do bot envie `/vincular TOKEN` e depois `/menu`. Token tem validade de 10 minutos, é armazenado apenas por hash e consumido uma vez. Bloqueios e mudanças de papel são verificados em cada comando/callback. `/cancelar` encerra o formulário; formulários expiram em cinco minutos. Execute somente uma instância de polling por token.

Para administradores, `/admin` ou `/menu → Administração completa` abre as operações do portal: cadastros e edições de colaboradores (incluindo perfis, bloqueio, ativação e senha), categorias, materiais, tarefas e configurações; entradas, saídas, devoluções, ajustes e estornos; dashboard, filtros, relatórios CSV e auditoria. Listas são paginadas. Formulários perguntam um campo por vez, aceitam datas DD/MM/AAAA e exigem confirmação final. Envie `-` para manter o valor indicado ou deixar um campo opcional vazio; `/cancelar` abandona a operação. Senhas ficam ocultas na revisão e o bot tenta apagar a mensagem que as contém; a exclusão depende da API do Telegram. Ações administrativas são auditadas com origem `telegram`. Edições recusam versões desatualizadas; confirmações expiram em cinco minutos, só funcionam para o usuário que iniciou e são consumidas uma vez. Não é necessário outro token de bot para o ADM: a conta vinculada precisa ter papel ADM no sistema. Reinicie `npm run bot` depois de atualizar o código. Alterações de nome/horário de tarefa seguem as mesmas restrições do portal (somente pendentes).

Notificações de tarefas, lembretes de 15 minutos e alertas de estoque são processados a cada minuto pelo processo do bot. Detalhes de produção e limitações em [operação](docs/OPERACAO.md).

## Verificar

```powershell
npm test
npm run lint
npm run build
npm run test:e2e
```

Testes HTTP usam armazenamento de sessão em memória e autenticador injetado apenas no teste; produção usa MySQL e bcrypt reais. Os 16 testes de navegador usam Microsoft Edge já instalado e API interceptada, sem dados fictícios na aplicação distribuída. Em outra plataforma, defina PLAYWRIGHT_CHANNEL para um canal instalado compatível. O runner inicia e encerra Vite automaticamente. Para integração, crie e migre um banco exclusivo terminado em `_test`, configure DB_NAME para ele e execute:

```powershell
$env:DB_NAME = 'almoxarifado_test'
$env:RUN_MYSQL_TESTS = '1'
npm run test:integration
Remove-Item Env:RUN_MYSQL_TESTS
Remove-Item Env:DB_NAME
```

Nunca aponte testes de integração ao banco de operação. A suíte cria registros com identificadores únicos e os preserva para inspeção, sem apagar tabelas. `npm run test:integration` sem a variável mostra SKIP explicitamente.

## Resultados nesta máquina

Node 24.12.0 e npm 10.9.2 encontrados fora do PATH; servidor existente anuncia MySQL 8.0.30. Dependências instaladas. A suíte atual tem 60 testes unitários/HTTP/bot aprovados; lint passou. Build React e 16 casos de navegador foram validados nas etapas anteriores. Os bancos `almoxarifado` e `almoxarifado_test` receberam a migração 001. A suíte real de integração MySQL passou (1 teste, zero falhas, zero ignorados), incluindo sessões, concorrência, rollback, auditoria e proteção das alterações administrativas. O primeiro ADM foi criado e login/logout com MySQL real foram validados. SESSION_SECRET seguro foi gerado no `.env`, e a senha de bootstrap foi removida após o uso. As novas operações administrativas do bot foram testadas sem envio de mensagens à rede Telegram. Veja resultados em [PLANO](docs/PLANO.md).

## Limites desta entrega

Migrações e integração MySQL foram validadas. As novas operações administrativas ainda precisam ser exercitadas pelo usuário no chat Telegram após reiniciar o bot. Permissões do portal seguem políticas fixas por papel; o bot permite restrições individuais dentro do perfil. Não há divisão em equipes. CSV exporta a página indicada. O dashboard de consumo conta saídas e agrupa o gráfico por dia UTC; não soma unidades de medida distintas. Instantes de histórico são convertidos para APP_TIMEZONE no painel; horários da agenda são civis nesse fuso. Não há recuperação de senha por email; ADM pode redefinir pelo cadastro. Notificações externas têm entrega pelo menos uma vez, sem garantia de exactly-once após falha de rede.
