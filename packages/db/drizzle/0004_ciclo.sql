CREATE TABLE "achadinhos"."checagens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"oferta_id" bigint NOT NULL,
	"aprovada" boolean NOT NULL,
	"motivos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agente" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achadinhos"."controle" (
	"chave" text PRIMARY KEY NOT NULL,
	"valor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achadinhos"."copies" ADD COLUMN "variacao" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."copies" ADD COLUMN "escolhida" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."copies" ADD COLUMN "modelo" text;--> statement-breakpoint
ALTER TABLE "achadinhos"."envios" ADD COLUMN "job_gateway" text;--> statement-breakpoint
ALTER TABLE "achadinhos"."envios" ADD COLUMN "numero_gateway" text;--> statement-breakpoint
ALTER TABLE "achadinhos"."envios" ADD COLUMN "extra" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."envios" ADD COLUMN "texto" text;--> statement-breakpoint
ALTER TABLE "achadinhos"."envios" ADD COLUMN "imagem_url" text;--> statement-breakpoint
ALTER TABLE "achadinhos"."ofertas" ADD COLUMN "ensaio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."checagens" ADD CONSTRAINT "checagens_oferta_id_ofertas_id_fk" FOREIGN KEY ("oferta_id") REFERENCES "achadinhos"."ofertas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checagens_dia" ON "achadinhos"."checagens" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "checagens_oferta" ON "achadinhos"."checagens" USING btree ("oferta_id");--> statement-breakpoint
CREATE INDEX "envios_devidos" ON "achadinhos"."envios" USING btree ("status","agendado_para");--> statement-breakpoint
CREATE UNIQUE INDEX "links_oferta_grupo" ON "achadinhos"."links" USING btree ("oferta_id","grupo_id");