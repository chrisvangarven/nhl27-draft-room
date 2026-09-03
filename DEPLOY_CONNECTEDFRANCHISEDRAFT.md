# Deploy connectedfranchisedraft.com

## Render
1. Put this folder in a GitHub repository.
2. In Render, choose **New > Blueprint** (or New > Web Service) and connect the repository.
3. Render will read `render.yaml`.
4. Use a paid web-service plan because Render persistent disks are not available on Free.
5. Deploy and confirm `/api/health` returns `ok: true`.
6. In Render > Settings > Custom Domains, add `www.connectedfranchisedraft.com`.
   Render will automatically add/redirect the root domain counterpart.
7. Render will show the exact DNS target for the service. Use that value in GoDaddy.

## GoDaddy DNS
Do this only after the Render service is live and the custom domain has been added there.

- Remove conflicting website A/CNAME records for `@` and `www` only if they currently point elsewhere and you intend this app to replace the site.
- Remove AAAA records for the domain while configuring Render.
- For the root (`@`), use the A record value Render currently instructs for “other DNS providers”.
- For `www`, use a CNAME whose value is your exact Render `*.onrender.com` hostname.
- Keep MX/TXT email records untouched.
- Return to Render and click Verify beside the custom domain.

## App persistence
The included Render Blueprint mounts a 1 GB persistent disk at:
`/opt/render/project/src/data`

League state and updated player data are stored there. The initial 300-player dataset is copied from `/seed/player-data.json` automatically the first time an empty disk starts.
