import { EventEmitter } from "node:events";
import { CANAL_EVENTOS } from "@achadinhos/shared";
import pg from "pg";

/**
 * Uma conexão dedicada faz LISTEN no canal de eventos (o gatilho da migração 0001 faz o NOTIFY com o id).
 * Os assinantes do /eventos/stream recebem só o id e leem a linha completa no banco.
 * Reconecta sozinho, com espera crescente, se a conexão cair.
 */
export class OuvinteEventos extends EventEmitter {
  private cliente: pg.Client | null = null;
  private parado = false;
  private espera = 1000;
  conectado = false;

  constructor(
    private readonly opcoes: pg.ClientConfig,
    private readonly log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
  ) {
    super();
    this.setMaxListeners(1000);
  }

  async iniciar(): Promise<void> {
    if (this.parado) return;
    const c = new pg.Client(this.opcoes);
    c.on("notification", (n) => {
      const id = Number(n.payload);
      if (n.channel === CANAL_EVENTOS && Number.isInteger(id)) this.emit("evento", id);
    });
    c.on("error", (e) => this.reconectar(e));
    c.on("end", () => this.reconectar(new Error("conexão encerrada")));
    try {
      await c.connect();
      await c.query(`LISTEN ${CANAL_EVENTOS}`);
      this.cliente = c;
      this.conectado = true;
      this.espera = 1000;
      this.log.info({ canal: CANAL_EVENTOS }, "ouvindo eventos");
    } catch (e) {
      await c.end().catch(() => {});
      this.reconectar(e);
    }
  }

  private reconectar(e: unknown) {
    if (this.parado || this.agendado) return;
    this.conectado = false;
    this.cliente = null;
    this.log.warn({ erro: String(e), esperaMs: this.espera }, "LISTEN caiu; reconectando");
    this.agendado = true;
    setTimeout(() => {
      this.agendado = false;
      void this.iniciar();
    }, this.espera).unref();
    this.espera = Math.min(this.espera * 2, 30_000);
  }
  private agendado = false;

  async parar(): Promise<void> {
    this.parado = true;
    await this.cliente?.end().catch(() => {});
  }
}
