-- Perfil do agente virtual (Opensquad/Aurélio): acesso total aos dados do conector MCP, sem perfil admin.
alter type public.app_role add value if not exists 'assistente_virtual';
