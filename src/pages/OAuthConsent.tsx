import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { clearPendingOAuth, setPendingOAuth } from '@/lib/oauthResume';

// Tela de consentimento do servidor OAuth do Supabase (conector MCP do Claude).
// O Supabase redireciona pra cá com ?authorization_id=...; o usuário aprova ou nega
// e é devolvido ao cliente OAuth (Claude) com o código ou o erro.

interface AuthDetails {
  authorization_id?: string;
  redirect_url?: string;
  redirect_uri?: string;
  scope?: string;
  client?: { name?: string };
}

function hostOf(uri?: string) {
  try { return uri ? new URL(uri).host : ''; } catch { return uri ?? ''; }
}

export default function OAuthConsent() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id');
  const { user, profile, loading: authLoading } = useAuth();

  const [details, setDetails] = useState<AuthDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (!authorizationId) {
      setError('Pedido de autorização inválido (falta o identificador).');
      setLoading(false);
      return;
    }

    // Sem login: guarda o pedido e manda pro login; depois do login volta pra cá.
    if (!user) {
      setPendingOAuth(authorizationId);
      navigate('/', { replace: true });
      return;
    }

    // Troca de senha obrigatória no primeiro acesso vem antes de qualquer consentimento.
    if (profile?.must_change_password) {
      navigate('/dashboard', { replace: true });
      return;
    }

    clearPendingOAuth();
    let cancelled = false;
    (async () => {
      const { data, error: err } = await (supabase.auth as any).oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (err || !data) {
        setError(err?.message || 'Pedido de autorização inválido ou expirado.');
        setLoading(false);
        return;
      }
      // Já consentido antes: o Supabase devolve só a URL de retorno.
      if (!('authorization_id' in data) && data.redirect_url) {
        window.location.href = data.redirect_url;
        return;
      }
      setDetails(data as AuthDetails);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, authorizationId, user, profile?.must_change_password, navigate]);

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setBusy(true);
    setError(null);
    const oauth = (supabase.auth as any).oauth;
    const { data, error: err } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (err || !data?.redirect_url) {
      setError(err?.message || 'Não foi possível concluir a autorização.');
      setBusy(false);
      return;
    }
    window.location.href = data.redirect_url;
  }

  const scopes = (details?.scope ?? '').split(' ').filter(Boolean);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Autorizar acesso ao AuraComex</CardTitle>
          <CardDescription>
            {loading ? 'Carregando pedido de autorização…' : 'Revise o pedido antes de continuar.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 text-sm">
          {error && <p className="text-destructive">{error}</p>}

          {details && (
            <>
              <p>
                O aplicativo <strong>{details.client?.name || 'desconhecido'}</strong> quer acessar o
                AuraComex em seu nome, usando as mesmas permissões do seu usuário
                {user?.email ? <> (<strong>{user.email}</strong>)</> : null}.
              </p>
              <p>
                Ele poderá consultar processos, documentos e cotações da sua empresa, registrar observações
                no diário dos processos e alterar o status deles. Nada é apagado, e tudo fica registrado
                com o seu nome. Você pode negar agora e o acesso só vale para quem você aprovar.
              </p>
              {hostOf(details.redirect_uri) && (
                <p className="text-muted-foreground">Retorno para: {hostOf(details.redirect_uri)}</p>
              )}
              {scopes.length > 0 && (
                <div>
                  <p className="font-medium">Permissões solicitadas:</p>
                  <ul className="list-disc pl-5">
                    {scopes.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>

        {details && (
          <CardFooter className="flex gap-2 justify-end">
            <Button variant="outline" disabled={busy} onClick={() => decide(false)}>Negar</Button>
            <Button disabled={busy} onClick={() => decide(true)}>Permitir</Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
