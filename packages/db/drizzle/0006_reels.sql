CREATE TABLE "achadinhos"."reels" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"produto_id" bigint NOT NULL,
	"oferta_id" bigint,
	"palavra" text NOT NULL,
	"modelo" text NOT NULL,
	"status" text DEFAULT 'video_pendente' NOT NULL,
	"fonte" text,
	"reel_url" text,
	"capa_url" text,
	"legenda" text,
	"dm_texto" text,
	"link_id" bigint,
	"dia" date NOT NULL,
	"agendado_para" timestamp with time zone,
	"mlabs_post_id" text,
	"mlabs_flow_id" text,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achadinhos"."links" ALTER COLUMN "oferta_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."links" ADD COLUMN "produto_id" bigint;--> statement-breakpoint
ALTER TABLE "achadinhos"."links" ADD COLUMN "origem" text DEFAULT 'grupo' NOT NULL;--> statement-breakpoint
ALTER TABLE "achadinhos"."links" ADD COLUMN "reel_id" bigint;--> statement-breakpoint
ALTER TABLE "achadinhos"."reels" ADD CONSTRAINT "reels_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "achadinhos"."produtos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achadinhos"."reels" ADD CONSTRAINT "reels_oferta_id_ofertas_id_fk" FOREIGN KEY ("oferta_id") REFERENCES "achadinhos"."ofertas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reels_status" ON "achadinhos"."reels" USING btree ("status","dia");--> statement-breakpoint
CREATE INDEX "reels_produto" ON "achadinhos"."reels" USING btree ("produto_id","criado_em");--> statement-breakpoint
ALTER TABLE "achadinhos"."links" ADD CONSTRAINT "links_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "achadinhos"."produtos"("id") ON DELETE cascade ON UPDATE no action;