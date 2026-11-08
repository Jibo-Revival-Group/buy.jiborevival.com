#!/bin/sh
# Scrape and publish: run from cron on the Hermes box (home IP; eBay and Mercari block datacenter and headless browsers).
set -e
cd "$(dirname "$0")/.."
git pull -q --ff-only
timeout 1500 xvfb-run -a node scraper/scrape.mjs
git add listings.json
git diff --cached --quiet || { git -c user.name="Zane V" -c user.email="zane@jiborevival.com" commit -q -m "Update listings"; git -c credential.helper='!gh auth git-credential' push -q origin master; }
