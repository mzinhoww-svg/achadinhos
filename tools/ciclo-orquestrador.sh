#!/bin/bash
# Resumo do estado para o ciclo do orquestrador. Somente leitura, rápido.
cd "$(dirname "$0")/.." || exit 0
[ -f STOP ] && echo "ARQUIVO STOP PRESENTE: não inicie nada novo."
echo "== PRs abertos"
gh pr list --json number,title,mergeable,reviewDecision,statusCheckRollup,comments --jq '.[]|"#\(.number) \(.title) [\(.mergeable)] CI:"+([.statusCheckRollup[]?|.name+"="+(.conclusion//"?")]|join(","))+" | ultimo: "+((.comments|last|.body//"")|split("\n")|map(select(length>0))|.[0][0:100])' 2>&1
echo "== main"; git fetch -q origin main 2>/dev/null; git log origin/main --oneline | head -5
echo "== checklist MVP"
python3 - <<'PY'
import json
for i in json.load(open("docs/mvp-checklist.json"))["itens"]: print(i["id"], i["status"], "-", i["titulo"])
PY
exit 0
