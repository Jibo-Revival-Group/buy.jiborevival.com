#!/bin/sh
# Scrape and upload to BEefy (the site reads https://api.5x1.com/jibo-listings). Runs from cron on the Hermes box:
# eBay, Mercari and Facebook block datacenter IPs and headless browsers. The token is root-only on this machine.
set -e
cd "$(dirname "$0")/.."
git pull -q --ff-only
timeout 1500 xvfb-run -a node scraper/scrape.mjs
curl -fsS -m 60 -X PUT -H "Authorization: Bearer $(cat /root/.config/buy-jibo/token)" -H 'Content-Type: application/json' \
  --data-binary @listings.json https://api.5x1.com/jibo-listings >/dev/null
echo "uploaded $(date -u +%FT%TZ)"
