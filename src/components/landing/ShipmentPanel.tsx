import { Check } from "lucide-react";

/**
 * Exemplo ilustrativo de um embarque no Aura Comex, para o hero da landing.
 * Os marcos são os mesmos da linha do tempo real do sistema (ver
 * STATUS_CATEGORY_LABELS em src/lib/shipmentStatusCategory.ts). Os dados
 * (contêiner, cliente, prazo) são fictícios e a ficha vem marcada como exemplo.
 */
const MARCOS = ["Reservado", "Origem", "Em trânsito", "Atracado", "Desembaraço", "Entregue"] as const;
const ATUAL = 2;

function estadoDoMarco(i: number): "feito" | "atual" | "pendente" {
  if (i < ATUAL) return "feito";
  if (i === ATUAL) return "atual";
  return "pendente";
}

const TEXTO_ESTADO = { feito: "concluído", atual: "etapa atual", pendente: "pendente" } as const;

export default function ShipmentPanel() {
  return (
    <figure className="al-panel">
      <div className="al-panel-container">
        <span className="al-panel-code" aria-label="Contêiner AURU 204518 7">
          AURU 204518 7
        </span>
        <span className="al-panel-tag">Exemplo</span>
      </div>

      <div className="al-panel-body">
        <dl className="al-panel-dados">
          <div>
            <dt>Processo</dt>
            <dd>AC-2451</dd>
          </div>
          <div>
            <dt>Cliente</dt>
            <dd>Global Trade Ltda</dd>
          </div>
          <div>
            <dt>Rota</dt>
            <dd>Xangai para Santos</dd>
          </div>
          <div>
            <dt>Modal</dt>
            <dd>Marítimo FCL</dd>
          </div>
        </dl>

        <div className="al-trail-wrap">
          <span className="al-trail-linha" aria-hidden="true">
            <span className="al-trail-preenche" />
          </span>
          <ol className="al-trail" aria-label="Andamento do embarque">
          {MARCOS.map((nome, i) => {
            const estado = estadoDoMarco(i);
            return (
              <li key={nome} data-estado={estado} aria-current={estado === "atual" ? "step" : undefined}>
                <span className="al-trail-no" aria-hidden="true">
                  {estado === "feito" && <Check size={14} strokeWidth={3} />}
                </span>
                <span className="al-trail-nome">
                  {nome}
                  <span className="al-sr"> ({TEXTO_ESTADO[estado]})</span>
                </span>
                {estado === "atual" && <span className="al-trail-nota">Chegada prevista em 9 dias</span>}
              </li>
            );
          })}
          </ol>
        </div>
      </div>
    </figure>
  );
}
