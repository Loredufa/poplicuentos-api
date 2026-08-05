# Poplicuentos API

API en Next.js 15 (App Router) que sirve de backend para la app móvil **popli-54**: autenticación (Lucia), historias generadas con OpenAI, ilustraciones, exportación a PDF y narración de cuentos por voz (TTS).

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
3. **`app/api/illustrate-gemini`**, la ruta que la app usaba de verdad para ilustrar cuentos, mandaba el texto completo del cuento a `api.nanobananaapi.ai` — un revendedor de terceros, no Google ni OpenAI directo, a pesar del nombre. A diferencia de los dos anteriores, este no era código muerto: estaba activo en producción. Se borró la ruta y se apuntó la app a `app/api/illustrate` (que ya existía pero no se usaba), simplificado para llamar directo a OpenAI — el mismo proveedor ya usado para el texto del cuento, sin sumar un tercero nuevo.

Moraleja para el futuro (humano o IA trabajando en este repo): antes de agregar cualquier tabla, ruta o integración que toque contenido generado por/para un niño, confirmar explícitamente que respeta esta premisa.

---

## Narración de voz (TTS) — `lib/tts.ts` + `app/api/tts/*`

Dos motores conviven en `narrate`, elegidos según si el pedido trae `reference_audio_b64`:

- **Voces fijas** (`alloy`, `nova`, `shimmer`): OpenAI (`gpt-4o-mini-tts`), devuelve MP3.
- **Voces grabadas por la familia** (mamá/papá/abuela): worker propio self-hosted en RunPod corriendo Chatterbox (`generateChatterboxSpeech` en `lib/tts.ts`), devuelve WAV. Sin terceros: el audio de referencia se manda de forma transitoria en cada narración (zero-shot, no hay clon persistente guardado en ningún servidor) — ver `poplicuentos-chatterbox-runpod/README.md` para el worker.

### Marcas de pausa: normalizar antes de bifurcar

El generador de cuentos mete marcas `(pausa)` en el texto, pero el modelo no siempre respeta la forma canónica: manda `(pausa breve)`, `[Pausa...]`, `—pausa—`. Cualquier variante que el worker no reconozca **la lee en voz alta** — y `(pausa)` narrado en rioplatense suena casi como "pará", que es como se reportó el bug.

Por eso `cleanStoryText` arranca por `normalizePauseMarkers`, que lleva toda variante a `(pausa)`. Después cada camino hace lo suyo: RunPod recibe las marcas canónicas (el worker las convierte en silencio real) y OpenAI recibe `stripPauseMarkers`, que las cambia por puntos suspensivos más corte de párrafo — `gpt-4o-mini-tts` no tiene SSML ni forma de pedir un silencio.

El mismo patrón vive en `PAUSE_MARKER_RE` (worker) y `NARRATION_CUE_PATTERN` (app). Si se toca uno, tocar los tres.

### Instrucción de estilo para CosyVoice

La instrucción es la única perilla de estilo que expone el modelo: el worker la pone antes del token `<|endofprompt|>` en el `prompt_text`, que es lo mismo que hace `inference_instruct2`. Sin esto el worker usa su default (`"You are a helpful assistant."`) y el modelo no recibe ninguna señal de qué idioma ni qué acento tiene que narrar — que es de dónde salía el acento extranjero.

La arma `buildNarrationInstruction` (`lib/ttsInstruction.ts`) a partir del **locale completo** que manda la app, no de una constante. El texto base salió de un A/B a oído (`scripts/ab_instruction.mjs` en el repo del worker): ganó la instrucción escrita **en español** pidiendo rioplatense, por encima de la misma en inglés y de no mandar ninguna. Por eso cada idioma tiene su plantilla en su propio idioma.

