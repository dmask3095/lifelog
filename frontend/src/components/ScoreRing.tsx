interface Props {
  score: number;
  color: string;
  label?: string;
  size?: number;
}

export default function ScoreRing({ score, color, label, size = 90 }: Props) {
  const r = size * 0.4;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, score)) / 100) * circ;
  const center = size / 2;
  const strokeWidth = size * 0.078;
  const fontSize = size * 0.178;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={center} cy={center} r={r} fill="none" stroke="#2a2a2a" strokeWidth={strokeWidth} />
        <circle cx={center} cy={center} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
        <text x={center} y={center + fontSize * 0.32} textAnchor="middle" fill="#fff" fontSize={fontSize} fontWeight="700">{score}%</text>
      </svg>
      {label && <span style={{ fontSize: 12, color: '#888' }}>{label}</span>}
    </div>
  );
}
