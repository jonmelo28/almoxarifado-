# Plano de implementação

Aplicação local em JavaScript ES Modules, sem Docker. O workspace estava vazio na inspeção inicial.

1. Documentação, configuração e migrações não destrutivas.
2. Login, sessões MySQL, CSRF, bootstrap e autorização.
3. Usuários, categorias e materiais.
4. Livro de movimentações com bloqueio de linha, decimais exatos, idempotência e auditoria.
5. Agenda, conflitos serializados por colaborador e histórico de tarefas.
6. API, relatórios e testes.
7. Painel React responsivo integrado à API.
8. Telegram com vínculo de uso único e regras compartilhadas.
9. Verificações e documentação operacional.

## Critérios de entrega

Saldo nunca editável por CRUD; colaborador acessa apenas seus registros; alterações e auditoria na mesma transação. Não simular números no painel. Integrações reais dependem de credenciais fornecidas localmente.

## Ambiente

Node e npm inicialmente ausentes do PATH. Encontrados Node 24.12.0 no Visual Studio e npm 10.9.2 no perfil. Servidor existente respondeu em 127.0.0.1:3306, anunciando MySQL 8.0.30. Nenhum servidor foi instalado ou reiniciado.

## Estado das etapas

| Fase | Entrega e verificação                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Estrutura, configuração, arquitetura e migração criadas. Instalação npm concluída. Acesso ao banco recusado para usuário de exemplo; nenhuma tabela criada.                                     |
| 2    | Login, logout, CSRF, perfis, sessão persistente e bootstrap implementados. Testes HTTP passaram com dependências de identidade/sessão isoladas. Persistência MySQL depende de credenciais.      |
| 3    | Usuários, categorias e materiais integrados à API e aos formulários. Validadores e bloqueio de campos sensíveis testados.                                                                       |
| 4    | Serviço de estoque transacional, DECIMAL/BigInt, idempotência, estorno e auditoria implementados. Aritmética e validações testadas; concorrência/rollback SQL aguardam banco dedicado de teste. |
| 5    | Agenda, bloqueio de conflitos por responsável, transições e histórico implementados. Máquina de estados e datas testadas.                                                                       |
| 6    | API versionada, paginação e exportação CSV implementadas. Suíte unitária/HTTP/bot: 39 testes passaram. Integração MySQL opt-in: 1 teste ignorado (SKIP), não validado.                          |
| 7    | Painel React, 14 telas verificadas em Edge headless com API controlada. Testados também modal de saída e menu móvel. Build de produção passou.                                                  |
| 8    | Bot separado com serviços compartilhados, vínculos, formulários, menus e outbox. Quatro testes de callbacks passaram sem conexão externa. Falta BOT_TOKEN para validação real.                  |
| 9    | Lint passou, build passou; erro de mínimo/passo na quantidade inteira encontrado pelo teste de navegador e corrigido. Testes de navegador não substituem integração real com MySQL.             |
| 10   | README, API, instruções de MySQL existente, bootstrap, HTTPS, backups e restauração documentados. Publicação e operação real dependem de ambiente configurado.                                  |

## Comandos executados

- Instalação via npm com cache restrito a `.runtime/npm-cache`.
- `npm test`: 39 passaram, zero falhas.
- `npm run lint`: passou.
- `npm run build`: passou, arquivos em frontend/dist; gráficos separados em chunk próprio.
- `npm run test:integration`: 1 SKIP explícito, sem execução SQL de teste.
- `npm run migrate`: interrompido com ER_ACCESS_DENIED_ERROR; sem credenciais e sem alteração de tabelas.
- `node backend/src/scripts/diagnose.js`: confirmou versão anunciada 8.0.30.
- `npm run test:e2e`: 16 passaram, zero falhas, saída 0 (16,9 segundos), com API interceptada. Runner dedicado mantém Vite no mesmo processo para encerramento confiável no Windows.

## Pendências reais

