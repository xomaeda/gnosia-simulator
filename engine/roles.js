// engine/roles.js
// 역할(직업) 설정/분배/판정/사칭 가능 규칙/밤 처리 유틸
//
// 설계 목표
// - 기획서 기반 역할: CREW(선원), GNOSIA(그노시아), ENGINEER, DOCTOR, GUARDIAN(수호천사), GUARD_DUTY(선내대기인), AC(AC주의자), BUG(버그)
// - 선원/그노시아는 항상 포함
// - 선내대기인은 정확히 2명(켜져 있을 때)이며 "절대로 그노시아일 수 없음" + "사칭 불가".
// - 수호천사는 커밍아웃 불가 + 거짓 사칭도 불가(즉 어떤 역할도 주장 못함).
// - 엔지니어/닥터 조사 결과: AC/BUG는 "인간"으로 나온다.
// - 버그: 그노시아 공격 면역, 엔지니어에게 조사당하면 즉시 소멸(수호천사 보호도 무효).
// - 최대 그노시아 수: (5~6:1), (7~8:2), (9~10:3), (11~12:4), (13~14:5), (15:6)
// - 추가 요구(최근): 유저는 시작 시 전체 역할을 볼 수 있어도 됨(옵션은 game.js에서 UI로 처리)
//
// 이 파일은 "규칙과 계산"만 담당. 실제 게임 흐름/로그/커맨드 연쇄는 game.js에서 담당.

export const ROLE = Object.freeze({
  CREW: "선원",
  GNOSIA: "그노시아",
  ENGINEER: "엔지니어",
  DOCTOR: "닥터",
  GUARDIAN: "수호천사",
  GUARD_DUTY: "선내대기인",
  AC: "AC주의자",
  BUG: "버그",
});

export const ALL_ROLES = Object.freeze(Object.values(ROLE));

// -------------------------------
// 그노시아 최대 수 계산
// -------------------------------
export function maxGnosiaForPlayerCount(n) {
  if (n <= 0) return 0;
  if (n <= 6) return 1;        // 5~6 -> 1
  if (n <= 8) return 2;        // 7~8 -> 2
  if (n <= 10) return 3;       // 9~10 -> 3
  if (n <= 12) return 4;       // 11~12 -> 4
  if (n <= 14) return 5;       // 13~14 -> 5
  return 6;                    // 15 -> 6
}

// -------------------------------
// 설정 검증
// settings 예시:
// {
//   enableEngineer:true,
//   enableDoctor:true,
//   enableGuardian:true,
//   enableGuardDuty:true,
//   enableAC:true,
//   enableBug:true,
//   gnosiaCount:2,
// }
// -------------------------------
export function validateRoleSettings(settings, playerCount) {
  const errs = [];

  if (playerCount < 5) errs.push("캐릭터는 최소 5명 이상이어야 게임을 시작할 수 있어.");
  if (playerCount > 15) errs.push("캐릭터는 최대 15명까지 가능해.");

  const maxG = maxGnosiaForPlayerCount(playerCount);
  const g = Number(settings.gnosiaCount ?? 1);
  if (!Number.isFinite(g) || g < 1) errs.push("그노시아 수는 최소 1명 이상이어야 해.");
  if (g > maxG) errs.push(`현재 인원(${playerCount}명)에서 그노시아 수는 최대 ${maxG}명까지 가능해.`);

  // 선내대기인(2명) 켰는데 인원 부족하면 안됨
  if (settings.enableGuardDuty) {
    if (playerCount < 5) errs.push("선내대기인을 활성화하려면 인원이 너무 적어.");
    // 더 타이트한 제한을 걸고 싶으면 여기 조정 가능
  }

  return errs;
}

