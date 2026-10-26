/** ไอคอน SVG แบบ inline (ไม่ต้องโหลดไลบรารี) — สีตาม currentColor */
type P = { className?: string; title?: string };
const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Svg({ title, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg {...base} className={className} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const RunnerIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="15" cy="4.5" r="2" fill="currentColor" stroke="none" />
    <path d="M10 21l2.5-5.5L15 17v4M7 12.5l3-3.5 3.5 1 2.5 3 3 .5M12.5 15.5L10 9" />
  </Svg>
);
export const TrophyIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3" />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const ListIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);
export const ShieldIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
  </Svg>
);
export const CrownIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" fill="currentColor" />
  </Svg>
);
export const CameraIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4V8z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);