Primeiro ADM criado e login validado. BOT_TOKEN configurado e identidade validada em 24/10/2026. Falta exercitar `/admin` com uma conta ADM vinculada e verificar a entrega real de notificações.

## Validação após configuração do .env

Esta execução substitui as limitações de banco registradas na entrega inicial acima:

- A primeira tentativa encontrou ER_BAD_DB_ERROR: o banco configurado ainda não existia.
- Criados somente `almoxarifado` e `almoxarifado_test`, sem instalar ou reiniciar servidor e sem remover bancos existentes.
- Migração `001_initial.sql` aplicada com sucesso nos dois bancos.
- Suíte MySQL real: 1 teste passou, zero falhas, zero ignorados. Validou login/logout, sessões persistidas, dashboard, concorrência de saídas, estoque insuficiente, idempotência, rollback, auditoria, conflitos/transições de tarefas e consumo único do token de vínculo, sem conectar à rede Telegram.
- Verificação no banco principal: health 200, emissão de CSRF 200 e acesso privado sem login 401. Nenhum ADM criado nem dados de teste de negócio inseridos no banco principal.
- SESSION_SECRET não atendia ao mínimo; gerado valor aleatório seguro diretamente no `.env`, sem exposição no terminal.
- Bootstrap tentado, mas interrompido pela validação de email/senha ausentes ou inválidos. BOT_TOKEN também não configurado. Essas configurações continuam pendentes do usuário.
- Dados da suíte preservados exclusivamente em `almoxarifado_test` para inspeção, conforme política documentada.

## Bootstrap concluído

- Após correção da senha para o mínimo exigido, `npm run bootstrap` criou o primeiro ADM com sucesso.
- Verificação HTTP com MySQL real: login 200, dashboard 200, consulta administrativa de usuários 200, logout 204 e sessão encerrada confirmada por 401.
- Credenciais não foram exibidas. ADMIN_BOOTSTRAP_PASSWORD removida do `.env` após a validação; o hash bcrypt de login permanece no banco.

## Portas locais configuráveis

- Corrigido o proxy fixo para a porta 3000: Vite agora lê PORT e FRONTEND_URL do `.env` da raiz, com strictPort para evitar troca silenciosa da porta do painel.
- Configuração atual validada: painel localhost:5174, API 127.0.0.1:3032. BOT_PORT=3033 permanece independente, usada no webhook.
- Verificação pela origem real do painel: health e CSRF 200, rota privada sem autenticação 401. Tela de login carregada no Edge headless, sem erros JavaScript.
- Lint e build executados após a correção.

## Administração completa pelo Telegram

- Adicionado `backend/src/bot/admin.js`, registrado em `createBot.js`, com `/admin` e botão exclusivo ADM em `/menu`.
- Incluídos cadastros/edições de usuários, categorias, materiais e tarefas; bloqueio e alteração de perfis; movimentações, ajustes e estornos; transições/cancelamento de tarefas; configuração de sobreposição, dashboard, auditoria, filtros e relatórios CSV paginados.
- Formulários guiados reutilizam Zod e serviços do portal; alterações exigem confirmação de uso único, expiram em cinco minutos e revalidam papel/identidade. Senhas são ocultadas na revisão.
- Serviços agora aceitam versão esperada em edições administrativas para impedir confirmação sobre cadastro modificado; a política de sobreposição também verifica o valor revisado. Nenhuma migração nova necessária.
- Testes cobrem permissões, confirmação, duplicação, cancelamento, expiração, perda de papel, troca de conta, cadastros, edição, bloqueio, tarefas, ajustes, estornos, CSV e consulta precisa de auditoria.
- Integração real executada somente em `almoxarifado_test`: criação/edição de usuário com origem Telegram, bloqueio de acesso, proteção do próprio ADM, versões desatualizadas e auditoria passaram. Nenhuma mensagem foi enviada ao Telegram durante a validação automatizada.
- Resultado atualizado: 60 testes unitários/HTTP/bot passaram; lint passou. Suíte MySQL real passou sem testes ignorados. Para acessar, reiniciar o processo do bot e enviar `/admin` na conta vinculada com papel ADM.

