import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, Bell, BellOff, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { disablePush, enablePush, getPushState } from '@/lib/push';
import { Button } from '@/components/ui/button';
import { WhatsAppTab } from '@/components/superadmin/WhatsAppTab';

export default function WhatsAppAdmin() {
  const navigate = useNavigate();
  const [pushState, setPushState] = useState<'unsupported' | 'denied' | 'on' | 'off'>('off');

  useEffect(() => {
    getPushState().then(setPushState).catch(() => setPushState('unsupported'));
  }, []);

  const togglePush = async () => {
    try {
      if (pushState === 'on') await disablePush();
      else await enablePush();
      setPushState(await getPushState());
      toast.success(pushState === 'on' ? 'Avisos desativados' : 'Avisos ativados neste aparelho');
    } catch (e: any) {
      toast.error(e?.message ?? 'Não foi possível alterar os avisos');
    }
  };

  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      <header className="border-b border-border bg-card shrink-0">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} className="-ml-2">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <MessageCircle className="w-5 h-5 text-muted-foreground shrink-0" />
          <h1 className="text-lg font-semibold flex-1">WhatsApp</h1>
          {pushState !== 'unsupported' && (
            <Button
              variant={pushState === 'on' ? 'secondary' : 'default'}
              size="sm"
              onClick={togglePush}
              disabled={pushState === 'denied'}
              title={pushState === 'denied' ? 'Notificações bloqueadas nas configurações do navegador' : undefined}
            >
              {pushState === 'on' ? <BellOff className="w-4 h-4 mr-1.5" /> : <Bell className="w-4 h-4 mr-1.5" />}
              {pushState === 'on' ? 'Desativar avisos' : pushState === 'denied' ? 'Avisos bloqueados' : 'Ativar avisos'}
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 max-w-6xl mx-auto md:px-6 md:py-6 w-full flex flex-col">
        <WhatsAppTab />
      </div>
    </div>
  );
}
