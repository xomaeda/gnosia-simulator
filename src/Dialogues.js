export function suspectLine(a, t) {
  const r = Math.random();
  if (r < 0.33) return `${a.name}:[의심한다] ${t.name}은 싫어.`;
  if (r < 0.66) return `${a.name}:[의심한다] ${t.name}은 의심스러워.`;
  return `${a.name}:[의심한다] ${t.name}은 확률적으로 수상해.`;
}

export function defendLine(a, t) {
  const r = Math.random();
  if (r < 0.33) return `${a.name}:[변호한다] ${t.name}은 좋아.`;
  if (r < 0.66) return `${a.name}:[변호한다] ${t.name}은 믿을 수 있어.`;
  return `${a.name}:[변호한다] ${t.name}은 확률적으로 안전해.`;
}

