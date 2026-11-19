CREATE SCHEMA IF NOT EXISTS "achadinhos";
--> statement-breakpoint
CREATE TABLE "achadinhos"."admins" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"senha_hash" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_login_em" timestamp with time zone,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."auditoria" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ator" text NOT NULL,
	"acao" text NOT NULL,
	"alvo" text,
	"detalhes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."biblia_docs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"versao" integer NOT NULL,
	"titulo" text NOT NULL,
	"conteudo" text NOT NULL,
	"autor" text NOT NULL,
	"motivo" text,
	"proposta_id" bigint,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."chamadas_pagas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chave_idempotente" text NOT NULL,
	"servico" text NOT NULL,
	"agente" text,
	"modelo" text,
	"tokens_entrada" integer,
	"tokens_saida" integer,
	"custo_usd" numeric(12, 6),
	"oferta_id" bigint,
	"sucesso" boolean NOT NULL,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chamadas_pagas_chave_idempotente_unique" UNIQUE("chave_idempotente")
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."cliques" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"link_id" bigint NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."conversoes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"marketplace" text NOT NULL,
	"pedido_externo" text NOT NULL,
	"link_id" bigint,
	"sub_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valor" numeric(12, 2),
	"comissao" numeric(12, 2),
	"status" text,
	"dia" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."copies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"oferta_id" bigint NOT NULL,
	"texto" text NOT NULL,
	"agente" text NOT NULL,
	"validada" boolean DEFAULT false NOT NULL,
	"motivo_invalida" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."envios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"oferta_id" bigint NOT NULL,
	"grupo_id" bigint NOT NULL,
	"numero_id" bigint,
	"link_id" bigint,
	"chave_idempotente" text NOT NULL,
	"status" text DEFAULT 'agendado' NOT NULL,
	"agendado_para" timestamp with time zone,
	"enviado_em" timestamp with time zone,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envios_chave_idempotente_unique" UNIQUE("chave_idempotente")
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."eventos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"agente" text NOT NULL,
	"dados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"oferta_id" bigint,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."grupo_nichos" (
	"grupo_id" bigint NOT NULL,
	"nicho_id" bigint NOT NULL,
	CONSTRAINT "grupo_nichos_grupo_id_nicho_id_pk" PRIMARY KEY("grupo_id","nicho_id")
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."grupos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"wa_jid" text,
	"promessa" text,
	"teste" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"max_por_dia" integer,
	"horarios" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"link_entrada" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grupos_wa_jid_unique" UNIQUE("wa_jid")
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."historico_precos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"produto_id" bigint NOT NULL,
	"preco" numeric(12, 2) NOT NULL,
	"preco_original" numeric(12, 2),
	"em_estoque" boolean,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."imagens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"oferta_id" bigint NOT NULL,
	"template" text NOT NULL,
	"foto_original_url" text NOT NULL,
	"url" text,
	"recorte_ok" boolean,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"oferta_id" bigint NOT NULL,
	"grupo_id" bigint,
	"url_afiliado" text NOT NULL,
	"codigo_curto" text NOT NULL,
	"sub_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_codigo_curto_unique" UNIQUE("codigo_curto")
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."nichos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"preco_min" numeric(12, 2),
	"preco_max" numeric(12, 2),
	"marketplace" text DEFAULT 'shopee' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nichos_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."numeros" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"apelido" text NOT NULL,
	"sessao_gateway" text NOT NULL,
	"papel" text DEFAULT 'reserva' NOT NULL,
	"status" text DEFAULT 'desconectado' NOT NULL,
	"ultimo_status_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "numeros_apelido_unique" UNIQUE("apelido")
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."ofertas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"produto_id" bigint NOT NULL,
	"nicho_id" bigint,
	"preco" numeric(12, 2) NOT NULL,
	"mediana_preco_30d" numeric(12, 2),
	"desconto_pct" numeric(5, 2),
	"status" text DEFAULT 'candidata' NOT NULL,
	"motivo_reprovacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."palavras_chave" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nicho_id" bigint NOT NULL,
	"termo" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."produtos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"marketplace" text NOT NULL,
	"id_externo" text NOT NULL,
	"loja_id" text,
	"nome" text NOT NULL,
	"marca" text,
	"url" text NOT NULL,
	"foto_url" text,
	"avaliacao" numeric(3, 2),
	"vendas" integer,
	"nicho_id" bigint,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."propostas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text NOT NULL,
	"autor" text NOT NULL,
	"doc_slug" text,
	"conteudo_proposto" text,
	"status" text DEFAULT 'aberta' NOT NULL,
	"decidido_por" text,
	"comentario" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"decidido_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "achadinhos"."cliques" ADD CONSTRAINT "cliques_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "achadinhos"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."conversoes" ADD CONSTRAINT "conversoes_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "achadinhos"."links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."copies" ADD CONSTRAINT "copies_oferta_id_ofertas_id_fk" FOREIGN KEY ("oferta_id") REFERENCES "achadinhos"."ofertas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."envios" ADD CONSTRAINT "envios_oferta_id_ofertas_id_fk" FOREIGN KEY ("oferta_id") REFERENCES "achadinhos"."ofertas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."envios" ADD CONSTRAINT "envios_grupo_id_grupos_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "achadinhos"."grupos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."envios" ADD CONSTRAINT "envios_numero_id_numeros_id_fk" FOREIGN KEY ("numero_id") REFERENCES "achadinhos"."numeros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."envios" ADD CONSTRAINT "envios_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "achadinhos"."links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."grupo_nichos" ADD CONSTRAINT "grupo_nichos_grupo_id_grupos_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "achadinhos"."grupos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."grupo_nichos" ADD CONSTRAINT "grupo_nichos_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "achadinhos"."nichos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."historico_precos" ADD CONSTRAINT "historico_precos_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "achadinhos"."produtos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD CONSTRAINT "imagens_oferta_id_ofertas_id_fk" FOREIGN KEY ("oferta_id") REFERENCES "achadinhos"."ofertas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."links" ADD CONSTRAINT "links_oferta_id_ofertas_id_fk" FOREIGN KEY ("oferta_id") REFERENCES "achadinhos"."ofertas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."links" ADD CONSTRAINT "links_grupo_id_grupos_id_fk" FOREIGN KEY ("grupo_id") REFERENCES "achadinhos"."grupos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."ofertas" ADD CONSTRAINT "ofertas_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "achadinhos"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."ofertas" ADD CONSTRAINT "ofertas_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "achadinhos"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."palavras_chave" ADD CONSTRAINT "palavras_chave_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "achadinhos"."nichos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD CONSTRAINT "produtos_nicho_id_nichos_id_fk" FOREIGN KEY ("nicho_id") REFERENCES "achadinhos"."nichos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "biblia_docs_slug_versao" ON "achadinhos"."biblia_docs" USING btree ("slug","versao");--> statement-breakpoint
