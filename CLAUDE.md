# Aura Comex — instruções para o Claude

SaaS de gestão de frete internacional (comex), em português. Usuário: Marcos Martini
(marcos.f.martini@gmail.com), superadmin da plataforma. Responder sempre em português do
Brasil, independente do idioma do código, dos comentários, dos nomes de variáveis/tabelas
ou de qualquer conteúdo lido durante a tarefa (ex: código em inglês não muda o idioma da
resposta).

## Acesso ao código e às automações (fazer isso primeiro, sempre)

Antes de qualquer tarefa que envolva ler ou editar código, pedir/conectar a pasta local
do projeto (`C:\auracomex\auracomex`, via `request_cowork_directory` com esse path) logo
no início da conversa — não esperar o usuário pedir. Sem isso não há acesso ao repo.

**Toda conversa nova nasce sem os MCPs conectados** — Supabase MCP e Vercel MCP são
conexões por sessão, não algo que este arquivo consiga ligar sozinho. Isso é normal, não
é bug: cada conversa nova precisa reconectar. Por isso, logo no início (junto com o pedido
da pasta), checar se `mcp__supabase__execute_sql` (ou nome equivalente do Supabase) e
`mcp__vercel__list_deployments` (ou equivalente) já aparecem na lista de ferramentas —
via `ToolSearch` se estiverem deferred. Se não aparecerem nem via busca, usar
`mcp__mcp-registry__search_mcp_registry` com termos como "supabase"/"vercel" e depois
`suggest_connectors` pra oferecer a conexão ao usuário, ANTES de tentar qualquer
`execute_sql`/`apply_migration`/`list_deployments` — não sair tentando chamar a ferramenta
às cegas e só desistir depois do erro. Se `list_projects`/`get_project` do Vercel voltar
vazio ou 404 mesmo com o MCP conectado, o conector perdeu o escopo do projeto — pedir pro
usuário reconectá-lo em Configurações → Conectores, dando acesso explícito ao projeto
`auracomex` (não precisa remover e readicionar, só reautorizar).

