# Bounce

Split-screen multiplayer climber. Create a room, share the four-digit code, and both players bounce upward against gravity while dodging moving bars.

## Play

```bash
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

- **Play on this screen** — split view, click the left or right half (or W / ↑)
- **Create room** — share the four-digit code in a second browser
- Last player alive wins; if both crash, highest climb score wins

## Stack

- Vite + TypeScript client (canvas split view)
- Node WebSocket server (`/ws`) with authoritative simulation
- Shared protocol + physics in `shared/`

## Scripts

| Command        | Purpose                                      |
|----------------|----------------------------------------------|
| `pnpm dev`     | WS server + Vite client (proxied `/ws`)      |
| `pnpm build`   | Production client build to `dist/`           |
| `pnpm start`   | WS server (serves `dist/` when present)      |
