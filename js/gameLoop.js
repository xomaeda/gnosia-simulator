// js/gameLoop.js
// 게임 진행 엔진: 낮(5턴) / 밤(자유행동 1회 + 습격/역할 1회) / 투표 / 사망 처리 / 승리 처리

import {
  ROLE,
  clamp,
  choice,
  weightedChoice,
  addLog,
  aliveChars,
  getChar,
} from "./dataStructures.js";

import {
  relGetTrust,
  relGetLike,
  relChangeTrust,
  relChangeLike,
  addHate,
  reduceHate,
  logNightFreeAction,
} from "./relationship.js";

import {
  COMMANDS,
  CMD_CONTEXT,
  canUseCommand,
  executeCommand,
  pickAutoFollowers,
} from "./commands.js";

import {
  assignRoles,
  nightRoleActions,
  doctorReport,
  checkVictory,
  revealRolesText,
  canClaimRole,
} from "./roleSystem.js";

// =========================
// 공통 유틸
// =========================
function resetDailyState(state) {
  // 일일 제한 리셋 + 일시 상태 초기화
  for (const c of state.chars) {
    c.dailyFlags = {};
  }
  state._voteSuggest = {};
  state._dontVote = {};
  state._sureHuman = new Set();
  state._sureEnemy = new Set();
  state._allExileRole = {};
  state._helpRequest = {};
  state._blockCounter = {};
  state._dontFallForIt = {};
  state._sayHuman = null;
  state._coopRequest = {};
  state._dogeza = {};
}

function logSeparator(state) {
  addLog(state, "------------------------------");
}

// “말 많이 하는 성향” 가중치: (사회성/쾌활) - (스텔스) + (용기 약간)
function talkativeness(ch) {
  const p = ch.pers || {};
  const s = ch.stats || {};
  const base = 0.4 + (p.social ?? 0) * 0.4 + (p.cheer ?? 0) * 0.25 + (p.courage ?? 0) * 0.15;
  const stealth = (s.stealth ?? 0) / 50; // 0~1
  return clamp(base - stealth * 0.35, 0.05, 1.0);
}

// “논리 중심” vs “감정 중심”
function logicBias(ch) {
  return clamp(ch.pers?.logical ?? 0, 0, 1);
}

// “상냥함(옹호 성향)”
function kindness(ch) {
  return clamp(ch.pers?.kind ?? 0, 0, 1);
}

// “욕망(자기보호/배신 성향)”
function desire(ch) {
  return clamp(ch.pers?.desire ?? 0, 0, 1);
}

// “용기(사칭/커밍아웃 선호)”
function courage(ch) {
  return clamp(ch.pers?.courage ?? 0, 0, 1);
}

// =========================
// 게임 시작/전환 API
// =========================
export function startNewGame(state) {
  // 역할 배정 + 1일차 낮 시작
  const ok = assignRoles(state);
  if (!ok) return false;

  state.phase = "day";
  state.day = 1;
  state.dayTurn = 0;
  state.lastKilledId = null;
  state.lastColdSleepId = null;

  resetDailyState(state);

  logSeparator(state);
  addLog(state, `DAY ${state.day} 시작`);
  return true;
}

export function runOneStep(state) {
  if (state.phase === "ended") {
    addLog(state, "게임이 종료되었습니다.");
    return;
  }

  if (state.phase === "setup") {
    addLog(state, "먼저 게임을 시작하세요.");
    return;
  }

  if (state.phase === "day") {
    runDayTurn(state);
    return;
  }

  if (state.phase === "night_free") {
    runNightFree(state);
    return;
  }

  if (state.phase === "night_attack") {
    runNightAttack(state);
    return;
  }
}

