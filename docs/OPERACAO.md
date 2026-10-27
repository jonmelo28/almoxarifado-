# Operação, HTTPS, backup e restauração

## Produção

Compile com `npm ci` e `npm run build`. Sirva `frontend/dist` em Nginx/IIS/Caddy com fallback de rotas para index.html e encaminhe `/api` para 127.0.0.1:3000. Use a mesma origem HTTPS para UI/API, FRONTEND_URL exata e NODE_ENV=production. SESSION_SECRET deve ser aleatório e privado. O proxy precisa definir X-Forwarded-Proto corretamente; API confia em exatamente um proxy. Não exponha a porta interna diretamente à rede. Cookies Secure exigem HTTPS.

Execute `npm start -w backend` e `npm run bot` como processos independentes supervisionados pelo mecanismo de serviços já utilizado no ambiente. Não instalar outro MySQL. Reinicie processos após alterar o ambiente. Use conta app com SELECT/INSERT/UPDATE/DELETE apenas nas tabelas da aplicação; a conta de migração não deve permanecer nos processos. Para reduzir privilégios ainda mais, conceda DELETE somente em sessoes e tokens_vinculacao_telegram; as demais tabelas não são excluídas pela aplicação.

Webhook: configure BOT_MODE=webhook, BOT_WEBHOOK_URL=https://seu-dominio/telegram/webhook, BOT_WEBHOOK_SECRET com 32+ caracteres alfanuméricos/hífen/underscore e BOT_PORT=3001. Encaminhe o caminho do webhook pelo proxy HTTPS para 127.0.0.1:3001. Telegraf valida o secret token do Telegram. Não reutilize SESSION_SECRET e não inclua BOT_TOKEN na URL. Para polling de desenvolvimento, BOT_MODE=polling.

## Notificações

Outbox persistida na mesma transação de tarefas/movimentações; chave única evita enfileiramento repetido de um mesmo lembrete. Retries a cada cinco minutos, máximo dez tentativas; uma entrega sem resposta após o Telegram aceitar pode ser repetida (entrega pelo menos uma vez; exactly-once não é garantido pela API externa). Workers usam SELECT FOR UPDATE SKIP LOCKED. Registros sem Telegram vinculado aguardam. Revisar notificações com tentativas=10 manualmente, sem alterar dados históricos de estoque. Formulários do bot são temporários em memória e são perdidos em reinícios; recomece pelo menu.

## Backup

Use o mysqldump da instalação existente e uma conta de backup autorizada. Execute fora do processo da aplicação, com destino protegido e senha solicitada interativamente:

```powershell
mysqldump --host=127.0.0.1 --user=SEU_USUARIO_BACKUP --password --single-transaction --no-tablespaces --result-file=almoxarifado-backup.sql almoxarifado
```

Esse arquivo contém dados pessoais e hashes: restrinja acesso, cifre cópias externas, defina retenção e teste restaurações. Não versionar backups. Para restaurar, o administrador cria um banco vazio de homologação, abre o cliente MySQL e executa `SOURCE C:/caminho/almoxarifado-backup.sql;` após selecionar explicitamente o banco de destino. Verifique usuários, saldos, histórico e checksums de migração antes de qualquer troca de ambiente. Nunca restaure sobre produção sem janela e autorização própria.

## Diagnóstico

`node backend/src/scripts/diagnose.js` mostra versão de Node e versão anunciada pelo servidor sem autenticar. `npm run migrate` deve ser executado apenas com credenciais configuradas e banco dedicado. `/api/v1/health` retorna 200 somente quando há acesso ao banco. Logs não imprimem corpos de requisição, senhas nem tokens. Guarde requestId para correlação. Não compartilhar `.env` ou URLs contendo segredos.
