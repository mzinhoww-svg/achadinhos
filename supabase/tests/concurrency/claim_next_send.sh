#!/usr/bin/env bash
# Concorrência real (várias conexões) da fila: claim_next_send, SKIP LOCKED, advisory lock e
# enqueue_send_now (duplo clique). pgTAP roda numa transação só; aqui cada sessão é um psql.
#
# Uso (banco local com as migrações aplicadas):
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#     supabase/tests/concurrency/claim_next_send.sh
# ou, para outro cliente: PSQL="docker exec -i <container> psql -U postgres -d <db> -X -q -At" ...
#
# Os dados são commitados e removidos ao final (cascata pela conta + usuário).
set -uo pipefail

PSQL=${PSQL:-"psql ${DATABASE_URL:?defina DATABASE_URL ou PSQL} -X -q -At -v ON_ERROR_STOP=1"}
RUN=$(date +%s)$$
fails=0
tmp=$(mktemp -d)
trap 'cleanup' EXIT

U=$(uuidgen | tr 'A-Z' 'a-z')
ACC=$(uuidgen | tr 'A-Z' 'a-z')

sql() { $PSQL -c "$1"; }
cleanup() {
  $PSQL -c "delete from public.accounts where account_id = '$ACC'; delete from auth.users where id = '$U';" >/dev/null 2>&1
  rm -rf "$tmp"
}
check() { # nome esperado obtido
  if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (esperado=$2 obtido=$3)"; fails=$((fails+1)); fi
}
uuid() { printf '%08x-0000-4000-8000-%012d' "$1" "$((RUN % 1000000000000))"; }

# ---------- fixture ----------
$PSQL <<SQL >/dev/null || { echo "falha ao montar fixture"; exit 2; }
insert into auth.users (id, aud, role, email) values ('$U','authenticated','authenticated','conc-$RUN@t.com');
insert into public.accounts (account_id, user_id) values ('$ACC','$U');
SQL

mkchan() { # idx
  local ch gr
  ch=$(uuid $((0x1000 + $1))); gr=$(uuid $((0x2000 + $1)))
  sql "insert into public.channels (id, account_id, kind, config_secret_id) values ('$ch','$ACC','telegram', vault.create_secret('conc-$RUN-$1'));
       insert into public.groups (id, account_id, channel_id, external_id, sub_id) values ('$gr','$ACC','$ch','ext-$RUN-$1','sub-$RUN-$1');" >/dev/null
}
mksend() { # idx n prio
  local ch gr off
  ch=$(uuid $((0x1000 + $1))); gr=$(uuid $((0x2000 + $1))); off=$(uuid $((0x3000 + $1 * 100 + $2)))
  sql "insert into public.offers (id, account_id, item_id) values ('$off','$ACC','conc-$RUN-$1-$2');
       insert into public.sends (id, account_id, offer_id, group_id, channel_id, idempotency_key, priority, scheduled_for)
       values ('$off','$ACC','$off','$gr','$ch','conc-$RUN-$1-$2', ${3:-0}, now() - interval '1 hour' + ($2 || ' seconds')::interval);" >/dev/null
}
claim() { # idx -> imprime quantas linhas o claim devolveu (como service_role)
  local ch; ch=$(uuid $((0x1000 + $1)))
  $PSQL -c "set role service_role; select count(*) from public.claim_next_send('$ch');" | tail -1
}
sending_count() { sql "select count(*) from public.sends where channel_id = '$(uuid $((0x1000 + $1)))' and status = 'sending'" | tail -1; }

for i in 1 2 3 4 5 6 7 8 9; do mkchan "$i"; done

# ---------- 1) 12 claims simultâneos no mesmo canal => exatamente 1 ----------
for n in $(seq 1 12); do mksend 1 "$n"; done
for n in $(seq 1 12); do ( claim 1 > "$tmp/c1.$n" 2>&1 ) & done
wait
total=$(cat "$tmp"/c1.* | grep -E '^[0-9]+$' | paste -sd+ - | bc)
errs=$(cat "$tmp"/c1.* | grep -ciE 'error|fatal' || true)
check "12 claims simultâneos no canal: 1 vencedor" 1 "$total"
check "12 claims simultâneos: nenhuma sessão levou erro" 0 "$errs"
check "12 claims simultâneos: 1 sending no banco" 1 "$(sending_count 1)"

