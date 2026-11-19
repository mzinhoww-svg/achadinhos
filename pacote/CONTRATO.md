# Contrato da operação Achadinhos

Este documento descreve o que os agentes trocam com o worker e o que o worker precisa fazer. O worker implementa este contrato e documenta a interface realmente construída. Mudou algo? A mudança entra aqui antes de ser usada em lote.

## Perfil de referência

| Camada | Referência | Alternativas aceitas |
| --- | --- | --- |
| Agentes | OpenBot no computador do Aurimar | OpenBot num VPS Ubuntu |
| Modelos | OpenRouter como endpoint compatível com OpenAI, um modelo por agente e um reserva | OpenCode (provedor nativo do OpenBot) ou provedor direto |
| Coleta | Open API de afiliados da Shopee (GraphQL); piloto só com Shopee | Mercado Livre na fase 2, pela API com aplicativo próprio |
| Imagem | Recorte de fundo em Node + sharp + Satori | Foto original na moldura, quando o recorte falhar |
| Envio | wa-gateway com Baileys e vários números; entrada no grupo por link wa.me | Outro gateway com a mesma API |
| Dados | Postgres na Vertra, schema achadinhos | Nenhuma |

## Entradas (a bíblia)
- Documentos: BIBLIA, AGENTES, NICHOS, TOM-DE-VOZ, REGRAS-DE-OFERTA, REGRAS-DE-ENVIO, TEMPLATES-VISUAIS, CHECAGEM, FAILOVER, ROTINA, METRICAS.
- Tabelas: nichos, palavras_chave, grupos, grupo_nichos, produtos, historico_precos, ofertas, imagens, copies, links, cliques, conversoes, numeros, envios, eventos, propostas, biblia_docs e auditoria.

## Ferramentas do worker

| Ferramenta | Quem chama | O que faz |
| --- | --- | --- |
| /biblia | Coordenador (escrita), todos (leitura) | Ler e versionar documentos |
| /propostas | Todos | Propor mudança; Coordenador ou Aurimar aprova |
| /coleta/buscar | Garimpeiro | Buscar produtos de um nicho e gerar links de afiliado |
| /precos/historico e /ofertas | Monitor | Histórico de preço e criação de ofertas candidatas |
| /imagem/render | Arte | Peça visual a partir da foto real |
| /ofertas/:id/copy | Copywriter | Mensagem validada contra o banco |
| /ofertas/:id/checar | Coordenador | Checagem automática antes do envio |
| /pausa | Coordenador, painel, comando no WhatsApp | Pausar e retomar toda a operação |
| /disparo | Disparador | Agendar e enviar pelo wa-gateway |
| /numeros | Coordenador | Status do pool e troca de número banido |
| /eventos | Todos | Registrar e ler tudo o que acontece |

## Capacidades exigidas
1. Oferta só com desconto real contra a mediana de preço dos últimos 30 dias.
2. A peça visual usa a foto real; IA nunca altera o produto.
3. A copy é conferida contra o banco: preço, desconto e nome iguais.
4. Nada é enviado sem passar na checagem automática: preço revalidado, copy e imagem conferidas, produto não repetido, nicho e marca permitidos. Reprovada vai para o log com o motivo. O comando PAUSAR para tudo na hora.
5. Limites de envio por grupo e espaçamento entre mensagens.
6. Failover automático de número, com aviso ao Aurimar.
7. Toda chamada paga (LLM, API) é registrada com custo e chave idempotente.
8. Segredos só por referência ao cofre ou às variáveis; nunca em código, bíblia ou relatório.
9. Ferramenta não construída responde 501 com o motivo; falha sempre explicável.
10. Os agentes do OpenBot conduzem o ciclo pelas rotinas. Se o OpenBot ficar fora do ar por mais de 30 minutos, o worker roda o ciclo reserva com as regras atuais e avisa o Aurimar.
11. Toda mensagem identifica publicidade (ex.: #publi, link de afiliado) e avisa que o preço pode mudar.
12. Travas automáticas: teto diário de gasto com LLM, teto de mensagens por grupo e pausa sozinha após 3 falhas seguidas, 2 números banidos em 24 h ou mais de 20% de ofertas reprovadas no dia.
13. Cada link da Shopee leva subIds (grupo, nicho, oferta, horário), para ligar a conversão à origem.

## Saídas
- Ofertas enviadas com link curto por grupo.
- Cliques e conversões ligados a oferta, grupo e horário.
- Resumo diário no WhatsApp do Aurimar.
- Custo por agente e por oferta.

## Validação mínima
Antes do piloto, uma oferta do adaptador falso percorre o ciclo inteiro até um grupo de teste. Depois, o ensaio roda sozinho por 3 dias com o nicho real num grupo de teste. Sem erro de preço, copy ou imagem, a operação passa sozinha para os grupos reais e avisa o Aurimar.
