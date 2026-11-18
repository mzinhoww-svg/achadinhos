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
  marketplace: text("marketplace", { enum: ["shopee", "mercadolivre"] })
    .notNull()
    .default("shopee"),
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
    marketplace: text("marketplace", { enum: ["shopee", "mercadolivre"] }).notNull(),
    idExterno: text("id_externo").notNull(),
    lojaId: text("loja_id"),
    nome: text("nome").notNull(),
    marca: text("marca"),
    url: text("url").notNull(),
    fotoUrl: text("foto_url"),
    avaliacao: numeric("avaliacao", { precision: 3, scale: 2 }),
    vendas: integer("vendas"),
    nichoId: ref("nicho_id").references(() => nichos.id),
    criadoEm: criadoEm(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("produtos_marketplace_externo").on(t.marketplace, t.idExterno)],
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
    status: text("status", {
      enum: ["candidata", "aprovada", "reprovada", "agendada", "enviada", "expirada"],
    })
      .notNull()
      .default("candidata"),
    motivoReprovacao: text("motivo_reprovacao"),
    criadoEm: criadoEm(),
  },
  (t) => [index("ofertas_status").on(t.status, t.criadoEm)],
);

export const imagens = achadinhos.table("imagens", {
  id: id(),
  ofertaId: ref("oferta_id")
    .notNull()
    .references(() => ofertas.id, { onDelete: "cascade" }),
  template: text("template").notNull(),
  fotoOriginalUrl: text("foto_original_url").notNull(),
  url: text("url"),
  recorteOk: boolean("recorte_ok"),
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
  (t) => [index("links_oferta").on(t.ofertaId)],
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
    marketplace: text("marketplace", { enum: ["shopee", "mercadolivre"] }).notNull(),
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
    criadoEm: criadoEm(),
  },
  (t) => [index("envios_grupo_dia").on(t.grupoId, t.criadoEm)],
);
