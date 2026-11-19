# Painel do Achadinhos

Versão 1 · 18/11/2026 · Resultado da entrevista com o Aurimar (Parte 1C).

## Regras de design

- **O mais fácil de usar.** Mobile first, uma ação principal por tela.
- Tabelas com filtro. Nenhum gráfico sem uma decisão por trás.
- Visual **limpo e neutro**: fundo claro (tema escuro automático pelo sistema), tipografia forte e o laranja só como
  destaque e na ação principal.
- shadcn/ui + Tailwind 4. Os componentes ficam em `apps/painel/src/components/ui`.
- Navegação no celular: **menu lateral** (botão no topo abre a lista das telas). No computador, a barra lateral fica
  sempre visível.
- Período padrão das telas de números: **últimos 7 dias**, com troca rápida para hoje ou 30 dias.
- Recortes em toda tabela de números: **nicho, grupo, horário e oferta**.
- Ofertas não passam pela aprovação do Aurimar: a checagem automática decide. O painel só consulta e propõe ajustes.

## Mapa de telas

| Tela               | Rota          | Ação principal                     | Uso                  |
| ------------------ | ------------- | ---------------------------------- | -------------------- |
| Visão geral        | `/`           | **PAUSAR / RETOMAR**               | celular e computador |
| Ofertas            | `/ofertas`    | Ver a peça completa                | celular              |
| Checagens          | `/checagens`  | Propor ajuste de regra             | celular e computador |
| Nichos             | `/nichos`     | Novo nicho                         | computador           |
| Grupos             | `/grupos`     | Novo grupo                         | computador           |
| Números (chips)    | `/chips`      | Trocar o ativo                     | celular e computador |
| Números (métricas) | `/numeros`    | Filtrar por recorte                | computador           |
| Links e cliques    | `/links`      | Filtrar por recorte                | computador           |
| Conversões         | `/conversoes` | Filtrar por recorte                | computador           |
| Bíblia             | `/biblia`     | Abrir documento / aprovar proposta | celular e computador |
| Log dos agentes    | `/log`        | Filtrar por agente e tipo          | computador           |

### Visão geral

- **Cartão de status:** rodando ou pausada, desde quando, e o botão grande PAUSAR (ou RETOMAR). Pausar pede
  confirmação.
- **Ofertas de hoje:** enviadas, reprovadas na checagem e a próxima agendada (horário e grupo).
- **Cliques e conversões:** cliques, conversões e comissão de hoje contra ontem.
- **Alertas e custos:** número caído, travas acionadas, propostas abertas e gasto de LLM do dia contra o teto (barra).
- Decisão de cada bloco: pausar, abrir o alerta ou aprovar a proposta.

### Ofertas

- Lista em cartões no celular e tabela no computador: foto, nome, preço, desconto contra a mediana de 30 dias, nicho,
  grupo, status (candidata, aprovada, reprovada, agendada, enviada) e horário.
- Filtros: status, nicho, grupo e dia.
- Ação: **ver a peça completa** (imagem final, texto, link curto, preço e histórico de 30 dias, onde e quando foi
  enviada). Só consulta.

### Checagens

- Ofertas reprovadas, com o motivo e o agente que a produziu.
- Filtros: motivo, nicho e dia. No topo, a taxa de reprovação do dia contra a trava de 20%.
- Ação: **propor ajuste de regra**. Abre uma proposta à bíblia (CHECAGEM ou REGRAS-DE-OFERTA) já preenchida com o
  motivo e os exemplos. O Coordenador ou o Aurimar aprova.

### Nichos e Grupos

- Edição **direta no painel**: cadastrar, editar, ligar e desligar. Cada mudança vira evento e entra na auditoria.
- Nicho: nome, marketplace (Shopee; o Mercado Livre na fase 2), faixa de preço, palavras-chave (chips editáveis) e
  ativo.
- Grupo: nome, promessa, nichos, horários, máximo por dia, link de entrada, grupo de teste (sim ou não) e ativo.

### Números (chips do WhatsApp)

- Cada chip: apelido, papel (ativo ou reserva), status (conectado, caído, banido ou aquecendo) e último envio. O número
  completo nunca aparece.
- Ações: **trocar o ativo na mão** (com confirmação) e **parear por QR** (abre o QR do wa-gateway).
- Histórico de quedas: quando caiu, quem assumiu e o tempo fora.

### Números, Links e cliques, Conversões

- Tabelas com totais por nicho, grupo, horário e oferta. Período de 7 dias por padrão.
- Números: enviadas, cliques, CTR, conversões, comissão e custo de LLM por oferta.
- Links e cliques: link curto, oferta, grupo, subIds e cliques.
- Conversões: pedido, oferta, grupo, horário (pelos subIds), valor, comissão e status.
- Gráfico só onde há decisão: barra por horário (escolher horários de envio).

### Bíblia (já existe)

- Os 11 documentos, com versão e autor, e a leitura com histórico.
- A acrescentar: a aba **Propostas** (abertas primeiro), com as ações aprovar e recusar, e o diff do texto proposto.

### Log dos agentes

- Eventos em **tempo real** (`/eventos/stream`), com filtro por agente, tipo e oferta. Cada linha pode ser expandida
  para ver os dados.

## Componentes

`Button`, `Badge`, `Card`, `Input`, `Label` (já existem); a acrescentar: `Table` (com filtro e ordenação), `Select`,
`Sheet` (menu lateral e detalhes no celular), `Dialog` (confirmações), `Tabs`, `Switch`, `Skeleton`, `Toast`,
`KpiCard` (número + comparação) e `StatusDot`.

## Estados de cada tela

- **Carregando:** esqueleto com a forma do conteúdo (`Skeleton`), nunca um spinner solto.
- **Vazio:** uma frase dizendo por que está vazio e o que fazer (ex.: "Nenhuma oferta hoje. O Garimpeiro roda às 8h.").
- **Erro:** a mensagem do worker e um botão "Tentar de novo". Se o worker estiver fora, isso é dito com clareza.
- **Pausado:** faixa laranja no topo de todas as telas enquanto a operação está pausada.

## Fora do escopo agora

Edição livre da bíblia pelo painel (só por proposta), Mercado Livre (fase 2) e relatórios exportáveis.
