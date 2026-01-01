// engine/roles.js
// =======================================================
// 역할(직업) 설정/배정/거짓말(사칭)/커밍아웃 규칙
//
// [사용자 확정 규칙 반영]
// 1) 엔지니어/닥터 사칭 가능: 그노시아, AC주의자, 버그 (거짓말 가능 진영)
// 2) 커밍아웃(역할 밝히기) 가능 역할: 엔지니어, 닥터, 선내대기인만
//    - 선원/그노시아/AC/버그는 커밍아웃 불가
//    - 수호천사는 커밍아웃 불가(기획서와 동일)
// 3) 선원 진영(선원/선내대기인/엔지니어/닥터/수호천사)은 "거짓말 자체 불가"
//    -> 진짜 역할만 말할 수 있고(사칭 불가), 거짓말 로그/속임수 시스템에서 항상 Truth-only
//    거짓말 가능: 그노시아 진영(그노시아/AC) + 버그
// =======================================================

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const ROLES = {
  CREW: "선원",
  GNOSIA: "그노시아",
  ENGINEER: "엔지니어",
  DOCTOR: "닥터",
  GUARDIAN: "수호천사",
  GUARD_DUTY: "선내대기인",
  AC: "AC주의자",
  BUG: "버그",
};

export const TOGGLE_ROLES = [
  ROLES.ENGINEER,
  ROLES.DOCTOR,
  ROLES.GUARDIAN,
  ROLES.GUARD_DUTY,
  ROLES.AC,
  ROLES.BUG,
];

// -------------------------------------------------------
// 캐릭터 수에 따른 그노시아 최대치 (기획서)
// -------------------------------------------------------
export function getMaxGnosiaCount(nPlayers) {
  if (nPlayers <= 6) return 1;   // 5~6
  if (nPlayers <= 8) return 2;   // 7~8
  if (nPlayers <= 10) return 3;  // 9~10
  if (nPlayers <= 12) return 4;  // 11~12
  if (nPlayers <= 14) return 5;  // 13~14
  return 6;                      // 15
}

// -------------------------------------------------------
// 설정 정규화
// -------------------------------------------------------
/**
 * @typedef {Object} GameRoleConfig
 * @property {boolean} enableEngineer
 * @property {boolean} enableDoctor
 * @property {boolean} enableGuardian
 * @property {boolean} enableGuardDuty
 * @property {boolean} enableAC
 * @property {boolean} enableBug
 * @property {number}  gnosiaCount
 */
export function normalizeRoleConfig(nPlayers, raw = {}) {
  const maxG = getMaxGnosiaCount(nPlayers);
  const cfg = {
    enableEngineer: !!raw.enableEngineer,
    enableDoctor: !!raw.enableDoctor,
    enableGuardian: !!raw.enableGuardian,
    enableGuardDuty: !!raw.enableGuardDuty,
    enableAC: !!raw.enableAC,
    enableBug: !!raw.enableBug,
    gnosiaCount: clamp(Number(raw.gnosiaCount ?? 1), 1, maxG),
  };

  // 선내대기인: 2명 필요. 인원 부족하면 off
  if (cfg.enableGuardDuty && nPlayers < 5) cfg.enableGuardDuty = false;
  return cfg;
}

// -------------------------------------------------------
// 역할 슬롯 구성
// -------------------------------------------------------
export function buildRoleSlots(nPlayers, cfg) {
  const slots = [];

  for (let i = 0; i < cfg.gnosiaCount; i++) slots.push(ROLES.GNOSIA);

  if (cfg.enableGuardDuty) slots.push(ROLES.GUARD_DUTY, ROLES.GUARD_DUTY);
  if (cfg.enableEngineer) slots.push(ROLES.ENGINEER);
  if (cfg.enableDoctor) slots.push(ROLES.DOCTOR);
  if (cfg.enableGuardian) slots.push(ROLES.GUARDIAN);
  if (cfg.enableAC) slots.push(ROLES.AC);
  if (cfg.enableBug) slots.push(ROLES.BUG);

  while (slots.length < nPlayers) slots.push(ROLES.CREW);
  return slots.slice(0, nPlayers);
}

