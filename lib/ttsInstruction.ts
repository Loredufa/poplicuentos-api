/**
 * Arma la instruccion de estilo que se le pasa a CosyVoice, adaptada al idioma del cuento y
 * a la variedad regional del usuario.
 *
 * El texto base salio de un A/B a oido contra el endpoint desplegado (scripts/ab_instruction.mjs
 * en el repo del worker): gano la instruccion escrita EN ESPAÑOL pidiendo rioplatense, por encima
 * de la misma instruccion en ingles y por encima de no mandar ninguna. Por eso cada idioma tiene
 * su plantilla en su propio idioma, y no una sola en ingles parametrizada.
 *
 * Lo que NO hay que perder de vista al tocar esto:
 *
 *  - El prefijo "You are a helpful assistant." no es decorativo. CosyVoice3 exige el prompt con
 *    la forma "<instruccion><|endofprompt|><transcripcion de la referencia>", y el handler del
 *    worker documenta que esta es la unica combinacion que se sabe que anda (src/handler.py).
 *
 *  - Issue #1790 de CosyVoice: con ciertas instrucciones el modelo IGNORA el idioma pedido y
 *    narra en otro. Cuanto mas rara la instruccion, mas probable. De ahi que una region que no
 *    corresponde al idioma no se nombre nunca (ver ACLARACION abajo) en vez de improvisar.
 *
 *  - La narracion usa la voz clonada del usuario, y CosyVoice arrastra el acento del audio de
 *    referencia ademas de esta instruccion. La instruccion rinde cuando COINCIDE con la voz
 *    grabada; cuando no hay señal clara, callarse es mejor que presumir.
 *
 * ACLARACION sobre el par (idioma, region): la region llega del dispositivo del usuario, o sea
 * dice DONDE VIVE, no que variedad del idioma quiere escuchar. Alguien en Argentina pidiendo un
 * cuento en ingles manda "en-AR", y nombrar ese pais daria "Argentina English", que no existe.
 * Por eso el par se valida contra VARIANTS y, si no figura, la instruccion sale sin mencion de
 * variedad.
 */

// CosyVoice3 lo espera; ver el comentario de arriba.
const ASSISTANT_PREFIX = "You are a helpful assistant.";

type LanguageSpec = {
  /** Instruccion cuando SI hay una variedad regional que nombrar. */
  withVariant: (variant: string) => string;
  /** Instruccion cuando no la hay: mismo texto, sin la mencion. */
  plain: string;
  /**
   * Como nombrar un pais cuando la entrada de VARIANTS es `null`, o sea cuando alcanza con el
   * nombre que devuelve Intl.DisplayNames. `null` = este idioma no usa la via generica y todas
   * sus entradas tienen texto propio.
   */
  fromCountry: ((country: string) => string) | null;
};

const LANGUAGES: Record<string, LanguageSpec> = {
  // El texto ganador del A/B, con la variedad parametrizada. Con variant = "rioplatense de
  // Argentina" reproduce palabra por palabra la variante que gano — incluido "calida" sin tilde,
  // que es como se probo.
  es: {
    withVariant: (v) =>
      `Narra este cuento infantil en español ${v}, con voz suave, calida y pausada, ` +
      `como quien acompaña a un niño a dormir.`,
    plain:
      `Narra este cuento infantil en español, con voz suave, calida y pausada, ` +
      `como quien acompaña a un niño a dormir.`,
    fromCountry: (c) => `de ${c}`,
  },
  en: {
    withVariant: (v) =>
      `Narrate this children's bedtime story in ${v} English, with a soft, warm, ` +
      `unhurried voice, like someone helping a child fall asleep.`,
    plain:
      `Narrate this children's bedtime story with a soft, warm, unhurried voice, ` +
      `like someone helping a child fall asleep.`,
    // En ingles la variedad va como adjetivo ANTES del idioma ("American English"), no como
    // "English of the United States". Por eso todas las entradas de `en` traen su adjetivo y la
    // via generica no se usa.
    fromCountry: null,
  },
  pt: {
    withVariant: (v) =>
      `Narre esta história infantil de ninar em português ${v}, com voz suave, ` +
      `calorosa e pausada, como quem acompanha uma criança a dormir.`,
    plain:
      `Narre esta história infantil de ninar em português, com voz suave, calorosa e pausada, ` +
      `como quem acompanha uma criança a dormir.`,
    // "do Brasil" y "de Portugal" contraen distinto, asi que la via generica ("de <Pais>")
    // produciria "de Brasil". Las dos entradas traen su texto.
    fromCountry: null,
  },
  ja: {
    withVariant: (v) =>
      `この子ども向けのおやすみ前の物語を、${v}で、やわらかく、あたたかく、` +
      `ゆっくりとした声で語ってください。`,
    plain:
      `この子ども向けのおやすみ前の物語を、やわらかく、あたたかく、` +
      `ゆっくりとした声で語ってください。`,
    fromCountry: null,
  },
};

