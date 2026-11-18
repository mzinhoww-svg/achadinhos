import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Tudo do Achadinhos fica neste schema, isolado das outras aplicações do mesmo Postgres. */
export const achadinhos = pgSchema("achadinhos");

const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();
const id = () => bigserial("id", { mode: "number" }).primaryKey();
const ref = (nome: string) => bigint(nome, { mode: "number" });

// ---------- bíblia e governança ----------

export const bibliaDocs = achadinhos.table(
  "biblia_docs",
  {
    id: id(),
    slug: text("slug").notNull(),
    versao: integer("versao").notNull(),
    titulo: text("titulo").notNull(),
    conteudo: text("conteudo").notNull(),
    autor: text("autor").notNull(),
    motivo: text("motivo"),
    propostaId: ref("proposta_id"),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("biblia_docs_slug_versao").on(t.slug, t.versao)],
);

export const propostas = achadinhos.table(
  "propostas",
  {
    id: id(),
    titulo: text("titulo").notNull(),
    descricao: text("descricao").notNull(),
    autor: text("autor").notNull(),
    docSlug: text("doc_slug"),
    conteudoProposto: text("conteudo_proposto"),
    status: text("status", { enum: ["aberta", "aprovada", "rejeitada"] })
      .notNull()
      .default("aberta"),
    decididoPor: text("decidido_por"),
    comentario: text("comentario"),
    criadoEm: criadoEm(),
    decididoEm: timestamp("decidido_em", { withTimezone: true }),
  },
  (t) => [index("propostas_status").on(t.status, t.criadoEm)],
);

export const eventos = achadinhos.table(
  "eventos",
  {
    id: id(),
    tipo: text("tipo").notNull(),
    agente: text("agente").notNull(),
    dados: jsonb("dados").$type<Record<string, unknown>>().notNull().default({}),
    ofertaId: ref("oferta_id"),
    criadoEm: criadoEm(),
  },
  (t) => [index("eventos_criado").on(t.criadoEm), index("eventos_tipo").on(t.tipo, t.criadoEm)],
);

export const auditoria = achadinhos.table("auditoria", {
  id: id(),
  ator: text("ator").notNull(),
  acao: text("acao").notNull(),
  alvo: text("alvo"),
  detalhes: jsonb("detalhes").$type<Record<string, unknown>>().notNull().default({}),
  criadoEm: criadoEm(),
});

export const admins = achadinhos.table("admins", {
  id: id(),
  email: text("email").notNull().unique(),
  nome: text("nome").notNull(),
  /** scrypt$N$r$p$salt$hash (apps/worker/src/senha.ts). */
  senhaHash: text("senha_hash").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
  ultimoLoginEm: timestamp("ultimo_login_em", { withTimezone: true }),
});

/** Capacidade 7 do contrato: toda chamada paga com custo e chave idempotente. */
export const chamadasPagas = achadinhos.table(
  "chamadas_pagas",
  {
    id: id(),
    chaveIdempotente: text("chave_idempotente").notNull().unique(),
    servico: text("servico").notNull(),
    agente: text("agente"),
    modelo: text("modelo"),
    tokensEntrada: integer("tokens_entrada"),
    tokensSaida: integer("tokens_saida"),
    custoUsd: numeric("custo_usd", { precision: 12, scale: 6 }),
    ofertaId: ref("oferta_id"),
    sucesso: boolean("sucesso").notNull(),
    erro: text("erro"),
    criadoEm: criadoEm(),
  },
  (t) => [index("chamadas_pagas_dia").on(t.criadoEm)],
);

// ---------- nichos e grupos ----------

export const nichos = achadinhos.table("nichos", {
  id: id(),
  nome: text("nome").notNull().unique(),
  ativo: boolean("ativo").notNull().default(true),
  precoMin: numeric("preco_min", { precision: 12, scale: 2 }),
  precoMax: numeric("preco_max", { precision: 12, scale: 2 }),
  marketplace: text("marketplace", { enum: ["shopee", "mercadolivre", "fake"] })
    .notNull()
    .default("shopee"),
  /** Oferta real: preço pelo menos X% abaixo da mediana de 30 dias (padrão 15). */
  descontoMinPct: numeric("desconto_min_pct", { precision: 5, scale: 2 }).notNull().default("15"),
  avaliacaoMin: numeric("avaliacao_min", { precision: 3, scale: 2 }).notNull().default("4.5"),
  vendasMin: integer("vendas_min").notNull().default(50),
  criadoEm: criadoEm(),
});

