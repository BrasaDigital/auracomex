import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Check, Menu, MessageCircle, Minus, X } from "lucide-react";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import ShipmentPanel from "@/components/landing/ShipmentPanel";
import "@/styles/landing.css";

const TITULO = "Aura Comex | Gestão de embarques e cotações para agentes de carga";
const DESCRICAO =
  "Aura Comex: plataforma para agentes de carga gerenciarem embarques, cotações, documentos e financeiro em um só lugar. Teste grátis por 14 dias.";

const WHATSAPP_NUMBER = "5511961573287";
const WHATSAPP_MESSAGE = "Olá! Vi a página do Aura Comex e quero saber mais.";

/**
 * Monta o link do wa.me embutindo a origem do clique (utm_source/utm_campaign
 * da URL, ou "ref" como atalho manual) no fim da mensagem pré-preenchida,
 * ex: "...quero saber mais.\n\n[origem: meta/lancamento-set]". O
 * whatsapp-webhook (Supabase Edge Function) lê esse marcador na primeira
 * mensagem pra gravar a origem do lead em whatsapp_contacts.source e depois
 * remove o marcador do corpo salvo — sem isso não dá pra saber de qual
 * anúncio/campanha um lead do WhatsApp veio.
 */
function buildWhatsappLink(): string {
  let origem: string | null = null;
  try {
    const params = new URLSearchParams(window.location.search);
    const source = params.get("utm_source");
    const campaign = params.get("utm_campaign");
    const ref = params.get("ref");
    if (source && campaign) origem = `${source}/${campaign}`;
    else if (campaign) origem = campaign;
    else if (source) origem = source;
    else if (ref) origem = ref;
  } catch {
    // window indisponível (SSR/teste) — segue sem origem
  }

  const message = origem ? `${WHATSAPP_MESSAGE}\n\n[origem: ${origem}]` : WHATSAPP_MESSAGE;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

const PRICING_SUMMARY = [
  {
    key: "basic",
    name: "Básico",
    price: "R$ 129,99",
    priceNote: "por usuário/mês, a partir do 3º usuário",
    description: "Para quem quer sair da planilha e organizar a operação.",
    features: ["Até 30 embarques/mês", "Usuários ilimitados", "Cotações + PDF profissional", "Financeiro (contas a pagar/receber)"],
    highlight: false,
  },
  {
    key: "professional",
    name: "Professional",
    price: "R$ 199,99",
    priceNote: "por usuário/mês, a partir do 3º usuário",
    description: "Para equipes que precisam de permissões e controle comercial.",
    features: ["Até 100 embarques/mês", "Tudo do Básico", "Perfis de acesso (RBAC) completos", "Comissão de vendedor com forecast"],
    highlight: true,
  },
  {
    key: "business",
    name: "Business",
    price: "Fale conosco",
    priceNote: "condições negociadas",
    description: "Para operações maiores, sem limites de embarques ou usuários.",
    features: ["Embarques ilimitados", "Tudo do Professional", "Múltiplas empresas", "Suporte dedicado"],
    highlight: false,
  },
];

const NAV_LINKS = [
  { href: "#recursos", label: "Recursos" },
  { href: "#comparativo", label: "Comparativo" },
  { href: "#planos", label: "Planos" },
  { href: "#perguntas", label: "Perguntas" },
];

const ARQUIVOS = [
  { nome: "cotacao_final_v3_AGORA.xlsx", tipo: "planilha" },
  { nome: "RE: RE: FW: booking confirmado?", tipo: "e-mail" },
  { nome: "BL_correto_NAO_USAR_o_outro.pdf", tipo: "documento" },
  { nome: "câmbio do dia (cópia).xlsx", tipo: "planilha" },
];

type Linha = { label: string; aura: boolean; tradicional: boolean; planilha: boolean };

const COMPARATIVO: Linha[] = [
  { label: "Preço acessível", aura: true, tradicional: false, planilha: true },
  { label: "Setup rápido (minutos)", aura: true, tradicional: false, planilha: true },
  { label: "Cotações profissionais", aura: true, tradicional: true, planilha: false },
  { label: "Controle financeiro", aura: true, tradicional: true, planilha: false },
  { label: "Fácil de usar", aura: true, tradicional: false, planilha: true },
  { label: "Gestão de documentos", aura: true, tradicional: true, planilha: false },
  { label: "Multi-usuário com permissões", aura: true, tradicional: true, planilha: false },
  { label: "Funciona no celular", aura: true, tradicional: false, planilha: true },
];

const PASSOS = [
  { titulo: "Crie sua conta", texto: "O cadastro leva menos de 2 minutos." },
  { titulo: "Configure sua operação", texto: "Cadastre clientes e parceiros e lance o primeiro embarque." },
  { titulo: "Deixe as planilhas de lado", texto: "Cotações, financeiro e documentos no mesmo lugar." },
];

const FAQ = [
  {
    q: "Posso ver o sistema antes de criar uma conta?",
    a: "Pode. A demonstração abre o Aura com uma empresa fictícia e dados de exemplo, sem cadastro. Os dados são reiniciados a cada hora.",
  },
  {
    q: "Quanto custa o Aura?",
    a: "O plano Básico começa em R$ 129,99 por usuário/mês e o Professional em R$ 199,99 por usuário/mês (valores a partir do 3º usuário). O Business é sob consulta, sem limites de embarques ou usuários. Veja todos os detalhes na página de preços.",
  },
  {
    q: "Preciso de cartão de crédito para testar?",
    a: "Não. O teste dura 14 dias e o cadastro não pede cartão de crédito.",
  },
  {
    q: "Preciso instalar alguma coisa?",
    a: "Não. O Aura funciona 100% no navegador. Basta acessar com login e senha, no computador, tablet ou celular.",
  },
  {
    q: "Funciona no celular?",
    a: "Sim. A plataforma é totalmente responsiva, então você acompanha seus processos de qualquer lugar.",
  },
  {
    q: "Quantos usuários posso ter?",
    a: "Depende do plano escolhido. Todos os planos permitem múltiplos usuários, com controle de permissão por perfil.",
  },
  {
    q: "Como migro meus dados?",
    a: "Nossa equipe pode ajudar na importação dos seus dados atuais durante o onboarding. Fale com a gente pelo WhatsApp.",
  },
];

function Landing() {
  const { data: platformSettings } = usePlatformSettings();
  const platformLogo = platformSettings?.logo_url;
  const [menuAberto, setMenuAberto] = useState(false);
  const whatsappLink = useMemo(() => buildWhatsappLink(), []);

  // A landing é uma rota dentro de um SPA: ajusta título e descrição enquanto está na tela.
  useEffect(() => {
    const tituloAnterior = document.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const descricaoAnterior = meta?.getAttribute("content") ?? null;
    document.title = TITULO;
    meta?.setAttribute("content", DESCRICAO);
    return () => {
      document.title = tituloAnterior;
      if (meta && descricaoAnterior !== null) meta.setAttribute("content", descricaoAnterior);
    };
  }, []);

  const fecharMenu = () => setMenuAberto(false);

  return (
    <div className="aura-landing">
      <a href="#conteudo" className="al-pular">
        Ir para o conteúdo
      </a>

      {/* Navegação */}
      <header className="al-nav">
        <div className="al-wrap">
          <div className="al-nav-linha">
            <Link to="/landing" className="al-marca" aria-label="Aura Comex, página inicial">
              {platformLogo ? (
                <img src={platformLogo} alt="Aura Comex" />
              ) : (
                <>
                  <span className="al-marca-nome">
                    <b>Aura</b> Comex
                  </span>
                  <span className="al-marca-sub">by Brasa Digital</span>
                </>
              )}
            </Link>

            <nav className="al-nav-links" aria-label="Seções da página">
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href}>
                  {l.label}
                </a>
              ))}
            </nav>

            <div className="al-nav-acoes">
              <Link to="/precos" className="al-entrar">
                Preços
              </Link>
              <Link to="/" className="al-entrar">
                Entrar
              </Link>
              <Link to="/signup" className="al-btn al-btn-ambar al-btn-pequeno">
                Começar grátis
              </Link>
            </div>

            <div className="al-nav-mobile-cta">
              <Link to="/signup" className="al-btn al-btn-ambar al-btn-pequeno">
                Começar grátis
              </Link>
              <button
                type="button"
                className="al-menu-btn"
                aria-expanded={menuAberto}
                aria-controls="menu-mobile"
                aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
                onClick={() => setMenuAberto((v) => !v)}
              >
                {menuAberto ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>

          {menuAberto && (
            <div id="menu-mobile" className="al-menu-painel">
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href} className="al-menu-item" onClick={fecharMenu}>
                  {l.label}
                </a>
              ))}
              <Link to="/precos" className="al-menu-item" onClick={fecharMenu}>
                Preços
              </Link>
              <Link to="/" className="al-menu-item" onClick={fecharMenu}>
                Entrar
              </Link>
              <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="al-menu-item">
                <MessageCircle size={20} color="#4cc38a" aria-hidden="true" />
                Falar no WhatsApp
              </a>
            </div>
          )}
        </div>
      </header>

      <main id="conteudo">
        {/* Hero */}
        <section className="al-hero">
          <div className="al-wrap al-hero-grade">
            <div className="al-hero-texto">
              <h1 className="al-h1">Seus embarques, do booking à entrega, em um só lugar.</h1>
              <p className="al-lead">
                O Aura Comex reúne embarques, cotações, documentos e financeiro para agentes de carga que operam com
                equipe enxuta.
              </p>
              <div className="al-hero-acoes">
                <Link to="/signup" className="al-btn al-btn-azul">
                  Começar grátis
                </Link>
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="al-btn al-btn-contorno">
                  <MessageCircle size={20} color="#2c7a58" aria-hidden="true" />
                  Falar no WhatsApp
                </a>
              </div>
              <p className="al-hero-nota">
                14 dias grátis, sem cartão de crédito. Prefere ver antes?{" "}
                <Link to="/demo" className="al-link">
                  Abra o sistema com dados de exemplo
                </Link>
                .
              </p>
            </div>

            <ShipmentPanel />
          </div>
        </section>

        {/* Problema */}
        <section className="al-secao al-secao-escura al-escuro" aria-labelledby="titulo-problema">
          <div className="al-wrap al-duas">
            <div className="al-duas-texto">
              <h2 id="titulo-problema" className="al-h2">
                Reconhece algum destes arquivos?
              </h2>
              <p className="al-texto al-suave">
                É assim que a informação de um processo se espalha. Horas se perdem copiando dados de um lugar para o
                outro, a cotação atrasa e o financeiro fica no escuro.
              </p>
              <p className="al-texto">
                No Aura, cada processo guarda cotação, documentos, andamento e financeiro juntos.
              </p>
            </div>
            <ul className="al-arquivos" aria-label="Exemplos de arquivos soltos">
              {ARQUIVOS.map((a) => (
                <li key={a.nome}>
                  {a.nome}
                  <span>{a.tipo}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Recursos */}
        <section id="recursos" className="al-secao" aria-labelledby="titulo-recursos">
          <div className="al-wrap">
            <div className="al-cabeca">
              <h2 id="titulo-recursos" className="al-h2">
                Do booking à prestação de contas
              </h2>
              <p className="al-lead al-suave">
                Tudo o que uma operação de frete internacional precisa, sem alternar entre cinco ferramentas.
              </p>
            </div>

            <div className="al-recursos">
              <article className="al-recurso">
                <h3 className="al-h3">Embarques</h3>
                <div className="al-recurso-texto">
                  <p className="al-texto">
                    Cada processo tem a própria linha do tempo, da reserva à entrega, com os documentos no mesmo lugar.
                  </p>
                  <ul className="al-lista">
                    <li>Marítimo FCL e LCL, aéreo, rodoviário e multimodal</li>
                    <li>Equipe inteira trabalhando no mesmo processo</li>
                    <li>Documentos e eventos anexados a cada embarque</li>
                  </ul>
                </div>
              </article>

              <article className="al-recurso">
                <h3 className="al-h3">Cotações</h3>
                <div className="al-recurso-texto">
                  <p className="al-texto">Monte a cotação, gere o PDF e envie ao cliente em minutos.</p>
                  <ul className="al-lista">
                    <li>PDF profissional pronto para enviar</li>
                    <li>Duplique cotações parecidas em vez de começar do zero</li>
                    <li>Histórico de alterações em cada cotação</li>
                  </ul>
                </div>
              </article>

              <article className="al-recurso">
                <h3 className="al-h3">Financeiro</h3>
                <div className="al-recurso-texto">
                  <p className="al-texto">Saiba quanto cada processo rende antes de fechar o mês.</p>
                  <ul className="al-lista">
                    <li>Contas a pagar e a receber, com câmbio e margem por processo</li>
                    <li>Notas de débito e prestação de contas por processo</li>
                    <li>Estimativa de custos do processo</li>
                    <li>Comissão de vendedor com forecast, no plano Professional</li>
                  </ul>
                </div>
              </article>

              <article className="al-recurso">
                <h3 className="al-h3">Rastreio para o cliente</h3>
                <div className="al-recurso-texto">
                  <p className="al-texto">
                    Seu cliente acompanha o embarque por um link protegido por PIN, sem precisar perguntar a você.
                    Disponível como complemento opcional.
                  </p>
                  <ul className="al-lista">
                    <li>Link público protegido por PIN</li>
                    <li>Você escolhe o que cada cliente pode ver</li>
                  </ul>
                </div>
              </article>
            </div>

            <p className="al-texto al-suave al-extras">
              Também incluído: controle de acesso por perfil, interface leve que funciona no celular e tour guiado no
              primeiro acesso.
            </p>
          </div>
        </section>

        {/* Comparativo */}
        <section id="comparativo" className="al-secao al-secao-papel" aria-labelledby="titulo-comparativo">
          <div className="al-wrap">
            <div className="al-cabeca">
              <h2 id="titulo-comparativo" className="al-h2">
                Como o Aura se compara
              </h2>
              <p className="al-lead al-suave">As alternativas que você provavelmente já usa ou já considerou.</p>
            </div>

            <div className="al-tabela-rolagem" role="region" aria-label="Tabela comparativa" tabIndex={0}>
              <table className="al-tabela">
                <caption className="al-sr">Comparação entre o Aura, sistemas tradicionais e planilhas</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="al-sr">Característica</span>
                    </th>
                    <th scope="col" className="al-col-aura">
                      Aura
                    </th>
                    <th scope="col">Sistemas tradicionais</th>
                    <th scope="col">Planilhas</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARATIVO.map((l) => (
                    <tr key={l.label}>
                      <th scope="row">{l.label}</th>
                      <td className="al-col-aura">
                        <Resposta sim={l.aura} destaque />
                      </td>
                      <td>
                        <Resposta sim={l.tradicional} />
                      </td>
                      <td>
                        <Resposta sim={l.planilha} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="al-rodape-tabela al-suave">
              Comparação entre categorias de solução, não entre produtos específicos.
            </p>
          </div>
        </section>

        {/* Como funciona */}
        <section className="al-secao" aria-labelledby="titulo-passos">
          <div className="al-wrap">
            <div className="al-cabeca">
              <h2 id="titulo-passos" className="al-h2">
                Comece em minutos
              </h2>
              <p className="al-lead al-suave">Sem contrato de fidelidade. Teste, avalie e decida com calma.</p>
            </div>
            <ol className="al-passos">
              {PASSOS.map((p, i) => (
                <li key={p.titulo} className="al-passo">
                  <span className="al-passo-numero" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3 className="al-h3">{p.titulo}</h3>
                  <p className="al-texto al-suave">{p.texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Sobre */}
        <section className="al-secao al-secao-papel" aria-labelledby="titulo-sobre">
          <div className="al-wrap">
            <h2 id="titulo-sobre" className="al-sr">
              Nossa missão
            </h2>
            <p className="al-missao">
              Tecnologia de ponta não deveria ser exclusividade dos grandes operadores. O Aura nasceu para dar a agentes
              de carga de qualquer tamanho uma plataforma completa, acessível e fácil de usar.
            </p>
            <p className="al-assinatura">Feito por quem entende logística, para quem vive logística.</p>
          </div>
        </section>

        {/* Planos */}
        <section id="planos" className="al-secao" aria-labelledby="titulo-planos">
          <div className="al-wrap">
            <div className="al-cabeca">
              <h2 id="titulo-planos" className="al-h2">
                Planos que cabem na sua operação
              </h2>
              <p className="al-lead al-suave">
                Todos os planos começam com 14 dias de teste. Complementos e todos os detalhes estão na{" "}
                <Link to="/precos" className="al-link">
                  página de preços
                </Link>
                .
              </p>
            </div>

            <div className="al-planos">
              {PRICING_SUMMARY.map((p) => (
                <article key={p.key} className={p.highlight ? "al-plano al-plano-destaque al-escuro" : "al-plano"}>
                  {p.highlight && <span className="al-plano-selo">Recomendado para equipes</span>}
                  <h3 className="al-plano-nome">{p.name}</h3>
                  <p className="al-texto al-suave">{p.description}</p>
                  <p className="al-plano-preco">{p.price}</p>
                  <p className="al-plano-nota">{p.priceNote}</p>
                  <ul className="al-plano-lista">
                    {p.features.map((f) => (
                      <li key={f}>
                        <Check size={16} strokeWidth={3} aria-hidden="true" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/precos"
                    className={
                      p.highlight ? "al-btn al-btn-ambar al-btn-cheio" : "al-btn al-btn-contorno al-btn-cheio"
                    }
                  >
                    Ver detalhes do {p.name}
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Perguntas */}
        <section id="perguntas" className="al-secao al-secao-papel" aria-labelledby="titulo-perguntas">
          <div className="al-wrap">
            <div className="al-cabeca">
              <h2 id="titulo-perguntas" className="al-h2">
                Perguntas frequentes
              </h2>
            </div>
            <Accordion type="single" collapsible className="al-faq">
              {FAQ.map((item, i) => (
                <AccordionItem key={item.q} value={`faq-${i}`} className="al-faq-item">
                  <AccordionTrigger className="al-faq-gatilho">{item.q}</AccordionTrigger>
                  <AccordionContent className="al-faq-resposta">{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* CTA final */}
        <section className="al-secao al-secao-escura al-escuro" aria-labelledby="titulo-cta">
          <div className="al-wrap al-cta">
            <h2 id="titulo-cta" className="al-h2">
              Pronto para deixar as planilhas de lado?
            </h2>
            <p className="al-lead al-suave">
              Crie sua conta ou fale com a gente para tirar as dúvidas antes de começar.
            </p>
            <div className="al-hero-acoes">
              <Link to="/signup" className="al-btn al-btn-ambar">
                Criar conta grátis
              </Link>
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="al-btn al-btn-contorno-claro"
              >
                <MessageCircle size={20} color="#4cc38a" aria-hidden="true" />
                Falar no WhatsApp
              </a>
            </div>
            <p className="al-texto al-suave">
              Quer olhar primeiro?{" "}
              <Link to="/demo" className="al-link">
                Abra a demonstração
              </Link>
              .
            </p>
          </div>
        </section>
      </main>

      {/* Rodapé */}
      <footer className="al-rodape">
        <div className="al-wrap al-rodape-grade">
          <div>
            <p className="al-marca-nome" style={{ color: "var(--al-nevoa)" }}>
              <b style={{ color: "var(--al-ambar)" }}>Aura</b> Comex
            </p>
            <p>by Brasa Digital</p>
          </div>
          <div>
            <div className="al-rodape-links">
              <Link to="/precos">Preços</Link>
              <Link to="/termos">Termos de uso</Link>
              <Link to="/privacidade">Privacidade</Link>
              <a href="mailto:contato@brasadigital.com.br">Contato</a>
            </div>
            <p>© {new Date().getFullYear()} Aura Comex. Todos os direitos reservados.</p>
            <p>contato@brasadigital.com.br</p>
            <p>CNPJ: 51.845.506/0001-32</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Resposta({ sim, destaque = false }: { sim: boolean; destaque?: boolean }) {
  if (sim) {
    return (
      <>
        <span className={destaque ? "al-sim" : "al-sim-neutro"} aria-hidden="true">
          <Check size={20} strokeWidth={destaque ? 3 : 2} />
        </span>
        <span className="al-sr">Sim</span>
      </>
    );
  }
  return (
    <>
      <span className="al-sim-neutro" aria-hidden="true">
        <Minus size={18} />
      </span>
      <span className="al-sr">Não</span>
    </>
  );
}

export default Landing;
