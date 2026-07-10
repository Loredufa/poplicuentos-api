# Poplicuentos API

API en Next.js 15 (App Router) que sirve de backend para la app móvil **popli-54**: autenticación (Lucia), historias generadas con Gemini/OpenAI, exportación a PDF y narración de cuentos por voz (TTS).

```bash
npm run dev
```

---

## 🔒 Premisa de arquitectura: privacidad de los niños ante todo

Decisión de arquitectura **no negociable** para este backend: no comprometer datos de los niños que usan la app.

- **Este backend no persiste cuentos.** `app/api/story/*` genera el texto y lo devuelve en la respuesta; no hay ningún `INSERT` a la base de datos con contenido de cuentos. La app los guarda en el dispositivo (ver `popli-54/README.md`).
- **Este backend no persiste audio narrado.** `app/api/tts/narrate` genera el MP3 al vuelo con OpenAI y lo devuelve; no queda copia en el servidor.
- La base de datos (Postgres/Neon vía Drizzle, `db/schema.ts`) solo guarda lo estrictamente necesario para cuentas: `users`, `sessions`, `passwordResetCodes`, `profiles`. Nada de contenido generado para o por los niños.
- **Cualquier feature nueva que implique guardar o mandar datos de los niños a una nube — propia o de terceros — se evalúa contra esta premisa antes de implementarse.**

### Por qué está escrito tan explícito acá

El 2026-07-10 se auditó el código y se encontraron dos cosas que violaban esta premisa sin haber sido decisiones conscientes del proyecto (todo apunta a una sesión de IA previa que las agregó por su cuenta):

1. **Integración completa con ElevenLabs** (voz de un tercero externo) para clonar voces familiares — sin créditos en la cuenta, fallaba en producción. Se sacó por completo (código, rutas, UI en la app).
2. **Tabla `story_narrations` en `db/schema.ts`**, con una columna `storyText` pensada para guardar el texto completo del cuento en Postgres. Nunca se llegó a usar (no había ningún `INSERT` en el código), pero era un riesgo latente — alguien podía "completarla" sin saber que rompía la arquitectura. Se borró del schema.

Moraleja para el futuro (humano o IA trabajando en este repo): antes de agregar cualquier tabla, ruta o integración que toque contenido generado por/para un niño, confirmar explícitamente que respeta esta premisa.

---

## Narración de voz (TTS) — `lib/tts.ts` + `app/api/tts/*`

Dos motores conviven en `narrate`, elegidos según si el pedido trae `reference_audio_b64`:

- **Voces fijas** (`alloy`, `nova`, `shimmer`): OpenAI (`gpt-4o-mini-tts`), devuelve MP3.
- **Voces grabadas por la familia** (mamá/papá/abuela): worker propio self-hosted en RunPod corriendo Chatterbox (`generateChatterboxSpeech` en `lib/tts.ts`), devuelve WAV. Sin terceros: el audio de referencia se manda de forma transitoria en cada narración (zero-shot, no hay clon persistente guardado en ningún servidor) — ver `poplicuentos-chatterbox-runpod/README.md` para el worker.

### Rutas disponibles

| Ruta | Qué hace |
|---|---|
| `GET /api/tts/voices` | Lista las 3 voces fijas (las voces grabadas por la familia son 100% locales al dispositivo, no pasan por este catálogo) |
| `POST /api/tts/preview` | Genera un audio corto de muestra de una voz fija |
| `POST /api/tts/narrate` | Narra el texto completo de un cuento. Con `reference_audio_b64` en el body, rutea a Chatterbox/RunPod (WAV); si no, a OpenAI (MP3) |

### Historial: por qué no hay ElevenLabs acá

Hubo una integración completa con ElevenLabs (clonación de voz de terceros) agregada en una sesión de IA previa, sin que fuera una decisión consciente del proyecto — y sin créditos de la cuenta, fallaba en producción. Se sacó por completo (2026-07-10) porque viola la premisa de arquitectura de arriba, y se reemplazó por el worker propio descripto arriba.

---

## Otras piezas del backend

- `db/` — esquema Drizzle + conexión Postgres (Neon)
- `lib/auth/` — autenticación con Lucia
- `app/api/story/` — generación de cuentos (Gemini/OpenAI)
- `app/api/illustrate*` — ilustraciones
- `lib/email-templates` — emails transaccionales

## Variables de entorno relevantes para TTS

```
OPENAI_API_KEY=...
OPENAI_TTS_MODEL=gpt-4o-mini-tts   # opcional, tiene default
RUNPOD_API_KEY=...                 # requerido para narrar con voces grabadas por la familia
RUNPOD_ENDPOINT_ID=...             # endpoint desplegado desde poplicuentos-chatterbox-runpod
RUNPOD_TTS_WAIT_MS=90000           # opcional, ventana sync de /runsync
```
