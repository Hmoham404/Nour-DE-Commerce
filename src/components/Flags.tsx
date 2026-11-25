// Drapeaux en SVG (les émojis drapeaux ne s'affichent pas sous Windows).
function starPoints(cx: number, cy: number, R: number, r: number, rotDeg: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = ((rotDeg + i * 36) * Math.PI) / 180;
    const rr = i % 2 === 0 ? R : r;
    pts.push(`${(cx + rr * Math.cos(rad)).toFixed(1)},${(cy + rr * Math.sin(rad)).toFixed(1)}`);
  }
  return pts.join(' ');
}
const TN_STAR = starPoints(630, 400, 90, 36, 180);

export function FlagTN({ className = 'h-4 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 800" className={className} aria-label="Tunisie" role="img">
      <rect width="1200" height="800" fill="#E70013" />
      <circle cx="600" cy="400" r="200" fill="#fff" />
      <circle cx="600" cy="400" r="150" fill="#E70013" />
      <circle cx="640" cy="400" r="120" fill="#fff" />
      <polygon fill="#E70013" points={TN_STAR} />
    </svg>
  );
}

export function FlagFR({ className = 'h-4 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 3 2" className={className} aria-label="Français" role="img">
      <rect width="1" height="2" fill="#002654" />
      <rect x="1" width="1" height="2" fill="#fff" />
      <rect x="2" width="1" height="2" fill="#CE1126" />
    </svg>
  );
}