export const palavrasChave = achadinhos.table(
  "palavras_chave",
  {
    id: id(),
    nichoId: ref("nicho_id")
      .notNull()
      .references(() => nichos.id, { onDelete: "cascade" }),
    termo: text("termo").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("palavras_chave_nicho_termo").on(t.nichoId, t.termo)],
);

export const grupos = achadinhos.table("grupos", {
  id: id(),
  nome: text("nome").notNull(),
  /** JID do grupo no WhatsApp (ex.: 1203...@g.us). */
  waJid: text("wa_jid").unique(),
  promessa: text("promessa"),
  teste: boolean("teste").notNull().default(false),
  ativo: boolean("ativo").notNull().default(true),
  maxPorDia: integer("max_por_dia"),
  horarios: jsonb("horarios").$type<string[]>().notNull().default([]),
  linkEntrada: text("link_entrada"),
  criadoEm: criadoEm(),
});

export const grupoNichos = achadinhos.table(
  "grupo_nichos",
  {
    grupoId: ref("grupo_id")
      .notNull()
      .references(() => grupos.id, { onDelete: "cascade" }),
    nichoId: ref("nicho_id")
      .notNull()
      .references(() => nichos.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.grupoId, t.nichoId] })],
);

// ---------- produtos, preços e ofertas ----------

