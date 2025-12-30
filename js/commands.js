// js/commands.js
// 커맨드 정의 + 조건 체크 + 실행 효과(신뢰/우호/어그로/특수상태) + 로그 생성(임시)

import {
  ROLE,
  clamp,
  round1,
  choice,
  weightedChoice,
  addLog,
  getChar,
  isAlive,
} from "./dataStructures.js";

import {
  relChangeTrust,
  relChangeLike,
  addHate,
  reduceHate,
} from "./relationship.js";

/**
 * 커맨드 설계 메모:
 * - "allowedCommands": 유저가 체크한 '사용 의지' 목록
 * - "조건": 스테이터스/상황(라운드 시작, 공격당함 등) + 일일 제한
 * - "효과": 관계도(발화자->대상, 타인->대상), 대상의 평판(여러 사람이 그 대상을 의심/옹호하도록 유도)
 *
 * 여기서는 기획서의 느낌을 최대한 살리되,
 * 복잡한 심리/AI는 gameLoop에서 "어떤 커맨드를 선택할지"로 다룸.
 * commands.js는 "선택된 커맨드가 실행되면 무슨 일이 일어나는지"만 책임짐.
 */

// ===== 로그 템플릿(임시) =====
function logLine(actor, cmdName, text = "") {
  // 예: 세츠:[의심한다] 지나는 수상해.
  return `${actor.name}:[${cmdName}] ${text}`.trim();
}

function tSuspicionText(actor, target) {
  // 임시: 우호/신뢰, 신뢰, 확률 중 아무거나
  const variants = [
    `${target.name}는 수상해.`,
    `${target.name}는 의심스러워.`,
    `${target.name}는 확률적으로 수상해.`,
  ];
  return choice(variants);
}

function tDefendText(actor, target) {
  const variants = [
    `${target.name}는 좋아.`,
    `${target.name}는 믿을 수 있어.`,
    `${target.name}는 확률적으로 안전해.`,
  ];
  return choice(variants);
}

function tAgreeText(actor, target) {
  return `${target.name} 말에 동의해.`;
}

function tGeneric(actor, target, msg) {
  return target ? `${target.name} ${msg}` : msg;
}

// ===== 조건 타입 =====
export const CMD_CONTEXT = Object.freeze({
  ROUND_START: "round_start",      // 낮 턴 시작(의심/감싼다 등)
  AFTER_SUSPECT: "after_suspect",  // 의심한다/동의 후
  AFTER_DEFEND: "after_defend",    // 변호/가담 후
  WHEN_ATTACKED: "when_attacked",  // 공격받은 직후(부정, 슬퍼, 얼버무, 반격 등)
  AFTER_PROPOSE_VOTE: "after_vote",// 투표해라/하지마라 이후 반론 등
  ANY: "any",
});

