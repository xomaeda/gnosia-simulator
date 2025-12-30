// js/roleSystem.js
// 역할 배정 + 밤 역할 집행 + 승리 판정 + 종료 시 공개

import {
  ROLE,
  computeMaxGnosiaCount,
  choice,
  clamp,
  addLog,
} from "./dataStructures.js";

import { relChangeTrust, relChangeLike } from "./relationship.js";

// ===== 역할 배정 =====
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function assignRoles(state) {
  const alive = state.chars.filter(c => c.alive);
  const n = alive.length;

  // 최소 5명
  if (n < 5) {
    addLog(state, "캐릭터가 5명 이상이어야 시뮬레이터를 실행할 수 있습니다.");
    return false;
  }
  // 최대 15명
  if (n > 15) {
    addLog(state, "캐릭터 최대 인원은 15명입니다.");
    return false;
  }

  // 그노시아 수 제한
  const maxG = computeMaxGnosiaCount(n);
  state.settings.gnosiaCount = clamp(state.settings.gnosiaCount, 1, maxG);

  const pool = [];

  // 그노시아
  for (let i = 0; i < state.settings.gnosiaCount; i++) pool.push(ROLE.GNOSIA);

  // 선택 역할
  const e = state.settings.rolesEnabled;
  if (e.engineer) pool.push(ROLE.ENGINEER);
  if (e.doctor) pool.push(ROLE.DOCTOR);
  if (e.guardian) pool.push(ROLE.GUARDIAN);
  if (e.ac) pool.push(ROLE.AC);
  if (e.bug) pool.push(ROLE.BUG);

  // 선내대기인: 반드시 2명
  if (e.crew) {
    pool.push(ROLE.CREW);
    pool.push(ROLE.CREW);
  }

  // 나머지 선원
  while (pool.length < n) pool.push(ROLE.CREWMATE);

  // 초과 방어
  if (pool.length > n) pool.length = n;

  const shuffledChars = shuffle(alive);
  const shuffledRoles = shuffle(pool);

  // 초기화
  for (const c of state.chars) {
    c.role = null;
    c.claimedRole = null;
    c.hate = 0;
    c.coop = null;
    c.dailyFlags = {};
  }

  // 배정
  for (let i = 0; i < n; i++) {
    shuffledChars[i].role = shuffledRoles[i];
  }

  // 그노시아는 서로를 앎(관계 상승)
  const gnosias = state.chars.filter(c => c.alive && c.role === ROLE.GNOSIA);
  for (const a of gnosias) {
    for (const b of gnosias) {
      if (a.id === b.id) continue;
      relChangeTrust(state, a.id, b.id, +35);
      relChangeLike(state, a.id, b.id, +25);
    }
  }

  // 선내대기인 2명 서로 신뢰/우호 상승
  const crews = state.chars.filter(c => c.alive && c.role === ROLE.CREW);
  if (crews.length === 2) {
    relChangeTrust(state, crews[0].id, crews[1].id, +40);
    relChangeTrust(state, crews[1].id, crews[0].id, +40);
    relChangeLike(state, crews[0].id, crews[1].id, +30);
    relChangeLike(state, crews[1].id, crews[0].id, +30);
  }

  addLog(state, "역할이 배정되었습니다. (종료 시 전원 공개)");
  return true;
}

// ===== 커밍아웃/사칭 제약 =====
export function canClaimRole(actor, roleToClaim) {
  // 수호천사: 커밍아웃/사칭 불가
  if (actor.role === ROLE.GUARDIAN) return false;

  // 선내대기인: 사칭 불가(진짜만)
  if (roleToClaim === ROLE.CREW) return actor.role === ROLE.CREW;

  // 수호천사 사칭 불가
  if (roleToClaim === ROLE.GUARDIAN) return false;

  // 그 외는 사칭 가능(AC/그노시아의 엔지니어/닥터 사칭 포함)
  return true;
}

