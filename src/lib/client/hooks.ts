"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { countUpValue } from "@/lib/domain/leaderboardDiff";

/** ผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว" ไว้หรือไม่ */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** ตัวเลขนับขึ้นจากค่าเดิมไปค่าใหม่ (ข้ามแอนิเมชันเมื่อ reduced motion) */
export function useCountUp(value: number, durationMs = 900): number {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (reduced || start === value) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / durationMs;
      setDisplay(countUpValue(start, value, t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced, durationMs]);
  return display;
}

/**
 * FLIP: แถวที่ย้ายตำแหน่ง (อันดับเปลี่ยน) เลื่อนจากที่เดิมไปที่ใหม่อย่างนุ่มนวล
 * ใช้ key ของแต่ละแถว — DOM เรียงตามอันดับเสมอ (screen reader อ่านถูกลำดับ)
 */
export function useFlip<K extends string>(keys: readonly K[], enabled: boolean) {
  const nodes = useRef(new Map<K, HTMLElement>());
  const last = useRef(new Map<K, number>());

  useLayoutEffect(() => {
    const next = new Map<K, number>();
    for (const [k, el] of nodes.current) next.set(k, el.getBoundingClientRect().top);
    if (enabled) {
      for (const [k, el] of nodes.current) {
        const before = last.current.get(k);
        const after = next.get(k);
        if (before === undefined || after === undefined || before === after) continue;
        el.animate([{ transform: `translateY(${before - after}px)` }, { transform: "translateY(0)" }], {
          duration: 700,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        });
      }
    }
    last.current = next;
  }, [keys, enabled]);

  return (key: K) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(key, el);
    else nodes.current.delete(key);
  };
}

/** เรียก fn เป็นระยะเฉพาะตอนแท็บเปิดดูอยู่ (ประหยัดโควต้าคำขอของ Cloudflare) */
export function useVisiblePolling(fn: () => void | Promise<void>, intervalMs: number) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  }, [fn]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(async () => {
        await saved.current();
        schedule();
      }, intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void Promise.resolve(saved.current()).then(schedule);
      } else {
        clearTimeout(timer);
      }
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