// ===== 커맨드 정의 =====
// 조건(최소 스탯) + 일일 제한(있으면 dailyFlagKey) + 컨텍스트
// 실제 사용가능 여부는 ui에서:
// 1) 유저 체크(allowedCommands)에 있어야 함
// 2) stat 조건 충족
// 3) 상황(context) 충족
// 4) 일일 제한 충족
export const COMMANDS = [
  {
    id: "suspect",
    name: "의심한다",
    context: [CMD_CONTEXT.ROUND_START],
    req: {},
  },
  {
    id: "agree_suspect",
    name: "의심에 동의한다",
    context: [CMD_CONTEXT.AFTER_SUSPECT],
    req: {},
  },
  {
    id: "deny",
    name: "부정한다",
    context: [CMD_CONTEXT.WHEN_ATTACKED],
    req: {},
  },
  {
    id: "defend",
    name: "변호한다",
    context: [CMD_CONTEXT.AFTER_SUSPECT, CMD_CONTEXT.WHEN_ATTACKED],
    req: {},
  },
  {
    id: "join_defend",
    name: "변호에 가담한다",
    context: [CMD_CONTEXT.AFTER_DEFEND],
    req: {},
  },
  {
    id: "cover",
    name: "감싼다",
    context: [CMD_CONTEXT.ROUND_START],
    req: {},
  },
  {
    id: "join_cover",
    name: "함께 감싼다",
    context: [CMD_CONTEXT.AFTER_DEFEND],
    req: {},
  },
  {
    id: "thanks",
    name: "감사한다",
    context: [CMD_CONTEXT.AFTER_DEFEND, CMD_CONTEXT.WHEN_ATTACKED], // 실제론 "감싸진 직후/인간확정 직후"
    req: {},
  },
  {
    id: "counter_arg",
    name: "반론한다",
    context: [CMD_CONTEXT.AFTER_PROPOSE_VOTE, CMD_CONTEXT.AFTER_DEFEND],
    req: {},
  },
  {
    id: "join_counter_arg",
    name: "반론에 가담한다",
    context: [CMD_CONTEXT.AFTER_PROPOSE_VOTE],
    req: {},
  },
  {
    id: "too_loud",
    name: "시끄러워",
    context: [CMD_CONTEXT.AFTER_SUSPECT, CMD_CONTEXT.AFTER_DEFEND],
    req: {}, // 조건은 상황(상대가 말많음)으로 gameLoop에서 걸러줌
  },
  {
    id: "claim_role",
    name: "역할을 밝힌다",
    context: [CMD_CONTEXT.ROUND_START],
    req: {},
    dailyFlagKey: "claim_role",
  },
  {
    id: "claim_role_too",
    name: "자신도 밝힌다",
    context: [CMD_CONTEXT.AFTER_SUSPECT, CMD_CONTEXT.AFTER_DEFEND],
    req: {},
    dailyFlagKey: "claim_role_too",
  },
  {
    id: "demand_claim",
    name: "역할을 밝혀라",
    context: [CMD_CONTEXT.ROUND_START],
    req: { charisma: 10 },
    dailyFlagKey: "demand_claim",
  },
  {
    id: "exaggerate",
    name: "과장해서 말한다",
    context: [CMD_CONTEXT.AFTER_SUSPECT, CMD_CONTEXT.AFTER_DEFEND],
    req: { acting: 15 },
  },
  {
    id: "ask_agree",
    name: "동의를 구한다",
    context: [CMD_CONTEXT.AFTER_SUSPECT, CMD_CONTEXT.AFTER_DEFEND],
    req: { charisma: 25 },
  },
  {
    id: "block_counter",
    name: "반론을 막는다",
    context: [CMD_CONTEXT.AFTER_SUSPECT, CMD_CONTEXT.AFTER_DEFEND],
    req: { charisma: 40 },
  },
  {
    id: "evade",
    name: "얼버무린다",
    context: [CMD_CONTEXT.WHEN_ATTACKED],
    req: { stealth: 25 },
  },
  {
    id: "counter_attack",
    name: "반격한다",
    context: [CMD_CONTEXT.WHEN_ATTACKED],
    req: { logic: 25, acting: 25 },
  },
  {
    id: "request_help",
    name: "도움을 요청한다",
    context: [CMD_CONTEXT.WHEN_ATTACKED],
    req: { acting: 30 },
  },
  {
    id: "sad",
    name: "슬퍼한다",
    context: [CMD_CONTEXT.WHEN_ATTACKED],
    req: { charm: 25 },
  },
  {
    id: "dont_fall_for_it",
    name: "속지마라",
    context: [CMD_CONTEXT.WHEN_ATTACKED],
    req: { intuition: 30 },
    dailyFlagKey: "dont_fall_for_it",
  },
  {
    id: "vote_him",
    name: "투표해라",
    context: [CMD_CONTEXT.ROUND_START],
    req: { logic: 10 },
    dailyFlagKey: "vote_him",
  },
  {
    id: "dont_vote",
    name: "투표하지 마라",
    context: [CMD_CONTEXT.ROUND_START],
    req: { logic: 15 },
    dailyFlagKey: "dont_vote",
  },
  {
    id: "sure_human",
    name: "반드시 인간이다",
    context: [CMD_CONTEXT.ROUND_START],
    req: { logic: 20 },
    dailyFlagKey: "sure_human",
  },
  {
    id: "sure_enemy",
    name: "반드시 적이다",
    context: [CMD_CONTEXT.ROUND_START],
    req: { logic: 20 },
    dailyFlagKey: "sure_enemy",
  },
  {
    id: "all_exile",
    name: "전원 배제해라",
    context: [CMD_CONTEXT.ROUND_START],
    req: { logic: 30 },
    dailyFlagKey: "all_exile",
  },
  {
    id: "smalltalk",
    name: "잡담한다",
    context: [CMD_CONTEXT.ROUND_START],
    req: { stealth: 10 },
    dailyFlagKey: "smalltalk",
  },
  {
    id: "cooperate",
    name: "협력하자",
    context: [CMD_CONTEXT.ROUND_START],
    req: { charm: 15 },
    dailyFlagKey: "cooperate",
  },
  {
    id: "say_human",
    name: "인간이라고 말해",
    context: [CMD_CONTEXT.ROUND_START],
    req: { intuition: 20 },
    dailyFlagKey: "say_human",
  },
  {
    id: "dogeza",
    name: "도게자한다",
    context: [CMD_CONTEXT.ANY], // 실제론 투표로 콜드슬립 대상 되었을 때
    req: { stealth: 35 }, // 기획서엔 stealth 35
    dailyFlagKey: "dogeza",
  },
];

