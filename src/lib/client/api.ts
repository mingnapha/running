"use client";

import type { ApiErrorBody } from "@/lib/dto";

/** error จาก API — code ใช้แปลข้อความด้วย t(`errors.${code}`, details) */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  const method = init.method ?? (init.body !== undefined || init.form ? "POST" : "GET");
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      signal: init.signal,
      headers: {
        ...(method !== "GET" ? { "x-requested-with": "workingrun" } : {}),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("network", 0);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const body = data as ApiErrorBody | null;
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      // อยู่นอก React component (ไม่มี router) และต้องโหลดใหม่ทั้งหน้าเพื่อล้างสถานะเดิม
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    }
    throw new ApiError(body?.error?.code ?? "generic", res.status, body?.error?.details ?? {});
  }
  return data as T;
}

/** แปลง ApiError เป็นข้อความตามภาษา (t = useTranslations()) */
export function errorMessage(t: (key: string, values?: Record<string, string | number>) => string, err: unknown): string {
  if (!(err instanceof ApiError)) return t("errors.generic");
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(err.details)) if (typeof v === "string" || typeof v === "number") values[k] = v;
  try {
    return t(`errors.${err.code}`, values);
  } catch {
    return t("errors.generic");
  }
}