## Retomada em 24/10/2026

- Inspeção confirmou que esta pasta não possui repositório Git nem arquivo AGENTS.md no código do projeto.
- `npm test`: 60 aprovados, zero falhas e zero ignorados.
- `npm run lint`: passou.
- `npm run build`: passou; Vite avisou que o chunk principal supera 500 kB. Isso não impediu a compilação.
- `npm run test:e2e`: 16 aprovados no navegador, com API interceptada.
- `npm run test:integration`: aprovado com RUN_MYSQL_TESTS=1 e DB_NAME=almoxarifado_test; dados de teste preservados nesse banco.
- Consultas somente de leitura ao Telegram: getMe e getWebhookInfo retornaram HTTP 200; identidade @Almoxdgmbot, sem webhook e sem atualizações pendentes no momento da consulta, compatível com BOT_MODE=polling.
- Nenhuma mensagem enviada ao Telegram nesta retomada. A validação de identidade não comprova execução contínua do polling nem entrega de notificações.
- Próxima validação operacional: executar `npm run bot` em um único terminal, enviar `/admin` pela conta ADM vinculada e exercitar os formulários e notificações documentados. Painel configurado em http://localhost:5174 e API em http://127.0.0.1:3032.

## Vínculo Telegram gerado pelo ADM

- Lista de colaboradores ganhou ação exclusiva ADM para gerar e copiar o comando de vínculo de cada pessoa, dispensando o login dela no portal.
- Novo POST `/usuarios/:id/telegram-token` reutiliza o serviço de vínculo, valida conta ativa/desbloqueada e registra o ADM como autor da geração para o usuário escolhido.
- Código mantém validade de 10 minutos, armazenamento por hash e uso único; nova geração invalida o código anterior. Nenhuma migração necessária.
- Validação: 61 testes unitários/HTTP, 17 testes de navegador, lint e build aprovados. Integração MySQL real aprovada em `almoxarifado_test`, incluindo geração pela API com sessão ADM/CSRF, recusa para outros perfis, bloqueio, substituição do código, consumo único, identidade vinculada e auditoria.

## Código automático de materiais

- Portal e Telegram deixam de solicitar código no cadastro. Servidor gera código numérico sequencial dentro da transação, com bloqueio da sequência para cadastros concorrentes; edições não alteram o código.
- Migração `002_material_codigo.sql` aplicada em `almoxarifado` e `almoxarifado_test`, preservando registros existentes e iniciando a sequência depois do maior código numérico anterior.
- Integração MySQL validou códigos consecutivos em cadastros simultâneos, preservação na edição e recusa de código fornecido pelo cliente.
- Verificação final: 61 testes unitários/HTTP, lint e build aprovados. Os 17 casos anteriores de navegador passaram; o novo caso de cadastro automático passou após corrigir o seletor de categoria do próprio teste.

## Justificativa de início e limpeza da conversa

- Início de tarefa no Telegram exige justificativa de 5 a 1000 caracteres, com cancelamento, expiração em cinco minutos e revalidação da conta e permissões; menu ADM mantém confirmação final.
- Justificativa registrada nas observações, no histórico da tarefa e na auditoria. Serviço recusa início de origem Telegram sem justificativa válida.
- Limpeza automática das respostas textuais de navegação e entradas processadas; processamento serializado por chat. `/limpar` tenta remover os últimos 100 IDs e abre um novo menu, sem alterar histórico de negócio.
- Limpeza respeita os limites do Telegram: mensagens antigas podem permanecer. Acompanhamento automático em memória desde a inicialização; comando manual alcança também mensagens anteriores à reinicialização dentro da janela recente.
- Integração MySQL real aprovada no banco exclusivo de testes, incluindo persistência da justificativa e recusa de início sem ela. Nenhuma mensagem enviada ao Telegram durante os testes.

