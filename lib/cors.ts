// lib/cors.ts
import { NextResponse } from "next/server";

const rawAllowed =
  process.env.ALLOWED_ORIGINS ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "";

const allowedOrigins = rawAllowed
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function resolveAllowedOrigin(origin: string | null): string {
  if (!allowedOrigins.length) {
    return origin || "*";
  }
  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }
  return allowedOrigins[0];
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allow = resolveAllowedOrigin(origin);

  return {
    "Access-Control-Allow-Origin": allow,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function withCors(req: Request, res: NextResponse): NextResponse {
  const headers = corsHeaders(req);
  for (const [key, value] of Object.entries(headers)) {
    res.headers.set(key, value);
  }
  return res;
}

export function jsonWithCors(
  req: Request,
  body: unknown,
  init?: ResponseInit
): NextResponse {
  return withCors(req, NextResponse.json(body, init));
}

export function optionsResponse(req: Request): NextResponse {
  return withCors(
    req,
    new NextResponse(null, {
      status: 204,
    })
  );
}

