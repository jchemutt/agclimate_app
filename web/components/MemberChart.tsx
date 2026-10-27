import type { PointResult } from "@/lib/types";
import { t } from "@/lib/i18n";
import { locale } from "@/lib/format";

/** One dot per ensemble member's seasonal rainfall, over the tercile bands
 *  (driest / middle / wettest third of 1991–2020 for the same weeks). */
export default function MemberChart({ point, lang }: { point: PointResult; lang: string }) {
  const vals = (point.members?.rainfall_total ?? []).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const p33 = point.terciles?.p33 ?? null;
  const p66 = point.terciles?.p66 ?? null;
  const lo = Math.min(...vals, p33 ?? Infinity) * 0.9;
  const hi = Math.max(...vals, p66 ?? -Infinity) * 1.08;
  const W = 300, H = 92, pad = 8;
  const x = (v: number) => pad + ((v - lo) / (hi - lo || 1)) * (W - 2 * pad);
  const sorted = [...vals].sort((a, b) => a - b);
  const nf = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 });
  // stack dots that would overlap
  const rows: number[] = [];
  const placed: { cx: number; row: number }[] = [];
  for (const v of sorted) {
    const cx = x(v);
    let row = 0;
    while (placed.some((d) => d.row === row && Math.abs(d.cx - cx) < 7)) row++;
    placed.push({ cx, row });
    rows.push(row);
  }
  return (
    <figure className="members">
      <figcaption>{t(lang, "memberSpread")}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`${vals.length} members, ${nf.format(sorted[0])} to ${nf.format(sorted[sorted.length - 1])} mm`}>
        {p33 != null && p66 != null ? (
          <g>
            <rect x={pad} y={6} width={x(p33) - pad} height={54} fill="var(--bn)" />
            <rect x={x(p33)} y={6} width={x(p66) - x(p33)} height={54} fill="var(--nn)" />
            <rect x={x(p66)} y={6} width={W - pad - x(p66)} height={54} fill="var(--an)" />
            <text x={pad + 3} y={18} className="band-label">{t(lang, "belowNormal")}</text>
            <text x={W - pad - 3} y={18} className="band-label" textAnchor="end">{t(lang, "aboveNormal")}</text>
          </g>
        ) : null}
        {placed.map((d, i) => (
          <circle key={i} cx={d.cx} cy={52 - d.row * 7} r={3.2} className="member-dot" />
        ))}
        <line x1={pad} x2={W - pad} y1={60} y2={60} className="axis" />
        <text x={pad} y={78} className="tick">{nf.format(lo)}</text>
        {p33 != null ? <text x={x(p33)} y={78} className="tick" textAnchor="middle">{nf.format(p33)}</text> : null}
        {p66 != null ? <text x={x(p66)} y={78} className="tick" textAnchor="middle">{nf.format(p66)}</text> : null}
        <text x={W - pad} y={78} className="tick" textAnchor="end">{nf.format(hi)} {t(lang, "mm")}</text>
      </svg>
    </figure>
  );
}
