import "flag-icons/css/flag-icons.min.css";

/** Country flag from the bundled flag-icons set (no external CDN); emoji fallback. */
export default function Flag({ iso2, emoji, className = "" }: { iso2?: string | null; emoji?: string; className?: string }) {
  if (iso2) return <span className={`flag fi fi-${iso2.toLowerCase()} ${className}`} role="img" aria-hidden />;
  return <span className={`flag flag-emoji ${className}`} aria-hidden>{emoji}</span>;
}
