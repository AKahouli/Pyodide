export function VisibilityDots({ total, visibleIndices }: Readonly<{ total: number; visibleIndices: number[] }>) {
  return (
    <div className='flex justify-center gap-1.5 mt-3'>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${visibleIndices.includes(i) ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`} />
      ))}
    </div>
  );
}