// 빠른 검색
const CMD_BY_ID = new Map(COMMANDS.map(c => [c.id, c]));

// ===== 공통 조건 체크 =====
export function listAllCommands() {
  return COMMANDS.map(c => ({ id: c.id, name: c.name, req: c.req }));
}

export function getCommandDef(cmdId) {
  return CMD_BY_ID.get(cmdId) || null;
}

export function statMeetsReq(ch, req) {
  for (const [k, v] of Object.entries(req || {})) {
    if ((ch.stats?.[k] ?? 0) < v) return false;
  }
  return true;
}

export function canUseCommand(state, actorId, cmdId, ctx) {
  const actor = getChar(state, actorId);
  if (!actor || !actor.alive) return { ok: false, reason: "dead" };

  const def = getCommandDef(cmdId);
  if (!def) return { ok: false, reason: "unknown" };

  // 유저 체크(allowedCommands)에 있어야 함
  if (!actor.allowedCommands?.has(cmdId)) return { ok: false, reason: "not_allowed_by_user" };

  // 스탯 조건
  if (!statMeetsReq(actor, def.req)) return { ok: false, reason: "stat" };

  // 컨텍스트
  if (def.context && !def.context.includes(CMD_CONTEXT.ANY) && ctx) {
    if (!def.context.includes(ctx)) return { ok: false, reason: "context" };
  }

  // 일일 제한
  if (def.dailyFlagKey) {
    if (actor.dailyFlags?.[def.dailyFlagKey]) return { ok: false, reason: "daily_limit" };
  }

  return { ok: true, reason: "ok" };
}

function markDaily(actor, def) {
  if (!def.dailyFlagKey) return;
  actor.dailyFlags ??= {};
  actor.dailyFlags[def.dailyFlagKey] = true;
}

// ===== 효과 스케일링(간단 모델) =====
// 논리력: trust 공격/회복
// 연기력: like 공격/회복
// 카리스마: 동조 유도(연쇄)
// 귀염성: 방어/감사/슬퍼 효과 증폭
// 스텔스: 어그로 증가 감소
function powerTrust(actor, base = 1) {
  return base * (0.6 + (actor.stats.logic / 50) * 1.4);
}
function powerLike(actor, base = 1) {
  return base * (0.6 + (actor.stats.acting / 50) * 1.4);
}
function chainPower(actor, base = 1) {
  return base * (0.5 + (actor.stats.charisma / 50) * 1.5);
}
function stealthFactor(actor) {
  // 스텔스 높을수록 어그로 쌓임 감소
  const s = clamp(actor.stats.stealth, 0, 50);
  return 1.0 - (s / 50) * 0.6; // 최대 60% 감소
}
function charmShield(actor) {
  const c = clamp(actor.stats.charm, 0, 50);
  return 1.0 - (c / 50) * 0.5; // 피해 50%까지 감소
}