// =========================
// 낮: 1클릭 = 1턴, 총 5턴
// =========================
function runDayTurn(state) {
  const alive = aliveChars(state);

  // 사망자가 있으면 혹시 승리조건 먼저 확인
  const winPre = checkVictory(state);
  if (winPre) {
    addLog(state, `승리: ${winPre}`);
    addLog(state, revealRolesText(state));
    return;
  }

  // 턴 증가
  state.dayTurn += 1;
  addLog(state, `(${state.day}일차 낮 - ${state.dayTurn}/5턴)`);

  // 1) 말할 사람 선택 (말수 성향 + 어그로 낮을수록 좀 더 말함)
  const speaker = pickSpeaker(state);
  if (!speaker) {
    addLog(state, "아무도 발언하지 않았다.");
  } else {
    runDiscussionForSpeaker(state, speaker);
  }

  // 2) 5턴 종료 후 투표(콜드슬립)
  if (state.dayTurn >= 5) {
    resolveVoting(state);

    // 투표 후 승리 확인
    const win = checkVictory(state);
    if (win) {
      addLog(state, `승리: ${win}`);
      addLog(state, revealRolesText(state));
      return;
    }

    // 3) 밤으로 전환
    state.phase = "night_free";
    state.dayTurn = 0;

    logSeparator(state);
    addLog(state, `NIGHT ${state.day} 시작 (1/2: 자유행동)`);
  }
}

function pickSpeaker(state) {
  const alive = aliveChars(state).filter(c => !state._sureEnemy?.has(c.id));
  if (alive.length === 0) return null;

  const items = alive.map(c => {
    const t = talkativeness(c);
    // 어그로가 너무 높으면 말수 줄이는 경향(기획서: 말 많으면 의심/습격↑)
    const hatePenalty = 1.0 - (c.hate / 100) * 0.45;
    return { item: c, w: Math.max(0.05, t * hatePenalty) };
  });

  return weightedChoice(items);
}

function runDiscussionForSpeaker(state, speaker) {
  // 스피커가 어떤 행동(커맨드)을 고를지 결정
  const action = decideDayAction(state, speaker);
  if (!action) {
    // 침묵은 “커맨드”로 넣지 않기로 했으니 그냥 로그만
    addLog(state, `${speaker.name}는 잠자코 있었다.`);
    // 말 안 하면 어그로 아주 조금 감소(스텔스 느낌)
    reduceHate(speaker, 1.5);
    return;
  }

  // 실행
  const { cmdId, targetId, ctx, meta } = action;
  const ok = executeCommand(state, { actorId: speaker.id, cmdId, targetId, ctx, meta });
  if (!ok) {
    addLog(state, `${speaker.name}는 말하려다 말았다.`);
    return;
  }

  // 기본적으로 발언하면 어그로가 조금 추가로 쌓인다(“여러 커맨드 연속 사용 가능” 느낌)
  addHate(speaker, 1.2);

  // “동조(연쇄)” 자동 생성(카리스마 기반)
  // - 의심/변호/감싼다/반론 계열만 자동 동조시키자
  const mainIsChainable = new Set(["suspect", "defend", "cover", "counter_arg"]);
  if (mainIsChainable.has(cmdId) && targetId) {
    const followers = pickAutoFollowers(state, speaker.id, targetId, 2);
    for (const fid of followers) {
      const f = getChar(state, fid);
      if (!f || !f.alive) continue;

      // 동조 커맨드(상황에 따라 선택)
      let followCmd = null;
      let followCtx = null;

      if (cmdId === "suspect") {
        followCmd = "agree_suspect";
        followCtx = CMD_CONTEXT.AFTER_SUSPECT;
      } else if (cmdId === "defend" || cmdId === "cover") {
        followCmd = "join_defend";
        followCtx = CMD_CONTEXT.AFTER_DEFEND;
      } else if (cmdId === "counter_arg") {
        followCmd = "join_counter_arg";
        followCtx = CMD_CONTEXT.AFTER_PROPOSE_VOTE;
      }

      if (followCmd) {
        // follower는 “유저 체크 + 스탯 조건”을 만족해야 실제 사용
        const can = canUseCommand(state, fid, followCmd, followCtx);
        if (can.ok) executeCommand(state, { actorId: fid, cmdId: followCmd, targetId, ctx: followCtx });
      }
    }
  }

  // 공격받은 대상(=targetId)이 “방어 커맨드”로 반응할지
  if (targetId) {
    const target = getChar(state, targetId);
    if (target && target.alive && !state._sureEnemy?.has(target.id)) {
      maybeDefensiveReaction(state, target, speaker);
    }
  }
}

