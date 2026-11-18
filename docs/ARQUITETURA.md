# Arquitetura

```
 Aurimar ──► Painel (Next, Vertra) ──X-Service-Token──► Worker (Fastify + pg-boss, Vertra) ──► Postgres (schema achadinhos)
   ▲  WhatsApp pessoal                                     ▲   │   │                              (snapshot diário da Vertra)
   │                                                        │   │   └──► Shopee Open API (busca, preço, link curto, conversões)
   │                                         MCP (token por agente)  └──► wa-gateway (Baileys, Vertra) ──► grupos e privado
   │                                                        │                     │
   └──────── resumo e alertas ◄─────────────────────────────┼─────────────────────┘ webhook pool.* (?t=token)
                                                 OpenBot no Mac (6 agentes, rotinas)
```

## As peças

| Peça                               | Onde                  | O que faz                                                                                                                                                |
| ---------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Painel** (`apps/painel`)         | Vertra, Node          | Telas para o Aurimar (login por e-mail e senha), botão Pausar tudo, link curto `/r/:codigo`. Só fala com o worker.                                       |
| **Worker** (`apps/worker`)         | Vertra, Node          | Todas as regras: coleta, Monitor, oferta real, arte, copy, checagem, agendamento, envio, travas, conversões, métricas, MCP dos agentes. Jobs no pg-boss. |
| **wa-gateway** (repo `wa-gateway`) | Vertra, Node          | Sessões Baileys no Postgres, pool de números com failover, fila por grupo, aquecimento, comandos e entrada por `wa.me`. Compartilhado com o Revela.      |
| **OpenBot**                        | Mac do Aurimar        | 6 agentes (Coordenador, Garimpeiro, Monitor, Diretor de Arte, Copywriter, Disparador) que conduzem o dia pelas rotinas e chamam o worker por MCP.        |
| **Postgres**                       | Vertra (`agencia-db`) | Schemas `achadinhos` (dados), `achadinhos_fila` (pg-boss) e `wa_gateway` (gateway).                                                                      |

## Pacotes do monorepo

- `packages/db`: schema Drizzle e migrações (aplicadas no boot do worker).
- `packages/marketplace`: adaptadores Shopee, Mercado Livre (fase 2) e falso; limite de taxa e repetição.
- `packages/arte`: download da foto, recorte de fundo (sharp, sem IA), padronização, templates (Satori + resvg).
- `packages/llm`: cliente OpenRouter com modelo reserva e registro de custo.
- `packages/shared`: tipos e validações comuns (bíblia, propostas, eventos).

## O ciclo de uma oferta

1. **Coleta** (`POST /coleta/buscar`): palavras-chave do nicho na Shopee → `produtos` (sem duplicar).
2. **Monitor** (job a cada 2 h): preço e estoque → `historico_precos`; desconto ≥ X% sobre a mediana de 30 dias, nota
   e vendas mínimas → `ofertas` (candidata), com pontuação.
3. **Arte** (`POST /imagem/render`): foto oficial, recorte, peça 1080×1080 e 1080×1350 → `imagens` (fallback com
   a foto original quando o recorte é ruim).
4. **Copy** (`POST /ofertas/:id/copy`): 2 variações do LLM, validadas contra o banco → `copies`.
5. **Checagem** (`POST /ofertas/:id/checar`): regras de CHECAGEM → `checagens`; aprovada é agendada.
6. **Agendamento**: horários de REGRAS-DE-ENVIO por grupo → `envios` (agendado).
7. **Envio** (job de 1 min): pausa? → preço revalidado → link curto por oferta e grupo (`links`, subIds na Shopee) →
   wa-gateway → webhook confirma → `envios` (enviado).
8. **Clique** (`/r/:codigo` no painel) → `cliques` → 302 para o link de afiliado.
9. **Conversão** (job 05:40): `conversionReport` da Shopee, subIds em `utmContent` → `conversoes` ligadas ao link.
10. **Métricas e resumo**: `/metricas`, `/custos`, resumo das 21h no WhatsApp.

## Quando algo cai

- **Agentes calados por 30 min:** o worker roda o ciclo reserva (passos 3 a 6) e avisa.
- **Chip cai:** o gateway troca para o próximo reserva admin dos grupos; banimento pausa tudo.
- **Shopee falha:** repetição com espera; erro registrado em `marketplace.erro`.
- **Banco cai:** o worker segue de pé em modo degradado (`/health` mostra) e tenta de novo.