## Permissões individuais do bot

- Tela exclusiva ADM em `/permissoes-bot`, com busca de colaborador, agrupamento de 22 permissões, restauração do padrão do perfil e atalho na lista de colaboradores.
- Novos GET/PATCH `/usuarios/:id/permissoes-bot`, validação de perfil, CSRF, auditoria e controle de versão para impedir sobrescrita de uma alteração concorrente.
- Migração `003_bot_permissions.sql` aplicada nos bancos principal e de testes. Sem registro individual, mantém os acessos existentes pelo perfil; permissões do portal preservadas.
- Menus escondem ações revogadas. Comandos, callbacks antigos, formulários e confirmações revalidam permissões, assim como os serviços com origem Telegram. Worker suspende notificações quando o acesso ou os avisos são desabilitados; a fila é preservada para eventual reativação.
- 74 testes unitários/HTTP/bot aprovados; integração MySQL real aprovada com persistência, revogação, auditoria, perfil, versão e API administrativa. 20 casos de navegador aprovados, incluindo salvar/recarregar permissões e recusa do acesso não administrativo. Lint e build aprovados. Sem envio de mensagens ao Telegram durante a validação.

## Preservação e revogação do vínculo Telegram

- Corrigido `/start`: antes sempre instruía a vincular, mesmo com vínculo persistido. Agora reconhece o telegram_id no MySQL, ignora payload antigo para contas já vinculadas e abre o menu após validar conta e permissões.
- Limpeza e reinicialização não alteram o vínculo. Troca de conta exige revogação explícita pelo ADM no painel, com confirmação e auditoria; códigos pendentes são invalidados na mesma transação.
- Novo DELETE `/usuarios/:id/telegram-vinculo`, protegido por perfil ADM e CSRF. Nenhuma migração necessária; nenhum vínculo real revogado durante a implementação.
- 79 testes unitários/HTTP/bot aprovados; integração real em `almoxarifado_test` validou preservação, recusa de substituição, revogação pela API, auditoria, invalidação de códigos e novo vínculo. Lint e build aprovados.

## Planejamento diário de tarefas

- Nova tela `/tarefas/planejamento`, exclusiva ADM/GESTOR, acessível pelo menu lateral e pelo botão Planejar dia na agenda. Data selecionável, navegação entre dias, cadastro contínuo preservando responsável, edição de pendentes e filtro por responsável.
- Seleção de uma ou várias tarefas, cópia para múltiplas datas e atalho Próximos 7 dias. Lista paginada e seleção por página; até 200 cópias em uma operação.
- POST `/tarefas/duplicar` reutiliza a gravação transacional de tarefas. Cópias começam pendentes, preservam programação e não reutilizam histórico ou observações de execução. Conflito desfaz o lote inteiro, incluindo auditoria e notificações.
- Edição no planejamento envia a versão consultada pelo header X-Record-Version para impedir sobrescrita de alterações concorrentes. Nenhuma migração necessária.
- Integração MySQL no banco de testes validou cópia de tarefa concluída como pendente, versão desatualizada, datas inválidas, recusa da data original e rollback completo de lote com conflito. Casos de navegador validaram cadastro contínuo, edição, cópia em várias datas, erro recuperável e navegação no celular.

## Cópia entre colaboradores — 26/10/2026

- Modal de cópia ganhou seleção opcional de colaborador de destino e atalho Usar mesmo dia. Sem destino, preserva os responsáveis originais.
- API aceita responsavel_id opcional; permite a data original somente quando o responsável muda. Originais preservados, novas tarefas pendentes, auditoria com destino e validação transacional de disponibilidade e conflitos.
- Integração MySQL aprovada: cópia para outro colaborador no mesmo dia, preservação do original e recusa de conflito, responsável bloqueado e cópia para si na data original. Nenhuma migração necessária.