// -------------------------------
// 셔플 유틸
// -------------------------------
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

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// -------------------------------
// 역할 분배
// actors: [{id,name,...}] 배열 (길이 = playerCount)
// 반환: rolesById: Map(id -> ROLE.*), plus derived lists
//
// 분배 규칙(현실적인 우선순위):
// 1) 선내대기인(켜져 있으면 2명) 먼저 뽑음 (절대 그노시아가 될 수 없음)
// 2) 그노시아 g명 뽑음 (선내대기인 제외)
// 3) 나머지 옵션 역할들(엔지/닥/수호/AC/버그) 배정
// 4) 나머지는 선원
//
// seed를 넣으면 같은 결과 재현 가능
// -------------------------------
export function assignRoles(actors, settings, seed = null) {
  const n = actors.length;
  const rng = seed == null ? Math.random : mulberry32(seed);

  const gnosiaCount = Number(settings.gnosiaCount ?? 1);

  const ids = actors.map((a) => a.id);
  const pool = ids.slice();
  shuffle(pool, rng);

  const rolesById = new Map();

  // 1) 선내대기인(2명)
  const guardDutyIds = [];
  if (settings.enableGuardDuty) {
    // 안전장치: 인원이 부족하면 가능한 만큼만(하지만 기획서상 "반드시 2명"이므로 보통 여기 오기 전에 validate에서 막히게)
    const take = Math.min(2, pool.length);
    for (let i = 0; i < take; i++) {
      const id = pool.pop();
      guardDutyIds.push(id);
      rolesById.set(id, ROLE.GUARD_DUTY);
    }
  }

  // 남은 후보(선내대기인 제외)
  const nonGuardPool = pool.slice(); // 아직 역할 미배정인 id들
  shuffle(nonGuardPool, rng);

  // 2) 그노시아
  const gnosiaIds = [];
  for (let i = 0; i < gnosiaCount; i++) {
    const id = nonGuardPool.pop();
    if (id == null) break;
    gnosiaIds.push(id);
    rolesById.set(id, ROLE.GNOSIA);
    // pool에서도 제거되도록
    const idx = pool.indexOf(id);
    if (idx >= 0) pool.splice(idx, 1);
  }

  // 이제 pool에는 "선내대기인 제외 & 그노시아 제외"한 나머지 id들이 남아있음
  shuffle(pool, rng);

  // 3) 옵션 역할들 배정
  // - 수호천사 1명
  // - 엔지니어 1명
  // - 닥터 1명
  // - AC 1명
  // - 버그 1명
  // (기획서에 인원수별 정확한 배정 규칙은 없으므로, 켜져 있으면 1명씩 배정)
  const takeRole = (roleName) => {
    const id = pool.pop();
    if (id == null) return null;
    rolesById.set(id, roleName);
    return id;
  };

  const guardianId = settings.enableGuardian ? takeRole(ROLE.GUARDIAN) : null;
  const engineerId = settings.enableEngineer ? takeRole(ROLE.ENGINEER) : null;
  const doctorId = settings.enableDoctor ? takeRole(ROLE.DOCTOR) : null;
  const acId = settings.enableAC ? takeRole(ROLE.AC) : null;
  const bugId = settings.enableBug ? takeRole(ROLE.BUG) : null;

  // 4) 나머지는 선원
  for (const id of pool) {
    if (!rolesById.has(id)) rolesById.set(id, ROLE.CREW);
  }

  // 혹시라도 누락된 id가 있으면 선원으로 채움
  for (const id of ids) {
    if (!rolesById.has(id)) rolesById.set(id, ROLE.CREW);
  }

  return {
    rolesById,
    lists: {
      guardDutyIds,
      gnosiaIds,
      guardianId,
      engineerId,
      doctorId,
      acId,
      bugId,
    },
  };
}

// -------------------------------
// 조사 결과 판정
// -------------------------------

/**
 * 엔지니어 조사 결과 문자열 반환
 * - GNOSIA -> "그노시아"
 * - 나머지(선원/AC/BUG/선내대기인/수호천사/엔지/닥 포함) -> "인간"
 */
export function engineerResultOf(role) {
  return role === ROLE.GNOSIA ? ROLE.GNOSIA : "인간";
}

/**
 * 닥터 검사 결과
 * - GNOSIA -> "그노시아"
 * - 나머지 -> "인간"
 */
export function doctorResultOf(role) {
  return role === ROLE.GNOSIA ? ROLE.GNOSIA : "인간";
}

/**
 * 버그 조사 즉사 여부 (엔지니어가 target을 조사했을 때)
 */
export function isBugKilledByEngineer(targetRole) {
  return targetRole === ROLE.BUG;
}

/**
 * 그노시아 공격 면역 여부
 * - BUG는 공격 면역
 * - GNOSIA는 서로 죽일 수 없음(공격 대상으로 선택하더라도 무효)
 */
