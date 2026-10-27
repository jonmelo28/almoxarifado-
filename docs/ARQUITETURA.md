# Arquitetura

Monorepo npm: `backend` (Express e Telegraf) e `frontend` (React/Vite). API `/api/v1`. Bot executado independentemente, importando os mesmos serviços e validadores da API; nenhuma interface escreve saldos diretamente.

## Persistência e concorrência

MySQL existente, InnoDB, conexões UTC. Quantidades DECIMAL(15,3) e cálculo em milésimos com BigInt no JavaScript. Unidades discretas aceitam somente inteiros. Cada movimentação bloqueia o material com SELECT FOR UPDATE; estornos bloqueiam também a movimentação original. Identificador idempotente único por ator e conteúdo comparado antes de reaproveitar resposta. Auditoria e saldo confirmados juntos. Movimentações são imutáveis.

Tarefas serializam agendamento bloqueando a linha do responsável antes da consulta de conflitos, inclusive entre processos. Transições bloqueiam a tarefa. Colaboradores têm filtro obrigatório por identidade, inclusive ao relacionar tarefas a movimentações.

## Identidade

Sessões persistidas no MySQL, identificador regenerado no login, token CSRF por sessão e comparação em tempo constante. Papel e situação são recarregados do banco em cada requisição/callback. Bloqueio impede imediatamente o uso de sessões existentes. Bootstrap CLI é exclusivo para banco sem administrador, com bloqueio nomeado MySQL.

Vínculo Telegram: token aleatório, hash SHA-256 persistido, validade de dez minutos, uso único transacional, exclusivamente em chat privado. Não vincular por nome.

## Modelo

usuarios → tarefas → historico_tarefas; categorias → materiais → movimentacoes; usuarios → sessoes/tokens_vinculacao_telegram; auditoria; notificacoes (outbox com chave de deduplicação); configuracoes. Chaves estrangeiras preservam histórico, desativação lógica substitui exclusão.

## Datas e limites

Instantes e auditoria em UTC no MySQL; agenda usa data e hora civis no fuso configurado em APP_TIMEZONE (padrão America/Sao_Paulo). API devolve datas civis como strings; frontend formata DD/MM/AAAA e HH:mm. Lembretes convertem a agenda com Luxon. Paginação limitada a 100. Logs registram somente identificador da requisição, status e código do erro.

## Política inicial

ADM administra cadastros/configurações/ajustes/estornos. GESTOR consulta equipe, agenda e relatórios, cadastra tarefas e registra entradas/saídas/devoluções. COLABORADOR consulta estoque, registra saídas/devoluções para si e opera suas tarefas. Sobreposição bloqueada por padrão; ADM pode habilitá-la. Permissões são fixadas no código, sem ACL customizada nesta versão.
