function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function initRelations(chars) {
  const n = chars.length;
  const trust = Array.from({ length: n }, () => Array(n).fill(0));
  const favor = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i=0;i<n;i++){
    for (let j=0;j<n;j++){
      if (i===j) continue;

      const pi = chars[i].personality;
      // base 40~60 with personality bias
      const biasUp = (pi.social + pi.cheer) * 6; // 0~12
      const biasDown = (pi.desire) * 3;          // 0~3
      const spread = 6 + (pi.desire * 6);        // 욕망 높으면 분산 ↑

      const t = rand(50 - spread, 50 + spread) + biasUp - biasDown;
      const f = rand(50 - spread, 50 + spread) + biasUp + (pi.kindness * 4);

      trust[i][j] = clamp(t, 0, 100);
      favor[i][j] = clamp(f, 0, 100);
    }
  }

  return { trust, favor };
}

export function clamp(n, min, max){
  n = Number(n);
  if (!Number.isFinite(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

export function addRel(rel, from, to, trustDelta, favorDelta){
  if (from === to) return;
  rel.trust[from][to] = clamp(rel.trust[from][to] + trustDelta, 0, 100);
  rel.favor[from][to] = clamp(rel.favor[from][to] + favorDelta, 0, 100);
}

