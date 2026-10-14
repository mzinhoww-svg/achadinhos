#!/bin/bash
# Resumo do estado para o ciclo do orquestrador. Somente leitura.
cd "$(dirname "$0")/.." || exit 0
[ -f STOP ] && echo "ARQUIVO STOP PRESENTE: não inicie nada novo."
echo "== PRs abertos"
for p in $(gh pr list --json number --jq '.[].number' 2>/dev/null | sort -n); do
  t=$(gh pr view $p --json title,mergeable --jq '.title+" ["+.mergeable+"]"' 2>/dev/null)
  ci=$(gh pr checks $p 2>&1 | awk '{print $1":"$2}' | tr '\n' ' ')
  c=$(gh pr view $p --json comments --jq '.comments[-1].body|split("\n")|map(select(length>0))|.[0][0:110]' 2>/dev/null)
  echo "#$p $t | CI $ci | último: $c"
done
echo "== main"; git fetch -q origin main 2>/dev/null; git log origin/main --oneline | head -5
echo "== checklist MVP"; python3 - <<'PY'
import json
d=json.load(open("docs/mvp-checklist.json"))
for i in d["itens"]: print(i["id"], i["status"], "-", i["titulo"])
PY
exit 0
