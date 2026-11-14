import { LegalLayout } from "./LegalLayout";
import { KENARO_CNPJ, KENARO_CIDADE_UF } from "@/lib/legal";

export default function PrivacyPolicy() {
  return (
    <LegalLayout title="Política de Privacidade (LGPD)" updatedAt="12 de novembro de 2026">
      <p>
        Esta Política de Privacidade descreve como a <strong>Aura Comex</strong>, operada por{" "}
        <strong>KENARO SOLUCOES LTDA</strong> ("Kenaro Soluções"), inscrita no CNPJ sob o nº{" "}
        {KENARO_CNPJ}, com sede em {KENARO_CIDADE_UF} ("nós"), trata dados pessoais no âmbito de
        sua plataforma SaaS, em conformidade com a Lei nº 13.709/2018 (LGPD).
      </p>

      <h2>1. Papéis no Tratamento de Dados</h2>
      <ul>
        <li>
          <strong>Cliente contratante (empresa):</strong> atua como <em>Controlador</em> dos dados
          pessoais que insere na Plataforma (parceiros, contatos, funcionários, clientes finais).
        </li>
        <li>
          <strong>Kenaro Soluções (Aura Comex):</strong> atua como <em>Operadora</em> dos dados
          inseridos pelo Cliente, tratando-os exclusivamente conforme as instruções do Cliente e
          o contrato firmado.
        </li>
        <li>
          Para dados dos próprios usuários da conta (login, cobrança, uso da Plataforma), a
          Kenaro Soluções atua como <em>Controladora</em>.
        </li>
      </ul>

      <h2>2. Dados Coletados</h2>
      <h3>2.1. Dados de conta e cobrança (Controladora: Kenaro Soluções)</h3>
      <ul>
        <li>Nome, e-mail corporativo, telefone e cargo do usuário;</li>
        <li>Empresa, CNPJ, endereço e dados de faturamento;</li>
        <li>Dados de pagamento processados pela Stripe (não armazenamos número de cartão);</li>
        <li>Logs de acesso: IP, data/hora, dispositivo e navegador.</li>
      </ul>
      <h3>2.2. Dados operacionais (Operadora — inseridos pelo Cliente)</h3>
      <ul>
        <li>Cadastros de parceiros, clientes, fornecedores, portos, taxas e comissões;</li>
        <li>Cotações, embarques, documentos anexados e comunicações operacionais;</li>
        <li>Dados financeiros da operação logística.</li>
      </ul>

      <h2>3. Bases Legais e Finalidades</h2>
      <ul>
        <li><strong>Execução de contrato</strong> — prestar o serviço, autenticar usuários, processar pagamentos, suportar operações;</li>
        <li><strong>Cumprimento de obrigação legal</strong> — emissão fiscal, guarda contábil, atendimento a autoridades;</li>
        <li><strong>Legítimo interesse</strong> — segurança da plataforma, prevenção a fraude, métricas agregadas de uso, melhoria do produto;</li>
        <li><strong>Consentimento</strong> — comunicações de marketing (opt-in), quando aplicável.</li>
      </ul>

      <h2>4. Compartilhamento com Terceiros (Suboperadores)</h2>
      <p>Utilizamos os seguintes provedores, todos com contratos que asseguram padrões de segurança e privacidade:</p>
      <ul>
        <li><strong>Infraestrutura de nuvem e banco de dados</strong> — armazenamento seguro, autenticação e execução da Plataforma;</li>
        <li><strong>Stripe</strong> — processamento de pagamentos e assinaturas;</li>
        <li><strong>Provedores de e-mail transacional</strong> — envio de convites, recuperação de senha e notificações;</li>
        <li><strong>APIs públicas</strong> (ex.: BrasilAPI, AwesomeAPI) — consulta de CNPJ e cotações de câmbio.</li>
      </ul>
      <p>Não vendemos, alugamos ou cedemos dados pessoais a terceiros para fins de marketing.</p>

      <h2>5. Transferência Internacional</h2>
      <p>
        Parte da infraestrutura pode estar localizada fora do Brasil. Nesses casos, garantimos
        cláusulas contratuais adequadas e nível de proteção compatível com a LGPD.
      </p>

      <h2>6. Retenção e Eliminação</h2>
      <ul>
        <li>Dados operacionais são mantidos enquanto a conta estiver ativa.</li>
        <li>
          <strong>Após o cancelamento, disponibilizamos por 30 (trinta) dias o download completo
          de todos os dados e documentos.</strong> Encerrado esse prazo, eliminamos os dados de
          nossos sistemas ativos; as cópias de segurança são descartadas conforme o ciclo de
          rotação do provedor de infraestrutura.
        </li>
        <li>
          Registramos, para fins de comprovação, a data e hora, o endereço IP e a versão dos Termos
          e desta Política aceitos no cadastro, mantidos enquanto necessários para a defesa de
          direitos da Kenaro Soluções.
        </li>
        <li>
          Dados sujeitos a guarda obrigatória (fiscal, contábil, judicial) podem ser retidos pelo
          prazo legal, mesmo após a exclusão da conta, sob acesso restrito. Em especial, mantemos
          os registros financeiros e de cobrança da conta e os registros de acesso à Plataforma (por 6 meses).
        </li>
      </ul>

      <h2>7. Segurança</h2>
      <ul>
        <li>Criptografia em trânsito (HTTPS/TLS) nas conexões com a Plataforma;</li>
        <li>Armazenamento em provedor de infraestrutura de nuvem que aplica criptografia em repouso;</li>
        <li>Isolamento dos dados de cada empresa por regras de acesso no banco de dados (Row-Level Security) e perfis de usuário com permissões por função;</li>
        <li>Solicitação de troca de senha no primeiro acesso de contas criadas por convite ou por um administrador;</li>
        <li>Registro de acessos (IP, data e hora) e histórico de alterações em cotações e processos;</li>
        <li>Cópias de segurança periódicas mantidas pelo provedor de infraestrutura.</li>
      </ul>
      <p>
        Nenhum sistema é 100% imune a incidentes. Em caso de incidente de segurança relevante,
        notificaremos os titulares e a ANPD conforme os prazos da LGPD.
      </p>

      <h2>8. Direitos do Titular (Art. 18 da LGPD)</h2>
      <p>Você pode, a qualquer momento, solicitar:</p>
      <ul>
        <li>Confirmação da existência de tratamento;</li>
        <li>Acesso aos seus dados;</li>
        <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
        <li>Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade;</li>
        <li>Portabilidade dos dados;</li>
        <li>Informação sobre o compartilhamento com terceiros;</li>
        <li>Revogação de consentimento.</li>
      </ul>
      <p>
        Para exercer qualquer desses direitos, envie um e-mail para{" "}
        <a href="mailto:contato@auracomex.app">contato@auracomex.app</a>. Respondemos em até 15 dias.
      </p>

      <h2>9. Cookies</h2>
      <p>
        Utilizamos cookies estritamente necessários para autenticação e funcionamento da Plataforma,
        além de cookies analíticos agregados para melhoria da experiência. Você pode gerenciá-los
        nas configurações do seu navegador.
      </p>

      <h2>10. Encarregado pelo Tratamento de Dados (DPO)</h2>
      <p>
        O Encarregado pelo Tratamento de Dados Pessoais é representado pelo sócio-administrador da
        Kenaro Soluções e pode ser contatado em{" "}
        <a href="mailto:contato@auracomex.app">contato@auracomex.app</a> para dúvidas, solicitações
        de titular ou comunicações relacionadas à privacidade.
      </p>

      <h2>11. Alterações desta Política</h2>
      <p>
        Podemos atualizar esta Política periodicamente. Mudanças relevantes serão comunicadas por
        e-mail e/ou aviso na Plataforma. Recomendamos revisão periódica.
      </p>

      <h2>12. Contato</h2>
      <p>
        KENARO SOLUCOES LTDA — CNPJ {KENARO_CNPJ}<br />
        {KENARO_CIDADE_UF}<br />
        E-mail: <a href="mailto:contato@auracomex.app">contato@auracomex.app</a>
      </p>
    </LegalLayout>
  );
}