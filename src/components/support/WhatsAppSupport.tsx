import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { buildWaLink } from '@/lib/whatsapp';

const MAX_LEN = 1000;

/**
 * Suporte por WhatsApp: o usuário escreve aqui, o app abre o WhatsApp dele já
 * com a mensagem (e empresa/usuário) preenchida pro número oficial da Aura.
 * Como a conversa é iniciada pelo cliente, abre a janela de 24h e a equipe
 * responde de graça pelo painel de WhatsApp.
 */
export function WhatsAppSupport({ onSent }: { onSent?: () => void }) {
  const { user, profile } = useAuth();
  const [message, setMessage] = useState('');

  const { data: companyName } = useQuery({
    queryKey: ['support-company-name', profile?.company_id],
    enabled: !!profile?.company_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('companies' as any)
        .select('name')
        .eq('id', profile!.company_id)
        .maybeSingle();
      return ((data as any)?.name as string | undefined) ?? '';
    },
  });

  function handleSend() {
    const text = message.trim();
    if (text.length < 5) {
      toast.error('Escreva sua mensagem para o suporte.');
      return;
    }
    const who = profile?.full_name || user?.email || 'Usuário';
    const header = [
      '*Suporte AuraComex*',
      companyName ? `Empresa: ${companyName}` : null,
      `Usuário: ${who}${user?.email && profile?.full_name ? ` (${user.email})` : ''}`,
    ].filter(Boolean).join('\n');

    window.open(buildWaLink(`${header}\n\n${text}`, 'suporte'), '_blank', 'noopener,noreferrer');
    setMessage('');
    toast.success('WhatsApp aberto — é só tocar em enviar.');
    onSent?.();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Como podemos ajudar?</Label>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
          placeholder="Descreva sua dúvida ou problema. Você fala direto com a equipe pelo WhatsApp."
          rows={6}
        />
        <p className="text-xs text-muted-foreground text-right">{message.length}/{MAX_LEN}</p>
      </div>
      <Button onClick={handleSend} className="w-full gap-2">
        <MessageCircle className="w-4 h-4" /> Enviar pelo WhatsApp
      </Button>
      <p className="text-xs text-muted-foreground">
        Ao enviar, abrimos o seu WhatsApp com a mensagem pronta. Nossa resposta chega na mesma conversa.
      </p>
    </div>
  );
}