function decideDayAction(state, actor) {
  // 가능한 후보 목록 만들기:
  // - 유저 체크 + 스탯 조건 충족
  // - 컨텍스트는 대부분 ROUND_START로 처리(턴 시작에서 발화)
  const ctx = CMD_CONTEXT.ROUND_START;

  const alive = aliveChars(state).filter(c => c.id !== actor.id);
  if (alive.length === 0) return null;

  // “확정 인간”은 공격 대상으로 배제, “확정 적”은 공격 대상으로 유리
  const pickSuspectTarget = () => {
    const candidates = alive.filter(c => !state._sureHuman?.has(c.id));
    const items = candidates.map(t => {
      const like = relGetLike(state, actor.id, t.id);
      const trust = relGetTrust(state, actor.id, t.id);

      // 논리성향 높으면 trust 중심, 감정이면 like 중심
      const lb = logicBias(actor);
      const score = (1 - lb) * (-like) + lb * (-trust) + (t.hate * 0.5);
      // 확정 적이면 더 높게
      const bonus = state._sureEnemy?.has(t.id) ? 50 : 0;
      return { item: t, w: Math.max(0.05, score + 60 + bonus) };
    });
    return weightedChoice(items);
  };

  const pickDefendTarget = () => {
    const candidates = alive.filter(c => !state._sureEnemy?.has(c.id));
    const items = candidates.map(t => {
      const like = relGetLike(state, actor.id, t.id);
      const trust = relGetTrust(state, actor.id, t.id);
      const lb = logicBias(actor);
      const score = (1 - lb) * (like) + lb * (trust) - (t.hate * 0.2);
      return { item: t, w: Math.max(0.05, score + 60) };
    });
    return weightedChoice(items);
  };

  // 성향에 따른 “대략적” 선택:
  // - 상냥함↑ : 감싼다/변호한다 확률↑
  // - 논리성향↑ : 의심한다/투표 관련↑
  // - 용기↑ : 역할 밝힌다 확률↑
  // - 욕망↑ : 자기에게 불리한(나를 싫어하는) 상대를 공격↑
  const k = kindness(actor);
  const lb = logicBias(actor);
  const co = courage(actor);
  const ds = desire(actor);

  // 후보 커맨드 가중치
  const plan = [];

  // 의심한다
  if (canUseCommand(state, actor.id, "suspect", ctx).ok) {
    plan.push({ id: "suspect", w: 1.2 + lb * 1.1 + ds * 0.6 });
  }
  // 감싼다/변호한다
  if (canUseCommand(state, actor.id, "cover", ctx).ok) {
    plan.push({ id: "cover", w: 0.9 + k * 1.4 + (1 - lb) * 0.4 });
  }
  if (canUseCommand(state, actor.id, "defend", ctx).ok) {
    plan.push({ id: "defend", w: 0.7 + k * 1.1 });
  }

  // 역할 밝힌다(용기↑일수록)
  if (canUseCommand(state, actor.id, "claim_role", ctx).ok) {
    // 수호천사는 못함 / 사칭 제한 적용
    const will = 0.15 + co * 0.8;
    plan.push({ id: "claim_role", w: will });
  }

  // 투표해라/하지마라: 논리 성향이 높을수록 가중치
  if (canUseCommand(state, actor.id, "vote_him", ctx).ok) {
    plan.push({ id: "vote_him", w: 0.25 + lb * 0.9 });
  }
  if (canUseCommand(state, actor.id, "dont_vote", ctx).ok) {
    plan.push({ id: "dont_vote", w: 0.12 + lb * 0.5 });
  }

  // 반드시 인간/적: 논리성향↑일수록 사용하려는 경향(다만 확정 정보가 없으면 거의 안 씀)
  if (canUseCommand(state, actor.id, "sure_human", ctx).ok) {
    plan.push({ id: "sure_human", w: 0.05 + lb * 0.2 });
  }
  if (canUseCommand(state, actor.id, "sure_enemy", ctx).ok) {
    plan.push({ id: "sure_enemy", w: 0.05 + lb * 0.2 });
  }

  // 잡담/협력: 사회성/쾌활↑이면 가끔
  if (canUseCommand(state, actor.id, "smalltalk", ctx).ok) {
    plan.push({ id: "smalltalk", w: 0.08 + (actor.pers.social ?? 0) * 0.25 });
  }
  if (canUseCommand(state, actor.id, "cooperate", ctx).ok && !actor.coop) {
    plan.push({ id: "cooperate", w: 0.06 + (actor.pers.social ?? 0) * 0.15 });
  }

  // 인간이라고 말해: 직감 기반, 하지만 리스크 큰 커맨드라 아주 낮게
  if (canUseCommand(state, actor.id, "say_human", ctx).ok) {
    plan.push({ id: "say_human", w: 0.03 + (actor.stats.intuition / 50) * 0.05 });
  }

  if (plan.length === 0) return null;

  const picked = weightedChoice(plan.map(x => ({ item: x.id, w: x.w })));
  if (!picked) return null;

  // 타겟이 필요한 커맨드면 결정
  if (picked === "suspect") {
    const t = pickSuspectTarget();
    if (!t) return null;
    return { cmdId: "suspect", targetId: t.id, ctx };
  }

  if (picked === "cover" || picked === "defend") {
    const t = pickDefendTarget();
    if (!t) return null;
    return { cmdId: picked, targetId: t.id, ctx };
  }

  if (picked === "vote_him") {
    // 투표 추천 대상: 의심 타겟 쪽
    const t = pickSuspectTarget();
    if (!t) return null;
    return { cmdId: "vote_him", targetId: t.id, ctx };
  }

  if (picked === "dont_vote") {
    // 투표 제외 대상: 좋아하는 사람 쪽
    const t = pickDefendTarget();
    if (!t) return null;
    return { cmdId: "dont_vote", targetId: t.id, ctx };
  }

  if (picked === "sure_human") {
    // “인간 확정” 정보가 실제로는 없지만, 논리성향 높은 캐릭터는 가끔 선언(오판 가능)
    const t = pickDefendTarget();
    if (!t) return null;
    return { cmdId: "sure_human", targetId: t.id, ctx };
  }

  if (picked === "sure_enemy") {
    const t = pickSuspectTarget();
    if (!t) return null;
    return { cmdId: "sure_enemy", targetId: t.id, ctx };
  }

  if (picked === "claim_role") {
    // 실제 역할 또는 사칭 역할 선택: 용기/욕망이 높으면 사칭도 더 자주
    const claim = pickClaimRole(state, actor);
    if (!claim) return null;
    return { cmdId: "claim_role", targetId: null, ctx, meta: { claimRole: claim } };
  }

  if (picked === "smalltalk") {
    return { cmdId: "smalltalk", targetId: null, ctx };
  }

  if (picked === "cooperate") {
    // 좋아하는 대상에게 협력 제안
    const t = pickDefendTarget();
    if (!t) return null;
    return { cmdId: "cooperate", targetId: t.id, ctx };
  }

  if (picked === "say_human") {
    return { cmdId: "say_human", targetId: null, ctx };
  }

  return null;
}

