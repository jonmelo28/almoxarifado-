# API REST

Base `/api/v1`, JSON UTF-8. Erros `{error, issues?, requestId}`. 401 para sessão ausente/conta bloqueada, 403 para permissão/CSRF, 404 para recurso ausente, 409 para conflito e 422 para validação.

1. GET `/auth/csrf`: recebe cookie e `{token}`.
2. POST `/auth/login` com `{email,senha}` e header `X-CSRF-Token`: retorna `{user,csrf}`. Use o novo token nas próximas mutações.
3. GET `/auth/me`; POST `/auth/logout`.

Toda mutação exige cookie de sessão e token CSRF. Cadastro público não existe.

POST `/tarefas/duplicar` (ADM/GESTOR) recebe `{tarefas:[1,2],dias:["2030-01-02","2030-01-03"],responsavel_id:3}` e retorna status 201 com `{total,tarefas:[{id}]}`. `responsavel_id` é opcional: ausente, mantém o responsável de cada original; presente, atribui todas as cópias ao colaborador escolhido, que deve estar ativo e desbloqueado. Até 100 IDs únicos e 31 datas civis válidas e únicas, limitado a 200 cópias. A data original é permitida somente para colaborador diferente do original. Cópias mantêm título, descrição, horário e prioridade, mas começam PENDENTE, sem observações e horários reais de execução. O lote inteiro usa a mesma transação: conflitos de horário no destino, responsável indisponível ou qualquer falha desfazem tarefas, auditoria, histórico e notificações do lote. O histórico original é preservado e a operação registra `DUPLICAR_TAREFAS` na auditoria, incluindo o responsável de destino.

PATCH de usuários, materiais e tarefas aceita o header opcional `X-Record-Version` com `atualizado_em` da consulta. Versão desatualizada retorna 409. O planejamento diário usa esse controle ao editar; tarefas iniciadas/concluídas/canceladas não podem ser editadas pelo cadastro.

GET `/usuarios/:id/permissoes-bot` e PATCH no mesmo endereço são exclusivos de ADM. GET retorna `{usuario,versao,permissoes,catalogo}`; o catálogo contém chave, descrição, grupo e disponibilidade pelo perfil. PATCH recebe `{versao,permissoes}` com todas as chaves booleanas do catálogo. Campos desconhecidos ou concessões incompatíveis com o perfil são recusados; versão desatualizada retorna 409. O salvamento registra `PERMISSOES_BOT` na auditoria. Não altera acessos do portal. Usuários sem configuração individual herdam o padrão do perfil. Revogações são revalidadas em comandos, callbacks, formulários e serviços de origem Telegram; o worker respeita `acessar_bot` e `notificacoes`.

Materiais: `codigo` é gerado automaticamente no servidor, numérico e sequencial, e não deve ser enviado em POST/PATCH. A resposta da gravação inclui `{id,codigo}`. Edições preservam o código. A migração `002_material_codigo.sql` preserva os códigos existentes e inicia a sequência após o maior código composto somente por dígitos (ou em 1 se não houver). A sequência é bloqueada na mesma transação do cadastro para impedir duplicação em cadastros simultâneos.

POST `/usuarios/:id/telegram-token` (somente ADM) gera vínculo para o usuário indicado, sem login dele. Retorna `{token,expira_em_minutos:10}` com status 201. Conta inexistente retorna 404; inativa ou bloqueada, 409. Invalida códigos anteriores desse usuário e registra o ADM como autor na auditoria. O colaborador envia `/vincular TOKEN` no chat privado do bot; o código só pode ser consumido uma vez. A tentativa de substituir uma conta Telegram vinculada retorna 409: o ADM deve revogar o vínculo antes de trocar de conta.

DELETE `/usuarios/:id/telegram-vinculo` (somente ADM, com sessão e CSRF) revoga o vínculo e todos os códigos pendentes do usuário, na mesma transação, registrando `REVOGAR_VINCULO_TELEGRAM` na auditoria. Retorna 204 ou 404 para usuário inexistente. Limpar mensagens, reiniciar o bot ou enviar `/start` não revoga o vínculo persistido no MySQL. `/start` reconhece contas vinculadas, ignora códigos antigos nesses casos e revalida bloqueio e permissões antes de abrir o menu.

| Recurso                                          | Operações                     | Acesso                                              |
| ------------------------------------------------ | ----------------------------- | --------------------------------------------------- |
| `/usuarios`, `/usuarios/:id`                     | GET, POST, PATCH              | GET ADM/GESTOR; escrita ADM                         |
| `/categorias`, `/categorias/:id`                 | GET coleção, POST, PATCH item | leitura todos; escrita ADM                          |
| `/materiais`, `/materiais/:id`                   | GET, POST, PATCH              | leitura todos; escrita ADM                          |
| `/movimentacoes`, `/movimentacoes/:id`           | GET, POST coleção             | colaborador vê suas operações; escrita por política |
| `/tarefas`, `/tarefas/:id`                       | GET, POST, PATCH              | colaborador vê próprias; escrita ADM/GESTOR         |
| `/tarefas/:id/iniciar`, `/concluir`, `/cancelar` | POST                          | próprias ou gestor; cancelamento ADM/GESTOR         |
| `/dashboard`                                     | GET                           | todos, escopo conforme papel                        |
| `/relatorios/estoque`, `/tarefas`, `/consumo`    | GET                           | ADM/GESTOR                                          |
| `/auditoria`                                     | GET                           | ADM                                                 |
| `/configuracoes`                                 | GET, PATCH                    | ADM                                                 |
| `/auth/telegram-token`                           | POST                          | autenticado                                         |
| `/health`                                        | GET                           | público, verifica conexão                           |

Coleções retornam `{data,total,page,limit}`. Parâmetros `page`, `limit` (1–100), `q`. Materiais: `baixo=true`, `ativo=true/false`. Tarefas: `data_programada`, `responsavel_id`, `status`, `prioridade`. Movimentações: `material_id`, `tipo`, `de`, `ate` (datas no fuso da aplicação, limite final inclusivo). Relatórios aceitam `formato=csv`, exportando somente a página explicitamente selecionada.

POST movimentações:

```json
{
  "material_id": 1,
  "tipo": "SAIDA",
  "quantidade": "2.500",
  "motivo": "Uso na manutenção",
  "chave_idempotencia": "uuid-gerado-pelo-cliente",
  "beneficiario_id": null,
  "tarefa_id": null,
  "estorno_de": null
}
```

Decimais são strings com ponto, até três casas, sem notação exponencial. UN exige inteiro. AJUSTE é variação assinada, não saldo absoluto. ESTORNO exige `estorno_de` e mesmo material; servidor calcula a compensação, ignorando a quantidade informada. Compensação pode falhar por estoque insuficiente. Repetir chave com conteúdo diferente retorna 409. Não existem edição/exclusão de movimentações.

PATCH de cadastros exige o formulário completo validado (exceto senha em usuários). Saldos, papéis extras e campos desconhecidos são recusados. Em tarefas, transições usam endpoints próprios e horários reais nunca são aceitos do cliente.
