CREATE TABLE "achadinhos"."arquivos" (
	"caminho" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"dados_b64" text NOT NULL,
	"tamanho" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ALTER COLUMN "oferta_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "produto_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "formato" text NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "mascara_url" text;--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "confianca" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "fallback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "motivo_fallback" text;--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "ampliada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "preco" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "preco_antigo" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "desconto_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD COLUMN "origem_preco" text DEFAULT 'oferta' NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."imagens" ADD CONSTRAINT "imagens_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "achadinhos"."produtos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imagens_oferta" ON "achadinhos"."imagens" USING btree ("oferta_id");--> statement-breakpoint
CREATE INDEX "imagens_produto" ON "achadinhos"."imagens" USING btree ("produto_id","criado_em");