# ---------- 2) canais diferentes não se bloqueiam: 6 canais x 3 claims ----------
for c in 2 3 4 5 6 7; do mksend "$c" 1; mksend "$c" 2; done
for c in 2 3 4 5 6 7; do for k in 1 2 3; do ( claim "$c" > "$tmp/c2.$c.$k" 2>&1 ) & done; done
wait
total=$(cat "$tmp"/c2.* | grep -E '^[0-9]+$' | paste -sd+ - | bc)
check "6 canais x 3 claims: 1 vencedor por canal" 6 "$total"
ok=1; for c in 2 3 4 5 6 7; do [ "$(sending_count $c)" = 1 ] || ok=0; done
check "6 canais: exatamente 1 sending em cada" 1 "$ok"

# ---------- 3) advisory lock: claim concorrente espera/desiste sem erro ----------
mksend 8 1; mksend 8 2
( $PSQL -c "set role service_role; begin; select count(*) from public.claim_next_send('$(uuid $((0x1008)))'); select pg_sleep(2); commit;" > "$tmp/a3" 2>&1 ) &
sleep 0.7
start=$(date +%s)
b=$(claim 8 2>&1)
elapsed=$(( $(date +%s) - start ))
wait
check "sessão A (transação aberta) ganhou o claim" 1 "$(grep -E '^[0-9]+$' "$tmp/a3" | head -1)"
check "sessão B durante a transação de A: 0 linhas, sem erro" 0 "$b"
check "sessão B não ficou presa esperando o lock (<2s)" 1 "$([ "$elapsed" -lt 2 ] && echo 1 || echo 0)"
check "canal 8: 1 sending" 1 "$(sending_count 8)"

# ---------- 4) SKIP LOCKED: linha do topo travada por outra sessão => pega a seguinte ----------
mksend 9 1 100; mksend 9 2 0
top=$(uuid $((0x3000 + 9 * 100 + 1))); second=$(uuid $((0x3000 + 9 * 100 + 2)))
( $PSQL -c "begin; select id from public.sends where id = '$top' for update; select pg_sleep(2); rollback;" >/dev/null 2>&1 ) &
sleep 0.7
got=$($PSQL -c "set role service_role; select id from public.claim_next_send('$(uuid $((0x1009)))');" | tail -1)
wait
check "SKIP LOCKED: topo travado, claim leva o próximo" "$second" "$got"
check "SKIP LOCKED: topo continua queued" queued "$(sql "select status from public.sends where id='$top'" | tail -1)"

# ---------- 5) duplo clique (6 sessões) em enqueue_send_now => 1 send ----------
mkchan 10
gr=$(uuid $((0x2000 + 10))); off=$(uuid $((0x3000 + 10 * 100 + 1)))
sql "insert into public.offers (id, account_id, item_id) values ('$off','$ACC','conc-$RUN-10-1')" >/dev/null
for k in 1 2 3 4 5 6; do
  ( $PSQL -c "set role authenticated; select set_config('request.jwt.claim.sub','$U', false); select public.enqueue_send_now('$gr','$off');" > "$tmp/e.$k" 2>&1 ) &
done
wait
ids=$(cat "$tmp"/e.* | grep -E '^[0-9a-f-]{36}$' | grep -v "$U" | sort -u | wc -l | tr -d ' ')
errs=$(cat "$tmp"/e.* | grep -ciE 'error' || true)
check "duplo clique: todas as sessões recebem o mesmo id" 1 "$ids"
check "duplo clique: nenhuma sessão com erro" 0 "$errs"
check "duplo clique: 1 linha em fila" 1 "$(sql "select count(*) from public.sends where group_id='$gr' and offer_id='$off'" | tail -1)"

echo
if [ "$fails" -eq 0 ]; then echo "OK: concorrência da fila"; else echo "FALHOU: $fails verificação(ões)"; exit 1; fi
