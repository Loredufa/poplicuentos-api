import { relations, sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  hashed_password: text("hashed_password").notNull(),
  created_at: timestamp("created_at").defaultNow(),
});

// Ojo a los nombres de **propiedad**: id, userId, expiresAt
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull(), // columna "user_id"
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
});

// Códigos de reseteo de contraseña (opción B)
export const passwordResetCodes = pgTable("password_reset_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(), // FK lógica a users.id
  codeHash: text("code_hash").notNull(),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  usedAt: timestamp("used_at", {
    withTimezone: true,
    mode: "date",
  }),
});


/* ===================== 2FA (TOTP) ===================== */

/**
 * Una fila por usuario que arranco el enrolamiento de 2FA.
 *
 * `status` distingue el secreto generado pero todavia no confirmado
 * ('pending') del que ya valido un codigo ('active'). Sin esa distincion, un
 * enrolamiento abandonado dejaria la cuenta pidiendo un segundo factor que el
 * usuario nunca termino de configurar.
 */
export const userTotp = pgTable(
  "user_totp",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(), // FK lógica a users.id
    // base64( iv(12) || authTag(16) || ciphertext ), AES-256-GCM con AAD = user_id
    secretEncrypted: text("secret_encrypted").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    status: text("status").notNull().default("pending"), // 'pending' | 'active'
    // Anti-replay: se rechaza todo codigo cuyo step sea <= a este. Sin esto un
    // codigo interceptado sigue sirviendo los 90s de la ventana de tolerancia.
    lastUsedStep: bigint("last_used_step", { mode: "number" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("user_totp_user_id_idx").on(table.userId)]
);

/**
 * Codigos de respaldo de un solo uso. Son la unica via de recuperacion si el
 * usuario pierde el telefono: no hay reseteo por email ni desactivacion por
 * soporte.
 */
export const userBackupCodes = pgTable(
  "user_backup_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    // Regenerar borra el lote anterior entero e inserta uno nuevo.
    batchId: uuid("batch_id").notNull(),
    // HMAC-SHA256(pepper, user_id + ':' + code). El pepper vive en la env, no
    // en la base: un dump solo no habilita fuerza bruta offline.
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("user_backup_codes_unused_idx")
      .on(table.userId)
      .where(sql`${table.usedAt} is null`),
  ]
);

/**
 * El estado intermedio del login: contrasena validada, falta el segundo factor.
 * Sin esta tabla no habria forma de representarlo, porque hoy el unico token
 * del sistema es el session id de Lucia y crearlo ya significa estar adentro.
 */
export const loginChallenges = pgTable(
  "login_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    // sha256(token opaco) en hex. Nunca se guarda el token: un dump de esta
    // tabla no permite completar ningun login pendiente.
    tokenHash: text("token_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("login_challenges_token_hash_idx").on(table.tokenHash),
    index("login_challenges_expires_at_idx").on(table.expiresAt),
  ]
);

/**
 * Rate limiting sobre la base que ya esta, sin Redis. Un codigo de 6 digitos es
 * brute-forceable y hasta ahora ninguna ruta de auth tenia limite alguno.
 */
export const authThrottle = pgTable(
  "auth_throttle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(), // 'mfa_verify' | 'login' | 'reset'
    subjectKey: text("subject_key").notNull(), // sha256(userId) o sha256(ip + salt)
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("auth_throttle_lookup_idx").on(
      table.scope,
      table.subjectKey,
      table.createdAt.desc()
    ),
  ]
);

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  totp: one(userTotp, {
    fields: [users.id],
    references: [userTotp.userId],
  }),
  backupCodes: many(userBackupCodes),
}));

export const userTotpRelations = relations(userTotp, ({ one }) => ({
  user: one(users, {
    fields: [userTotp.userId],
    references: [users.id],
  }),
}));

export const userBackupCodesRelations = relations(userBackupCodes, ({ one }) => ({
  user: one(users, {
    fields: [userBackupCodes.userId],
    references: [users.id],
  }),
}));

export const loginChallengesRelations = relations(loginChallenges, ({ one }) => ({
  user: one(users, {
    fields: [loginChallenges.userId],
    references: [users.id],
  }),
}));

export const profiles = pgTable("profiles", {
  user_id: uuid("user_id").primaryKey(), // FK lógica a users.id
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  display_name: text("display_name"),
  created_at: timestamp("created_at").defaultNow(),
  email: text("email").notNull(),
  country: text("country").notNull(),
  phone: text("phone").notNull(),
  language: text("language").notNull(),
  password: text("password").notNull(),
});

export const passwordResetCodesRelations = relations(
  passwordResetCodes,
  ({ one }) => ({
    user: one(users, {
      fields: [passwordResetCodes.userId],
      references: [users.id],
    }),
  })
);
