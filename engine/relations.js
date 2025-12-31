// engine/relations.js
// 관계도(신뢰/우호) 행렬 + 적용 로직 + 시각화용 데이터 생성
//
// 목표
// - "캐릭터 A가 캐릭터 B를 얼마나 믿고/좋아하는가"를 A->B 방향 행렬로 관리한다.
// - trust/favor는 캐릭터별로 서로 다르므로, 전역 값이 아니라 (i,j)로 가진다.
// - 범위: 기본 0~100 (게임 밸런스에 따라 바꿔도 됨)
// - 랜덤 분포(초기 관계) 옵션 지원
// - commands.js에서 나온 effects( rel / aggro / flags ) 중 rel/aggro를 여기서 반영할 수 있게 제공
//
// 주의
// - "어그로"는 관계도가 아니라 캐릭터 자신의 상태값이므로, 여기서는 clamp/적용 유틸만 제공한다.
//   (game.js가 actor.aggro를 가진다면 applyAggroEffects를 써도 됨)

export const REL_MIN = 0;
export const REL_MAX = 100;

export function clamp(n, lo = REL_MIN, hi = REL_MAX) {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// --- 랜덤 분포 유틸 (seed 없이도 동작, seed 있으면 재현 가능) ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randNormalLike(rng) {
  // Box-Muller: 평균 0, 분산 1
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z;
}

/**
 * 초기 관계 분포 생성
 * @param {number} n - 캐릭터 수
 * @param {object} opt
 *  - baseTrust: number (기본 신뢰 평균)
 *  - baseFavor: number (기본 우호 평균)
 *  - spreadTrust: number (표준편차 느낌)
 *  - spreadFavor: number
 *  - seed: number|null
 *  - selfValue: number|null (자기 자신 i->i 값. null이면 REL_MAX/2로)
 */
export function createRelations(n, opt = {}) {
  const {
    baseTrust = 50,
    baseFavor = 50,
    spreadTrust = 12,
    spreadFavor = 12,
    seed = null,
    selfValue = null,
  } = opt;

  const rng = seed == null ? Math.random : mulberry32(seed);

  // trust[i][j], favor[i][j]
  const trust = Array.from({ length: n }, () => Array(n).fill(0));
  const favor = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        const v = selfValue == null ? 50 : selfValue;
        trust[i][j] = clamp(v);
        favor[i][j] = clamp(v);
        continue;
      }
      // 정규분포 비슷하게 퍼지게
      const t = baseTrust + randNormalLike(rng) * spreadTrust;
      const f = baseFavor + randNormalLike(rng) * spreadFavor;
      trust[i][j] = clamp(t);
      favor[i][j] = clamp(f);
    }
  }

  return { trust, favor };
}

/**
 * 관계도 객체 복제(깊은 복사)
 */
export function cloneRelations(rel) {
  return {
    trust: rel.trust.map((row) => row.slice()),
    favor: rel.favor.map((row) => row.slice()),
  };
}

/**
 * 관계도에 변화 적용 (commands.js effects.rel)
 * @param {object} rel - {trust:number[][], favor:number[][]}
 * @param {Array} relEffects - [{from,to,trustDelta,favorDelta,reason}]
 * @returns {object} appliedInfo - 로그/디버그용
 */
export function applyRelEffects(rel, relEffects = []) {
  const applied = [];
  for (const ef of relEffects) {
    const { from, to } = ef;
    if (from == null || to == null) continue;
    if (!rel.trust[from] || rel.trust[from][to] == null) continue;

    const t0 = rel.trust[from][to];
    const f0 = rel.favor[from][to];

    const t1 = clamp(t0 + (ef.trustDelta ?? 0));
    const f1 = clamp(f0 + (ef.favorDelta ?? 0));

    rel.trust[from][to] = t1;
    rel.favor[from][to] = f1;

    applied.push({
      from,
      to,
      trustBefore: t0,
      trustAfter: t1,
      favorBefore: f0,
      favorAfter: f1,
      trustDelta: ef.trustDelta ?? 0,
      favorDelta: ef.favorDelta ?? 0,
      reason: ef.reason ?? "",
    });
  }
  return { applied };
}

/**
 * 어그로 변화 적용 (effects.aggro)
 * - actor 객체에 actor.aggro를 유지한다는 전제.
 * - 범위는 0~100을 기본으로 함.
 */
export function applyAggroEffects(actors, aggroEffects = [], opt = {}) {
  const { min = 0, max = 100 } = opt;
  const applied = [];
  for (const ef of aggroEffects) {
    const who = ef.who;
    if (who == null) continue;
    const a = actors[who];
    if (!a) continue;
    const before = Number.isFinite(a.aggro) ? a.aggro : 0;
    const after = Math.max(min, Math.min(max, before + (ef.delta ?? 0)));
    a.aggro = after;
    applied.push({
      who,
      before,
      after,
      delta: ef.delta ?? 0,
      reason: ef.reason ?? "",
    });
  }
  return { applied };
}

/**
 * 관계도를 UI 시각화(그리드/히트맵 등)하기 좋은 형태로 변환
 * @param {object} rel
 * @param {Array} actors - [{id,name,...}] 또는 game.actors
 * @returns {object}
 *  - nodes: [{id,name}]
 *  - edges: [{from,to,trust,favor,score}]
 */
export function relationsToGraph(rel, actors) {
  const n = actors.length;
  const nodes = actors.map((a, idx) => ({ id: idx, name: a.name }));
  const edges = [];

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const trust = rel.trust[i][j];
      const favor = rel.favor[i][j];
      // score는 시각화 편의용 (예: trust와 favor의 평균)
      const score = (trust + favor) / 2;
      edges.push({ from: i, to: j, trust, favor, score });
    }
  }
  return { nodes, edges };
}

/**
 * 특정 캐릭터(i)가 다른 모두를 어떻게 보는지 한 줄 요약(정렬 포함)
 * @param {object} rel
 * @param {number} i
 * @param {Array} actors
 * @param {"trust"|"favor"|"score"} by
 * @param {"desc"|"asc"} order
 */
export function rankTargets(rel, i, actors, by = "score", order = "desc") {
  const n = actors.length;
  const items = [];
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const trust = rel.trust[i][j];
    const favor = rel.favor[i][j];
    const score = (trust + favor) / 2;
    items.push({ targetId: j, name: actors[j].name, trust, favor, score });
  }
  const dir = order === "asc" ? 1 : -1;
  items.sort((a, b) => (a[by] - b[by]) * dir);
  return items;
}

/**
 * "성격(0.00~1.00)" 관련 유틸
 * - 네 스펙: 성격 최소 0.00 최대 1.00
 * - game/character 생성시 normalize에 써도 됨.
 */
export function clampPersonality01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * 캐릭터 입력 검증용 유틸(음수/범위 방지에 도움)
 * - status: 0~50 (소수 허용)
 * - age: 0 이상
 */
export function clampStatus050(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(50, x));
}

export function clampNonNegativeInt(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.floor(x));
}

/**
 * "존재하지 않는 인물이 발언" 방지에 도움:
 * - aliveIds(Set)와 from/to가 살아있는지 확인하고 relEffects를 필터링
 */
export function filterEffectsByAlive(relEffects, aliveIds) {
  if (!aliveIds) return relEffects;
  return relEffects.filter((ef) => {
    const fromOk = ef.from == null ? true : aliveIds.has(ef.from);
    const toOk = ef.to == null ? true : aliveIds.has(ef.to);
    return fromOk && toOk;
  });
}