/**
 * Que pares (idioma, region) son una variedad real del idioma. Es la unica fuente de verdad de
 * esa validez: la app manda el locale sin filtrar y aca se decide.
 *
 * El valor es el texto de la variedad, o `null` para armarlo con Intl.DisplayNames + el
 * `fromCountry` del idioma. Un pais que NO figura no se nombra: cae a `plain`.
 */
const VARIANTS: Record<string, Record<string, string | null>> = {
  es: {
    // Los dos unicos con texto propio: "rioplatense" cruza dos paises y es justo el rasgo que el
    // A/B mostro que el modelo si recoge (la "ll"/"y", la entonacion).
    AR: "rioplatense de Argentina",
    UY: "rioplatense de Uruguay",
    // El resto sale como "de <Pais>", que en español funciona para todos estos nombres.
    BO: null,
    CL: null,
    CO: null,
    CR: null,
    CU: null,
    DO: null,
    EC: null,
    ES: null,
    GQ: null,
    GT: null,
    HN: null,
    MX: null,
    NI: null,
    PA: null,
    PE: null,
    PR: null,
    PY: null,
    SV: null,
    VE: null,
  },
  en: {
    AU: "Australian",
    CA: "Canadian",
    GB: "British",
    IE: "Irish",
    IN: "Indian",
    NZ: "New Zealand",
    US: "American",
    ZA: "South African",
  },
  pt: {
    BR: "do Brasil",
    PT: "de Portugal",
  },
  // Japones a proposito sin entradas: no hay una variedad regional que valga la pena nombrarle al
  // modelo, y "日本の日本語" seria redundante. "ja-JP" cae a `plain`, que es lo correcto.
  ja: {},
};

/** Nombre del pais en el idioma destino. `null` si el codigo no es una region conocida. */
function countryName(language: string, region: string): string | null {
  try {
    const name = new Intl.DisplayNames([language], { type: "region" }).of(region);
    // DisplayNames devuelve el codigo tal cual cuando no lo conoce; eso no es un nombre.
    return name && name !== region ? name : null;
  } catch {
    // Un codigo con forma invalida tira RangeError. No es motivo para quedarse sin narracion.
    return null;
  }
}

/**
 * Separa un locale tipo "es-AR" en idioma y region.
 *
 * Ojo con "es-LATAM": circula por varios lados del proyecto y NO es una region ISO, asi que se
 * descarta como region (el filtro de 2 letras la deja afuera) y el locale queda como "es" pelado.
 */
function parseLocale(locale: string): { language: string; region: string | null } {
  const [rawLanguage = "", rawRegion = ""] = String(locale || "").split("-");
  const language = rawLanguage.trim().toLowerCase();
  const region = rawRegion.trim().toUpperCase();
  return {
    language,
    region: /^[A-Z]{2}$/.test(region) ? region : null,
  };
}

/**
 * Instruccion de estilo para el locale dado, siempre con el prefijo que CosyVoice3 exige.
 *
 * Nunca tira: un locale desconocido, mal formado o vacio degrada a la instruccion en español sin
 * mencion de variedad. Si esto fallara, el usuario se quedaria sin narracion — y una instruccion
 * generica es infinitamente mejor que un 502.
 */
export function buildNarrationInstruction(locale: string): string {
  const { language, region } = parseLocale(locale);
  const spec = LANGUAGES[language] ?? LANGUAGES.es;

  let variant: string | null = null;
  if (region) {
    const entry = VARIANTS[language]?.[region];
    if (entry) {
      variant = entry;
    } else if (entry === null && spec.fromCountry) {
      // Figura en la tabla pero sin texto propio: se arma con el nombre del pais.
      const name = countryName(language, region);
      variant = name ? spec.fromCountry(name) : null;
    }
    // `undefined` (no figura) cae aca con variant en null: la region no es una variedad de este
    // idioma. Es el caso "en-AR". No se nombra.
  }

  const body = variant ? spec.withVariant(variant) : spec.plain;
  return `${ASSISTANT_PREFIX} ${body}`;
}
