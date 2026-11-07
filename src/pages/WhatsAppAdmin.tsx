import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WhatsAppTab } from '@/components/superadmin/WhatsAppTab';

export default function WhatsAppAdmin() {
  const navigate = useNavigate();

  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      <header className="border-b border-border bg-card shrink-0">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')} className="-ml-2">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <MessageCircle className="w-5 h-5 text-muted-foreground shrink-0" />
          <h1 className="text-lg font-semibold">WhatsApp</h1>
        </div>
      </header>

      <div className="flex-1 min-h-0 max-w-6xl mx-auto md:px-6 md:py-6 w-full flex flex-col">
        <WhatsAppTab />
      </div>
    </div>
  );
}