function pickClaimRole(state, actor) {
  // 수호천사는 절대 못함
  if (actor.role === ROLE.GUARDIAN) return null;

  // 후보: ENGINEER / DOCTOR (사칭 가능), CREW는 진짜만, GUARDIAN 불가
  const candidates = [ROLE.ENGINEER, ROLE.DOCTOR, ROLE.CREWMATE];
  if (actor.role === ROLE.CREW) candidates.push(ROLE.CREW);

  // 실제로 존재하지 않는 역할은 사칭해도 의미가 적으니 가중치를 낮춤
  const exist = new Set(aliveChars(state).map(c => c.role));

  const items = candidates.map(r => {
    if (!canClaimRole(actor, r)) return { item: r, w: 0 };
    let w = 1.0;

    // 용기/욕망 높을수록 사칭도 빈도↑
    const co = courage(actor);
    const ds = desire(actor);

    if (r === actor.role) w += 0.8 + co * 0.6;
    else w += (co * 0.4 + ds * 0.2);

    // 실제로 없는 역할이면 가중치↓
    if (r !== ROLE.CREWMATE && !exist.has(r)) w *= 0.35;

    return { item: r, w };
  });

  return weightedChoice(items);
}

// 대상이 공격당했을 때 반응(부정/얼버무/반격/슬퍼/도움요청)
function maybeDefensiveReaction(state, target, attacker) {
  // 공격인지(=의심/반론 등) 여부는 단순히 관계 하락 유도 커맨드만 체크
  // 여기서는 “대상이 방어 행동을 할지 말지”만 결정
  const prob = clamp(0.25 + (target.hate / 100) * 0.25 + desire(target) * 0.25, 0.1, 0.75);
  if (Math.random() > prob) return;

  // 후보 방어 커맨드
  const options = [];
  if (canUseCommand(state, target.id, "deny", CMD_CONTEXT.WHEN_ATTACKED).ok) options.push({ id: "deny", w: 1.0 });
  if (canUseCommand(state, target.id, "evade", CMD_CONTEXT.WHEN_ATTACKED).ok) options.push({ id: "evade", w: 0.55 });
  if (canUseCommand(state, target.id, "counter_attack", CMD_CONTEXT.WHEN_ATTACKED).ok) options.push({ id: "counter_attack", w: 0.5 });
  if (canUseCommand(state, target.id, "sad", CMD_CONTEXT.WHEN_ATTACKED).ok) options.push({ id: "sad", w: 0.6 });
  if (canUseCommand(state, target.id, "request_help", CMD_CONTEXT.WHEN_ATTACKED).ok) options.push({ id: "request_help", w: 0.45 });

  if (options.length === 0) return;

  const picked = weightedChoice(options.map(o => ({ item: o.id, w: o.w })));
  if (!picked) return;

  // request_help는 누굴 선택할지 필요
  if (picked === "request_help") {
    const helper = pickHelpTarget(state, target, attacker);
    if (!helper) return;
    executeCommand(state, { actorId: target.id, cmdId: "request_help", targetId: helper.id, ctx: CMD_CONTEXT.WHEN_ATTACKED });
    // 도움 요청 성공/실패는 night/day 로직보다 “즉시 변호”로 약식 처리(성향 기반)
    maybeAutoDefendByHelper(state, helper, target);
    return;
  }

  // counter_attack은 attacker가 target
  if (picked === "counter_attack") {
    executeCommand(state, { actorId: target.id, cmdId: "counter_attack", targetId: attacker.id, ctx: CMD_CONTEXT.WHEN_ATTACKED });
    return;
  }

  executeCommand(state, { actorId: target.id, cmdId: picked, targetId: null, ctx: CMD_CONTEXT.WHEN_ATTACKED });
}