**GitHub não é um MCP separado aqui** — não existe (nem precisa existir) um conector MCP
de GitHub pra esse projeto. Todo o fluxo de commit/push acontece via `git` direto no
repositório montado localmente (`C:\auracomex\auracomex`, ver seção "Git no ambiente
sandbox" abaixo). PORÉM: o push passa por um proxy de git que só injeta credencial pra
repositórios autorizados na sessão. Se o push falhar com 403 e "not in this session's
authorized repository set": estar dentro do projeto AuraComex NÃO basta — o repo
`BrasaDigital/auracomex` precisa estar adicionado como FONTE da própria conversa (seletor
de fontes/conhecimento da conversa). A correção é o usuário adicionar o repo GitHub como
fonte da conversa. Não adianta mexer em credencial, remote ou config do git — o bloqueio
é do proxy, não do repositório. Enquanto isso, o commit local não se perde: qualquer
sessão autorizada (ou o próprio usuário na máquina dele) consegue dar o push depois.

**Sessão sem pasta local montada (ex: Cowork sem `C:\auracomex\auracomex` conectado)**:
sem `git`, ler/editar arquivo do repo por `web_fetch` direto em
`https://raw.githubusercontent.com/BrasaDigital/auracomex/main/<caminho>` (rápido,
confiável, um arquivo por vez). `api.github.com` (search/tree/contents) não responde
nem pelo `bash` do sandbox nem sempre pelo `web_fetch`; pra listar diretório ou navegar
histórico, usar o Chrome (`github.com/BrasaDigital/auracomex/tree/main/<pasta>`) — o
`web_fetch` direto em `github.com` normal não retorna conteúdo (página client-rendered).
Pra COMMITAR sem pasta local, editar pelo Chrome no editor web do GitHub
(`github.com/BrasaDigital/auracomex/edit/main/<arquivo>`) e commitar direto na `main`;
depois disso o Vercel faz o deploy automático como qualquer outro push. Abrir/mergear PR
pelo Chrome às vezes trava na primeira tentativa ("This page is taking too long to
load") — recarregar a comparação (`compare/main...branch`) e tentar de novo resolve.

## Stack e referências

- React 18 + TypeScript + Vite + shadcn/ui (Radix) + Tailwind + TanStack React Query + React Router
- Backend: Supabase (Postgres/Auth/Storage/Edge Functions, pg_cron) — projeto `pqiuxojgjmqhdajdhgqk`
- Testes: Vitest (`npx vitest run`)
- Repo GitHub: `BrasaDigital/auracomex`, branch de produção `main`
- Deploy: Vercel, auto-deploy no push pro `main` — projeto `auracomex`
  (id `prj_gS2iVXFhlHTqHspNQ79m2AsDz0wA`, team `team_72KuLwbJZBtnU2NFLrfHBomJ`)
- Deploy Hook manual (se o auto-deploy falhar): colar no navegador
  `https://api.vercel.com/v1/integrations/deploy/prj_gS2iVXFhlHTqHspNQ79m2AsDz0wA/5OG2kJBvaA`
  (o sandbox NÃO alcança api.vercel.com — pedir pro usuário abrir a URL no navegador dele)

## Comandos

- `npm run dev` — servidor de desenvolvimento (Vite, porta 8080, HMR; libera hosts
  `*.trycloudflare.com` pra expor via `cloudflared tunnel --url http://localhost:8080`)
- `npm run build` / `npm run build:dev` — build de produção / build em modo development
- `npm run preview` — preview do build
- `npm run lint` — ESLint (`eslint.config.js`; `@typescript-eslint/no-unused-vars` desligado
  de propósito)
- `npx tsc --noEmit -p tsconfig.app.json` — checagem de tipos (ver passo 1 do "Fluxo de
  trabalho obrigatório" abaixo; NUNCA `-p .`)
- `npm run test` / `npm run test:watch` — Vitest (`jsdom`, setup em `src/test/setup.ts`,
  arquivos `src/**/*.{test,spec}.{ts,tsx}`). Um arquivo só: `npx vitest run
  src/test/costEstimate.test.ts`. Um teste só por nome: `npx vitest run -t "nome do teste"`.
- Playwright (`@playwright/test`) está configurado (`playwright.config.ts`, via
  `lovable-agent-playwright-config`) mas sem specs no repo ainda.
- Banco (Supabase CLI, fora do MCP): `supabase migration new <nome>` cria migração em
  `supabase/migrations/`; `supabase db push` aplica no remoto; `supabase gen types typescript
  --project-id pqiuxojgjmqhdajdhgqk > src/integrations/supabase/types.ts` regenera os tipos;
  `supabase functions deploy [nome-da-function] --project-ref pqiuxojgjmqhdajdhgqk` publica
  Edge Functions.

## Arquitetura

- **SPA React Router** (`src/App.tsx`): todas as rotas num `Routes` só, a maioria com
  `lazy()` (code splitting) exceto `Auth`/`Index` (caminho crítico). Guards: `ProtectedRoute`
  (exige `user` + permissão via `usePermissions`, envolve em `AppLayout`), `SuperAdminRoute`
  (fullscreen, sem `AppLayout`), `DashboardRoute` (redireciona superadmin sem empresa ativa
  pra `/admin`).
- **Auth + impersonação de empresa** (`src/contexts/AuthContext.tsx`): dono da sessão/profile/
  role do Supabase. Superadmin "entra" numa empresa via `switchCompany`/`exitCompany`, que
  reescrevem `profile.company_id` e guardam o `originalCompanyId` pra restaurar na saída —
  não é uma sessão separada, é o mesmo profile temporariamente redirecionado.
- **Permissões são por role, não tabela no banco**: `src/hooks/usePermissions.ts` deriva flags
  booleanas (`canAccessQuotes`, `canAccessFinancial` etc.) de listas de roles hardcoded no topo
  do arquivo. Pra dar/tirar acesso de um módulo a um role, mexe ali, não numa tabela de RBAC.
- **Multi-tenancy via RLS**: toda tabela de dado tem `company_id`; policies filtram por
  `my_company_id()` (SECURITY DEFINER, evita recursão em RLS). `is_superadmin()` idem.
- **Dois backends serverless, de propósito diferente**: a maior parte da lógica de servidor
  é Supabase Edge Function (Deno, `supabase/functions/*` — Stripe checkout/webhook, gestão de
  usuário, fila de e-mail, tracking, gateways Siscomex/Portal Único). `api/` (Vercel, Node) só
  existe pro único caso que Deno não cobre: apresentar certificado cliente mTLS ao Portal Único
  (ver entrada "Portal Único / DUIMP" no índice de módulos abaixo, com a duplicação de código
  proposital entre os dois arquivos).
- **Organização por domínio**: `src/components/<domínio>` (quotes, shipments, financial,
  coleta, superadmin, registrations...) concentra a UI de cada área; `src/pages` tem os
  containers de rota; `src/lib` concentra regra de negócio/cálculo (`costEstimate.ts`,
  `estimateSync.ts`, `cargoValue.ts`, `debitNotes.ts`, `pdf-utils.ts` etc.) separada da UI
  pra ficar testável via Vitest sem montar componente.
- **Dados**: TanStack React Query, sem store global — `QueryClient` configurado em `App.tsx`
  com `staleTime` de 3 min e `refetchOnWindowFocus: false` (trade-off deliberado de custo/
  performance, não default esquecido).
- **Geração de PDF**: client-side, via `generatePdfFromElement` (`src/lib/pdf-utils.ts`,
  html2canvas + jsPDF/html2pdf.js) renderizando um elemento DOM oculto; o PDF resultante sobe
  pro bucket `shipment-documents` do Storage (`DOCS_BUCKET` em `src/lib/storage.ts`) e é
  registrado na tabela `documents`. Padrão usado tanto pra estimativa quanto pra Ordem de
  Coleta (ver entrada "Coleta" no índice de módulos).
- **i18n**: `src/contexts/LanguageContext.tsx`.

## Índice de módulos por assunto (crescer isto a cada investigação nova)

Mapa rápido de "onde mexer" por área, pra não explorar o repo do zero toda vez. Sempre que
uma investigação render descoberta de arquivo/fluxo que valha a pena não redescobrir depois,
acrescentar uma entrada nova aqui (mesmo padrão desta primeira).

- **Portal Único / DUIMP (PUCOMEX)**: autenticação mTLS roda em `api/portalunico/test-connection.ts`
  e `api/portalunico/subscribe-webhook.ts` (função serverless Node no Vercel — Supabase Edge
  Function/Deno não suporta apresentar certificado cliente em conexão TLS). A lógica de auth é
  DUPLICADA nos dois arquivos DE PROPÓSITO — não extrair pra um `_lib.ts` compartilhado, já
  quebrou os dois endpoints em produção (Vercel aparentemente excluiu o módulo prefixado com
  `_` do bundle; ver comentário no topo dos dois arquivos).
  `supabase/functions/portalunico-gateway/index.ts` só grava a credencial da empresa
  (`company_portalunico_configs`), sem chamada de rede nenhuma.
  `supabase/functions/portalunico-webhook/index.ts` recebe o PUSH de eventos do Portal Único,
  casa pelo `duimp_number` do embarque (tabela `shipments`) e grava log durável de TODO evento
  recebido em `portalunico_webhook_events` (colunas `numero`, `matched`, `shipment_ids`,
  `raw_body`) — é o primeiro lugar pra olhar num chamado de "a DUIMP não atualizou".
  Campo no formulário: `src/components/shipments/LogisticsTab.tsx`, Card 5 "Desembaraço,
  Entrega & Faturamento" (`duimp_number`, texto livre, sem botão de busca).
  **Não existe consulta ativa/síncrona de DUIMP** para intervenientes privados no Portal
  Único — só assinatura de eventos futuros (webhook), sem backfill do estado atual. Ver
  armadilha detalhada na seção abaixo.
- **Coleta (frete rodoviário com frota própria do cliente)**: quando o próprio cliente
  (importador) faz a coleta do contêiner no terminal com motorista/veículo próprios (não uma
  transportadora terceirizada), a Aura registra isso em `coleta_motoristas`/`coleta_veiculos`
  (vinculados a `client_id`, não `company_id` — a frota é do cliente) e `coleta_ordens_coleta`
  (vinculada ao `shipment_id`). O PDF entregue ao motorista (não é o certificado oficial do
  terminal, é documento próprio da Aura) é gerado por `src/lib/gerarDocumentoOrdemColeta.ts`
  reaproveitando `generatePdfFromElement` (`src/lib/pdf-utils.ts`) e o bucket
  `shipment-documents` (`DOCS_BUCKET` em `src/lib/storage.ts`), registrado em `documents` com
  `document_type = 'ordem_coleta'`. Número do documento vem de `next_oc_number(company_id)`
  (mesmo padrão de `next_dn_number`). UI: aba "Coleta" em `src/components/coleta/OrdemColetaTab.tsx`,
  plugada tanto em `QuoteDetail.tsx` (embarque com cotação vinculada, o caminho mais comum) quanto
  em `ShipmentDetail.tsx` (embarque avulso). Geração do PDF é manual (botão), não automática na
  mudança de status — motorista/veículo normalmente só são conhecidos perto da data real da coleta.
- **Versionamento/build da sidebar**: ver seção "Fluxo de trabalho obrigatório" logo abaixo
  (`app_releases` = histórico por assunto fechado; `app_build_version` = versão exibida na
  sidebar, atualizada em todo deploy).

## Fluxo de trabalho obrigatório

1. **Verificar tipos antes de qualquer deploy**: `npx tsc --noEmit -p tsconfig.app.json`.
   NUNCA usar `-p .` — o tsconfig.json raiz é solution-style com `files: []` e não checa nada.
2. **Deploy sempre**: toda mudança verificada é commitada e enviada pro `main` imediatamente
   (o usuário pediu "deploy sempre"). Antes de push, `git fetch origin main` pra checar divergência.
3. **Versionamento por assunto (uma versão "fechada" por conversa/assunto)**: dentro de um mesmo
   assunto (tipicamente uma conversa), o sequencial (`NN`) fica TRAVADO e cada deploy intermediário
   ganha uma letra: `26.8.64a`, `26.8.64b`, `26.8.64c`... Essas versões com letra são só pro bundle
   ir pro ar (deploy Vercel normal) — **NÃO inserir linha em `app_releases`** pra elas, é só rodar
   o deploy e confirmar via Vercel. O usuário avisa quando o assunto está resolvido/fechado; só
   nesse momento insere UMA linha em `app_releases` com a versão sem letra (o próximo sequencial
   "puro", ex. `26.8.65`) resumindo o que foi feito no assunto inteiro — não cada ajuste intermediário.
   Um assunto novo (nova conversa/tema) sempre começa do próximo sequencial sem letra e recomeça o
   ciclo de letras se precisar de vários ajustes.
   Formato da versão: `AA.M.NN[letra]` (ano.mês.sequencial — ex: `26.8.55`, `26.8.64b`).
   Colunas de `app_releases`: `version`, `title`, `summary`, `highlights` (jsonb array de strings),
   `is_major` (bool). Consultar a última versão ANTES de fechar um assunto:
   `SELECT version FROM app_releases ORDER BY created_at DESC LIMIT 1`.
   A versão exibida na sidebar do app vem da tabela `app_build_version` (linha única, id=1),
   NÃO de `app_releases` — essa é atualizada em TODO deploy (com ou sem letra), pra dar pra
   conferir na hora se o último deploy já subiu, sem esperar o assunto fechar. Fazer o UPDATE
   dela em TODO deploy, como parte do fluxo (ver passo 4).
4. **Confirmar o deploy**: após push, checar via `list_deployments` (Vercel MCP) que apareceu um
   deployment novo com o SHA do commit e estado READY.
5. **Atualizar a versão de build (TODO deploy, com ou sem letra)**: `UPDATE app_build_version
   SET version = 'AA.M.NNletra', updated_at = now() WHERE id = 1` — é o que aparece na sidebar
   (`v26.8.64b`). Diferente do passo 3 (`app_releases`, só no fechamento do assunto), este UPDATE
   roda em TODO deploy, sempre com a versão exata (com a letra do momento).

## Git no ambiente sandbox (FUSE) — workaround obrigatório

O repo é montado via FUSE e `rm`/`os.remove` em arquivos `.lock` do `.git/` falha com
"Operation not permitted". Antes de CADA operação git (fetch/add/commit/push), rodar:

```bash
cd /caminho/do/repo && python3 -c "
import os
for root, dirs, files in os.walk('.git'):
    for f in files:
        if f.endswith('.lock'):
            p = os.path.join(root, f)
            os.rename(p, p + '.bak')
"
```

Warnings tipo `unable to unlink '...lock'` ou `tmp_obj_...` são cosméticos e inofensivos —
o que importa é o resultado do commit/push. Confirmar com `git log --oneline -1 origin/main`
após um `git fetch`.

Se `git merge`/`git checkout` falhar tentando SUBSTITUIR um arquivo já versionado (não só
`.lock`) com "unable to unlink ... Operation not permitted" — ex. ao dar fast-forward num
arquivo que mudou no remoto — não insistir no merge normal. Usar `git reset --soft
origin/main` (só move HEAD/index, não toca no working tree) e depois sobrescrever o
conteúdo do(s) arquivo(s) divergente(s) manualmente (`git show origin/main:<arquivo>` pra
ver o alvo, aplicar via ferramenta de edição, `git add`) antes de continuar com o commit
novo. Mais lento que um merge normal, mas não esbarra na limitação do FUSE.

Commits com crase/caractere especial na mensagem: usar `git commit -F /tmp/msg.txt`.

## Armadilhas conhecidas do código (não reaprender do zero)

- **Duplicação de cálculo em `src/pages/Quotes.tsx`**: o Lucro Estimado da lista usa
  `computeQuoteProfitBrl` (mesma função da ordenação). Já existiu uma segunda cópia inline no
  `<TableCell>` que divergiu (faltava `per_wm`) — foi removida. NUNCA reintroduzir cópia inline;
  qualquer ajuste vai na função compartilhada.
- **Unidade `per_wm` (W/M)** = `Math.max(pesoTotal_ton, cbmTotal)`. Implementações de referência:
  `getChargeMultiplier` em `QuoteDetail.tsx` e `getMultiplier` em `QuotePdfPreviewDialog.tsx`.
- **`src/lib/estimateSync.ts` (`mapChargesToEstimate`)**: TODA taxa com `leg='freight'` tem
  `charge_type='freight'` no banco (charge_type espelha o leg, não distingue frete de seguro).
  Por isso `isSeguro` é checado ANTES de `isFrete` e `isFrete` exclui `isSeguro`. Não inverter.
- **Auto-sync Taxas→Estimativa** (`CostEstimateTab.tsx`, efeito com `lastSyncedRef`): roda a cada
  mount da aba. Bug nessa cadeia REVERTE silenciosamente correções manuais no banco — se um valor
  de `cost_estimates` "volta sozinho" pro errado, a causa é código, não cache.
- **PDF da estimativa (`EstimatePdfDialog.tsx`)**: `minHeight` das folhas é `294mm` (não 297mm) —
  margem contra arredondamento subpixel do html2canvas/jsPDF que gerava página em branco extra.
  Não usar `maxHeight`/`overflow:hidden` (risco de cortar conteúdo).
- Auto-save do app é no `onBlur` (não debounce durante digitação).
- **Portal Único / DUIMP — webhook sem backfill (investigado 18/ago/2026)**: preencher
  `duimp_number` num embarque só atualiza `customs_channel`/situação sozinho se houver uma
  transição de estado NOVA na DUIMP depois que a assinatura do webhook foi ativada
  (`company_portalunico_configs.webhook_active`). Se a DUIMP já estava registrada ou já tinha
  canal definido ANTES de digitar o número no Aura, nunca chega evento pra ela — não existe
  consulta ativa (o Portal Único não oferece isso pra intervenientes privados, só push de
  eventos futuros). Diagnóstico rápido: `SELECT * FROM portalunico_webhook_events WHERE
  numero = '<duimp>'` — se não retornar nada, o Portal Único nunca notificou essa DUIMP nesta
  assinatura; nesse caso a orientação é preencher canal/situação manualmente (o campo aceita
  edição livre) e deixar o automático cuidar só da PRÓXIMA mudança de status.
- **Assinatura de webhook do Portal Único incompleta**: normalmente só 3 dos 4 eventos
  (`dimp-situacao-import`, `dimp-registro-import`, `dimp-retifica-import`) são aceitos por
  empresa — falta `dimp-diag-import`. Confirmado assim pra ATLAS LOGISTICA em 18/ago/2026;
  não investigado ainda por que o Portal Único rejeita esse evento específico. Re-rodar
  `subscribe-webhook` não resolveu sozinho.

## Ferramentas MCP disponíveis

- Supabase MCP: `execute_sql`, `apply_migration`, `get_logs` etc. (projeto `pqiuxojgjmqhdajdhgqk`)
- Vercel MCP: `list_deployments`, `get_deployment_build_logs` etc.
- O sandbox NÃO tem acesso de rede irrestrito (curl pra APIs externas pode falhar com exit 56).

## Diagnóstico — confiabilidade das ferramentas (aprendido na prática, não teórico)

- **`query_logs`/`get_logs` do Supabase MCP é instável**: numa sessão inteira (18/ago/2026)
  retornou "Backend error! Retry your query" em toda tentativa, mesmo com SQL trivial (`select
  ... limit 5`). Não insistir mais que 2-3 vezes — preferir consultar direto uma tabela de log
  própria do app quando existir (ex: `portalunico_webhook_events`) via `execute_sql`, que é
  estável.
- **`get_advisors` retorna payload grande** (pode passar do limite de tokens da tool call) —
  já vem salvo em arquivo quando isso acontece; ler em pedaços com `offset`/`limit` em vez de
  tentar de novo esperando resposta menor.