// ===== 동조(연쇄) 모델 =====
// gameLoop에서 "누가 동조할지"를 결정해도 되지만,
// 여기서는 간단히: 카리스마 기반으로 0~2명 정도 자동 동조를 생성할 수 있게 지원.
// (원하면 gameLoop가 이 자동 동조를 끄고 직접 제어 가능)
export function pickAutoFollowers(state, actorId, targetId, maxFollowers = 2) {
  const actor = getChar(state, actorId);
  if (!actor) return [];

  const alive = state.chars.filter(c => c.alive && c.id !== actorId && c.id !== targetId);
  if (alive.length === 0) return [];

  const desire = chainPower(actor, 1.0); // 0.5~2.0 정도
  const count =
    desire < 0.9 ? 0 :
    desire < 1.3 ? 1 :
    desire < 1.8 ? 2 : 2;

  const realCount = Math.min(count, maxFollowers, alive.length);
  if (realCount <= 0) return [];

  // 가중치: actor를 좋아하고(target을 싫어하면) 더 동조
  const items = alive.map(c => {
    const likeA = state.relations.like[c.id]?.[actorId] ?? 0;
    const likeT = targetId ? (state.relations.like[c.id]?.[targetId] ?? 0) : 0;
    const trustA = state.relations.trust[c.id]?.[actorId] ?? 0;
    const w = 1 + likeA * 0.08 + trustA * 0.06 - likeT * 0.05;
    return { item: c.id, w };
  });

  const res = [];
  const pool = [...items];
  for (let i = 0; i < realCount; i++) {
    const pick = weightedChoice(pool);
    if (!pick) break;
    res.push(pick);
    const idx = pool.findIndex(x => x.item === pick);
    if (idx >= 0) pool.splice(idx, 1);
  }
  return res;
}