function pickHelpTarget(state, target, attacker) {
  const alive = aliveChars(state).filter(c => c.id !== target.id && c.id !== attacker.id);
  if (alive.length === 0) return null;
  const items = alive.map(c => {
    const like = relGetLike(state, target.id, c.id);
    const trust = relGetTrust(state, target.id, c.id);
    const w = 1 + like * 0.08 + trust * 0.06;
    return { item: c, w: Math.max(0.05, w) };
  });
  return weightedChoice(items);
}

function maybeAutoDefendByHelper(state, helper, target) {
  // 도움 요청을 받았을 때, 우호/협력/성향으로 변호 여부 결정
  const like = relGetLike(state, helper.id, target.id);
  const trust = relGetTrust(state, helper.id, target.id);
  const coopBonus = (helper.coop === target.id || target.coop === helper.id) ? 0.25 : 0.0;

  const p = clamp(0.15 + (like / 100) * 0.35 + (trust / 100) * 0.25 + kindness(helper) * 0.25 + coopBonus, 0.05, 0.85);
  if (Math.random() > p) return;

  if (canUseCommand(state, helper.id, "defend", CMD_CONTEXT.WHEN_ATTACKED).ok) {
    executeCommand(state, { actorId: helper.id, cmdId: "defend", targetId: target.id, ctx: CMD_CONTEXT.WHEN_ATTACKED });
  }
}