export const produtos = achadinhos.table(
  "produtos",
  {
    id: id(),
    marketplace: text("marketplace", { enum: ["shopee", "mercadolivre", "fake"] }).notNull(),
    idExterno: text("id_externo").notNull(),
    lojaId: text("loja_id"),
    lojaNome: text("loja_nome"),
    nome: text("nome").notNull(),
    marca: text("marca"),
    url: text("url").notNull(),
    /** Link de afiliado devolvido na busca (Shopee: offerLink). O link curto com subIds é gerado no envio. */
    linkAfiliado: text("link_afiliado"),
    fotoUrl: text("foto_url"),
    precoAtual: numeric("preco_atual", { precision: 12, scale: 2 }),
    precoMax: numeric("preco_max", { precision: 12, scale: 2 }),
    descontoAnunciado: numeric("desconto_anunciado", { precision: 5, scale: 4 }),
    avaliacao: numeric("avaliacao", { precision: 3, scale: 2 }),
    vendas: integer("vendas"),
    comissaoTaxa: numeric("comissao_taxa", { precision: 6, scale: 4 }),
    comissaoValor: numeric("comissao_valor", { precision: 12, scale: 2 }),
    emEstoque: boolean("em_estoque"),
    /** O Monitor só atualiza os acompanhados. */
    acompanhado: boolean("acompanhado").notNull().default(true),
    nichoId: ref("nicho_id").references(() => nichos.id),
    ultimaColetaEm: timestamp("ultima_coleta_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("produtos_marketplace_externo").on(t.marketplace, t.idExterno),
    index("produtos_monitor").on(t.acompanhado, t.ultimaColetaEm),
  ],
);

export const historicoPrecos = achadinhos.table(
  "historico_precos",
  {
    id: id(),
    produtoId: ref("produto_id")
      .notNull()
      .references(() => produtos.id, { onDelete: "cascade" }),
    preco: numeric("preco", { precision: 12, scale: 2 }).notNull(),
    precoOriginal: numeric("preco_original", { precision: 12, scale: 2 }),
    emEstoque: boolean("em_estoque"),
    coletadoEm: timestamp("coletado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("historico_precos_produto").on(t.produtoId, t.coletadoEm)],
);

export const ofertas = achadinhos.table(
  "ofertas",
  {
    id: id(),
    produtoId: ref("produto_id")
      .notNull()
      .references(() => produtos.id),
    nichoId: ref("nicho_id").references(() => nichos.id),
    preco: numeric("preco", { precision: 12, scale: 2 }).notNull(),
    medianaPreco30d: numeric("mediana_preco_30d", { precision: 12, scale: 2 }),
    descontoPct: numeric("desconto_pct", { precision: 5, scale: 2 }),
    comissaoTaxa: numeric("comissao_taxa", { precision: 6, scale: 4 }),
    /** 0 a 100: desconto real, comissão, vendas e nota (as maiores saem primeiro). */
    pontuacao: numeric("pontuacao", { precision: 5, scale: 2 }),
    status: text("status", {
      enum: ["candidata", "aprovada", "reprovada", "agendada", "enviada", "expirada", "cancelada"],
    })
      .notNull()
      .default("candidata"),
    motivoReprovacao: text("motivo_reprovacao"),
    /** Oferta de ensaio (produto falso): só vai para grupos de teste. */
    ensaio: boolean("ensaio").notNull().default(false),
    criadoEm: criadoEm(),
  },
  (t) => [
    index("ofertas_status").on(t.status, t.criadoEm),
    index("ofertas_pontuacao").on(t.status, t.pontuacao),
    // No máximo uma oferta aberta por produto.
    uniqueIndex("ofertas_produto_aberta")
      .on(t.produtoId)
      .where(sql`status in ('candidata', 'aprovada', 'agendada')`),
  ],
);

/** Peças da Arte (Prompt 3). Uma linha por formato renderizado. */
export const imagens = achadinhos.table(
  "imagens",
  {
    id: id(),
    /** Null na pré-visualização de um produto que ainda não virou oferta. */
    ofertaId: ref("oferta_id").references(() => ofertas.id, { onDelete: "cascade" }),
    produtoId: ref("produto_id")
      .notNull()
      .references(() => produtos.id, { onDelete: "cascade" }),
    formato: text("formato").notNull(),
    /** De onde veio o template: biblia-nicho, biblia-padrao ou padrao. */
    template: text("template").notNull(),
    fotoOriginalUrl: text("foto_original_url").notNull(),
    url: text("url"),
    mascaraUrl: text("mascara_url"),
    recorteOk: boolean("recorte_ok"),
    confianca: numeric("confianca", { precision: 4, scale: 2 }),
    fallback: boolean("fallback").notNull().default(false),
    motivoFallback: text("motivo_fallback"),
    ampliada: boolean("ampliada").notNull().default(false),
    preco: numeric("preco", { precision: 12, scale: 2 }),
    precoAntigo: numeric("preco_antigo", { precision: 12, scale: 2 }),
    descontoPct: numeric("desconto_pct", { precision: 5, scale: 2 }),
    /** previa = produto sem oferta, desconto anunciado pela loja. */
    origemPreco: text("origem_preco").notNull().default("oferta"),
    criadoEm: criadoEm(),
  },
  (t) => [index("imagens_oferta").on(t.ofertaId), index("imagens_produto").on(t.produtoId, t.criadoEm)],
);

/** Armazenamento reserva das peças quando o Blob da Vertra não está configurado. */
export const arquivos = achadinhos.table("arquivos", {
  caminho: text("caminho").primaryKey(),
  tipo: text("tipo").notNull(),
  dadosB64: text("dados_b64").notNull(),
  tamanho: integer("tamanho").notNull(),
  criadoEm: criadoEm(),
});

export const copies = achadinhos.table("copies", {
  id: id(),
  ofertaId: ref("oferta_id")
    .notNull()
    .references(() => ofertas.id, { onDelete: "cascade" }),
  texto: text("texto").notNull(),
  agente: text("agente").notNull(),
  validada: boolean("validada").notNull().default(false),
  motivoInvalida: text("motivo_invalida"),
  variacao: integer("variacao").notNull().default(1),
  escolhida: boolean("escolhida").notNull().default(false),
  /** Modelo do LLM, ou "modelo-fixo" quando a copy veio do texto padrão (sem LLM ou teto de gasto). */
  modelo: text("modelo"),
  criadoEm: criadoEm(),
});

export const links = achadinhos.table(
  "links",
  {
    id: id(),
    ofertaId: ref("oferta_id")
      .notNull()
      .references(() => ofertas.id, { onDelete: "cascade" }),
    grupoId: ref("grupo_id").references(() => grupos.id),
    urlAfiliado: text("url_afiliado").notNull(),
    codigoCurto: text("codigo_curto").notNull().unique(),
    /** Capacidade 13: grupo, nicho, oferta e horário. */
    subIds: jsonb("sub_ids").$type<Record<string, string>>().notNull().default({}),
    criadoEm: criadoEm(),
  },
  (t) => [index("links_oferta").on(t.ofertaId), uniqueIndex("links_oferta_grupo").on(t.ofertaId, t.grupoId)],
);

export const cliques = achadinhos.table(
  "cliques",
  {
    id: id(),
    linkId: ref("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    criadoEm: criadoEm(),
  },
  (t) => [index("cliques_link").on(t.linkId, t.criadoEm)],
);

export const conversoes = achadinhos.table(
  "conversoes",
  {
    id: id(),
    marketplace: text("marketplace", { enum: ["shopee", "mercadolivre", "fake"] }).notNull(),
    pedidoExterno: text("pedido_externo").notNull(),
    linkId: ref("link_id").references(() => links.id),
    subIds: jsonb("sub_ids").$type<Record<string, string>>().notNull().default({}),
    valor: numeric("valor", { precision: 12, scale: 2 }),
    comissao: numeric("comissao", { precision: 12, scale: 2 }),
    status: text("status"),
    dia: date("dia"),
    criadoEm: criadoEm(),
  },
  (t) => [uniqueIndex("conversoes_pedido").on(t.marketplace, t.pedidoExterno)],
);

// ---------- números e envios ----------

export const numeros = achadinhos.table("numeros", {
  id: id(),
  apelido: text("apelido").notNull().unique(),
  /** Referência da sessão no wa-gateway; nunca o número completo em logs. */
  sessaoGateway: text("sessao_gateway").notNull(),
  papel: text("papel", { enum: ["ativo", "reserva"] })
    .notNull()
    .default("reserva"),
  status: text("status", { enum: ["conectado", "desconectado", "banido", "aquecendo"] })
    .notNull()
    .default("desconectado"),
  ultimoStatusEm: timestamp("ultimo_status_em", { withTimezone: true }),
  criadoEm: criadoEm(),
});

export const envios = achadinhos.table(
  "envios",
  {
    id: id(),
    ofertaId: ref("oferta_id")
      .notNull()
      .references(() => ofertas.id),
    grupoId: ref("grupo_id")
      .notNull()
      .references(() => grupos.id),
    numeroId: ref("numero_id").references(() => numeros.id),
    linkId: ref("link_id").references(() => links.id),
    chaveIdempotente: text("chave_idempotente").notNull().unique(),
    status: text("status", { enum: ["agendado", "enviando", "enviado", "falhou", "cancelado"] })
      .notNull()
      .default("agendado"),
    agendadoPara: timestamp("agendado_para", { withTimezone: true }),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
    erro: text("erro"),
    /** Id do envio na fila do wa-gateway e número que enviou. */
    jobGateway: text("job_gateway"),
    numeroGateway: text("numero_gateway"),
    extra: boolean("extra").notNull().default(false),
    texto: text("texto"),
    imagemUrl: text("imagem_url"),
    criadoEm: criadoEm(),
  },
  (t) => [
    index("envios_grupo_dia").on(t.grupoId, t.criadoEm),
    index("envios_devidos").on(t.status, t.agendadoPara),
  ],
);

// ---------- Prompt 5: controle, checagens ----------

/** Estado global: pausa (chave "pausa"), avisos já mandados no dia etc. */
export const controle = achadinhos.table("controle", {
  chave: text("chave").primaryKey(),
  valor: jsonb("valor").$type<Record<string, unknown>>().notNull().default({}),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const checagens = achadinhos.table(
  "checagens",
  {
    id: id(),
    ofertaId: ref("oferta_id")
      .notNull()
      .references(() => ofertas.id, { onDelete: "cascade" }),
    aprovada: boolean("aprovada").notNull(),
    motivos: jsonb("motivos").$type<{ codigo: string; detalhe: string }[]>().notNull().default([]),
    agente: text("agente").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index("checagens_dia").on(t.criadoEm), index("checagens_oferta").on(t.ofertaId)],
);
