# NHL 27 Draft Room v6 — Live Lobby

A deployable multi-user NHL 27 fantasy draft room with a dependency-free Node.js backend.

## v6 highlights
- Create League / Join League screens
- Six-character league codes and shareable invite URLs (`?league=CODE`)
- 2–32 teams
- Manager team passwords for claiming/rejoining a team
- Commissioner PIN access
- Live lobby with online and ready status
- Commissioner-controlled Start Draft
- Server-authoritative pick timer with automatic timer-expired picks
- Snake, linear, and third-round-reversal formats
- Real-time cross-device updates via Server-Sent Events
- Persistent league state
- Private manager queues, rankings, attribute weights, and X-Factor weights
- Full 300-player NHL 27 dataset with JSON replacement workflow
- Commissioner pause/resume, skip, undo, reset, team naming, order randomization, and player-data updates

## Run locally
```bash
node server.js
```
Then open http://localhost:3000. No npm install is required.

## Deployment
The included Dockerfile and render.yaml can be used for hosted deployment. Persist the `/data` directory if your host uses ephemeral filesystems.

## Important security note
Team passwords and commissioner PINs are stored as salted scrypt hashes. For a large public service, move persistence to a database and add HTTPS, rate limiting, account recovery, and stronger identity/session controls.
