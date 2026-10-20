// Retoma o fluxo de consentimento OAuth (conector do Claude) depois do login.
// A página /oauth/consent guarda o authorization_id aqui quando o usuário ainda
// não está logado; o redirecionamento pós-login volta pra ela em vez do /dashboard.

const KEY = 'aura_oauth_authorization_id';

export function setPendingOAuth(authorizationId: string) {
  try { sessionStorage.setItem(KEY, authorizationId); } catch { /* storage indisponível */ }
}

export function clearPendingOAuth() {
  try { sessionStorage.removeItem(KEY); } catch { /* storage indisponível */ }
}

/** Destino depois do login: consentimento pendente, ou o dashboard de sempre. */
export function getPostLoginPath(): string {
  try {
    const id = sessionStorage.getItem(KEY);
    if (id) return `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
  } catch { /* storage indisponível */ }
  return '/dashboard';
}
