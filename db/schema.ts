import { relations } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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


export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
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

export const storyNarrations = pgTable("story_narrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyId: uuid("story_id"),
  voiceId: text("voice_id").notNull(),
  locale: text("locale").notNull().default("es-LATAM"),
  storyText: text("story_text").notNull(),
  audioBase64: text("audio_base64"),
  audioUrl: text("audio_url"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at").defaultNow(),
});
