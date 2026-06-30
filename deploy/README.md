# SJC OS — Deployment

Production host: this Linux box (residential, public IP `73.94.192.119`).
Public URL: **https://os.sjcarpentryllc.com**

## Architecture

```
browser ──HTTPS──> nginx (:443, Let's Encrypt) ──HTTP──> 127.0.0.1:3017 (Next.js prod)
                                                            │
                                                            ├── Postgres :5432 (role/db: sjcos)
                                                            └── Ollama :11434 (qwen2.5:7b-instruct)
```

- **App**: `next start` on loopback `127.0.0.1:3017`, run as the systemd **user** service
  `sjcos.service` (reboot-persistent via `loginctl enable-linger joe`). See `sjcos.service`.
- **AI**: Ollama runs as the systemd user service `ollama.service` (separate).
- **TLS/DNS**: `os.sjcarpentryllc.com` is an A record → `73.94.192.119`, **DNS-only (grey
  cloud)** in the Cloudflare account that holds the zone (managed by Joe's web developer;
  registrar is Squarespace). nginx terminates TLS via certbot. See `nginx-sjcos.conf`.

## First-time go-live steps

1. **DNS** (developer, one-time): add A record `os` → `73.94.192.119`, DNS-only.
   Verify: `dig +short A os.sjcarpentryllc.com @1.1.1.1` returns `73.94.192.119`.
2. **App service**: `cp deploy/sjcos.service ~/.config/systemd/user/ && systemctl --user
   daemon-reload && systemctl --user enable --now sjcos.service`
3. **nginx + TLS** (sudo):
   ```
   sudo cp deploy/nginx-sjcos.conf /etc/nginx/sites-available/sjcos
   sudo ln -s /etc/nginx/sites-available/sjcos /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d os.sjcarpentryllc.com
   ```
4. **Env**: `.env.local` (gitignored) must set `GMAIL_REDIRECT_URI=https://os.sjcarpentryllc.com/api/inbox/oauth/callback`,
   `AI_PROVIDER=ollama`, `NEXT_PUBLIC_AI_PROVIDER=ollama`, `SESSION_SECRET`, DB + Gmail creds.
5. **Gmail modify re-consent** (one-time, after TLS): register the prod redirect URI in Google
   Cloud Console → Credentials → the OAuth client, then visit
   `https://os.sjcarpentryllc.com/api/inbox/oauth/start`, approve, paste the new
   `GMAIL_REFRESH_TOKEN` into `.env.local`, `systemctl --user restart sjcos.service`.

## Redeploy after a code change

```
cd ~/sjcos-app
git pull                       # (or edit in place)
npm run build                  # do NOT run while sjcos.service is live if it shares .next — stop it first
systemctl --user restart sjcos.service
```

## Scheduler — daily reminders

A systemd **user timer** runs the reminder sweep (`/api/cron/reminders`) once a
day at 08:00. The endpoint is not session-gated (the proxy excludes `/api`); it
checks `CRON_SECRET` from `.env.local`. Reboot-persistent via the existing
`loginctl enable-linger joe`.

Install (one-time):
```
# .env.local must contain CRON_SECRET=<random hex>  (gitignored)
install -m755 deploy/sjcos-reminders.sh ~/bin/sjcos-reminders
cp deploy/sjcos-reminders.service deploy/sjcos-reminders.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now sjcos-reminders.timer
```

Run on demand / inspect:
```
systemctl --user start sjcos-reminders.service           # trigger now
journalctl --user -u sjcos-reminders.service -n 20       # last result (JSON)
systemctl --user list-timers sjcos-reminders.timer       # next run
```

Windows emitted: compliance items 60/30 days out, sub COI expiry 30/15/5 days
out (the urgent ≤14-day compliance window is emitted on feed-read in
`lib/notify.ts`). Each (record, window) fires once via the `reminder_log` dedup
table. Add new scans (warranty deadlines, A/R dunning) in `lib/reminders.ts`.
