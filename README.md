# SwiftReply AI MVP

A repaired, deployable MVP for generating polished email, chat, and customer-support replies with the Gemini API.

## What works

- Responsive browser interface
- Professional, friendly, concise, and empathetic tones
- Server-side Gemini API key protection
- Password-protected generation endpoint
- Per-IP request limiting
- Health check and Docker deployment
- No database, Redis, or frontend build system required

## Important scope

This MVP is a web reply generator. WhatsApp Cloud API receiving and sending are not included yet. Add WhatsApp only after this deployment is verified.

## Local setup

1. Copy `.env.example` to `.env` and add your secrets.
2. Export those environment variables in your terminal.
3. Start the app:

```bash
npm start
```

Open `http://localhost:3000`.

## Required production secrets

- `GEMINI_API_KEY`
- `APP_PASSWORD`

Optional configuration:

- `GEMINI_MODEL` (defaults to `gemini-3.5-flash-lite`)
- `RATE_LIMIT_MAX` (defaults to `10` requests per hour per IP)
- `RATE_LIMIT_WINDOW_MS` (defaults to one hour)

Never commit `.env` or expose `GEMINI_API_KEY` in browser code.

## Test

```bash
npm test
```

## Attribution

This repair is based on the SwiftReply AI concept and source materials originally published by the SwiftReply AI project. Original copyright and MIT licensing are preserved. The deployment architecture was simplified to create a working MVP from the incomplete multi-repository source.

## License

MIT — see `LICENSE`.
