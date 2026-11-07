import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Send, Bot, Clock } from "lucide-react";

interface WhatsappContact {
  id: string;
  phone: string;
  name: string | null;
  status: "lead" | "client" | "descartado";
  last_message_at: string | null;
  source: string | null;
  ai_paused: boolean | null;
  triage_step: string | null;
}

interface WhatsappMessage {
  id: string;
  contact_id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  message_type: string;
  status: string;
  created_at: string;
  sent_by_name: string | null;
}

function formatPhone(phone: string) {
  const match = phone.match(/^55(\d{2})(\d{5})(\d{4})$/);
  if (!match) return `+${phone}`;
  return `+55 (${match[1]}) ${match[2]}-${match[3]}`;
}

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function WhatsAppTab() {
  const queryClient = useQueryClient();
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: contacts = [], isLoading: loadingContacts } = useQuery({
    queryKey: ["whatsapp_contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_contacts")
        .select("id, phone, name, status, last_message_at, source, ai_paused, triage_step")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data as unknown as WhatsappContact[];
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["whatsapp_messages", selectedContactId],
    queryFn: async () => {
      if (!selectedContactId) return [];
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("id, contact_id, direction, body, message_type, status, created_at, sent_by_name")
        .eq("contact_id", selectedContactId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as WhatsappMessage[];
    },
    enabled: !!selectedContactId,
  });

  useEffect(() => {
    const channel = supabase
      .channel("whatsapp-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["whatsapp_messages"] });
          queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_contacts" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedContactId) ?? null,
    [contacts, selectedContactId],
  );

  // Janela de 24h: texto livre só é aceito até 24h após a última mensagem do cliente.
  const windowHoursLeft = useMemo(() => {
    const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
    if (!lastInbound) return 0;
    const left = 24 - (Date.now() - new Date(lastInbound.created_at).getTime()) / 3600000;
    return Math.max(0, left);
  }, [messages]);
  const windowOpen = windowHoursLeft > 0;

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedContact) throw new Error("Nenhum contato selecionado");
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { phone: selectedContact.phone, body: draft },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["whatsapp_messages", selectedContactId] });
    },
    onError: (err: any) => {
      // Fora da janela de 24h desde a última mensagem do cliente, a Graph API
      // rejeita texto livre — nesse caso é preciso enviar um template aprovado.
      toast.error(err?.message ?? "Falha ao enviar mensagem");
    },
  });

  return (
    <div className="flex flex-1 min-h-0 md:min-h-[420px] md:border md:rounded-lg overflow-hidden bg-card">
      {/* Lista de contatos — some no celular quando uma conversa está aberta */}
      <div
        className={cn(
          "w-full md:w-80 border-r flex-col shrink-0",
          selectedContactId ? "hidden md:flex" : "flex",
        )}
      >
        <div className="px-4 py-3 border-b bg-[#008069] text-white">
          <h3 className="font-semibold">Conversas</h3>
          <p className="text-xs text-white/80">Prospecção e atendimento AuraComex</p>
        </div>
        <ScrollArea className="flex-1">
          {loadingContacts && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
          {contacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => setSelectedContactId(contact.id)}
              className={cn(
                "w-full flex items-center gap-3 p-3 text-left border-b hover:bg-muted/50 transition-colors",
                selectedContactId === contact.id && "bg-muted",
              )}
            >
              <Avatar>
                <AvatarFallback>{(contact.name ?? contact.phone).slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-medium truncate">{contact.name ?? formatPhone(contact.phone)}</p>
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(contact.last_message_at)}</span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{formatPhone(contact.phone)}</p>
                  {contact.source && (
                    <span className="text-[10px] text-muted-foreground/70 truncate border rounded px-1 shrink-0">
                      {contact.source}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge variant={contact.status === "client" ? "default" : "secondary"}>
                  {contact.status === "client" ? "Cliente" : contact.status === "lead" ? "Lead" : "Descartado"}
                </Badge>
                {contact.triage_step && contact.triage_step !== "done" && (
                  <span className="text-[10px] text-amber-600 font-medium">em triagem</span>
                )}
                {contact.triage_step === "done" && (
                  <span className="text-[10px] text-emerald-600 font-medium">triado</span>
                )}
              </div>
            </button>
          ))}
          {!loadingContacts && contacts.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
          )}
        </ScrollArea>
      </div>

      {/* Thread de mensagens — some no celular quando nenhuma conversa está aberta */}
      <div className={cn("flex-1 flex-col min-w-0", selectedContactId ? "flex" : "hidden md:flex")}>
        {selectedContact ? (
          <>
            <div className="px-3 py-2.5 border-b shrink-0 flex items-center gap-2 bg-[#008069] text-white">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden shrink-0 text-white hover:bg-white/10 hover:text-white"
                onClick={() => setSelectedContactId(null)}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-white/20 text-white text-xs">
                  {(selectedContact.name ?? selectedContact.phone).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate leading-tight">{selectedContact.name ?? formatPhone(selectedContact.phone)}</p>
                <p className="text-xs text-white/80 truncate">
                  {formatPhone(selectedContact.phone)}
                  {selectedContact.source && ` · ${selectedContact.source}`}
                </p>
              </div>
              {selectedContact.ai_paused && (
                <span className="text-[10px] flex items-center gap-1 bg-white/15 rounded px-1.5 py-0.5 shrink-0">
                  <Bot className="w-3 h-3" /> IA pausada
                </span>
              )}
            </div>
            <div
              className={cn(
                "px-3 py-1 text-[11px] flex items-center gap-1.5 shrink-0",
                windowOpen ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
              )}
            >
              <Clock className="w-3 h-3" />
              {windowOpen
                ? `Janela de resposta aberta — ${Math.floor(windowHoursLeft)}h${String(Math.floor((windowHoursLeft % 1) * 60)).padStart(2, "0")} restantes (grátis)`
                : "Janela de 24h fechada — só dá para enviar template aprovado"}
            </div>
            <ScrollArea className="flex-1 p-3 bg-[#efeae2] dark:bg-zinc-900" ref={scrollRef}>
              <div className="flex flex-col gap-2">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "max-w-[85%] md:max-w-[70%] rounded-lg px-3 py-1.5 text-sm shadow-sm text-zinc-900",
                      msg.direction === "outbound"
                        ? "self-end bg-[#d9fdd3] rounded-tr-none"
                        : "self-start bg-white rounded-tl-none",
                    )}
                  >
                    {msg.direction === "outbound" && (
                      <p className="text-[11px] font-semibold text-[#008069] mb-0.5">
                        {msg.sent_by_name ?? (msg.message_type === "template" ? "Template" : "🤖 Automático")}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.body ?? (msg.message_type !== "text" ? `[${msg.message_type}]` : "")}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5 text-right">
                      {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      {msg.direction === "outbound" && ` · ${msg.status === "read" ? "✓✓ lida" : msg.status === "delivered" ? "✓✓" : msg.status === "failed" ? "falhou" : "✓"}`}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t flex gap-2 items-center shrink-0 bg-[#f0f2f5] dark:bg-zinc-800">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={windowOpen ? "Mensagem" : "Janela fechada"}
                disabled={!windowOpen}
                className="rounded-full bg-white dark:bg-zinc-900"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && draft.trim() && windowOpen) {
                    e.preventDefault();
                    sendMutation.mutate();
                  }
                }}
              />
              <Button
                size="icon"
                className="rounded-full shrink-0 bg-[#008069] hover:bg-[#006d59] text-white"
                onClick={() => sendMutation.mutate()}
                disabled={!draft.trim() || !windowOpen || sendMutation.isPending}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Selecione uma conversa
          </div>
        )}
      </div>
    </div>
  );
}
