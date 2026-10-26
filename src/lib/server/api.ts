import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "./errors";
import { SessionRefreshRequired } from "./session";

export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "workingrun";

type RouteContext<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: RouteContext<P>) => Promise<Response>;

export function errorResponse(err: AppError): NextResponse {
  return NextResponse.json(
    { error: { code: err.code, message: err.code, ...(err.details ? { details: err.details } : {}) } },
    { status: err.status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * ครอบ Route Handler: กัน CSRF สำหรับคำขอที่เปลี่ยนข้อมูล และแปลง error เป็นรูปแบบเดียวกัน
 * (ข้อความ error แปลภาษาที่หน้าเว็บจาก code)
 */
export function route<P = Record<string, never>>(handler: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD" && req.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
        throw new AppError("FORBIDDEN", 403, { reason: "csrf" });
      }
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof AppError) return errorResponse(err);
      if (err instanceof SessionRefreshRequired) return errorResponse(new AppError("NOT_AUTHENTICATED", 401));
      console.error(`Unhandled error in ${req.method} ${req.nextUrl.pathname}`, err);
      return errorResponse(new AppError("INTERNAL_ERROR", 500));
    }
  };
}

export function json<T>(data: T, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return NextResponse.json(data, {
    status: init.status ?? 200,
    headers: { "cache-control": "private, no-store", ...init.headers },
  });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export async function readJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", 400, { reason: "invalid_json" });
  }
  return parseOrThrow(schema, body);
}

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const fields = Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]));
    throw new AppError("VALIDATION_ERROR", 400, { fields });
  }
  return parsed.data;
}

export function searchParams<S extends z.ZodType>(req: NextRequest, schema: S): z.infer<S> {
  return parseOrThrow(schema, Object.fromEntries(req.nextUrl.searchParams));
}

export const uuid = z.uuid();
