-- Cada evento novo avisa os ouvintes (LISTEN achadinhos_eventos). O payload é só o id:
-- quem ouve lê a linha completa, e o limite de 8000 bytes do NOTIFY nunca é atingido.
CREATE OR REPLACE FUNCTION "achadinhos"."notificar_evento"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('achadinhos_eventos', NEW.id::text);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "eventos_notificar" ON "achadinhos"."eventos";
--> statement-breakpoint
CREATE TRIGGER "eventos_notificar" AFTER INSERT ON "achadinhos"."eventos"
FOR EACH ROW EXECUTE FUNCTION "achadinhos"."notificar_evento"();