// ===== 밤 역할 집행(밤 2단계 결과 요약 출력 규칙 반영) =====
// plan: { guardianProtectId, engineerScanId, gnosiaAttackId }
export function nightRoleActions(state, plan) {
  const alive = state.chars.filter(c => c.alive);
  const guardian = alive.find(c => c.role === ROLE.GUARDIAN) || null;
  const engineer = alive.find(c => c.role === ROLE.ENGINEER) || null;

  const deaths = []; // 이번 밤에 "소멸"한 캐릭터 이름들(엔지니어 버그 + 습격 피해자)

  // 1) 보호 대상(수호천사는 자기 자신 보호 불가)
  let protectedId = null;
  if (guardian && plan.guardianProtectId && plan.guardianProtectId !== guardian.id) {
    protectedId = plan.guardianProtectId;
  }

  // 2) 엔지니어 조사(버그는 즉시 소멸, 그 외는 죽지 않음)
  if (engineer && plan.engineerScanId) {
    const t = state.chars.find(c => c.id === plan.engineerScanId && c.alive);
    if (t) {
      if (t.role === ROLE.BUG) {
        // 버그 즉시 소멸(보호 무시)
        t.alive = false;
        state.lastKilledId = t.id;
        deaths.push(t.name);
        // (조사 결과 로그는 게임 맛을 위해 남겨도 되지만, 원하면 지울 수 있음)
        addLog(state, `엔지니어 조사 결과: ${t.name}는 인간... (버그가 소멸했습니다)`);
      } else if (t.role === ROLE.GNOSIA) {
        addLog(state, `엔지니어 조사 결과: ${t.name}는 그노시아입니다.`);
      } else {
        addLog(state, `엔지니어 조사 결과: ${t.name}는 인간입니다.`);
      }
    }
  }

  // 3) 그노시아 습격(보호 성공/버그 면역/그노시아 대상은 소멸 없음)
  let attackVictimName = null;

  if (plan.gnosiaAttackId) {
    const victim = state.chars.find(c => c.id === plan.gnosiaAttackId && c.alive);
    if (victim) {
      // 보호 성공 -> 소멸 없음(이유 숨김)
      if (protectedId === victim.id) {
        // no death
      }
      // 버그는 습격 면역 -> 소멸 없음(이유 숨김)
      else if (victim.role === ROLE.BUG) {
        // no death
      }
      // 그노시아끼리 습격 불가 -> 소멸 없음(이유 숨김)
      else if (victim.role === ROLE.GNOSIA) {
        // no death
      }
      // 정상 소멸
      else {
        victim.alive = false;
        state.lastKilledId = victim.id;
        attackVictimName = victim.name;
        deaths.push(victim.name);
      }
    }
  }

  // 4) 최종 요약 출력(요청한 규칙)
  if (deaths.length === 0) {
    addLog(state, "아무도 소멸하지 않았습니다.");
  } else if (deaths.length === 1) {
    addLog(state, `${deaths[0]}가 소멸했습니다.`);
  } else {
    // "A와 B가 소멸했습니다" 형식
    const msg = `${deaths.join("와 ")}가 소멸했습니다.`;
    addLog(state, msg);
  }

  return {
    protectedId,
    deaths, // gameLoop에서 승리판정 등에도 활용 가능
  };
}

// ===== 닥터 검사(낮 보고 시점) =====
export function doctorReport(state) {
  const doctor = state.chars.find(c => c.alive && c.role === ROLE.DOCTOR);
  if (!doctor) return;

  const id = state.lastColdSleepId;
  if (!id) return;

  const t = state.chars.find(c => c.id === id);
  if (!t) return;

  if (t.role === ROLE.GNOSIA) {
    addLog(state, `닥터 검사 결과: ${t.name}는 그노시아였습니다.`);
  } else {
    addLog(state, `닥터 검사 결과: ${t.name}는 인간이었습니다.`);
  }
}

// ===== 승리 판정 =====
export function checkVictory(state) {
  const alive = state.chars.filter(c => c.alive);

  const aliveG = alive.filter(c => c.role === ROLE.GNOSIA).length;
  const aliveHumLike = alive.filter(c =>
    c.role === ROLE.CREWMATE ||
    c.role === ROLE.ENGINEER ||
    c.role === ROLE.DOCTOR ||
    c.role === ROLE.GUARDIAN ||
    c.role === ROLE.CREW
  ).length;

  const bugAlive = alive.some(c => c.role === ROLE.BUG);

  let winner = null;
  if (aliveG <= 0) winner = "human";
  else if (aliveHumLike <= 0) winner = "gnosia";

  // 버그 덮어쓰기
  if (winner && bugAlive) winner = "bug";

  if (winner) {
    state.phase = "ended";
    state.winner = winner;
    state.revealOnEnd = true;
  }

  return winner;
}

export function revealRolesText(state) {
  const lines = [];
  lines.push("=== 역할 공개 ===");
  for (const c of state.chars) {
    lines.push(`${c.name}: ${c.role}`);
  }
  return lines.join("\n");
}