// =========================
// 투표(콜드슬립)
// =========================
function resolveVoting(state) {
  addLog(state, "=== 투표(콜드슬립) ===");

  const alive = aliveChars(state);
  const candidates = alive.filter(c => !state._sureHuman?.has(c.id)); // 확정 인간은 원칙상 제외

  if (candidates.length === 0) {
    addLog(state, "투표할 대상이 없다.");
    // 밤으로 넘어가도 되지만, 일단 아무 변화 없이
    return;
  }

  // 각 후보의 “투표 점수” 계산:
  // - 타인들이 그 후보를 얼마나 불신하는지(평균 trust 낮음)
  // - 후보 어그로(hate)
  // - 투표해라/하지마라 영향
  // - 반드시 적이다 처리된 경우 강한 가중
  const scores = new Map();
  for (const t of candidates) {
    let s = 0;

    // 불신(타인->t trust 평균)
    let sum = 0;
    let cnt = 0;
    for (const o of alive) {
      if (o.id === t.id) continue;
      sum += relGetTrust(state, o.id, t.id);
      cnt += 1;
    }
    const avgTrust = cnt ? sum / cnt : 0;
    s += (-avgTrust) * 0.8;

    // 어그로
    s += t.hate * 0.9;

    // 투표 추천/비추천
    s += (state._voteSuggest?.[t.id] || 0) * 18;
    s -= (state._dontVote?.[t.id] || 0) * 12;

    // 확정 적 보정
    if (state._sureEnemy?.has(t.id)) s += 80;

    scores.set(t.id, s);
  }

  // 1등 후보 선택(동점이면 랜덤)
  let best = null;
  let bestScore = -Infinity;
  for (const [id, sc] of scores.entries()) {
    if (sc > bestScore) {
      bestScore = sc;
      best = id;
    }
  }
  let target = getChar(state, best);

  // 도게자(투표 당선 직후 회피)
  if (target && target.alive) {
    // 도게자 사용 가능하면 확률적으로 사용
    if (canUseCommand(state, target.id, "dogeza", CMD_CONTEXT.ANY).ok) {
      // 도게자 실행(내부에 확률 저장)
      executeCommand(state, { actorId: target.id, cmdId: "dogeza", targetId: null, ctx: CMD_CONTEXT.ANY });

      const p = state._dogeza?.[target.id]?.p ?? 0;
      if (Math.random() < p) {
        addLog(state, `${target.name}는 도게자로 콜드슬립을 피했습니다.`);
        // 2등 후보로 넘어가기: 현재 후보 제외 후 다시 선택
        const rest = [...candidates].filter(c => c.id !== target.id);
        if (rest.length > 0) {
          // 재계산 없이 점수순 다음을 고른다
          let next = null;
          let nextScore = -Infinity;
          for (const c of rest) {
            const sc = scores.get(c.id);
            if (sc > nextScore) {
              nextScore = sc;
              next = c.id;
            }
          }
          target = getChar(state, next);
        } else {
          target = null;
        }
      }
    }
  }

  if (!target) {
    addLog(state, "콜드슬립 대상이 정해지지 않았다.");
    return;
  }

  // 콜드슬립 처리
  target.alive = false;
  state.lastColdSleepId = target.id;
  addLog(state, `${target.name}가 콜드슬립 되었습니다.`);

  // 닥터 보고(낮 종료 직후가 아니라, “다음날 시작 시”가 더 자연스럽지만)
  // 여기서는 “즉시 기록”도 남기고, 다음날 시작에서도 한 번 더 호출해도 됨.
}

// =========================
// 밤 1단계: 자유행동
// =========================
function runNightFree(state) {
  const alive = aliveChars(state);

  // 자유행동: 0~1명과 시간을 보냄(랜덤이지만 관계/성향 반영)
  // 너무 복잡하게 하지 않고:
  // - 사회성/쾌활↑ : 같이 보낼 확률↑
  // - 혼자 보낼 경우: 어그로 조금 감소
  for (const a of alive) {
    const pTogether = clamp(0.2 + (a.pers.social ?? 0) * 0.5 + (a.pers.cheer ?? 0) * 0.2, 0.1, 0.9);
    if (Math.random() > pTogether || alive.length < 2) {
      logNightFreeAction(state, a, null);
      reduceHate(a, 2.0 + (a.stats.stealth / 50) * 2.5);
      continue;
    }

    const partners = alive.filter(b => b.id !== a.id);
    const items = partners.map(b => {
      const like = relGetLike(state, a.id, b.id);
      const trust = relGetTrust(state, a.id, b.id);
      const lb = logicBias(a);
      const w = 1 + (1 - lb) * (like + 50) * 0.02 + lb * (trust + 50) * 0.015;
      return { item: b, w: Math.max(0.05, w) };
    });

    const b = weightedChoice(items);
    if (!b) {
      logNightFreeAction(state, a, null);
      continue;
    }

    logNightFreeAction(state, a, b);

    // 우호 상승(양방향), 약간의 신뢰도 상승
    relChangeLike(state, a.id, b.id, +4);
    relChangeLike(state, b.id, a.id, +4);
    relChangeTrust(state, a.id, b.id, +2);
    relChangeTrust(state, b.id, a.id, +2);
  }

  // 밤 2단계로
  state.phase = "night_attack";
  addLog(state, `NIGHT ${state.day} (2/2: 습격/역할 집행)`);
}