// ===== 커맨드 실행 =====
// executeCommand(state, {actorId, cmdId, targetId, ctx, meta})
// meta는 gameLoop에서 필요한 추가정보 전달 가능(예: 공격자/방어자/투표대상 등)
export function executeCommand(state, payload) {
  const { actorId, cmdId, targetId, ctx, meta } = payload;

  const actor = getChar(state, actorId);
  const def = getCommandDef(cmdId);
  const target = targetId ? getChar(state, targetId) : null;

  if (!actor || !actor.alive || !def) return false;
  if (targetId && (!target || !target.alive)) return false;

  // 조건 확인(최종 안전)
  const ok = canUseCommand(state, actorId, cmdId, ctx);
  if (!ok.ok) return false;

  // 일일 제한 마킹
  markDaily(actor, def);

  actor.lastTarget = targetId ?? null;
  actor.lastCommand = cmdId;

  // 커맨드별 처리
  switch (cmdId) {
    case "suspect": {
      // 대상 신뢰/우호 하락, 어그로 증가(스텔스로 완화), 동조자 유도(카리스마)
      const dt = powerTrust(actor, 6);
      const dl = powerLike(actor, 5);

      relChangeTrust(state, actor.id, target.id, -dt);
      relChangeLike(state, actor.id, target.id, -dl);

      // 말한 만큼 어그로
      addHate(actor, 6 * stealthFactor(actor));

      addLog(state, logLine(actor, def.name, tSuspicionText(actor, target)));
      return true;
    }

    case "agree_suspect": {
      const dt = powerTrust(actor, 3.2);
      const dl = powerLike(actor, 2.6);

      relChangeTrust(state, actor.id, target.id, -dt);
      relChangeLike(state, actor.id, target.id, -dl);

      addHate(actor, 3 * stealthFactor(actor));

      addLog(state, logLine(actor, def.name, tAgreeText(actor, target)));
      return true;
    }

    case "deny": {
      // 공격당했을 때 자신을 방어: 공격자에 대한 관계 악화/자기 평판 회복 효과는 gameLoop에서
      // 여기서는 "다른 사람들이 나를 덜 의심"하도록 하는 효과를 관계에 반영(타인->나 trust/like 약간 상승)
      const alive = state.chars.filter(c => c.alive && c.id !== actor.id);
      for (const o of alive) {
        const upT = powerTrust(actor, 1.4) * charmShield(actor);
        const upL = powerLike(actor, 1.1) * charmShield(actor);
        relChangeTrust(state, o.id, actor.id, +upT);
        relChangeLike(state, o.id, actor.id, +upL);
      }
      addHate(actor, 2.5 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, "난 아니야."));
      return true;
    }

    case "defend": {
      // 대상 신뢰/우호 상승 + 동조 유도
      const dt = powerTrust(actor, 5.5);
      const dl = powerLike(actor, 4.8);

      relChangeTrust(state, actor.id, target.id, +dt);
      relChangeLike(state, actor.id, target.id, +dl);

      addHate(actor, 5.5 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, tDefendText(actor, target)));
      return true;
    }

    case "join_defend": {
      const dt = powerTrust(actor, 2.8);
      const dl = powerLike(actor, 2.4);

      relChangeTrust(state, actor.id, target.id, +dt);
      relChangeLike(state, actor.id, target.id, +dl);

      addHate(actor, 3.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, tAgreeText(actor, target)));
      return true;
    }

    case "cover": {
      // 감싼다: defend보다 약간 더 우호/신뢰 회복 + 동조 유도
      const dt = powerTrust(actor, 6.2);
      const dl = powerLike(actor, 5.5);

      relChangeTrust(state, actor.id, target.id, +dt);
      relChangeLike(state, actor.id, target.id, +dl);

      addHate(actor, 5.8 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name} 편이야.`));
      return true;
    }

    case "join_cover": {
      const dt = powerTrust(actor, 3.0);
      const dl = powerLike(actor, 2.8);

      relChangeTrust(state, actor.id, target.id, +dt);
      relChangeLike(state, actor.id, target.id, +dl);

      addHate(actor, 3.2 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, tAgreeText(actor, target)));
      return true;
    }

    case "thanks": {
      // 감사: 어그로 감소 + 감사 대상(타겟)에 대한 호감 상승
      const down = 6.0 * (0.6 + (actor.stats.charm / 50) * 0.8);
      reduceHate(actor, down);

      if (target) {
        relChangeLike(state, actor.id, target.id, +powerLike(actor, 3.5));
        relChangeTrust(state, actor.id, target.id, +powerTrust(actor, 2.0));
      }

      addLog(state, logLine(actor, def.name, target ? `${target.name}, 고마워.` : "고마워."));
      return true;
    }

    case "counter_arg": {
      // 반론: target을 공격(신뢰/우호 하락) + 동조 유도
      const dt = powerTrust(actor, 4.8);
      const dl = powerLike(actor, 4.2);

      relChangeTrust(state, actor.id, target.id, -dt);
      relChangeLike(state, actor.id, target.id, -dl);

      addHate(actor, 5.5 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name} 말은 이상해.`));
      return true;
    }

    case "join_counter_arg": {
      const dt = powerTrust(actor, 2.4);
      const dl = powerLike(actor, 2.0);

      relChangeTrust(state, actor.id, target.id, -dt);
      relChangeLike(state, actor.id, target.id, -dl);

      addHate(actor, 3.2 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, tAgreeText(actor, target)));
      return true;
    }

    case "too_loud": {
      // 시끄러워: 상대 어그로 증가 + 상대 신뢰 약간 하락
      addHate(target, 5.0);
      relChangeTrust(state, actor.id, target.id, -powerTrust(actor, 2.0));
      addHate(actor, 2.2 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name}, 말이 너무 많아.`));
      return true;
    }

    case "claim_role": {
      // 커밍아웃/사칭: meta.claimRole required
      const claim = meta?.claimRole || actor.claimedRole || actor.role;
      actor.claimedRole = claim;

      addHate(actor, 4.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `(${claim}라고 선언한다.)`));
      return true;
    }

    case "claim_role_too": {
      const claim = meta?.claimRole || actor.claimedRole || actor.role;
      actor.claimedRole = claim;

      addHate(actor, 3.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `나도 ${claim}야.`));
      return true;
    }

    case "demand_claim": {
      // 확률적으로 누군가 커밍아웃 유도: 실제 대상 선택/실행은 gameLoop에서
      addHate(actor, 4.5 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, "역할을 밝혀."));
      return true;
    }

    case "exaggerate": {
      // 과장: 직전 발언이 동의/의심/옹호 계열일 때, 우호 쪽 위력 강화(기획서)
      // 여기서는 "대상에 대한 like 변화량을 추가로 부스트"로 구현
      if (!target) return false;
      const boost = powerLike(actor, 2.8);
      // 과장은 대체로 "연기력 기반"이므로 like에 추가 영향
      relChangeLike(state, actor.id, target.id, (meta?.direction === "plus") ? +boost : -boost);

      addHate(actor, 2.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, "좀 더 강하게 말한다."));
      return true;
    }

    case "ask_agree": {
      // 동의 구함: 동조자 더 많이 유도(실제 모집은 gameLoop에서)
      addHate(actor, 4.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, "다들 동의해줘."));
      return true;
    }

    case "block_counter": {
      // 반론 봉쇄: meta.blockTargetId(=target) 대상으로 "이번 논의에서 반론 불가" 플래그 부여
      // 효과는 gameLoop에서 적용, 여기서는 상태만 표시
      state._blockCounter ??= {};
      state._blockCounter[target.id] = true;

      addHate(actor, 10.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name} 편들지 마.`));
      return true;
    }

    case "evade": {
      // 얼버무림: 즉시 논의 종료(메타로 처리), 어그로는 적당히 + 방어
      addHate(actor, 2.5 * stealthFactor(actor));
      // 방어: 타인의 trust/like 하락을 약간 완화
      const alive = state.chars.filter(c => c.alive && c.id !== actor.id);
      for (const o of alive) {
        relChangeTrust(state, o.id, actor.id, +powerTrust(actor, 0.6));
        relChangeLike(state, o.id, actor.id, +powerLike(actor, 0.4));
      }
      addLog(state, logLine(actor, def.name, "딴소리로 넘어간다."));
      return true;
    }

    case "counter_attack": {
      // 반격: 공격자(=target)의 trust/like를 공격. 자신은 회복 없음.
      const dt = powerTrust(actor, 5.2);
      const dl = powerLike(actor, 4.8);

      relChangeTrust(state, actor.id, target.id, -dt);
      relChangeLike(state, actor.id, target.id, -dl);

      addHate(actor, 6.5 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name}가 더 수상해.`));
      return true;
    }

    case "request_help": {
      // 도움 요청: target에게 나를 변호해달라 요청. 성공 여부는 gameLoop에서.
      addHate(actor, 3.5 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name}, 나 좀 도와주지 않을래?`));
      // 상태 저장
      state._helpRequest ??= {};
      state._helpRequest[actor.id] = target.id;
      return true;
    }

    case "sad": {
      // 슬퍼: 타인의 동정 유발 -> 타인->나 trust/like 상승(귀염성 기반)
      const alive = state.chars.filter(c => c.alive && c.id !== actor.id);
      const scale = 1.0 + (actor.stats.charm / 50) * 1.2;

      for (const o of alive) {
        relChangeTrust(state, o.id, actor.id, +powerTrust(actor, 1.0) * scale);
        relChangeLike(state, o.id, actor.id, +powerLike(actor, 1.0) * scale);
      }
      reduceHate(actor, 4.0 * scale);

      addLog(state, logLine(actor, def.name, "상처받았어..."));
      return true;
    }

    case "dont_fall_for_it": {
      // 속지마라: 타겟이 거짓말이면(혹은 의심되는 경우) 타인의 직감 판정 확률 상승 상태 부여
      state._dontFallForIt ??= {};
      state._dontFallForIt[target.id] = {
        by: actor.id,
        untilDay: state.day, // 다음날 보고 끝날 때까지는 gameLoop에서 처리
      };
      addHate(actor, 4.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name} 에게, 속지 마.`));
      return true;
    }

    case "vote_him": {
      // 투표해라: meta.voteTargetId를 올리는 형태. 여기서는 target을 투표 추천 대상으로
      state._voteSuggest ??= {};
      state._voteSuggest[target.id] = (state._voteSuggest[target.id] || 0) + (1.0 + actor.stats.logic / 50);

      addHate(actor, 4.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name}에게 투표해.`));
      return true;
    }

    case "dont_vote": {
      state._dontVote ??= {};
      state._dontVote[target.id] = (state._dontVote[target.id] || 0) + (1.0 + actor.stats.logic / 50);

      addHate(actor, 3.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name}는 빼자.`));
      return true;
    }

    case "sure_human": {
      // 인간 확정: target은 이후 논의 공격 대상으로 제외(상태)
      state._sureHuman ??= new Set();
      state._sureHuman.add(target.id);

      // 지목자->대상 호감 상승
      relChangeLike(state, actor.id, target.id, +powerLike(actor, 2.5));
      addHate(actor, 4.0 * stealthFactor(actor));

      addLog(state, logLine(actor, def.name, `${target.name}는 인간이야.`));
      return true;
    }

    case "sure_enemy": {
      // 적 확정: target은 논의 행동 불가 상태
      state._sureEnemy ??= new Set();
      state._sureEnemy.add(target.id);

      addHate(actor, 6.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name}는 적이야.`));
      return true;
    }

    case "all_exile": {
      // 전원 배제해라: meta.roleKey(ENGINEER/DOCTOR 등) 필요
      const roleKey = meta?.roleKey;
      if (!roleKey) {
        addLog(state, logLine(actor, def.name, "전원 배제 제안."));
        return true;
      }
      state._allExileRole ??= {};
      state._allExileRole[roleKey] = {
        by: actor.id,
        day: state.day,
      };
      addHate(actor, 7.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${roleKey} 전원 배제하자.`));
      return true;
    }

    case "smalltalk": {
      // 잡담: 어그로 감소 + 참가자들과 우호 상승
      reduceHate(actor, 6.5 * (0.6 + actor.stats.stealth / 50));

      // 참가자 1~3명
      const alive = state.chars.filter(c => c.alive && c.id !== actor.id);
      const n = Math.min(alive.length, 1 + Math.floor(Math.random() * 3));
      const picked = [];
      const pool = [...alive];
      for (let i = 0; i < n; i++) {
        const p = choice(pool);
        picked.push(p);
        pool.splice(pool.indexOf(p), 1);
      }
      for (const p of picked) {
        relChangeLike(state, actor.id, p.id, +powerLike(actor, 2.0));
        relChangeLike(state, p.id, actor.id, +powerLike(p, 1.5));
      }

      addLog(state, logLine(actor, def.name, "잡담을 했다."));
      return true;
    }

    case "cooperate": {
      // 협력: coop 없는 상태에서 대상에게 제안. 수락 여부는 gameLoop.
      state._coopRequest ??= {};
      state._coopRequest[actor.id] = target.id;

      addHate(actor, 2.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, `${target.name}, 협력하자.`));
      return true;
    }

    case "say_human": {
      // 인간이라고 말해: 모두에게 "나는 인간" 발언 유도.
      // 실제 개인별 말/침묵/끊기 판정은 gameLoop에서.
      state._sayHuman ??= { by: actor.id, day: state.day };

      addHate(actor, 5.0 * stealthFactor(actor));
      addLog(state, logLine(actor, def.name, "다들 '나는 인간'이라고 말해."));
      return true;
    }

    case "dogeza": {
      // 도게자: 투표로 콜드슬립 대상 되었을 때 발동.
      // 성공 확률은 연기력 기반인데, 기획서에는 (연기력)이라 되어 있음.
      // 여기서는 '연기력'을 사용.
      const p = clamp(0.15 + (actor.stats.acting / 50) * 0.5, 0.15, 0.65);
      state._dogeza ??= {};
      state._dogeza[actor.id] = { p, day: state.day };
      addLog(state, logLine(actor, def.name, "살려줘..."));
      return true;
    }

    default:
      addLog(state, logLine(actor, def.name, tGeneric(actor, target, "행동")));
      addHate(actor, 2.0 * stealthFactor(actor));
      return true;
  }
}

// ===== UI용: 스테이터스 기반 “선택 가능 커맨드” 판정 =====
// (주의) 유저가 성향상 사용하지 않을 커맨드를 체크/해제할 수 있어야 하므로
// UI에서는: "조건 충족"인 커맨드만 체크박스를 보여주되,
//          기본 체크 여부는 유저 마음.
//          조건을 충족하지 못하면 체크박스 자체를 disabled.
export function commandAvailabilityForCharacter(ch) {
  return COMMANDS.map(def => {
    const meets = statMeetsReq(ch, def.req);
    return {
      id: def.id,
      name: def.name,
      meetsStat: meets,
      req: def.req,
    };
  });
}
