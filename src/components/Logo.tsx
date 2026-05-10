export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 4,
      fontFamily: 'var(--display)', fontStyle: 'italic', fontSize: size, letterSpacing: '-0.02em', lineHeight: 1,
    }}>
      <span>R</span>
      <span style={{
        display: 'inline-block', width: size * 0.18, height: size * 0.18, borderRadius: 2,
        background: 'var(--accent)', transform: 'translateY(-2px)',
      }} />
      <span>AW</span>
    </div>
  )
}