CREATE INDEX "chamadas_pagas_dia" ON "achadinhos"."chamadas_pagas" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "cliques_link" ON "achadinhos"."cliques" USING btree ("link_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "conversoes_pedido" ON "achadinhos"."conversoes" USING btree ("marketplace","pedido_externo");--> statement-breakpoint
CREATE INDEX "envios_grupo_dia" ON "achadinhos"."envios" USING btree ("grupo_id","criado_em");--> statement-breakpoint
CREATE INDEX "eventos_criado" ON "achadinhos"."eventos" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "eventos_tipo" ON "achadinhos"."eventos" USING btree ("tipo","criado_em");--> statement-breakpoint
CREATE INDEX "historico_precos_produto" ON "achadinhos"."historico_precos" USING btree ("produto_id","coletado_em");--> statement-breakpoint
CREATE INDEX "links_oferta" ON "achadinhos"."links" USING btree ("oferta_id");--> statement-breakpoint
CREATE INDEX "ofertas_status" ON "achadinhos"."ofertas" USING btree ("status","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "palavras_chave_nicho_termo" ON "achadinhos"."palavras_chave" USING btree ("nicho_id","termo");--> statement-breakpoint
CREATE UNIQUE INDEX "produtos_marketplace_externo" ON "achadinhos"."produtos" USING btree ("marketplace","id_externo");--> statement-breakpoint
CREATE INDEX "propostas_status" ON "achadinhos"."propostas" USING btree ("status","criado_em");