---
name: deploy
description: Fluxo de deploy do AuraComex - typecheck, commit, push na main, confere o Vercel e atualiza a versão de build.
disable-model-invocation: true
---

Siga o "Fluxo de trabalho obrigatório" do CLAUDE.md, nesta ordem, parando no primeiro erro:

1. `npx tsc --noEmit -p tsconfig.app.json` (nunca `-p .`). Se falhar, corrija antes de seguir.
2. `git fetch origin main` e confira divergência. Commit com mensagem clara (usar `git commit -F` se houver crase).
3. `git push origin main`. Se der 403 "not in this session's authorized repository set", pare e avise: `BrasaDigital/auracomex` precisa ser fonte da conversa.
4. Vercel MCP `list_deployments` (projeto `prj_gS2iVXFhlHTqHspNQ79m2AsDz0wA`, team `team_72KuLwbJZBtnU2NFLrfHBomJ`): confirme deployment novo com o SHA do commit em READY.
5. Supabase MCP: `UPDATE app_build_version SET version = '<AA.M.NNletra>', updated_at = now() WHERE id = 1` (letra do momento; `app_releases` só quando o Marcos fechar o assunto).
6. Termine com: versão no ar e o que o Marcos deve testar.
