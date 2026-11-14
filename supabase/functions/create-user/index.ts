import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization")!;

    // Client with caller's token (to check permissions)
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client with service role
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Get caller info
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller role
    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();

    const body = await req.json();
    const { email, password, full_name, company_id, role, department } = body;

    if (!email || !password || !full_name || !role) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization checks
    const isSuperadmin = callerRole?.role === "superadmin";
    const isCompanyAdmin = callerRole?.role === "admin";

    if (!isSuperadmin && !isCompanyAdmin) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Superadmin can create admin users for any company
    // Company admin can only create users for their own company
    let targetCompanyId = company_id;

    if (isCompanyAdmin && !isSuperadmin) {
      // Get caller's company
      const { data: callerProfile } = await adminClient
        .from("profiles")
        .select("company_id")
        .eq("user_id", caller.id)
        .single();

      if (!callerProfile) {
        return new Response(JSON.stringify({ error: "Profile not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      targetCompanyId = callerProfile.company_id;

      // Company admin cannot create superadmin or admin roles
      if (role === "superadmin" || role === "admin") {
        return new Response(JSON.stringify({ error: "Cannot assign this role" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!targetCompanyId) {
      return new Response(JSON.stringify({ error: "company_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create user via admin API
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        company_id: targetCompanyId,
        role,
        department: department || null,
        must_change_password: "true",
      },
    });

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profileErr = await createProfileAndRole(adminClient, {
      userId: newUser.user.id,
      email,
      fullName: full_name,
      companyId: targetCompanyId,
      role,
      department: department || null,
      mustChangePassword: true,
    });
    if (profileErr) {
      await adminClient.auth.admin.deleteUser(newUser.user.id);
      return new Response(JSON.stringify({ error: "Falha ao criar o perfil do usuário: " + profileErr }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ user: newUser.user }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Cria o perfil e o papel do usuário recém-criado. Antes isso era feito por um gatilho em auth.users (handle_new_user)
// que NÃO existe no banco de produção (não foi recriado na migração do Lovable), então o login nascia sem perfil/papel.
// Os valores vêm DO CÓDIGO (já validados pela função), nunca dos metadados do cadastro, e a chave de servidor ignora RLS.
// Devolve a mensagem de erro, ou null se deu certo. Idempotente (não duplica se o gatilho um dia voltar).
async function createProfileAndRole(
  admin: any,
  p: { userId: string; email: string; fullName: string; companyId: string; role: string; department?: string | null; mustChangePassword: boolean },
): Promise<string | null> {
  const { error: profErr } = await admin.from("profiles").upsert(
    {
      user_id: p.userId,
      company_id: p.companyId,
      full_name: p.fullName || p.email,
      email: p.email,
      department: p.department ?? null,
      must_change_password: p.mustChangePassword,
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (profErr) return profErr.message;
  const { error: roleErr } = await admin.from("user_roles").upsert(
    { user_id: p.userId, role: p.role },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (roleErr) return roleErr.message;
  return null;
}