function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function assignRoles(characters, cfg, rng = Math.random) {
  const n = characters.length;
  const slots = buildRoleSlots(n, cfg);
  shuffleInPlace(slots, rng);

  const ids = characters.map((c) => c.id);
  shuffleInPlace(ids, rng);

  const roleOf = new Map();
  for (let i = 0; i < n; i++) roleOf.set(ids[i], slots[i]);
  return roleOf;
}

// -------------------------------------------------------
// 진영/거짓말 가능 여부
// -------------------------------------------------------
export function getFaction(role) {
  if (role === ROLES.GNOSIA) return "GNOSIA";
  if (role === ROLES.AC) return "GNOSIA";
  if (role === ROLES.BUG) return "THIRD";
  return "HUMAN";
}

/**
 * 거짓말(사칭 포함)이 가능한 역할인가?
 * - 거짓말 가능: 그노시아, AC, 버그
 * - 거짓말 불가: 선원 진영 전부(선원/선내대기인/엔지니어/닥터/수호천사)
 */
export function canLieByRole(role) {
  return (role === ROLES.GNOSIA || role === ROLES.AC || role === ROLES.BUG);
}

// -------------------------------------------------------
// 커밍아웃(역할 밝히기) 규칙
// -------------------------------------------------------
/**
 * "역할을 밝힌다/자신도 밝힌다"로 밝힐 수 있는 역할
 * - 사용자 규칙: 엔지니어/닥터/선내대기인만 가능
 */
export function isComeoutRoleAllowed(claimRole) {
  return (
    claimRole === ROLES.ENGINEER ||
    claimRole === ROLES.DOCTOR ||
    claimRole === ROLES.GUARD_DUTY
  );
}

/**
 * actor가 claimRole을 주장(커밍아웃)할 수 있는가?
 * - 선원 진영(거짓말 불가)은 "자기 진짜 역할"만 가능
 * - 거짓말 가능(그노시아/AC/버그)은 (엔지/닥/선내대기인)에 한해 사칭 가능
 * - 수호천사는 커밍아웃 자체가 불가(어떤 역할도 밝히지 못하게 처리하려면 game.js에서 막아도 됨)
 */
export function canClaimRole(roleOf, actorId, claimRole) {
  const trueRole = roleOf.get(actorId);
  if (!trueRole) return false;

  // 커밍아웃 시스템 자체에서 허용되는 역할인가?
  if (!isComeoutRoleAllowed(claimRole)) return false;

  const liar = canLieByRole(trueRole);
  if (!liar) {
    // 거짓말 불가면 진짜 역할만 말할 수 있음
    return trueRole === claimRole;
  }

  // 거짓말 가능이면 엔지/닥/선내대기인 사칭 가능
  return true;
}

/**
 * "역할을 밝혀라"로 요구할 수 있는 역할 목록
 * - 사용자 규칙: 엔지니어/닥터/선내대기인만
 * - 설정에서 켜진 것만 포함
 */
export function getRequestableRoles(cfg) {
  const roles = [];
  if (cfg.enableEngineer) roles.push(ROLES.ENGINEER);
  if (cfg.enableDoctor) roles.push(ROLES.DOCTOR);
  if (cfg.enableGuardDuty) roles.push(ROLES.GUARD_DUTY);
  return roles;
}

export function pickRequestedRole(cfg, rng = Math.random) {
  const candidates = getRequestableRoles(cfg);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

// -------------------------------------------------------
// 선내대기인 2인 쌍
// -------------------------------------------------------
export function getGuardDutyPair(roleOf) {
  const ids = [];
  for (const [id, role] of roleOf.entries()) {
    if (role === ROLES.GUARD_DUTY) ids.push(id);
  }
  if (ids.length >= 2) return [ids[0], ids[1]];
  return null;
}
