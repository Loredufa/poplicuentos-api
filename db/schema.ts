import { relations } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  hashed_password: text("hashed_password").notNull(),
  created_at: timestamp("created_at").defaultNow(),
});

// 👇 Ojo a los nombres de **propiedad**: id, userId, expiresAt
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull(), // columna "user_id"
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
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

export const favorites = pgTable("favorites", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  story: text("story").notNull(),
  age_range: text("age_range"),
  skill: text("skill"),
  tone: text("tone"),
  minutes: integer("minutes").notNull().default(0),
  created_at: timestamp("created_at").defaultNow(),
});

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, {
    fields: [favorites.user_id],
    references: [users.id],
  }),
}));
