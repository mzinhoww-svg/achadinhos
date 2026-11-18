import { type Db, tabelas as t } from "@achadinhos/db";
import { type ChamadaRegistrada, criarClienteLlm } from "@achadinhos/llm";
import { and, eq, gte, sql } from "drizzle-orm";
import { ErroNegocio, registrarEvento } from "../servicos.js";
import type { Alertas } from "./controle.js";
import { lerModelos, lerRegrasEnvio, lerTomDeVoz, type TomDeVoz } from "./regras.js";

/** Dados da oferta que a copy pode citar. Nada fora disto pode aparecer no texto. */
export interface DadosCopy {
  nome: string;
  preco: number;
  precoAntigo: number | null;
  descontoPct: number | null;
  ensaio: boolean;
}

export const brl = (v: number) => v.toFixed(2).replace(".", ",");
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const PALAVRAS_VAZIAS = new Set([
  "para",
  "com",
  "kit",
  "pcs",
  "unidades",
  "cozinha",
  "casa",
  "de",
  "do",
  "da",
  "e",
]);

/** Palavras do nome do produto que identificam o item (4+ letras). */
export function palavrasDoNome(nome: string): string[] {
  return semAcento(nome)
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p));
}

/**
 * Validador da copy (T5.1). Reprova se:
 * - faltar o preço da oferta, ou aparecer qualquer outro valor em R$ que não seja o preço antigo;
 * - aparecer uma porcentagem diferente do desconto (tolerância de 1 ponto);
 * - o texto não citar o produto (nenhuma palavra do nome);
 * - faltar a identificação de publicidade ou o marcador {{link}};
 * - passar do tamanho máximo.
 */
export function validarCopy(
  texto: string,
  d: DadosCopy,
  tom: Pick<TomDeVoz, "identificacoes" | "maxCaracteres">,
): string[] {
  const erros: string[] = [];
  const precos = [...texto.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map((m) =>
    Number((m[1] ?? "").replace(/\./g, "").replace(",", ".")),
  );
  const ok = new Set([d.preco.toFixed(2), ...(d.precoAntigo ? [d.precoAntigo.toFixed(2)] : [])]);
  if (!precos.some((p) => p.toFixed(2) === d.preco.toFixed(2)))
    erros.push(`preço da oferta (R$ ${brl(d.preco)}) ausente`);
  for (const p of precos) if (!ok.has(p.toFixed(2))) erros.push(`valor R$ ${brl(p)} não bate com o banco`);
  if (/R\$\s*\d+(?![\d.,]*,\d{2})/.test(texto.replace(/R\$\s*[\d.]+,\d{2}/g, "")))
    erros.push("preço fora do formato R$ 0,00");
  for (const m of texto.matchAll(/(\d{1,3})\s?%/g)) {
    const pct = Number(m[1]);
    if (d.descontoPct == null || Math.abs(pct - d.descontoPct) > 1)
      erros.push(`desconto de ${pct}% não bate com o banco`);
  }
  const nome = palavrasDoNome(d.nome);
  const t2 = semAcento(texto);
  if (nome.length && !nome.some((p) => t2.includes(p))) erros.push("o texto não cita o produto");
  if (!tom.identificacoes.some((i) => t2.includes(semAcento(i))))
    erros.push("falta a identificação de publicidade");
  if (!texto.includes("{{link}}")) erros.push("falta o marcador {{link}}");
  if (texto.length > tom.maxCaracteres)
    erros.push(`texto com ${texto.length} caracteres (máximo ${tom.maxCaracteres})`);
  return erros;
}

/** Nome curto: até 7 palavras, sem o excesso de termos de busca dos anúncios. */
export function nomeCurto(nome: string): string {
  const limpo = nome
    .replace(/[|/\\[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const palavras = limpo.split(" ").slice(0, 7).join(" ");
  return palavras.length > 60 ? `${palavras.slice(0, 57)}…` : palavras;
}

/** Copy de modelo fixo: usada sem LLM, com o teto de gasto atingido ou quando o LLM erra a validação. */
export function copyModeloFixo(d: DadosCopy, tom: Pick<TomDeVoz, "identificacaoPadrao">): [string, string] {
  const nome = nomeCurto(d.nome);
  const ensaio = d.ensaio ? "[ENSAIO] " : "";
  const de = d.precoAntigo ? `De ~R$ ${brl(d.precoAntigo)}~ por ` : "Por ";
  const desc = d.descontoPct ? ` (${Math.round(d.descontoPct)}% abaixo do preço médio)` : "";
  const a = `${ensaio}🏠 *${nome}*\n\n${de}*R$ ${brl(d.preco)}*${desc}\n\n👉 {{link}}\n\n${tom.identificacaoPadrao}`;
  const b = `${ensaio}Achado do dia: ${nome}\n\n💰 *R$ ${brl(d.preco)}*${d.precoAntigo ? ` (antes R$ ${brl(d.precoAntigo)})` : ""}\n\nCompre aqui: {{link}}\n\n${tom.identificacaoPadrao}`;
  return [a, b];
}

/** Gasto com LLM (US$) desde o início do dia e do mês (UTC-3). */
export async function gastoLlm(db: Db) {
  const agora = new Date(Date.now() - 3 * 3_600_000);
  const dia = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 3));
  const mes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1, 3));
  const soma = async (desde: Date) => {
    const [r] = await db
      .select({ v: sql<string>`coalesce(sum(${t.chamadasPagas.custoUsd}), 0)` })
      .from(t.chamadasPagas)
      .where(and(eq(t.chamadasPagas.servico, "llm"), gte(t.chamadasPagas.criadoEm, desde)));
    return Number(r?.v ?? 0);
  };
  return { dia: await soma(dia), mes: await soma(mes) };
}

