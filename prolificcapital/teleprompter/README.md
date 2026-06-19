# Teleprompter

A focused script teleprompter for Divinity CRM students. Two screens:
- **Main display**: large auto-scrolling text with adjustable speed, font size, and stage context
- **Stage navigator**: jump between pipeline stages, pulls script prompts from the same source as CRM (`backend/src/services/script-prompts.js` logic)

## Why separate from CRM?

The CRM has a Pipeline page with a script-prompt modal. That's for editing/drafting. This is a **call-mode** interface — large fonts, auto-scroll, hands-free operation while on a call.

## Architecture

```
teleprompter/
├── backend/           # Express API (port 3002) — proxies to CRM DB for stage context
├── frontend/          # React + Vite (port 5174) — large-font scrolling UI
└── README.md
```

## Run locally

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## API

- `GET /api/script/:stageId` — returns the full script for a stage (text + delivery notes)
- `GET /api/stages` — returns the 21 stages with display names and owners
- `GET /api/lead/:leadId/script` — returns the lead-specific script (with property address, seller name, etc filled in)
- `POST /api/script/:stageId/render` — returns rendered script (variable substitution)

## TODO

- [ ] Backend Express server
- [ ] Stage definitions (copy from `divinitycrm/frontend/src/lib/pipeline-stages.js`)
- [ ] Variable substitution (address, seller_name, etc.)
- [ ] Frontend: large-font auto-scroll component
- [ ] Frontend: speed control (WPM)
- [ ] Frontend: stage navigator
- [ ] Frontend: keyboard shortcuts (Space=pause, ↑↓=speed)
- [ ] WebSocket for remote control (e.g., second device as clicker)
