import { ErroNegocio } from "../servicos.js";

/** Cliente do wa-gateway (pool do Achadinhos). Erros viram ErroNegocio: o painel recebe o motivo, não um 500. */
export class ErroGateway extends ErroNegocio {
  constructor(
    message: string,
    status: number,
    readonly codigoGateway: string | null = null,
  ) {
    super(status >= 500 ? 502 : status, "gateway", message);
    this.name = "ErroGateway";
  }
}

export interface NumeroGateway {
  instanceId: string;
  ordem: number;
  papel: "ativo" | "reserva" | "banido" | "bloqueado";
  conexao: string;
  aguardandoQr: boolean;
  telefone: string | null;
  ultimoHeartbeat: string | null;
  falhasSeguidas: number;
  motivo: string | null;
  aquecimento: { dias: number; tetoDiario: number; enviadosHoje: number };
}

export class Gateway {
  constructor(
    private url: string,
    private token: string,
    readonly pool: string,
    private f: typeof fetch = fetch,
  ) {}

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.f(`${this.url.replace(/\/$/, "")}${caminho}`, {
        method: metodo,
        headers: { "x-api-key": this.token, ...(corpo ? { "content-type": "application/json" } : {}) },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ErroGateway("o wa-gateway não respondeu", 503);
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok)
      throw new ErroGateway(
        `wa-gateway: ${json.error ?? `HTTP ${res.status}`}`,
        res.status,
        json.error ?? null,
      );
    return json;
  }

  /** Cria o pool (sem telefones) se ainda não existir, e repete a chamada. Não sobrescreve um pool existente. */
  private async comPool<T>(fazer: () => Promise<T>): Promise<T> {
    try {
      return await fazer();
    } catch (e) {
      if (!(e instanceof ErroGateway) || e.codigoGateway !== "POOL_NOT_FOUND") throw e;
      await this.chamar("PUT", this.p(), { project: "achadinhos", adminPhones: [] });
      return fazer();
    }
  }

  /** URL completa de uma página do gateway (ex.: o link de pareamento /parear/<token>). */
  absoluta(caminho: string) {
    return `${this.url.replace(/\/$/, "")}${caminho}`;
  }

  private p(resto = "") {
    return `/v1/pools/${this.pool}${resto}`;
  }

  configurarPool(adminPhones: string[]) {
    return this.chamar<{ ok: true }>("PUT", this.p(), { project: "achadinhos", adminPhones });
  }
  adicionarNumero(instanceId: string, ordem: number) {
    return this.comPool(() =>
      this.chamar<{ pareamento: { token: string; expiraEm: string } }>("POST", this.p("/numeros"), {
        instanceId,
        ordem,
      }),
    );
  }
  pareamento(instanceId: string) {
    return this.chamar<{ url: string; expiraEm: string }>("POST", `/v1/instances/${instanceId}/pareamento`);
  }
  numeros() {
    return this.comPool(() => this.chamar<{ numeros: NumeroGateway[] }>("GET", this.p("/numeros")));
  }
  promover(instanceId: string) {
    return this.chamar<{ ok: true }>("POST", this.p(`/numeros/${instanceId}/promover`));
  }
  salvarGrupo(
    jid: string,
    g: { nome?: string; intervaloMinS?: number; espacoMinS?: number; espacoMaxS?: number },
  ) {
    return this.chamar<{ ok: true }>("PUT", this.p(`/grupos/${encodeURIComponent(jid)}`), g);
  }
  gruposDoWhatsapp() {
    return this.chamar<{ grupos: { jid: string; nome: string; participantes: number; souAdmin: boolean }[] }>(
      "GET",
      this.p("/grupos-whatsapp"),
    );
  }
  convite(jid: string) {
    return this.chamar<{ convite: string }>("GET", this.p(`/grupos/${encodeURIComponent(jid)}/convite`));
  }
  enviarGrupo(jid: string, texto: string, imagem: string | null, ref: string) {
    return this.chamar<{ id: string }>("POST", this.p(`/grupos/${encodeURIComponent(jid)}/mensagem`), {
      texto,
      ...(imagem ? { imagem } : {}),
      ref,
    });
  }
  privado(texto: string, ref?: string) {
    return this.chamar<{ ids: string[] }>("POST", this.p("/privado"), { texto, ...(ref ? { ref } : {}) });
  }
  salvarEntrada(e: { chave: string; grupoJid: string; mensagem: string; origem: string; resposta?: string }) {
    return this.chamar<{ waLink: string | null }>("POST", this.p("/entradas"), e);
  }
  eventos(limite = 50) {
    return this.chamar<{
      eventos: { id: string; tipo: string; dados: Record<string, unknown>; em: string }[];
    }>("GET", this.p(`/eventos?limite=${limite}`));
  }
}
