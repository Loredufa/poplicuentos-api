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

Narración con OpenAI (`gpt-4o-mini-tts`) y 3 voces fijas: `alloy`, `nova`, `shimmer`.

### Rutas disponibles

| Ruta | Qué hace |
|---|---|
| `GET /api/tts/voices` | Lista las 3 voces disponibles |
| `POST /api/tts/preview` | Genera un audio corto de muestra de una voz |
| `POST /api/tts/narrate` | Narra el texto completo de un cuento |

### Historial: por qué no hay ElevenLabs acá

Hubo una integración completa con ElevenLabs (clonación de voz de terceros) agregada en una sesión de IA previa, sin que fuera una decisión consciente del proyecto — y sin créditos de la cuenta, fallaba en producción. Se sacó por completo (2026-07-10) porque viola la premisa de arquitectura de arriba.

La clonación de voz (mamá/papá/abuela) se va a reconstruir **desde cero**, con esa premisa como punto de partida del diseño (no como algo a resolver después de implementarla).

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
```