La región **se valida** contra el idioma antes de nombrarla. La región llega del dispositivo, o sea dice dónde vive el usuario, no qué variedad quiere escuchar: alguien en Argentina pidiendo un cuento en inglés manda `en-AR`, y nombrar ese país daría "Argentina English". Un par que no figura en `VARIANTS` cae a la instrucción sin mención de variedad — que además es lo más seguro contra el [issue #1790](https://github.com/FunAudioLLM/CosyVoice/issues/1790), donde una instrucción rara hace que el modelo ignore el idioma pedido.

| Locale | Instrucción |
|---|---|
| `es-AR`, `es-UY` | español **rioplatense** (el ganador del A/B) |
| `es-MX`, `es-ES`, … | español **de \<País\>**, con el nombre vía `Intl.DisplayNames` |
| `en-US`, `en-GB`, … | **American** / **British** English (en inglés el adjetivo va antes) |
| `en-AR`, `es-LATAM`, `es`, desconocido | sin mención de variedad |

El prefijo `"You are a helpful assistant."` se mantiene a propósito y lo pone siempre el constructor: el handler documenta que es la combinación que se sabe que anda con Fun-CosyVoice3.

`RUNPOD_TTS_INSTRUCTION` sigue existiendo, pero ahora es un **override**: si está seteada gana sobre el constructor, para iterar la redacción o volver a un comportamiento fijo sin deployar. `RUNPOD_TTS_INSTRUCTION=""` desactiva la instrucción por completo. Para probar redacciones a oído sin deployar: `node scripts/ab_instruction.mjs` en el repo del worker.

### Rutas disponibles

| Ruta | Qué hace |
|---|---|
| `GET /api/tts/voices` | Lista las 3 voces fijas (las voces grabadas por la familia son 100% locales al dispositivo, no pasan por este catálogo) |
| `POST /api/tts/preview` | Genera un audio corto de muestra de una voz fija |
| `POST /api/tts/narrate` | Narra el texto completo de un cuento. Con `reference_audio_b64` en el body, rutea a Chatterbox/RunPod (WAV); si no, a OpenAI (MP3) |

### Historial: por qué no hay ElevenLabs acá

Hubo una integración completa con ElevenLabs (clonación de voz de terceros) agregada en una sesión de IA previa, sin que fuera una decisión consciente del proyecto — y sin créditos de la cuenta, fallaba en producción. Se sacó por completo (2026-07-10) porque viola la premisa de arquitectura de arriba, y se reemplazó por el worker propio descripto arriba.

---

## Ilustraciones — `app/api/illustrate/route.ts`

Genera 1-6 imágenes por cuento con OpenAI: primero arma un plan de arte + sinopsis (`gpt-4o-mini`, para mantener personajes/escenario consistentes entre imágenes), después genera las imágenes (`gpt-image-1`, calidad `medium`). Devuelve `images: string[]` — siempre `data:image/png;base64,...` (a diferencia de `dall-e-3`, `gpt-image-1` nunca devuelve una URL). La app ya soporta base64 en todos lados: mostrarlas, guardarlas localmente, incrustarlas en el PDF.

**Nota histórica**: usaba `dall-e-3`, dado de baja por OpenAI el 2026-05-12 — se migró a `gpt-image-1` (verificado contra la doc oficial de OpenAI y el SDK instalado `openai@4.104.0`, que todavía no tipa `gpt-image-2`/`gpt-image-1-mini`).

Único proveedor: OpenAI, el mismo ya usado para el texto del cuento — no hay una integración de Google/Gemini funcional acá (el SDK instalado no soporta generación de imágenes; ver historial arriba).

### Rutas disponibles

| Ruta | Qué hace |
|---|---|
| `POST /api/illustrate` | Genera las ilustraciones de un cuento (OpenAI DALL-E-3) |
| `POST /api/story/pdf` | Arma el PDF del cuento con las imágenes ya generadas |

---

## Otras piezas del backend

- `db/` — esquema Drizzle + conexión Postgres (Neon)
- `lib/auth/` — autenticación con Lucia
- `app/api/story/` — generación de cuentos (OpenAI)
- `lib/email-templates` — emails transaccionales

## Migraciones: por qué no hay `db:migrate` ni `db:push`

Los scripts disponibles son solo `npm run db:generate` y `npm run db:check`. La
ausencia de los otros dos es deliberada:

- **`drizzle-kit push`** introspecta la base viva y borra lo que no esté en
  `db/schema.ts`. Ya pasó que hubiera tablas fuera del schema (`favorites`,
  `story_narrations`); un `push` distraído se las habría llevado sin aviso.
- **`drizzle-kit migrate`** replayearía `0000`/`0001`, que no usan
  `IF NOT EXISTS` y revientan a mitad si se corren dos veces.

**El flujo real es:** `npm run db:generate` → revisar el `.sql` → agregarle
`IF NOT EXISTS` a mano → aplicarlo en el editor SQL de Neon. Editar el `.sql`
generado no desincroniza nada, porque los snapshots de `drizzle/meta/` se
computan desde `db/schema.ts`, no desde el SQL.

Antes de aplicar cualquier migración, revisar que el SQL generado **solo** toque
lo que se esperaba: si aparece un `DROP` o un `ALTER` sobre `users`, `sessions`,
`profiles` o `password_reset_codes`, el snapshot no refleja la base y hay que
parar.

## Envío de correo — `lib/email.ts`

Todo el correo del proyecto sale por `sendEmail()`. No usar `resend.emails.send()`
directo: **devuelve `{ data, error }` y no lanza**, así que un `await` sin mirar
`error` deja el fallo invisible —sin excepción, sin log, y la ruta respondiendo
200—. Fue exactamente lo que pasó con los códigos de reseteo.

El remitente sale de `RESEND_FROM`. Mientras apunte al default `resend.dev`
(dominio compartido de pruebas de Resend), **solo llegan correos a la dirección
dueña de la cuenta**; cualquier otro destinatario se rechaza con 403 y ni
siquiera queda registrado en el dashboard. Para enviar a usuarios reales hay que
verificar un dominio propio en Resend y setear `RESEND_FROM` en Vercel.

## Variables de entorno relevantes para TTS

```
OPENAI_API_KEY=...
OPENAI_TTS_MODEL=gpt-4o-mini-tts   # opcional, tiene default
RUNPOD_API_KEY=...                 # requerido para narrar con voces grabadas por la familia
RUNPOD_ENDPOINT_ID=...             # endpoint desplegado desde poplicuentos-chatterbox-runpod
RUNPOD_TTS_WAIT_MS=90000           # opcional, ventana sync de /runsync
RUNPOD_TTS_INSTRUCTION=...         # opcional, PISA la instrucción que se arma por locale (ver la sección de TTS)
RUNPOD_TTS_MAX_CHARS=300           # opcional, caracteres por chunk; subirlo da más continuidad de prosodia
```
