# System Dashboard & WhatsApp Automation

A monorepo project containing a WhatsApp automation backend and a Next.js dashboard frontend.

## Structure

- **Backend**: Node.js/Express application handling WhatsApp integration (Baileys), Sessions, and Business Logic.
- **Frontend**: Next.js (App Router) + TailwindCSS dashboard for managing campaigns and viewing real-time stats.

## Prerequisites

- Node.js >= 18
- Windows OS (Optimized for Windows environment)

## Setup & Running

### Backend

```bash
cd Backend
npm install
npm start
```
Runs on `http://localhost:3001`

### Frontend

```bash
cd Frontend
cp .env.example .env.local
npm install
npm run dev
```
Runs on `http://localhost:3000`

## Configuration

- **Frontend**: Configure API URL in `.env.local`.
- **Backend**: Check `config.json` for paths and compliance settings. WhatsApp sessions are stored reliably in `Backend/data/sessions/`.

## Notes

- Tests and experimental scripts have been moved to `_quarantine/` for cleanup.
- Ensure `Backend/data` folders exist for state persistence.