export function isImmuneToGnosiaAttack(targetRole) {
  return targetRole === ROLE.BUG || targetRole === ROLE.GNOSIA;
}

// -------------------------------
// 커밍아웃/사칭 가능 규칙
// -------------------------------

/**
 * 수호천사는 커밍아웃 불가 + 사칭 불가 => 어떤 claimedRole도 주장 불가
 */
export function canClaimAnyRole(actualRole) {
  return actualRole !== ROLE.GUARDIAN;
}

/**
 * "claimedRole"을 주장할 수 있는지 (게임 내 커맨드 '역할을 밝힌다/자신도 밝힌다' 등에 사용)
 * 기본 규칙(기획서 + 너랑 합의한 버전):
 * - GUARDIAN: 아무것도 주장 불가
 * - GUARD_DUTY: 사칭 불가(본인만 주장 가능), 그리고 본인은 주장 가능(원하면)
 * - claimedRole이 GUARDIAN이면 누구도 주장 불가(거짓 사칭도 불가)
 * - claimedRole이 GUARD_DUTY이면 본인(실제 GUARD_DUTY)만 가능
 * - ENGINEER/DOCTOR는 누구나 "거짓말"로 주장할 수 있지만,
 *   AC는 특히 그걸 자주 한다는 의미(성격/AI에서 가중치로 처리)
 * - GNOSIA/CREW/BUG도 주장 자체는 가능(거짓말 시스템에서 걸릴 수 있음)
 */
export function canClaimRole(actualRole, claimedRole) {
  if (!claimedRole) return false;
  if (actualRole === ROLE.GUARDIAN) return false; // 수호천사: 아예 불가

  // 수호천사라는 "역할" 자체는 커밍아웃 불가/사칭 불가
  if (claimedRole === ROLE.GUARDIAN) return false;

  // 선내대기인은 사칭 불가
  if (claimedRole === ROLE.GUARD_DUTY) return actualRole === ROLE.GUARD_DUTY;

  // 나머지는 "주장" 자체는 가능
  return true;
}

/**
 * '역할을 밝혀라' 커맨드의 응답 조건에서 사용:
 * - requestedRole이 주어지면, 그 역할이거나(진실)
 * - 또는 그 역할을 "주장할 수 있는" 캐릭터(거짓)면 응답 후보가 됨
 * 단, requestedRole이 GUARDIAN이면 아무도 응답 못함
 * requestedRole이 GUARD_DUTY면 실제 GUARD_DUTY만 가능
 */
export function canRespondToRevealRequest(actualRole, requestedRole) {
  return canClaimRole(actualRole, requestedRole);
}

// -------------------------------
// 밤 처리(소멸 결과 계산)
// 요구 반영:
// - 수호천사 보호 성공 OR 그노시아가 버그를 노린 경우 => (그노시아 공격으로는) 아무도 소멸하지 않음.
// - 엔지니어가 버그 조사 성공 + 그노시아가 선원/인간을 소멸 => "A와 B가 소멸했습니다"처럼 2명 가능.
// - 그노시아가 버그를 노려서 실패했더라도, 엔지니어가 버그를 조사했다면 버그는 소멸(보호 무시).
//
// 입력은 "선택된 대상 id" 기반.
// aliveIds(Set) 기준으로 유효성 체크는 game.js에서 해도 되고 여기서도 한번 방어한다.
// -------------------------------
export function resolveNightDeaths({
  actors,
  rolesById,
  aliveIds,
  gnosiaTargetId = null,
  guardianProtectId = null,
  engineerScanTargetId = null,
}) {
  const deaths = [];
  const info = {
    gnosiaKill: { attempted: false, success: false, reason: "" },
    bugScanKill: { attempted: false, success: false, reason: "" },
  };

  const isAlive = (id) => (aliveIds ? aliveIds.has(id) : true);

  // 1) 엔지니어의 버그 조사 즉사
  if (engineerScanTargetId != null && isAlive(engineerScanTargetId)) {
    info.bugScanKill.attempted = true;
    const r = rolesById.get(engineerScanTargetId);
    if (isBugKilledByEngineer(r)) {
      deaths.push(engineerScanTargetId);
      info.bugScanKill.success = true;
      info.bugScanKill.reason = "엔지니어가 버그를 조사해 소멸";
    } else {
      info.bugScanKill.success = false;
      info.bugScanKill.reason = "버그가 아니므로 소멸 없음";
    }
  }

  // 2) 그노시아 공격
  if (gnosiaTargetId != null && isAlive(gnosiaTargetId)) {
    info.gnosiaKill.attempted = true;
    const targetRole = rolesById.get(gnosiaTargetId);

    // 버그/그노시아는 면역
    if (isImmuneToGnosiaAttack(targetRole)) {
      info.gnosiaKill.success = false;
      info.gnosiaKill.reason = "공격 면역 대상(버그 또는 그노시아)";
    } else if (guardianProtectId != null && guardianProtectId === gnosiaTargetId) {
      info.gnosiaKill.success = false;
      info.gnosiaKill.reason = "수호천사 보호 성공";
    } else {
      // 성공
      deaths.push(gnosiaTargetId);
      info.gnosiaKill.success = true;
      info.gnosiaKill.reason = "그노시아 공격 성공";
    }
  }

  // 중복 제거
  const uniq = [];
  const seen = new Set();
  for (const d of deaths) {
    if (seen.has(d)) continue;
    seen.add(d);
    uniq.push(d);
  }

  return {
    deathIds: uniq,
    info,
  };
}

