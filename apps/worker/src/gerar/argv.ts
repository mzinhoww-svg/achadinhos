export interface CliArgs {
  limit?: number;
  outbox?: string;
  groupLabel?: string;
  groupIndex?: number;
  keyword?: string;
  handle?: string;
  endpoint?: string;
  permitirReal?: boolean;
  help?: boolean;
}

export class ArgvError extends Error {
  override readonly name = "ArgvError";
}

function parseIntArg(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new ArgvError(`valor inválido para ${flag}`);
  return value;
}

/** Parser mínimo e determinístico; sem dependência. Aceita `--flag valor` e `--flag=valor`. */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; ) {
    const token = argv[i] ?? "";
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    const readValue = (): { value: string; next: number } => {
      if (inline !== undefined) return { value: inline, next: i + 1 };
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new ArgvError(`faltou valor para ${name}`);
      return { value: next, next: i + 2 };
    };

    switch (name) {
      case "--help":
      case "-h":
        args.help = true;
        i += 1;
        break;
      case "--permitir-real":
        args.permitirReal = true;
        i += 1;
        break;
      case "--limite": {
        const { value, next } = readValue();
        args.limit = parseIntArg(value, name);
        i = next;
        break;
      }
      case "--outbox": {
        const { value, next } = readValue();
        args.outbox = value;
        i = next;
        break;
      }
      case "--grupo": {
        const { value, next } = readValue();
        args.groupLabel = value;
        i = next;
        break;
      }
      case "--grupo-indice": {
        const { value, next } = readValue();
        args.groupIndex = parseIntArg(value, name);
        i = next;
        break;
      }
      case "--keyword": {
        const { value, next } = readValue();
        args.keyword = value;
        i = next;
        break;
      }
      case "--handle": {
        const { value, next } = readValue();
        args.handle = value;
        i = next;
        break;
      }
      case "--endpoint": {
        const { value, next } = readValue();
        args.endpoint = value;
        i = next;
        break;
      }
      default:
        throw new ArgvError(`argumento desconhecido: ${name}`);
    }
  }
  return args;
}

export const HELP = [
  "uso: pnpm outbox:gerar [--limite N] [--outbox DIR] [--grupo LABEL] [--grupo-indice N]",
  "                          [--keyword TEXTO] [--handle @x] [--endpoint URL]",
  "",
  "Gera a outbox (arquivos .md/.png) a partir de ofertas da Shopee e do canal FileOutbox.",
  "",
  "  --limite N        teto por execução (padrão 10, máximo 50)",
  "  --outbox DIR      raiz da outbox (padrão OUTBOX_DIR ou ./outbox)",
  "  --grupo LABEL     rótulo de exibição do grupo (padrão \"Grupo <indice>\")",
  "  --grupo-indice N  posição do grupo na configuração, 1..99 (padrão 1)",
  "  --keyword TXT     filtro de palavra-chave da busca",
  "  --handle @x       @ do afiliado (padrão AFFILIATE_HANDLE)",
  "  --endpoint URL    endpoint GraphQL (padrão SHOPEE_ENDPOINT)",
  "  --permitir-real   autoriza endpoint fora de loopback; exige --limite e só com autorização de Aurimar",
  "",
  "Ambiente: SHOPEE_APP_ID, SHOPEE_SECRET, SHOPEE_ENDPOINT, AFFILIATE_HANDLE, IMAGE_ALLOWED_HOSTS,",
  "OUTBOX_DIR, LOG_LEVEL. Nenhuma chamada real à Shopee sem SHOPEE_ENDPOINT explícito.",
].join("\n");
