import type { Db } from "@achadinhos/db";
import {
  comLimite,
  ErroNaoImplementado,
  FakeAdapter,
  type MarketplaceAdapter,
  MercadoLivreAdapter,
  ShopeeAdapter,
} from "@achadinhos/marketplace";
import type { Config } from "../config.js";
import { registrarEvento } from "../servicos.js";

export interface Marketplaces {
  /** Adaptador da coleta e do Monitor (Shopee no piloto, ou o fake no ensaio). */
  principal: MarketplaceAdapter | null;
  /** Por que o principal não está disponível (ex.: credencial ausente). */
  indisponivel: string | null;
  mercadolivre: MarketplaceAdapter;
}

/** Monta os adaptadores com limite de taxa e novas tentativas; cada falha vira evento `marketplace.erro`. */
export function criarMarketplaces(db: Db, c: Config, fake?: FakeAdapter): Marketplaces {
  const aoErro = (f: Parameters<NonNullable<Parameters<typeof comLimite>[1]["aoErro"]>>[0]) =>
    registrarEvento(db, { tipo: "marketplace.erro", agente: "worker", dados: { ...f } }).then(() => {});
  const ml = new MercadoLivreAdapter();
  if (c.MARKETPLACE === "fake") {
    return {
      principal: comLimite(fake ?? new FakeAdapter(), { porMinuto: 600, aoErro }),
      indisponivel: null,
      mercadolivre: ml,
    };
  }
  if (!c.SHOPEE_APP_ID || !c.SHOPEE_SECRET) {
    return {
      principal: null,
      indisponivel: "SHOPEE_APP_ID e SHOPEE_SECRET não configurados no worker.",
      mercadolivre: ml,
    };
  }
  const shopee = new ShopeeAdapter({
    appId: c.SHOPEE_APP_ID,
    secret: c.SHOPEE_SECRET,
    ...(c.SHOPEE_ENDPOINT ? { endpoint: c.SHOPEE_ENDPOINT } : {}),
  });
  return {
    principal: comLimite(shopee, { porMinuto: c.SHOPEE_POR_MINUTO, tentativas: 3, aoErro }),
    indisponivel: null,
    mercadolivre: ml,
  };
}

export { ErroNaoImplementado };
