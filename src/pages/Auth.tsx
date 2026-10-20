import { useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { PlatformLogo } from '@/components/shared/PlatformLogo';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { getPostLoginPath } from '@/lib/oauthResume';

function ForgotPasswordLink() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success(t('auth.reset_email_sent'));
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
      >
        {t('auth.forgot_password')}
      </button>
    );
  }

  return (
    <form onSubmit={handleReset} className="w-full space-y-3 pt-2 border-t border-border">
      <p className="text-sm text-muted-foreground">{t('auth.forgot_password')}</p>
      <Input
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        placeholder="email@empresa.com"
      />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} className="flex-1">
          {t('auth.back_to_login')}
        </Button>
        <Button type="submit" size="sm" disabled={sending} className="flex-1">
          {sending ? '...' : t('auth.send_reset_link')}
        </Button>
      </div>
    </form>
  );
}

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, signIn } = useAuth();
  const { t, language, setLanguage } = useLanguage();

  if (user) return <Navigate to={getPostLoginPath()} replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await signIn(email, password);
      if (error) throw error;
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <PlatformLogo size={72} />
        </div>

        <Card className="glass">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{t('auth.login')}</CardTitle>
            <CardDescription>International Logistics Platform</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>{t('auth.email')}</Label>
                <Input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="email@empresa.com"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('auth.password')}</Label>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('auth.signing_in') : t('auth.login')}
              </Button>
            </form>

            {/* Forgot password */}
            <div className="mt-3 flex justify-center">
              <ForgotPasswordLink />
            </div>

            {/* Language toggle */}
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setLanguage(language === 'pt' ? 'en' : 'pt')}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {language === 'pt' ? '🇺🇸 English' : '🇧🇷 Português'}
              </button>
            </div>
            
            {/* Support contact */}
            <div className="mt-6 text-center">
              <p className="text-xs text-muted-foreground">
                {t('common.support_contact')}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Landing link for prospects */}
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Ainda não é nosso cliente?{' '}
            <Link to="/signup" className="text-primary hover:underline font-medium">
              Criar conta grátis
            </Link>{' '}
            ou{' '}
            <Link to="/landing" className="text-primary hover:underline">
              conheça o Aura →
            </Link>
          </p>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground opacity-70">CNPJ: 51.845.506/0001-32</p>
        </div>
      </div>
    </div>
  );
}