// -------------------------------
// 승리 조건 체크
// - BUG는 "혼자 끝까지 살아남기" (다른 진영 승리 뒤엎음)
// - 일반적으로:
//   * 그노시아 승리: 그노시아 수 >= 인간(그노시아 제외) 수 (AC/BUG 포함 여부는 게임 설계에 따라)
//   * 선원 승리: 그노시아 전원 제거
//
// 이 시뮬레이터에서는 "AC는 인간 종족이지만 그노시아 편"
// => 승리 판정에서 "인간측"은 CREW/ENGINEER/DOCTOR/GUARDIAN/GUARD_DUTY 로 보고,
//    AC는 인간측 카운트에서 제외하는 방식이 더 직관적.
// BUG는 제3세력: 마지막까지 살아남으면 단독승리.
//
// game.js에서 호출하기 쉽게: (aliveIds, rolesById)만 받아서 winner를 반환
// -------------------------------
export function checkWinner(aliveIds, rolesById) {
  // 생존 역할 카운트
  let aliveGnosia = 0;
  let aliveHumanTeam = 0; // 선원측(AC 제외)
  let aliveBug = 0;

  for (const id of aliveIds) {
    const r = rolesById.get(id);
    if (r === ROLE.GNOSIA) aliveGnosia++;
    else if (r === ROLE.BUG) aliveBug++;
    else if (r === ROLE.AC) {
      // AC는 인간이지만 그노시아 편이라 인간측 카운트에서 제외
    } else {
      aliveHumanTeam++;
    }
  }

  // BUG 단독 승리 조건: "혼자 끝까지 살아남기"
  // => 생존자가 1명이고 그게 BUG면 BUG 승리.
  if (aliveIds.size === 1) {
    const onlyId = Array.from(aliveIds)[0];
    if (rolesById.get(onlyId) === ROLE.BUG) {
      return { winner: "BUG", detail: "버그 단독 생존" };
    }
  }

  // 선원 승리: 그노시아 0
  if (aliveGnosia === 0) {
    // 다만 BUG가 같이 살아있으면? 기획서: 마지막까지 살아남기만 하면 승리 뒤엎음.
    // => 이 시점에서 BUG가 살아있고, 게임이 종료되는 상황이라면 BUG 승리가 되어야 한다.
    // 하지만 '혼자' 조건이라 했으므로, 여기서는 "단독"일 때만 BUG.
    return { winner: "CREW", detail: "그노시아 전멸" };
  }

  // 그노시아 승리: 그노시아 수가 인간측 이상
  if (aliveGnosia >= aliveHumanTeam && aliveHumanTeam > 0) {
    // BUG가 살아있다고 해서 바로 BUG 승리가 되지는 않음(혼자 조건)
    return { winner: "GNOSIA", detail: "그노시아가 우세(인간측과 동수 이상)" };
  }

  // 아직 진행
  return { winner: null, detail: "" };
}

// -------------------------------
// 디버그/표시용: rolesById를 {id:role} plain object로
// -------------------------------
export function rolesMapToObject(rolesById) {
  const obj = {};
  for (const [id, role] of rolesById.entries()) obj[id] = role;
  return obj;
}
