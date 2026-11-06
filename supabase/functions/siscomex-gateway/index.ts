import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { action, company_id, ncm } = await req.json()

    if (action === 'test_connection') {
      // 1. Fetch config
      const { data: config, error: configError } = await supabase
        .from('company_siscomex_configs')
        .select('*')
        .eq('company_id', company_id)
        .single()

      if (configError || !config) {
        throw new Error('Configurações não encontradas para esta empresa')
      }

      // Mocking successful connection for now if it's a test
      // In a real scenario, we would:
      // a) Download .pfx from storage
      // b) Authenticate with Serpro OAuth2
      // c) Use .pfx for MTLS check if needed
      
      console.log(`Testing connection for company ${company_id} using key ${config.serpro_consumer_key.substring(0, 5)}...`)
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1500))

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Conexão validada com sucesso (Simulado)' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (action === 'get_ncm_rates') {
      if (!ncm) throw new Error('NCM é obrigatório')

      const cleanNcm = ncm.replace(/\D/g, '')
      if (cleanNcm.length !== 8) throw new Error('NCM deve ter 8 dígitos')
      console.log(`Consultando Tabelas Fiscais (dados oficiais NCM/TEC/TIPI) para NCM: ${cleanNcm}`)

      // Busca real de II e IPI na API pública "Tabelas Fiscais" — sem chave,
      // dados de fonte oficial (Siscomex/Receita Federal/MDIC-Gecex).
      // Substituiu uma implementação anterior que retornava valores
      // hardcoded no código rotulados como "Receita Federal (Oficial)" sem
      // consultar nada de verdade — não reintroduzir esse padrão.
      const apiResponse = await fetch(`https://tabelasfiscais.com.br/api/v1/ncm/${cleanNcm}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (apiResponse.status === 404) {
        throw new Error(`NCM ${cleanNcm} não encontrado na tabela oficial.`);
      }
      if (!apiResponse.ok) {
        throw new Error(`Falha ao consultar Tabelas Fiscais (status ${apiResponse.status}).`);
      }

      const ncmData = await apiResponse.json();
      const iiAliquota = ncmData?.ii?.aliquota != null ? parseFloat(ncmData.ii.aliquota) : null;
      const ipiAliquota = ncmData?.ipi?.aliquota != null ? parseFloat(ncmData.ipi.aliquota) : null;

      if (iiAliquota === null) {
        throw new Error(`Alíquota de II indisponível para o NCM ${cleanNcm} na fonte consultada.`);
      }
      // IPI pode vir null na fonte (ex: NCM com IPI variando por subcódigo da TIPI).
      // Nesse caso NÃO assumimos valor: devolvemos ipi=null e o front mantém o IPI atual.

      // PIS/COFINS-Importação: não há uma API pública gratuita de alíquota
      // por NCM equivalente à do II/IPI (o regime monofásico/diferenciado
      // depende de enquadramento específico do produto). Retornamos a
      // alíquota geral do regime (Lei 10.865/2004) e sinalizamos isso
      // explicitamente em vez de fingir que foi consultada por NCM.
      const rates = {
        ii: iiAliquota,
        ipi: ipiAliquota,
        pis: 2.1,
        cofins: 9.65,
      };

      return new Response(JSON.stringify({
        success: true,
        source: 'II/IPI: Tabelas Fiscais (dados oficiais Siscomex/Receita Federal/MDIC-Gecex) — PIS/COFINS: alíquota geral do regime de importação (Lei 10.865/2004), não específica por NCM',
        ncm_descricao: ncmData?.descricao || null,
        ipi_indisponivel: ipiAliquota === null,
        timestamp: new Date().toISOString(),
        rates,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }



    throw new Error('Ação inválida')

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})