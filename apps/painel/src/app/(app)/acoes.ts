"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirSessao } from "@/lib/auth";
import { worker } from "@/lib/worker";

/** Toda ação do painel passa por aqui: executa no worker e grava a auditoria (T6.9). */
async function agir<T>(
  acao: string,
  alvo: string,
  detalhes: Record<string, unknown>,
  fazer: () => Promise<T>,
  caminho: string,
) {
  const s = await exigirSessao();
  let erro: string | null = null;
  try {
    await fazer();
  } catch (e) {
    // Falha vira aviso na própria tela (?erro=), não a página de erro.
    erro = (e as Error).message || "não foi possível concluir";
  }
  if (erro) redirect(`${caminho}?erro=${encodeURIComponent(erro.slice(0, 200))}`);
  await worker.post("/auditoria", { ator: `${s.nome} (painel)`, acao, alvo, detalhes }).catch(() => {});
  revalidatePath(caminho);
  redirect(caminho);
}

/** Apelido de chip: minúsculas, sem acento, espaços viram hífen (o celular costuma pôr maiúscula). */
function apelido(v: FormDataEntryValue | null) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

const num = (v: FormDataEntryValue | null) =>
  v === null || v === "" ? null : Number(String(v).replace(",", "."));
const lista = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export async function salvarNicho(form: FormData) {
  const corpo = {
    nome: String(form.get("nome") ?? "").trim(),
    palavras: lista(form.get("palavras")),
    precoMin: num(form.get("precoMin")),
    precoMax: num(form.get("precoMax")),
    descontoMinPct: num(form.get("descontoMinPct")) ?? undefined,
    avaliacaoMin: num(form.get("avaliacaoMin")) ?? undefined,
    vendasMin: num(form.get("vendasMin")) ?? undefined,
    ativo: form.get("ativo") === "on",
    template: String(form.get("template") ?? "").trim() || null,
    modeloLlm: String(form.get("modeloLlm") ?? "").trim() || null,
    autor: "painel",
  };
  await agir("nicho.salvo", `nicho:${corpo.nome}`, corpo, () => worker.post("/nichos", corpo), "/nichos");
}

export async function alternarNicho(form: FormData) {
  const n = JSON.parse(String(form.get("nicho"))) as Record<string, unknown>;
  const corpo = { ...n, ativo: !n.ativo, autor: "painel" };
  await agir(
    n.ativo ? "nicho.pausado" : "nicho.ativado",
    `nicho:${n.nome}`,
    {},
    () => worker.post("/nichos", corpo),
    "/nichos",
  );
}

export async function salvarGrupo(form: FormData) {
  const id = num(form.get("id"));
  const corpo = {
    ...(id ? { id } : {}),
    nome: String(form.get("nome") ?? "").trim(),
    waJid: String(form.get("waJid") ?? "").trim() || null,
    promessa: String(form.get("promessa") ?? "").trim() || null,
    teste: form.get("teste") === "on",
    ativo: form.get("ativo") === "on",
    maxPorDia: num(form.get("maxPorDia")),
    horarios: lista(form.get("horarios")),
    nichoIds: form.getAll("nichoIds").map(Number),
    autor: "painel",
  };
  await agir(
    id ? "grupo.alterado" : "grupo.criado",
    `grupo:${corpo.nome}`,
    corpo,
    () => worker.post("/grupos", corpo),
    "/grupos",
  );
}

export async function criarEntrada(form: FormData) {
  const id = Number(form.get("grupoId"));
  const corpo = {
    chave: String(form.get("chave") ?? "").trim(),
    mensagem: String(form.get("mensagem") ?? "").trim(),
    origem: String(form.get("origem") ?? "").trim(),
  };
  await agir(
    "grupo.entrada",
    `grupo:${id}`,
    corpo,
    () => worker.post(`/grupos/${id}/entrada`, corpo),
    "/grupos",
  );
}

export async function adicionarNumero(form: FormData) {
  const corpo = {
    instanceId: apelido(form.get("instanceId")),
    ordem: num(form.get("ordem")) ?? 0,
  };
  if (!/^[a-z0-9-]{2,32}$/.test(corpo.instanceId))
    redirect(
      `/chips?erro=${encodeURIComponent("Apelido inválido: use de 2 a 32 letras minúsculas, números ou hífen (ex.: ach-1).")}`,
    );
  await agir(
    "numero.adicionado",
    `numero:${corpo.instanceId}`,
    corpo,
    () => worker.post("/numeros", corpo),
    "/chips",
  );
}

export async function promoverNumero(form: FormData) {
  const id = String(form.get("instanceId"));
  await agir("numero.promovido", `numero:${id}`, {}, () => worker.post(`/numeros/${id}/promover`), "/chips");
}

export async function salvarTelefonesDono(form: FormData) {
  const adminPhones = lista(form.get("telefones")).map((x) => x.replace(/\D/g, ""));
  await agir(
    "pool.telefones",
    "pool",
    { quantidade: adminPhones.length },
    () => worker.post("/wa/pool", { adminPhones }),
    "/chips",
  );
}

export async function prepararOferta(form: FormData) {
  const id = Number(form.get("id"));
  await agir(
    "oferta.preparar",
    `oferta:${id}`,
    {},
    () => worker.post(`/ofertas/${id}/preparar`),
    `/ofertas/${id}`,
  );
}

export async function checarOferta(form: FormData) {
  const id = Number(form.get("id"));
  await agir(
    "oferta.checar",
    `oferta:${id}`,
    {},
    () => worker.post(`/ofertas/${id}/checar`, { agente: "painel" }),
    `/ofertas/${id}`,
  );
}

export async function criarEnsaio() {
  await agir("ensaio.criado", "ensaio", {}, () => worker.post("/ensaio/oferta", {}), "/checagens");
}

export async function salvarDocBiblia(form: FormData) {
  const slug = String(form.get("slug"));
  const corpo = {
    slug,
    conteudo: String(form.get("conteudo") ?? ""),
    autor: "Aurimar (painel)",
    motivo: String(form.get("motivo") ?? "").trim() || "edição no painel",
  };
  await agir(
    "biblia.editada",
    `biblia:${slug}`,
    { motivo: corpo.motivo },
    () => worker.post("/biblia", corpo),
    `/biblia/${slug}`,
  );
}