export interface OpcoesCopy {
  openrouterKey?: string | undefined;
  openrouterBaseUrl?: string | undefined;
  alertas?: Alertas;
  f?: typeof fetch;
}

function extrairVariacoes(texto: string): string[] {
  const json = /\{[\s\S]*\}/.exec(texto)?.[0];
  if (json) {
    try {
      const v = (JSON.parse(json) as { variacoes?: unknown }).variacoes;
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").slice(0, 2);
    } catch {
      /* cai no texto puro */
    }
  }
  return texto
    .split(/\n-{3,}\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 2);
}

/** T5.1: gera 2 variações, valida contra o banco e escolhe a primeira válida. */
export async function gerarCopy(db: Db, ofertaId: number, o: OpcoesCopy, agente = "Copywriter") {
  const [l] = await db
    .select({ oferta: t.ofertas, produto: t.produtos })
    .from(t.ofertas)
    .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
    .where(eq(t.ofertas.id, ofertaId));
  if (!l) throw new ErroNegocio(404, "nao_encontrado", `oferta ${ofertaId} não existe`);
  const preco = Number(l.oferta.preco);
  const mediana = l.oferta.medianaPreco30d ? Number(l.oferta.medianaPreco30d) : null;
  const d: DadosCopy = {
    nome: l.produto.nome,
    preco,
    precoAntigo: mediana && mediana > preco ? mediana : null,
    descontoPct: l.oferta.descontoPct ? Number(l.oferta.descontoPct) : null,
    ensaio: l.oferta.ensaio,
  };
  const tom = await lerTomDeVoz(db);
  const regras = await lerRegrasEnvio(db);
  let candidatas: { texto: string; modelo: string }[] = [];
  let motivoSemLlm: string | null = null;

  const gasto = await gastoLlm(db);
  if (!o.openrouterKey) motivoSemLlm = "sem OPENROUTER_API_KEY";
  else if (gasto.dia >= regras.tetoDiarioUsd)
    motivoSemLlm = `teto diário de US$ ${regras.tetoDiarioUsd} atingido`;
  else if (gasto.mes >= regras.tetoMensalUsd)
    motivoSemLlm = `teto mensal de US$ ${regras.tetoMensalUsd} atingido`;
  if (motivoSemLlm?.startsWith("teto"))
    await o.alertas?.umaVezPorDia(
      "teto-llm",
      `💸 ${motivoSemLlm}: as copies seguem com o modelo fixo até a virada.`,
    );

  if (!motivoSemLlm && o.openrouterKey) {
    const modelos = await lerModelos(db);
    const llm = criarClienteLlm({
      apiKey: o.openrouterKey,
      ...(o.openrouterBaseUrl ? { baseUrl: o.openrouterBaseUrl } : {}),
      modelos: { copy: modelos.copy },
      titulo: "Achadinhos",
      ...(o.f ? { fetch: o.f } : {}),
      registrar: async (c: ChamadaRegistrada) => {
        await db
          .insert(t.chamadasPagas)
          .values({
            chaveIdempotente: c.chaveIdempotente,
            servico: "llm",
            agente: c.agente,
            modelo: c.modelo,
            tokensEntrada: c.tokensEntrada,
            tokensSaida: c.tokensSaida,
            custoUsd: c.custoUsd?.toString() ?? null,
            ofertaId,
            sucesso: c.sucesso,
            erro: c.erro,
          })
          .onConflictDoNothing();
      },
    });
    const dados = {
      produto: nomeCurto(d.nome),
      nomeCompleto: d.nome,
      precoPor: `R$ ${brl(d.preco)}`,
      precoDe: d.precoAntigo ? `R$ ${brl(d.precoAntigo)}` : null,
      descontoPct: d.descontoPct ? Math.round(d.descontoPct) : null,
      ensaio: d.ensaio,
    };
    try {
      const r = await llm.conversar({
        tarefa: "copy",
        agente,
        chaveIdempotente: `copy:${ofertaId}:${Date.now()}`,
        temperatura: 0.8,
        maxTokens: 700,
        mensagens: [
          {
            role: "system",
            content: [
              "Você escreve mensagens curtas de oferta para um grupo de WhatsApp de achadinhos.",
              "Use SOMENTE os dados enviados. Não invente preço, desconto, frete, cupom, prazo ou característica do produto.",
              `Cada mensagem: no máximo ${tom.maxCaracteres} caracteres, com o marcador {{link}} onde vai o link e com "${tom.identificacaoPadrao}" no final.`,
              "Formatação do WhatsApp: *negrito* e ~riscado~. No máximo 3 emojis.",
              dados.ensaio ? "É um ENSAIO: comece com [ENSAIO]." : "",
              tom.texto ? `Tom de voz do grupo:\n${tom.texto}` : "",
              tom.exemplos.length ? `Exemplos aprovados:\n${tom.exemplos.join("\n---\n")}` : "",
              'Responda só com JSON: {"variacoes": ["mensagem 1", "mensagem 2"]}',
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
          { role: "user", content: JSON.stringify(dados) },
        ],
      });
      candidatas = extrairVariacoes(r.texto).map((texto) => ({ texto, modelo: r.modelo }));
    } catch (e) {
      motivoSemLlm = `LLM falhou: ${(e as Error).message.slice(0, 160)}`;
    }
  }

  const avaliadas = candidatas.map((c) => ({ ...c, erros: validarCopy(c.texto, d, tom) }));
  if (!avaliadas.some((c) => c.erros.length === 0)) {
    // Modelo fixo garante que o ciclo não para; as tentativas do LLM ficam gravadas como reprovadas.
    const [a, b] = copyModeloFixo(d, tom);
    avaliadas.push(
      ...[a, b].map((texto) => ({ texto, modelo: "modelo-fixo", erros: validarCopy(texto, d, tom) })),
    );
  }

  await db.update(t.copies).set({ escolhida: false }).where(eq(t.copies.ofertaId, ofertaId));
  let escolhida: number | null = null;
  const gravadas: { id: number; texto: string; modelo: string; validada: boolean; erros: string[] }[] = [];
  for (const [i, c] of avaliadas.entries()) {
    const ehEscolhida: boolean = escolhida === null && c.erros.length === 0;
    const [linha]: { id: number }[] = await db
      .insert(t.copies)
      .values({
        ofertaId,
        texto: c.texto,
        agente,
        validada: c.erros.length === 0,
        motivoInvalida: c.erros.length ? c.erros.join("; ") : null,
        variacao: (i % 2) + 1,
        escolhida: ehEscolhida,
        modelo: c.modelo,
      })
      .returning({ id: t.copies.id });
    if (ehEscolhida) escolhida = linha?.id ?? null;
    gravadas.push({
      id: linha?.id ?? 0,
      texto: c.texto,
      modelo: c.modelo,
      validada: c.erros.length === 0,
      erros: c.erros,
    });
  }
  await registrarEvento(db, {
    tipo: escolhida ? "copy.gerada" : "copy.reprovada",
    agente,
    ofertaId,
    dados: {
      variacoes: gravadas.length,
      modelo: gravadas.find((g) => g.id === escolhida)?.modelo ?? null,
      semLlm: motivoSemLlm,
    },
  });
  return { ofertaId, escolhida, variacoes: gravadas, semLlm: motivoSemLlm, gastoHojeUsd: gasto.dia };
}
