#!/bin/bash
# Cloudflare 以外からのオリジン直叩きを遮断する。
#
# なぜ UFW ではダメか:
#   UFW は 80/443 を CF レンジのみに許可しているが、Docker が公開ポートを
#   nat PREROUTING で DNAT してコンテナへ FORWARD するため、パケットは
#   ホストの INPUT チェーンを通らず UFW のルールが一切効かない。
#   Docker が用意している DOCKER-USER チェーン (FORWARD の先頭で評価される) に
#   入れる必要がある。
#
# 注意: DOCKER-USER はコンテナの「外向き」通信も通る。
#   dport 80/443 を無条件に DROP すると batch -> R2/FRED や api-go -> Google OAuth が死ぬ。
#   そのため -i <外部IF> で「外から入ってくる新規接続」だけに限定している。
set -euo pipefail

EXT_IF="${EXT_IF:-ens3}"
CF_LIST="/etc/cloudflare-ips-v4.txt"

# CF レンジを更新 (取得できなければ既存ファイルを使う)
TMP=$(mktemp)
if curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4 -o "$TMP" && [ -s "$TMP" ]; then
  install -m 644 "$TMP" "$CF_LIST"
fi
rm -f "$TMP"
[ -s "$CF_LIST" ] || { echo "CF IP リストが空: $CF_LIST" >&2; exit 1; }

iptables -F DOCKER-USER

# 確立済みの接続 (コンテナの外向き通信の戻りを含む) はそのまま通す
iptables -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN

# 外部IF から入ってくる 80/443 のうち CF レンジのものだけ許可
while read -r cidr; do
  [ -n "$cidr" ] || continue
  iptables -A DOCKER-USER -i "$EXT_IF" -p tcp -m multiport --dports 80,443 -s "$cidr" -j RETURN
done < "$CF_LIST"

# 残り (= CF 以外からのオリジン直叩き) は落とす
iptables -A DOCKER-USER -i "$EXT_IF" -p tcp -m multiport --dports 80,443 -j DROP

# それ以外の転送は Docker の既定に委ねる
iptables -A DOCKER-USER -j RETURN

echo "DOCKER-USER に $(wc -l < "$CF_LIST") 件の CF レンジを適用した (EXT_IF=$EXT_IF)"
