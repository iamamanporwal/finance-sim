# Ollama (local AI)

```bash
ollama serve
ollama pull gpt-oss:20b          # tool-calling model used in development
cp apps/web/.env.example apps/web/.env.local   # optional
```

| Variable | Default | Meaning |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where the **server** reaches Ollama |
| `OLLAMA_MODEL` | unset | Default model. Users can pick any installed model in Settings (stored per browser) |
| `AI_PROVIDER` | `ollama` | Set to `disabled` on deployments without AI |

- **Local mode**: browser → Next.js on localhost → Ollama. The browser never calls Ollama directly.
- **Cloud mode (Vercel)**: Vercel cannot reach a user's `localhost:11434`. Set `AI_PROVIDER=disabled`, or point `OLLAMA_BASE_URL` at a reachable Ollama host. The rest of the app works without AI.
- Model choice order: the user's choice in Settings (if installed), then `OLLAMA_MODEL`, then the first installed model.
- Live test: `OLLAMA_E2E=1 pnpm vitest run apps/web/test/ai-ollama.e2e.test.ts`. It extracts the plan's example business with the real model and checks every value.
