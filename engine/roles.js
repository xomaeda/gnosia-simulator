// engine/roles.js
// ============================================================================
// Role system for the simulator
//
// 반영된 너의 수정 사항(핵심):
// 1) 엔지니어/닥터 사칭 가능: 그노시아, AC주의자, 버그
// 2) '역할을 밝혀라'로 CO를 요구/유도할 수 있는 "CO 가능한 직업군"은:
//    - 선내대기인, 엔지니어, 닥터
//    (수호천사는 CO 불가, 선원/그노시아/AC/버그도 CO로 '자기 역할'은 공개 불가)
//
// ⚠️ 중요한 해석(충돌 해결):
// - 너는 "그노시아/AC/버그는 커밍아웃 불가능"이라고 했지만,
//   동시에 "엔지니어/닥터 사칭 가능"도 요구했음.
// - 그래서 여기서는 다음처럼 정리해서 구현한다:
//
//   A) 'CO 가능한 역할' = {엔지니어, 닥터, 선내대기인} 만 CO 체인에 관여한다.
//   B) 그노시아/AC/버그는 "자기 진짜 역할을 CO" 하진 못하지만,
//      거짓말(사칭)로 엔지니어/닥터를 "자칭"할 수 있다.
//      (즉, CO 체인에 끼어들 수는 있으나, 주장 가능한 역할은 엔지니어/닥터만)
//
// - 선원 진영(선원/선내대기인/엔지니어/닥터/수호천사)은 거짓말 자체 불가.
//   => 사칭/거짓 보고/거짓 CO 불가.
//
// 이 파일은 다음을 제공:
// - ROLE: 역할 ID 상수
// - ROLE_INFO: 역할 속성(진영, 거짓말 가능, CO 가능, 사칭 가능 역할 등)
// - computeMaxGnosia(nPlayers): 인원수별 그노시아 최대치
// - normalizeGameConfig(config, nPlayers): 설정 유효성(그노시아 수 상한, 선내대기인 2명 강제 등)
// - assignRoles(chars, config, rng): 역할 배정 (유저에게 시작 시 공개 가능)
// ============================================================================

export const ROLE = {
  CREW: "선원",
  ENGINEER: "엔지니어",
  DOCTOR: "닥터",
  GUARDIAN: "수호천사",
  PASSENGER: "선내대기인",
  GNOSIA: "그노시아",
  AC: "AC주의자",
  BUG: "버그",
};

export const SIDE = {
  CREW: "CREW",
  GNOSIA: "GNOSIA",
  BUG: "BUG",
};

// 역할 속성 정의
export const ROLE_INFO = {
  [ROLE.CREW]: {
    id: ROLE.CREW,
    side: SIDE.CREW,
    canLie: false,
    canCOTruth: false,      // '역할을 밝힌다'로 자신의 역할 공개 불가
    canCOClaim: false,      // CO 체인에 끼어드는 것 자체 불가
    fakeableRoles: [],      // 주장 가능한 역할 없음
  },

  [ROLE.ENGINEER]: {
    id: ROLE.ENGINEER,
    side: SIDE.CREW,
    canLie: false,
    canCOTruth: true,       // 진짜 엔지니어면 CO 가능
    canCOClaim: true,       // CO 체인 참여 가능
    fakeableRoles: [],      // 선원진영은 거짓말 불가
  },

  [ROLE.DOCTOR]: {
    id: ROLE.DOCTOR,
    side: SIDE.CREW,
    canLie: false,
    canCOTruth: true,
    canCOClaim: true,
    fakeableRoles: [],
  },

  [ROLE.GUARDIAN]: {
    id: ROLE.GUARDIAN,
    side: SIDE.CREW,
    canLie: false,
    canCOTruth: false,      // 기획서: 수호천사는 커밍아웃 불가, 사칭도 불가
    canCOClaim: false,
    fakeableRoles: [],
  },

  [ROLE.PASSENGER]: {
    id: ROLE.PASSENGER,
    side: SIDE.CREW,
    canLie: false,
    canCOTruth: true,       // 선내대기인은 "역할을 밝히면 2명이 서로 인간 보증"이므로 CO 가능
    canCOClaim: true,
    fakeableRoles: [],      // 사칭 불가(그노시아/AC/버그도 사칭 불가)
    isFixedCrew: true,      // 절대 그노시아일 수 없음
  },

  [ROLE.GNOSIA]: {
    id: ROLE.GNOSIA,
    side: SIDE.GNOSIA,
    canLie: true,
    canCOTruth: false,      // 진짜 그노시아라고 CO는 안 함
    canCOClaim: true,       // CO 체인에 끼어들 "수는" 있으나(거짓말), 주장 가능한 역할만 허용
    fakeableRoles: [ROLE.ENGINEER, ROLE.DOCTOR], // 사칭 가능
  },

  [ROLE.AC]: {
    id: ROLE.AC,
    side: SIDE.GNOSIA,
    canLie: true,
    canCOTruth: false,
    canCOClaim: true,
    fakeableRoles: [ROLE.ENGINEER, ROLE.DOCTOR], // 사칭 가능
  },

  [ROLE.BUG]: {
    id: ROLE.BUG,
    side: SIDE.BUG,
    canLie: true,
    canCOTruth: false,
    canCOClaim: true,
    fakeableRoles: [ROLE.ENGINEER, ROLE.DOCTOR], // ✅ 너가 추가로 요구: 버그도 사칭 가능
  },
};

