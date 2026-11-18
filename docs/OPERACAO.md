# Operação do dia a dia

## O dia, sem você fazer nada

| Hora (Brasília)                 | Quem                        | O quê                                                                                                        |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 05:40                           | worker                      | Importa as conversões da Shopee dos últimos 7 dias e liga cada pedido à oferta, ao grupo e ao horário.       |
| 06:15                           | Coordenador                 | Abre o dia: lê a rotina, confere chips e pausa.                                                              |
| 06:30                           | Garimpeiro                  | Coleta os produtos dos nichos ativos.                                                                        |
| a cada 2 h                      | Monitor (e o job do worker) | Atualiza preços e cria as ofertas candidatas (desconto real sobre a mediana de 30 dias).                     |
| :30 e :40 antes de cada horário | Diretor de Arte, Copywriter | Peças com a foto real e o texto validado.                                                                    |
| :50 antes de cada horário       | Coordenador                 | Checagem automática; aprovada é agendada sozinha.                                                            |
| 08h, 11h, 14h, 17h, 20h         | worker                      | Revalida o preço e envia pelo chip ativo (até 3 extras por dia acima de 40%, máximo 8, 20 min de intervalo). |
| 21:00                           | Coordenador                 | Resumo do dia no seu WhatsApp (às 21:05 o worker manda, se ninguém mandou).                                  |
| ~00:35                          | Vertra                      | Snapshot diário do banco (`agencia-db`, que guarda o schema `achadinhos`).                                   |

Se os agentes ficarem 30 minutos sem falar com o worker (OpenBot fechado, Mac desligado), o worker assume o **ciclo
reserva** e avisa você uma vez por dia.

## O que olhar no painel

- **Visão geral:** rodando ou pausado, ofertas do dia, cliques, conversões, saúde dos chips e alertas.
- **Checagens:** o que saiu, o que está agendado e o que foi barrado (com o motivo).
- **Conferência da arte:** cada peça ao lado da foto original.
- **Números:** o que dá resultado por nicho, grupo, horário e oferta, e o custo de IA por agente.

## Pausar

Qualquer um destes para tudo na hora (o worker confere antes de cada envio):

- botão **Pausar tudo** no topo do painel;
- mandar **PAUSAR** para o chip ativo, do seu WhatsApp pessoal (RETOMAR volta; STATUS responde como está);
- o Coordenador, pela ferramenta `definir_pausa`.

O sistema pausa sozinho e avisa você quando:

- houver 3 falhas de envio seguidas;
- mais de 20% das ofertas do dia forem reprovadas (com no mínimo 5);
- um número for banido;
- não sobrar chip de reserva.

## Quando algo dá errado

| Sintoma                                | O que fazer                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alerta "número caiu"                   | Painel › Chips: veja o motivo. Falha técnica, o reserva já assumiu. Banimento: tudo pausou; troque o chip e pareie um novo (QR) antes de retomar. |
| Chip aguardando QR                     | Painel › Chips › **QR**, abra o link no computador e escaneie com o celular do chip (WhatsApp › Aparelhos conectados). O link vale 10 min.        |
| Nenhuma oferta há dias                 | Normal nos 3 primeiros dias (histórico de preço). Depois, veja Nichos: desconto mínimo alto demais ou palavras-chave ruins.                       |
| Muitas reprovações                     | Checagens › Reprovadas: o motivo diz qual regra barrou. Ajuste a regra na bíblia (CHECAGEM) ou o nicho.                                           |
| "Shopee recusou (ERRO_SISTEMA)" no log | A Shopee falha de vez em quando; o worker repete com espera. Se for sempre a mesma palavra, troque a palavra.                                     |
| Gasto de IA no teto                    | As copies seguem com o texto padrão até a virada do dia. Para subir o teto, mude `tetoDiarioUsd` em REGRAS-DE-ENVIO.                              |
| Worker fora do ar                      | Vertra › app `worker` › Logs. O `/health` diz se o problema é banco, fila ou configuração.                                                        |

## Mudar regras

As regras moram na **bíblia** (painel › Bíblia; cada documento tem versões). Os documentos REGRAS-DE-ENVIO, CHECAGEM,
TOM-DE-VOZ, AGENTES e TEMPLATES-VISUAIS aceitam um bloco ` ```json ` com os campos descritos em `WORKER-API.md` e
`DECISOES.md` (D-013, D-016). O que não estiver no bloco usa o padrão.

Nichos (palavras, faixa de preço, desconto mínimo, nota, vendas, template e modelo) mudam na tela **Nichos** e valem
na próxima coleta e na próxima rodada do Monitor.

## Ir para o grupo real

1. Ensaio de 3 dias só no grupo de teste (grupo marcado como **teste** em Grupos).
2. Leia os 3 resumos do ensaio.
3. Cadastre o grupo real (JID, chips como admins, nichos), deixe-o **ativo** e desmarque **teste**.

## Segurança

- Nenhum segredo no git (gitleaks no CI a cada push). Chaves ficam nas variáveis da Vertra e no cofre do OpenBot.
- Cada agente tem o próprio token de MCP (tela Agentes); troque o `SERVICE_TOKEN` do worker para invalidar todos.
- O `/r` limita 30 cliques por minuto por IP; o IP nunca é guardado (só um hash com sal).
