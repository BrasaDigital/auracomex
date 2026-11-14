import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PlatformLogo } from "@/components/shared/PlatformLogo";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/legal";

function formatCnpj(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export default function Signup() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  async function handleCnpjBlur() {
    const digits = cnpj.replace(/\D/g, "");
    if (digits.length !== 14) return;
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!r.ok) return;
      const data = await r.json();
      if (data?.razao_social && !companyName) setCompanyName(data.razao_social);
    } catch { /* silencioso */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acceptedTerms) {
      toast.error("Você precisa aceitar os termos para continuar");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("public-signup", {
        body: { companyName, cnpj, adminName, adminEmail, password, acceptedTerms, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);

      toast.success("Conta criada! Entrando...");
      const { error: signErr } = await signIn(adminEmail, password);
      if (signErr) throw signErr;
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar conta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center mb-8">
          <PlatformLogo size={72} />
        </div>

        <Card className="glass">
          <CardHeader>
            <CardTitle>Criar conta</CardTitle>
            <CardDescription>
              Sem cartão de crédito. Acesso completo por 14 dias.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>CNPJ *</Label>
                <Input
                  value={cnpj}
                  onChange={(e) => setCnpj(formatCnpj(e.target.value))}
                  onBlur={handleCnpjBlur}
                  required
                  placeholder="00.000.000/0000-00"
                />
              </div>
              <div className="space-y-2">
                <Label>Razão social *</Label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  placeholder="Sua empresa Ltda"
                />
              </div>
              <div className="space-y-2">
                <Label>Seu nome *</Label>
                <Input
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                  placeholder="Nome completo"
                />
              </div>
              <div className="space-y-2">
                <Label>Email corporativo *</Label>
                <Input
                  type="email"
                  autoComplete="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  required
                  placeholder="voce@empresa.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Senha *</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="mínimo 8 caracteres"
                />
              </div>

              <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={acceptedTerms}
                  onCheckedChange={(v) => setAcceptedTerms(!!v)}
                  className="mt-0.5"
                />
                <span>
                  Li e aceito os{" "}
                  <Link to="/termos" target="_blank" className="text-primary hover:underline">Termos de Uso</Link>{" "}
                  e a{" "}
                  <Link to="/privacidade" target="_blank" className="text-primary hover:underline">Política de Privacidade</Link>.
                </span>
              </label>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {loading ? "Criando conta..." : "Criar conta grátis"}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              Já tem conta?{" "}
              <Link to="/" className="text-primary hover:underline font-medium">
                Entrar
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}