// 인원수에 따른 그노시아 최대치
export function computeMaxGnosia(nPlayers) {
  if (nPlayers <= 6) return 1;
  if (nPlayers <= 8) return 2;
  if (nPlayers <= 10) return 3;
  if (nPlayers <= 12) return 4;
  if (nPlayers <= 14) return 5;
  return 6; // 15명
}

// config 예시(권장):
// {
//   rolesEnabled: {
//     [ROLE.ENGINEER]: true/false,
//     [ROLE.DOCTOR]: true/false,
//     [ROLE.GUARDIAN]: true/false,
//     [ROLE.PASSENGER]: true/false,
//     [ROLE.AC]: true/false,
//     [ROLE.BUG]: true/false,
//   },
//   gnosiaCount: number
// }
export function normalizeGameConfig(config, nPlayers) {
  const maxG = computeMaxGnosia(nPlayers);

  const rolesEnabled = {
    [ROLE.ENGINEER]: !!config?.rolesEnabled?.[ROLE.ENGINEER],
    [ROLE.DOCTOR]: !!config?.rolesEnabled?.[ROLE.DOCTOR],
    [ROLE.GUARDIAN]: !!config?.rolesEnabled?.[ROLE.GUARDIAN],
    [ROLE.PASSENGER]: !!config?.rolesEnabled?.[ROLE.PASSENGER],
    [ROLE.AC]: !!config?.rolesEnabled?.[ROLE.AC],
    [ROLE.BUG]: !!config?.rolesEnabled?.[ROLE.BUG],
  };

  // 선원/그노시아는 항상 포함(설정에서 끌 수 없음)
  let gnosiaCount = Number(config?.gnosiaCount ?? 1);
  if (!Number.isFinite(gnosiaCount)) gnosiaCount = 1;
  gnosiaCount = Math.max(1, Math.min(maxG, Math.floor(gnosiaCount)));

  return { rolesEnabled, gnosiaCount };
}

