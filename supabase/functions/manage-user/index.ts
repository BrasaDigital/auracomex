import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization")!;

    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerRole } = await adminClient
      .from("user_roles").select("role").eq("user_id", caller.id).single();
    const isSuperadmin = callerRole?.role === "superadmin";
    const isCompanyAdmin = callerRole?.role === "admin";
    if (!isSuperadmin && !isCompanyAdmin) {
      return new Response(JSON.stringify({ error: "Permissões insuficientes" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body.action as "list_status" | "toggle_active" | "set_temp_password" | "list_roles" | "set_role";

    // Ensure target users belong to caller's company (for admins)
    async function assertSameCompany(userIds: string[]) {
      if (isSuperadmin) return true;
      const { data: callerProfile } = await adminClient
        .from("profiles").select("company_id").eq("user_id", caller.id).single();
      if (!callerProfile) return false;
      const { data: targets } = await adminClient
        .from("profiles").select("user_id, company_id").in("user_id", userIds);
      // Todos os alvos precisam ter perfil E ser da mesma empresa (antes, um id sem perfil passava na checagem).
      return (targets || []).length === new Set(userIds).size &&
        (targets || []).every((t) => t.company_id === callerProfile.company_id);
    }

    if (action === "list_status") {
      const userIds: string[] = body.user_ids || [];
      if (userIds.length === 0) {
        return new Response(JSON.stringify({ statuses: {} }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!(await assertSameCompany(userIds))) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const statuses: Record<string, boolean> = {};
      for (const uid of userIds) {
        const { data } = await adminClient.auth.admin.getUserById(uid);
        const bannedUntil = (data?.user as any)?.banned_until;
        const isActive = !bannedUntil || new Date(bannedUntil) <= new Date();
        statuses[uid] = isActive;
      }
      return new Response(JSON.stringify({ statuses }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "toggle_active") {
      const userId: string = body.user_id;
      const active: boolean = !!body.active;
      if (!userId) {
        return new Response(JSON.stringify({ error: "user_id é obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (userId === caller.id) {
        return new Response(JSON.stringify({ error: "Você não pode desativar a si mesmo" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!(await assertSameCompany([userId]))) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: targetRole } = await adminClient
        .from("user_roles").select("role").eq("user_id", userId).single();
      if (targetRole?.role === "superadmin") {
        return new Response(JSON.stringify({ error: "Não é permitido alterar superadmin" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: active ? "none" : "876000h",
      } as any);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, active }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set_temp_password") {
      const userId: string = body.user_id;
      if (!userId) {
        return new Response(JSON.stringify({ error: "user_id é obrigatório" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!(await assertSameCompany([userId]))) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: targetRole } = await adminClient
        .from("user_roles").select("role").eq("user_id", userId).single();
      if (targetRole?.role === "superadmin") {
        return new Response(JSON.stringify({ error: "Não é permitido alterar superadmin" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Gera uma senha temporária aleatória (letras + números, sem caracteres ambíguos)
      const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      let tempPassword = "";
      const randomBytes = new Uint8Array(10);
      crypto.getRandomValues(randomBytes);
      for (let i = 0; i < 10; i++) tempPassword += chars[randomBytes[i] % chars.length];

      const { error: pwError } = await adminClient.auth.admin.updateUserById(userId, {
        password: tempPassword,
      });
      if (pwError) {
        return new Response(JSON.stringify({ error: pwError.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: profError } = await adminClient
        .from("profiles")
        .update({ must_change_password: true } as any)
        .eq("user_id", userId);
      if (profError) {
        return new Response(JSON.stringify({ error: profError.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, temp_password: tempPassword }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Papéis dos usuários da empresa. O banco só deixa quem não é superadmin ler a PRÓPRIA linha de user_roles,
    // então a tela de Usuários precisa desta ação para listar o papel dos demais.
    if (action === "list_roles") {
      const userIds: string[] = body.user_ids || [];
      if (userIds.length === 0) {
        return new Response(JSON.stringify({ roles: {} }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!(await assertSameCompany(userIds))) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: rows, error } = await adminClient
        .from("user_roles").select("user_id, role").in("user_id", userIds);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const roles: Record<string, string> = {};
      (rows || []).forEach((r: any) => { roles[r.user_id] = r.role; });
      return new Response(JSON.stringify({ roles }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Troca o papel de um usuário. Mesmas regras do convite/criação: admin de empresa só mexe em usuários da PRÓPRIA
    // empresa, não atribui nem altera "admin"/"superadmin" (só superadmin faz isso) e respeita o plano Básico.
    if (action === "set_role") {
      const userId: string = body.user_id;
      const role: string = body.role;
      const deny = (msg: string, status = 403) => new Response(JSON.stringify({ error: msg }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      if (!userId || !role) return deny("user_id e role são obrigatórios", 400);
      if (userId === caller.id) return deny("Você não pode alterar o seu próprio cargo", 400);
      if (role === "superadmin") return deny("Não é permitido atribuir este cargo");
      if (!(await assertSameCompany([userId]))) return deny("Forbidden");
      const { data: targetRole } = await adminClient
        .from("user_roles").select("role").eq("user_id", userId).maybeSingle();
      if (targetRole?.role === "superadmin") return deny("Não é permitido alterar superadmin");
      if (!isSuperadmin) {
        if (role === "admin" || targetRole?.role === "admin") return deny("Não é permitido atribuir ou alterar este cargo");
        const BASIC_PLAN_ROLES = ["admin", "operator", "financeiro", "viewer"];
        const { data: callerProfile } = await adminClient
          .from("profiles").select("company_id").eq("user_id", caller.id).single();
        const { data: companySub } = await adminClient
          .from("company_subscriptions").select("plan").eq("company_id", callerProfile?.company_id).maybeSingle();
        if (companySub?.plan === "starter" && !BASIC_PLAN_ROLES.includes(role)) {
          return deny("Este cargo requer o plano Professional ou superior.");
        }
      }
      const { error } = await adminClient
        .from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id" });
      if (error) return deny(error.message, 400);
      return new Response(JSON.stringify({ ok: true, role }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});