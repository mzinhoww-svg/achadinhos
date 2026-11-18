"use strict";
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; return e; };

async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "X-OBG": "1" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  if (res.status === 401 && url.startsWith("/admin/")) { show(false); throw new Error("Sessão expirada"); }
  return { status: res.status, ok: res.ok, data };
}
const errText = (r) => (r.data && (r.data.message || r.data.error)) || ("HTTP " + r.status);

function show(signedIn) {
  $("#login-view").hidden = signedIn; $("#app-view").hidden = !signedIn; $("#logout").hidden = !signedIn;
  if (signedIn) { loadStatus(); fillAccess(); }
}

// ----- sign in -----
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target); $("#login-error").textContent = "";
  const r = await api("POST", "/auth/login", { email: f.get("email"), password: f.get("password") });
  if (r.ok) { e.target.reset(); show(true); }
  else $("#login-error").textContent = r.status === 429 ? "Muitas tentativas. Aguarde 15 minutos." : "E-mail ou senha inválidos.";
});
$("#logout").addEventListener("click", async () => { await api("POST", "/auth/logout"); show(false); });

// ----- tabs -----
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  for (const t of ["server", "agents", "access"]) $("#tab-" + t).hidden = t !== b.dataset.tab;
  if (b.dataset.tab === "agents") loadAgents();
}));

// ----- server -----
const LABELS = { version: "Versão", account: "Conta", email: "E-mail", account_message: "Mensagem da conta", server: "Servidor", server_name: "Nome", server_message: "Mensagem do servidor", memory_level: "Memória (nível)", turn_limit: "Turnos simultâneos" };
async function loadStatus() {
  const dl = $("#status"); dl.replaceChildren();
  const r = await api("GET", "/admin/api/status").catch((e) => ({ data: { error: e.message } }));
  const s = r.data || {};
  if (!r.ok) { dl.append(el("dt", {}, "Erro"), el("dd", {}, errText(r))); return; }
  for (const [k, label] of Object.entries(LABELS)) if (s[k]) dl.append(el("dt", {}, label), el("dd", {}, s[k]));
  if (s.memory_limit) dl.append(el("dt", {}, "Memória livre"), el("dd", {}, `${Math.round(s.memory_available / 1048576)} MiB de ${Math.round(s.memory_limit / 1048576)} MiB`));
  $("#signin-box").hidden = s.account === "signed_in";
}
$("#refresh-status").addEventListener("click", loadStatus);

let challenge = null, signinName = "";
$("#signin-start").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target); signinName = f.get("name") || "";
  const r = await api("POST", "/admin/api/server/login/start", { email: f.get("email"), name: signinName });
  if (r.data?.ok && r.data.challenge) { challenge = r.data.challenge; $("#signin-verify").hidden = false; $("#signin-msg").textContent = "Código enviado. Confira o e-mail."; }
  else $("#signin-msg").textContent = errText(r);
});
$("#signin-verify").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  const r = await api("POST", "/admin/api/server/login/verify", { challenge, code: f.get("code"), name: signinName });
  if (r.data?.ok) { $("#signin-msg").textContent = "Servidor vinculado. Publicando..."; e.target.reset(); setTimeout(loadStatus, 4000); }
  else $("#signin-msg").textContent = errText(r);
});
$("#signin-claim").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  const name = $("#signin-start").elements.name.value;
  const r = await api("POST", "/admin/api/server/login/claim", { claim: f.get("claim"), name });
  e.target.reset();
  $("#signin-msg").textContent = r.data?.ok ? "Servidor vinculado. Publicando..." : errText(r);
  if (r.data?.ok) setTimeout(loadStatus, 4000);
});
$("#mobile-connect").addEventListener("click", async () => {
  const r = await api("POST", "/admin/api/server/mobile-connect");
  const pre = $("#qr"); pre.hidden = false;
  pre.textContent = r.data?.ok && r.data.qr ? r.data.qr + "\nEscaneie no app OpenBot (Scan QR code). Uso único; expira em poucos minutos." : errText(r);
});

// ----- agents -----
let current = null;
async function loadAgents() {
  $("#agents-msg").textContent = "";
  const ul = $("#agent-list"); ul.replaceChildren();
  const r = await api("GET", "/admin/api/agents");
  if (!r.ok) { $("#agents-msg").textContent = errText(r); return; }
  for (const a of r.data || []) {
    const li = el("li", {}, a.name || a.id);
    if (current && current.id === a.id) li.classList.add("active");
    li.addEventListener("click", () => { current = a; document.querySelectorAll("#agent-list li").forEach((x) => x.classList.toggle("active", x === li)); openChat(); });
    ul.append(li);
  }
  if (!ul.children.length) $("#agents-msg").textContent = "Nenhum agente com Local scripts ligado.";
}
$("#refresh-agents").addEventListener("click", loadAgents);

