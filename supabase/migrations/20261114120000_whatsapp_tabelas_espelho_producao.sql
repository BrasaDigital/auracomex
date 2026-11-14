-- ESPELHO do que já existe em produção (lido do catálogo em 14/11/2026): tabelas do WhatsApp da própria AuraComex
-- (leads/suporte) e as assinaturas de Web Push do superadmin. Foram criadas por migrações aplicadas direto no banco e
-- nunca entraram no repositório; sem este arquivo, recriar o projeto Supabase perderia a funcionalidade.
-- NÃO precisa ser aplicado em produção (tudo é IF NOT EXISTS / idempotente). As Edge Functions que usam estas tabelas
-- (whatsapp-webhook, whatsapp-send) estão em supabase/functions/.
--
-- Não são dados de cliente da plataforma: nenhuma coluna de company_id de tenant; só o superadmin lê e escreve.

CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text NOT NULL,
  name            text,
  status          text NOT NULL DEFAULT 'lead',
  company_ref_id  uuid REFERENCES public.companies(id),
  notes           text,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  source          text,
  ai_paused       boolean NOT NULL DEFAULT false,
  ai_paused_reason text,
  triage_step     text,
  triage_data     jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT whatsapp_contacts_phone_key UNIQUE (phone),
  CONSTRAINT whatsapp_contacts_status_check CHECK (status = ANY (ARRAY['lead'::text, 'client'::text, 'descartado'::text]))
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  direction     text NOT NULL,
  wa_message_id text,
  message_type  text NOT NULL DEFAULT 'text',
  body          text,
  template_name text,
  status        text NOT NULL DEFAULT 'received',
  raw_payload   jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_by_name  text,
  CONSTRAINT whatsapp_messages_wa_message_id_key UNIQUE (wa_message_id),
  CONSTRAINT whatsapp_messages_direction_check CHECK (direction = ANY (ARRAY['inbound'::text, 'outbound'::text])),
  CONSTRAINT whatsapp_messages_status_check CHECK (status = ANY (ARRAY['received'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text]))
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_contact_id_idx ON public.whatsapp_messages USING btree (contact_id);
CREATE INDEX IF NOT EXISTS whatsapp_messages_created_at_idx ON public.whatsapp_messages USING btree (created_at);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)
);

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_contacts' AND policyname='superadmin_all') THEN
    CREATE POLICY "superadmin_all" ON public.whatsapp_contacts FOR ALL TO public
      USING (is_superadmin()) WITH CHECK (is_superadmin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_messages' AND policyname='superadmin_all') THEN
    CREATE POLICY "superadmin_all" ON public.whatsapp_messages FOR ALL TO public
      USING (is_superadmin()) WITH CHECK (is_superadmin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='push_subscriptions' AND policyname='superadmin gerencia suas assinaturas push') THEN
    CREATE POLICY "superadmin gerencia suas assinaturas push" ON public.push_subscriptions FOR ALL TO authenticated
      USING (is_superadmin() AND (user_id = auth.uid())) WITH CHECK (is_superadmin() AND (user_id = auth.uid()));
  END IF;
END $$;

-- Atualização em tempo real do painel /admin/whatsapp (publicação do Supabase Realtime).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='whatsapp_contacts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_contacts;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='whatsapp_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
END $$;
