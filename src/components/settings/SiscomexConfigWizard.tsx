import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, Key, FileCode, CheckCircle2, AlertCircle, Loader2, Sparkles, ChevronRight, ChevronLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SiscomexConfigWizardProps {
  companyId: string;
  onComplete?: () => void;
}

type Step = 'intro' | 'credentials' | 'certificate' | 'test';

export function SiscomexConfigWizard({ companyId, onComplete }: SiscomexConfigWizardProps) {
  const [step, setStep] = useState<Step>('intro');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    consumerKey: '',
    consumerSecret: '',
    certificatePassword: '',
    certificateFile: null as File | null,
  });

  const nextStep = () => {
    if (step === 'intro') setStep('credentials');
    else if (step === 'credentials') setStep('certificate');
    else if (step === 'certificate') setStep('test');
  };

  const prevStep = () => {
    if (step === 'credentials') setStep('intro');
    else if (step === 'certificate') setStep('credentials');
    else if (step === 'test') setStep('certificate');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.pfx') && !file.name.endsWith('.p12')) {
        toast.error('Por favor, selecione um arquivo de certificado (.pfx ou .p12)');
        return;
      }
      setForm({ ...form, certificateFile: file });
    }
  };

  const handleSaveAndTest = async () => {
    setTesting(true);
    try {
      // 1. Upload certificate to private storage
      let certificatePath = '';
      if (form.certificateFile) {
        const fileExt = form.certificateFile.name.split('.').pop();
        certificatePath = `${companyId}/siscomex_cert_${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('company-certificates')
          .upload(certificatePath, form.certificateFile, { upsert: true });
        
        if (uploadError) throw uploadError;
      }

      // 2. Save configurations to database
      // Sem upsert de propósito: o upsert (INSERT ... ON CONFLICT DO UPDATE) exige permissão de LEITURA nas colunas de
      // segredo, que o navegador deixa de ter (migration 20261112135000_ocultar_segredos_siscomex.sql). Lê só colunas
      // liberadas (id) para saber se já existe e então faz update ou insert.
      const payload = {
        serpro_consumer_key: form.consumerKey,
        serpro_consumer_secret: form.consumerSecret,
        certificate_path: certificatePath || undefined,
        certificate_password: form.certificatePassword,
        is_active: true,
      };
      const { data: existing, error: existingError } = await supabase
        .from('company_siscomex_configs')
        .select('id')
        .eq('company_id', companyId)
        .maybeSingle();
      if (existingError) throw existingError;

      const { error: dbError } = existing
        ? await supabase.from('company_siscomex_configs').update(payload).eq('company_id', companyId)
        : await supabase.from('company_siscomex_configs').insert({ company_id: companyId, ...payload });

      if (dbError) throw dbError;

      // 3. Call Edge Function to test connection
      const { data, error: functionError } = await supabase.functions.invoke('siscomex-gateway', {
        body: { action: 'test_connection', company_id: companyId }
      });

      if (functionError) throw functionError;

      if (data?.success) {
        toast.success('Integração configurada e testada com sucesso!');
        onComplete?.();
      } else {
        throw new Error(data?.error || 'Falha ao testar conexão com Siscomex');
      }
    } catch (err: any) {
      console.error('Wizard error:', err);
      toast.error(err.message || 'Erro ao configurar integração');
    } finally {
      setTesting(false);
    }
  };

  const AuraMessage = ({ children }: { children: React.ReactNode }) => (
    <div className="flex gap-3 p-4 rounded-xl bg-primary/5 border border-primary/10 mb-6">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <div className="text-sm text-foreground/80 leading-relaxed italic">
        {children}
      </div>
    </div>
  );

  return (
    <div className="max-w-xl mx-auto py-4">
      <div className="flex justify-between mb-8 px-2">
        {(['intro', 'credentials', 'certificate', 'test'] as Step[]).map((s, i) => (
          <div key={s} className="flex flex-col items-center gap-2">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              step === s ? 'bg-primary text-primary-foreground' : 
              i < ['intro', 'credentials', 'certificate', 'test'].indexOf(step) ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {i < ['intro', 'credentials', 'certificate', 'test'].indexOf(step) ? <CheckCircle2 className="h-5 w-5" /> : i + 1}
            </div>
          </div>
        ))}
      </div>

      {step === 'intro' && (
        <Card className="glass animate-in fade-in slide-in-from-bottom-4">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-2">
              <Shield className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Passo 1: Introdução</span>
            </div>
            <CardTitle>Configuração Siscomex</CardTitle>
            <CardDescription>
              Personalize sua integração para buscar alíquotas oficiais diretamente do Governo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AuraMessage>
              Olá! Eu sou a Aura. Vou te ajudar a configurar a busca de impostos. 
              <strong>Dica:</strong> Se você não tiver o Integra Comex (Serpro), não se preocupe! 
              O sistema já possui uma <strong>base gratuita de referência</strong> que funciona automaticamente para os NCMs mais comuns.
            </AuraMessage>
            <div className="space-y-3">
              <p className="text-sm font-medium">Deseja configurar o acesso oficial (Opcional)?</p>
              <p className="text-xs text-muted-foreground">O acesso oficial permite dados 100% atualizados em tempo real diretamente do Siscomex, mas requer assinatura do Serpro.</p>
            </div>
            <Button className="w-full mt-4" onClick={nextStep}>
              Configurar Acesso Oficial <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
            <p className="text-[10px] text-center text-muted-foreground mt-4 italic">
              Se preferir usar apenas a base gratuita, nenhuma configuração é necessária aqui.
            </p>

          </CardContent>
        </Card>
      )}

      {step === 'credentials' && (
        <Card className="glass animate-in fade-in slide-in-from-right-4">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-2">
              <Key className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Passo 2: Credenciais API</span>
            </div>
            <CardTitle>Acesso Serpro</CardTitle>
            <CardDescription>
              Informe suas chaves de acesso obtidas no portal Integra Comex.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AuraMessage>
              Essas chaves permitem que o sistema se identifique perante o Serpro. 
              Você as encontra no "Cockpit" do desenvolvedor após assinar o serviço Integra Comex.
            </AuraMessage>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="consumerKey">Consumer Key</Label>
                <Input 
                  id="consumerKey" 
                  value={form.consumerKey} 
                  onChange={(e) => setForm({...form, consumerKey: e.target.value})}
                  placeholder="Seu identificador de cliente"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="consumerSecret">Consumer Secret</Label>
                <Input 
                  id="consumerSecret" 
                  type="password"
                  value={form.consumerSecret} 
                  onChange={(e) => setForm({...form, consumerSecret: e.target.value})}
                  placeholder="Seu segredo de cliente"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="ghost" className="flex-1" onClick={prevStep}>
                <ChevronLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button className="flex-[2]" onClick={nextStep} disabled={!form.consumerKey || !form.consumerSecret}>
                Próximo Passo <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'certificate' && (
        <Card className="glass animate-in fade-in slide-in-from-right-4">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-2">
              <FileCode className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Passo 3: Certificado Digital</span>
            </div>
            <CardTitle>Certificado A1</CardTitle>
            <CardDescription>
              O certificado é essencial para assinar as requisições e provar a identidade da sua empresa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AuraMessage>
              Fique tranquilo(a)! O seu certificado será armazenado em um ambiente de alta segurança 
              e nunca será compartilhado com terceiros. Ele é usado apenas para a comunicação oficial.
            </AuraMessage>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="certificate">Arquivo do Certificado (.pfx / .p12)</Label>
                <div 
                  className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileCode className={`h-8 w-8 ${form.certificateFile ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium">
                    {form.certificateFile ? form.certificateFile.name : 'Clique para selecionar o arquivo'}
                  </span>
                  <input 
                    ref={fileInputRef}
                    type="file" 
                    className="hidden" 
                    accept=".pfx,.p12"
                    onChange={handleFileChange}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="certPassword">Senha do Certificado</Label>
                <Input 
                  id="certPassword" 
                  type="password"
                  value={form.certificatePassword} 
                  onChange={(e) => setForm({...form, certificatePassword: e.target.value})}
                  placeholder="Digite a senha do arquivo"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="ghost" className="flex-1" onClick={prevStep}>
                <ChevronLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button className="flex-[2]" onClick={nextStep} disabled={!form.certificateFile || !form.certificatePassword}>
                Revisar e Testar <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'test' && (
        <Card className="glass animate-in fade-in slide-in-from-right-4">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary mb-2">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Passo 4: Finalização</span>
            </div>
            <CardTitle>Tudo Pronto!</CardTitle>
            <CardDescription>
              Vamos validar as informações e realizar um teste de conexão.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AuraMessage>
              Estamos quase lá! Ao clicar em "Salvar e Testar", eu farei uma chamada rápida 
              ao Siscomex para garantir que tudo foi configurado corretamente.
            </AuraMessage>
            
            <div className="rounded-lg bg-muted/50 p-4 space-y-2 border border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Consumer Key:</span>
                <span className="font-mono">{form.consumerKey.substring(0, 8)}...</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Certificado:</span>
                <span>{form.certificateFile?.name}</span>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button variant="ghost" className="flex-1" onClick={prevStep} disabled={testing}>
                <ChevronLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button 
                className="flex-[2]" 
                onClick={handleSaveAndTest} 
                disabled={testing}
              >
                {testing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Testando Conexão...
                  </>
                ) : (
                  <>Salvar e Testar Conexão</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}