const histories = new Map();
function addMsg(who, text, meta) {
  const list = histories.get(current.id) || []; list.push({ who, text, meta }); histories.set(current.id, list); renderMsgs();
}
function renderMsgs() {
  const box = $("#messages"); box.replaceChildren();
  for (const m of histories.get(current.id) || []) { const d = el("div", { class: "msg " + m.who }); d.append(el("span", { class: "meta" }, m.meta), document.createTextNode(m.text)); box.append(d); }
  box.scrollTop = box.scrollHeight;
}
function openChat() { $("#chat").hidden = false; $("#chat-title").textContent = current.name || current.id; renderMsgs(); loadPending(); }

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = new FormData(e.target); const text = String(f.get("text") || "").trim(); if (!text) return;
  const agent = current; const btn = e.target.querySelector("button"); btn.disabled = true; e.target.reset();
  addMsg("me", text, "Você");
  try {
    const r = await api("POST", `/admin/api/agents/${encodeURIComponent(agent.id)}/messages`, { text });
    if (r.status !== 202) { addMsg("bot", errText(r), "Erro"); return; }
    const d = (r.data.deliveries || []).find((x) => x.recipientAgentId === agent.id) || r.data.deliveries?.[0];
    if (!d) { addMsg("bot", "Mensagem na fila.", "OpenBot"); return; }
    await poll(agent, d.id);
  } finally { btn.disabled = false; }
});
async function poll(agent, deliveryId) {
  const started = Date.now();
  while (Date.now() - started < 30 * 60_000) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await api("GET", `/admin/api/agents/${encodeURIComponent(agent.id)}/deliveries/${encodeURIComponent(deliveryId)}`);
    if (!r.ok) { addMsg("bot", errText(r), "Erro"); return; }
    const s = r.data.status;
    if (["completed", "failed", "interrupted", "cancelled"].includes(s)) {
      addMsg("bot", r.data.answer || r.data.error || "(sem resposta)", `${agent.name || agent.id} · ${s}`); loadPending(); return;
    }
    if (Date.now() - started > 15_000) loadPending();
  }
  addMsg("bot", "Ainda em execução; confira depois em openbot.run/app.", "OpenBot");
}
$("#new-chat").addEventListener("click", async () => {
  const r = await api("POST", `/admin/api/agents/${encodeURIComponent(current.id)}/context/clear`);
  if (r.ok) { histories.set(current.id, []); renderMsgs(); } else alert(errText(r));
});

async function loadPending() {
  const box = $("#pending"); const agent = current;
  const r = await api("GET", `/admin/api/agents/${encodeURIComponent(agent.id)}/pending`);
  box.replaceChildren();
  if (!r.ok) { box.textContent = errText(r); return; }
  const { prompts = [], approvals = [], browserTakeovers = [] } = r.data || {};
  if (!prompts.length && !approvals.length && !browserTakeovers.length) { box.textContent = "Nada pendente."; return; }
  for (const p of prompts) {
    const item = el("div", { class: "pending-item" });
    if (p.requiresOpenBot) { item.textContent = "Pergunta que precisa ser respondida no OpenBot (openbot.run/app)."; box.append(item); continue; }
    const form = el("form");
    for (const q of p.questions || []) {
      form.append(el("strong", {}, q.header || q.id), el("p", {}, q.question));
      if (q.options) { const sel = el("select", { name: q.id }); for (const o of q.options) sel.append(el("option", { value: o.label }, o.label)); form.append(sel); }
      else form.append(el("input", { name: q.id, required: "" }));
    }
    form.append(el("button", { type: "submit" }, "Responder"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); const fd = new FormData(form); const answers = {};
      for (const [k, v] of fd.entries()) answers[k] = [String(v)];
      const a = await api("POST", `/admin/api/agents/${encodeURIComponent(agent.id)}/prompts/${encodeURIComponent(p.requestId)}/answer`, { answers });
      if (!a.ok) alert(errText(a)); loadPending();
    });
    item.append(form); box.append(item);
  }
  for (const ap of approvals) {
    const item = el("div", { class: "pending-item" });
    item.append(el("strong", {}, "Aprovação: " + (ap.kind || "")), el("pre", {}, [ap.command, ap.cwd && "cwd: " + ap.cwd, ap.reason && "motivo: " + ap.reason].filter(Boolean).join("\n")));
    for (const decision of ["accept", "decline"]) {
      const b = el("button", { class: decision === "accept" ? "" : "ghost" }, decision === "accept" ? "Aprovar" : "Recusar");
      b.addEventListener("click", async () => {
        const a = await api("POST", `/admin/api/agents/${encodeURIComponent(agent.id)}/approvals/${encodeURIComponent(ap.requestId)}/respond`, { decision });
        if (!a.ok) alert(errText(a)); loadPending();
      });
      item.append(b, document.createTextNode(" "));
    }
    box.append(item);
  }
  for (const _ of browserTakeovers) box.append(el("div", { class: "pending-item" }, "O agente pede para assumir o navegador: conclua em openbot.run/app."));
}

// ----- access -----
function fillAccess() {
  const base = location.origin;
  $("#mcp-example").textContent =
`# Claude Code (outro chat / outra máquina)
claude mcp add --transport http openbot-vertra ${base}/mcp \\
  --header "Authorization: Bearer \${OPENBOT_GATEWAY_TOKEN}"

# Qualquer cliente MCP: URL ${base}/mcp, header Authorization: Bearer <token>`;
  $("#rest-example").textContent =
`curl -sS ${base}/api/v1/agents -H "Authorization: Bearer $OPENBOT_GATEWAY_TOKEN"

curl -sS -X POST ${base}/api/v1/agents/<agentId>/messages \\
  -H "Authorization: Bearer $OPENBOT_GATEWAY_TOKEN" -H "Content-Type: application/json" \\
  -d '{"text":"Olá","waitSeconds":120}'`;
}

api("GET", "/auth/me").then((r) => show(!!r.data?.signedIn)).catch(() => show(false));