// =========================
// 밤 2단계: 역할 집행 + 습격 결과 요약(네 규칙은 roleSystem에서 처리됨)
// =========================
function runNightAttack(state) {
  const alive = aliveChars(state);

  // 역할 집행 대상 선정(간단 AI)
  const plan = {
    guardianProtectId: null,
    engineerScanId: null,
    gnosiaAttackId: null,
  };

  // 수호천사 보호 대상: 좋아/신뢰 높은 사람(자기 제외)
  const guardian = alive.find(c => c.role === ROLE.GUARDIAN) || null;
  if (guardian) {
    const candidates = alive.filter(c => c.id !== guardian.id);
    if (candidates.length > 0) {
      const items = candidates.map(t => {
        const like = relGetLike(state, guardian.id, t.id);
        const trust = relGetTrust(state, guardian.id, t.id);
        const w = 1 + (like + 50) * 0.02 + (trust + 50) * 0.015;
        return { item: t, w: Math.max(0.05, w) };
      });
      const t = weightedChoice(items);
      plan.guardianProtectId = t?.id ?? null;
    }
  }

  // 엔지니어 조사 대상: “의심되는 사람”(trust 낮거나 hate 높거나)
  const engineer = alive.find(c => c.role === ROLE.ENGINEER) || null;
  if (engineer) {
    const candidates = alive.filter(c => c.id !== engineer.id);
    if (candidates.length > 0) {
      const items = candidates.map(t => {
        const trust = relGetTrust(state, engineer.id, t.id);
        const like = relGetLike(state, engineer.id, t.id);
        const w = 1 + (-trust) * 0.03 + (-like) * 0.01 + (t.hate * 0.03);
        return { item: t, w: Math.max(0.05, w) };
      });
      const t = weightedChoice(items);
      plan.engineerScanId = t?.id ?? null;
    }
  }

  // 그노시아 습격 대상: “그노시아들이 싫어/불신/눈에 띄는” 인간
  const gnosias = alive.filter(c => c.role === ROLE.GNOSIA);
  if (gnosias.length > 0) {
    const candidates = alive.filter(c => c.role !== ROLE.GNOSIA); // 그노시아 제외
    if (candidates.length > 0) {
      const items = candidates.map(v => {
        // 여러 그노시아의 평균 감정/판단
        let score = 0;
        for (const g of gnosias) {
          const like = relGetLike(state, g.id, v.id);
          const trust = relGetTrust(state, g.id, v.id);

          // 싫어함/불신 + 어그로(눈에 띔)
          score += (-like) * 0.05 + (-trust) * 0.04 + (v.hate * 0.08);

          // 욕망(자기보호)이 큰 그노시아일수록 “나를 의심하는 사람”을 더 치는 경향:
          // 대략: v가 g를 얼마나 싫어/불신하는지(=v->g 관계 역방향)
          const vToG = (-relGetTrust(state, v.id, g.id)) * 0.03 + (-relGetLike(state, v.id, g.id)) * 0.02;
          score += vToG * (0.5 + desire(g));
        }

        // 후보가 “확정 인간”이면 굳이 위험 감수할 필요가 없음(하지만 그노시아는 정보가 없으니 큰 패널티는 X)
        if (state._sureHuman?.has(v.id)) score *= 0.9;

        return { item: v, w: Math.max(0.05, score + 5) };
      });

      const victim = weightedChoice(items);
      plan.gnosiaAttackId = victim?.id ?? null;
    }
  }

  // 역할 집행 + 습격 결과(요약 규칙은 roleSystem에서 이미 반영됨)
  nightRoleActions(state, plan);

  // 승리 판정
  const win = checkVictory(state);
  if (win) {
    addLog(state, `승리: ${win}`);
    addLog(state, revealRolesText(state));
    return;
  }

  // 다음날로
  state.day += 1;
  state.phase = "day";
  state.dayTurn = 0;

  resetDailyState(state);

  logSeparator(state);
  addLog(state, `DAY ${state.day} 시작`);

  // 닥터 보고는 “새 날 시작”에 자연스럽게 출력
  doctorReport(state);
}
