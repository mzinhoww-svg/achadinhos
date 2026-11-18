ALTER TABLE "achadinhos"."nichos" ADD COLUMN "desconto_min_pct" numeric(5, 2) DEFAULT '15' NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."nichos" ADD COLUMN "avaliacao_min" numeric(3, 2) DEFAULT '4.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."nichos" ADD COLUMN "vendas_min" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."ofertas" ADD COLUMN "comissao_taxa" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "achadinhos"."ofertas" ADD COLUMN "pontuacao" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "loja_nome" text;--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "link_afiliado" text;--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "preco_atual" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "preco_max" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "desconto_anunciado" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "comissao_taxa" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "comissao_valor" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "em_estoque" boolean;--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "acompanhado" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."produtos" ADD COLUMN "ultima_coleta_em" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ofertas_pontuacao" ON "achadinhos"."ofertas" USING btree ("status","pontuacao");--> statement-breakpoint
CREATE UNIQUE INDEX "ofertas_produto_aberta" ON "achadinhos"."ofertas" USING btree ("produto_id") WHERE status in ('candidata', 'aprovada', 'agendada');--> statement-breakpoint
CREATE INDEX "produtos_monitor" ON "achadinhos"."produtos" USING btree ("acompanhado","ultima_coleta_em");