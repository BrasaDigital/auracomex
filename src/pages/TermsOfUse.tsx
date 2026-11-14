import { LegalLayout } from "./LegalLayout";
import { KENARO_CNPJ, KENARO_CIDADE_UF } from "@/lib/legal";

export default function TermsOfUse() {
  return (
    <LegalLayout title="Termos de Uso" updatedAt="12 de novembro de 2026">
      <p>
        Estes Termos de Uso ("Termos") regem o acesso e a utilização da plataforma
        <strong> Aura Comex</strong> ("Plataforma", "Serviço"), disponibilizada por{" "}
        <strong>KENARO SOLUCOES LTDA</strong> ("Kenaro Soluções"), inscrita no CNPJ sob o nº{" "}
        {KENARO_CNPJ}, com sede em {KENARO_CIDADE_UF} ("Aura Comex", "nós").
      </p>
      <p>
        Ao criar uma conta, contratar um plano ou utilizar qualquer funcionalidade do Serviço,
        o usuário e a empresa que ele representa ("Cliente") declaram ter lido, compreendido e
        concordado integralmente com estes Termos e com a{" "}
        <a href="/privacidade">Política de Privacidade</a>.
      </p>

      <h2>1. Objeto</h2>
      <p>
        A Aura Comex é um software como serviço (SaaS) voltado a agentes de carga, freight
        forwarders e operadores logísticos, oferecendo funcionalidades de gestão de cotações,
        embarques, financeiro, cadastros, portal de tracking para clientes e ferramentas
        auxiliares de operação de comércio exterior.
      </p>

      <h2>2. Cadastro e Conta</h2>
      <ul>
        <li>O acesso é restrito a usuários convidados por um administrador da empresa contratante.</li>
        <li>O Cliente é responsável pela veracidade das informações fornecidas e por mantê-las atualizadas.</li>
        <li>As credenciais são pessoais e intransferíveis. O Cliente responde por toda atividade realizada em sua conta.</li>
        <li>O primeiro acesso exige troca de senha. Recomenda-se o uso de senhas fortes e únicas.</li>
      </ul>

      <h2>3. Planos, Pagamento e Cancelamento</h2>
      <ul>
        <li>Os planos, preços e limites vigentes estão descritos em <a href="/precos">/precos</a>.</li>
        <li>Os pagamentos são processados por gateway externo (Stripe). A Aura Comex não armazena dados de cartão.</li>
        <li>A cobrança é recorrente (mensal) conforme o plano contratado, com renovação automática.</li>
        <li>O Cliente pode cancelar a assinatura a qualquer momento pelo portal de faturamento; o acesso permanece ativo até o fim do ciclo já pago.</li>
        <li>Não há reembolso proporcional de períodos já iniciados, salvo determinação legal em contrário.</li>
        <li>Em caso de inadimplência, o acesso poderá ser suspenso após aviso, mantendo-se somente o modo de leitura para exportação de dados.</li>
      </ul>

      <h2>4. Uso Aceitável</h2>
      <p>O Cliente compromete-se a não:</p>
      <ul>
        <li>Utilizar o Serviço para atividades ilegais, fraudulentas ou que violem direitos de terceiros;</li>
        <li>Tentar acessar áreas restritas, contas de terceiros ou realizar engenharia reversa da Plataforma;</li>
        <li>Sobrecarregar, testar vulnerabilidades ou interferir na disponibilidade do Serviço sem autorização prévia por escrito;</li>
        <li>Enviar dados de terceiros sem base legal adequada nos termos da LGPD.</li>
      </ul>

      <h2>5. Propriedade dos Dados e do Software</h2>
      <ul>
        <li>
          <strong>Dados do Cliente:</strong> todos os documentos, cadastros, cotações, embarques e
          demais informações inseridos na Plataforma são de propriedade exclusiva da empresa
          contratante. A Aura Comex atua apenas como operadora desses dados.
        </li>
        <li>
          <strong>Software:</strong> o código-fonte, marca, layout, textos e demais elementos da
          Plataforma são de titularidade da Aura Comex e protegidos pela legislação de propriedade
          intelectual. Nenhuma licença de reprodução é concedida ao Cliente além do direito de uso durante a vigência do contrato.
        </li>
      </ul>

      <h2>6. Disponibilidade e Suporte</h2>
      <p>
        Envidamos esforços razoáveis para manter o Serviço disponível 24/7, ressalvadas paradas para
        manutenção programada, falhas de terceiros (provedores de infraestrutura, gateway de
        pagamento, APIs governamentais) e eventos de força maior. Suporte por e-mail em{" "}
        <a href="mailto:contato@auracomex.app">contato@auracomex.app</a>.
      </p>

      <h2>7. Limitação de Responsabilidade</h2>
      <p>
        A Aura Comex não se responsabiliza por decisões operacionais ou financeiras tomadas pelo
        Cliente com base nas informações da Plataforma, nem por prejuízos indiretos, lucros
        cessantes ou perda de oportunidade. A responsabilidade total, em qualquer hipótese, fica
        limitada ao valor efetivamente pago pelo Cliente nos 12 (doze) meses anteriores ao evento.
      </p>

      <h2>8. Encerramento da Conta</h2>
      <ul>
        <li>O Cliente pode encerrar sua conta a qualquer momento pelo painel de faturamento.</li>
        <li>
          Após o cancelamento, disponibilizamos por <strong>30 (trinta) dias</strong> o download
          completo de todos os dados e documentos armazenados. Após esse período, os dados são
          eliminados de nossos sistemas ativos, e as cópias de segurança são descartadas conforme o
          ciclo de rotação do provedor de infraestrutura, ressalvadas hipóteses de guarda
          obrigatória por lei.
        </li>
        <li>
          A Aura Comex pode suspender ou encerrar contas em caso de violação destes Termos, mediante notificação.
        </li>
      </ul>

      <h2>9. Alterações destes Termos</h2>
      <p>
        Podemos atualizar estes Termos a qualquer tempo. Alterações relevantes serão comunicadas
        por e-mail e/ou aviso na Plataforma com antecedência mínima de 15 dias. O uso continuado
        após a vigência implica aceite da nova versão.
      </p>

      <h2>10. Lei Aplicável e Foro</h2>
      <p>
        Estes Termos são regidos pela legislação brasileira. Fica eleito o foro da Comarca de
        São Caetano do Sul/SP para dirimir quaisquer controvérsias, com renúncia a qualquer outro por mais privilegiado que seja.
      </p>

      <h2>11. Contato</h2>
      <p>
        KENARO SOLUCOES LTDA — CNPJ {KENARO_CNPJ}<br />
        {KENARO_CIDADE_UF}<br />
        E-mail: <a href="mailto:contato@auracomex.app">contato@auracomex.app</a>
      </p>
    </LegalLayout>
  );
}