// RNG 유틸(외부에서 rng를 주면 그걸 쓰고, 없으면 Math.random)
function rand(rng) {
  return (typeof rng === "function" ? rng() : Math.random());
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(rng) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 역할 배정
 * - chars: [{id, name, ...}] 최소 5 최대 15, alive=true 등은 game에서 관리
 * - config: normalizeGameConfig 통과한 설정
 * - 반환: Map<charId, roleId>
 *
 * 규칙:
 * - 그노시아는 gnosiaCount명
 * - 선내대기인이 enabled면 반드시 2명 배정(무조건 CREW side)
 * - 엔지니어/닥터/수호천사/AC/버그는 enabled일 때 각각 1명 배정 (선내대기인만 2명)
 * - 남는 인원은 선원
 */
export function assignRoles(chars, config, rng) {
  const n = chars.length;
  const { rolesEnabled, gnosiaCount } = normalizeGameConfig(config, n);

  // 후보 인덱스 섞기
  const idx = [...Array(n)].map((_, i) => i);
  shuffleInPlace(idx, rng);

  // 배정 결과
  const roleById = new Map();

  // helper: 한 명 뽑아 role 부여
  let cursor = 0;
  const takeOne = (role) => {
    if (cursor >= idx.length) return null;
    const c = chars[idx[cursor++]];
    roleById.set(c.id, role);
    return c;
  };

  // 1) 그노시아 먼저
  for (let i = 0; i < gnosiaCount; i++) {
    const picked = takeOne(ROLE.GNOSIA);
    if (!picked) break;
  }

  // 2) 선내대기인(2명) — enabled면 반드시 2명
  if (rolesEnabled[ROLE.PASSENGER]) {
    takeOne(ROLE.PASSENGER);
    takeOne(ROLE.PASSENGER);
  }

  // 3) 엔지니어/닥터/수호천사/AC/버그 (각 1명)
  if (rolesEnabled[ROLE.ENGINEER]) takeOne(ROLE.ENGINEER);
  if (rolesEnabled[ROLE.DOCTOR]) takeOne(ROLE.DOCTOR);
  if (rolesEnabled[ROLE.GUARDIAN]) takeOne(ROLE.GUARDIAN);
  if (rolesEnabled[ROLE.AC]) takeOne(ROLE.AC);
  if (rolesEnabled[ROLE.BUG]) takeOne(ROLE.BUG);

  // 4) 나머지 선원
  while (cursor < idx.length) {
    const c = chars[idx[cursor++]];
    roleById.set(c.id, ROLE.CREW);
  }

  return roleById;
}

/**
 * 도우미: 어떤 캐릭터가 "거짓말을 할 수 있는가"
 */
export function canLie(roleId) {
  return !!ROLE_INFO?.[roleId]?.canLie;
}

/**
 * 도우미: 어떤 캐릭터가 "CO 체인에 참여(역할 밝히기 응답)" 할 수 있는가
 * - 진짜 CO 가능한 직업(엔지/닥/선내대기인)이거나
 * - 거짓말 가능한 진영(그노시아/AC/버그)이면서 사칭 가능한 역할이 있을 때
 */
export function canParticipateCO(roleId) {
  const info = ROLE_INFO[roleId];
  if (!info) return false;
  if (info.canCOClaim) return true;
  return false;
}

/**
 * 도우미: 해당 캐릭터가 "주장(커밍아웃)할 수 있는 역할 목록" 반환
 * - 선원 진영은 진짜 역할만 주장 가능(거짓말 불가)
 * - 거짓말 가능한 진영은 fakeableRoles만 주장 가능
 */
export function getClaimableRoles(roleId) {
  const info = ROLE_INFO[roleId];
  if (!info) return [];
  if (!info.canLie) {
    // 거짓말 불가 => 자기 역할이 CO 가능한 역할이라면 그 역할만, 아니면 빈 배열
    if (info.canCOTruth) return [roleId];
    return [];
  }
  // 거짓말 가능 => 사칭 가능한 역할 목록
  return Array.isArray(info.fakeableRoles) ? [...info.fakeableRoles] : [];
}

/**
 * 도우미: '역할을 밝혀라' 커맨드가 요구할 수 있는 역할 목록
 * (너가 지정: 선내대기인/엔지니어/닥터)
 */
export function getCOQueryableRoles() {
  return [ROLE.PASSENGER, ROLE.ENGINEER, ROLE.DOCTOR];
}

/**
 * 도우미: 엔지니어/닥터 판정에서 "그노시아로 판정되는 역할인가?"
 */
export function isGnosiaDetectedRole(roleId) {
  return roleId === ROLE.GNOSIA;
}

/**
 * 도우미: 엔지니어/닥터 판정에서 "인간으로 판정되는 역할인가?"
 * - AC, BUG는 인간으로 뜸 (기획서)
 * - 선내대기인/선원/수호천사/엔지니어/닥터도 인간
 */
export function isHumanDetectedRole(roleId) {
  return roleId !== ROLE.GNOSIA;
}

/**
 * 도우미: 역할 이름을 UI에 보여줄 때
 */
export function roleLabel(roleId) {
  return ROLE_INFO?.[roleId]?.id || String(roleId);
}
