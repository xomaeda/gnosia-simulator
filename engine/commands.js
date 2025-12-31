// engine/commands.js
// A-모드(완성형)용 커맨드 정의 파일
// - 모든 커맨드의: 사용 조건(스탯/상황/연쇄), 효과(신뢰/우호/어그로/플래그), 연쇄 구조를 정의한다.
// - 실제 수치 적용(관계도 행렬 반영)과 AI 선택은 game.js / relations.js / ai.js에서 처리한다.
//
// 설계 철학:
// - commands.js는 "무엇이 가능한가/무슨 효과가 발생하는가"를 정의만 한다.
// - 실제 적용은 game가 effects를 받아 relations/state에 반영한다.
//
// 용어:
// - trust: 신뢰도 (A가 B를 믿는 정도) 0~100 권장
// - favor: 우호도 (A가 B를 좋아하는 정도) 0~100 권장
// - aggro: 어그로 (타인이 나를 투표/습격 대상으로 올릴 가능성) 0~100 권장
//
// 턴(=한 세션) 연쇄:
// - 한 턴은 root(루트 커맨드) 1개로 시작
// - 이후 follow(부속) / reaction(반응) / meta(중단/찬반 등)로 이어질 수 있음
// - 1캐릭터 1턴 1회 발언(Q3 반영)
//
// game는 TurnContext를 유지하며, commands의 canUse/nextAllowedIds를 이용해 흐름을 제어한다.

export const COMMAND_ID = {
  // 루트(턴 시작 트리거)
  SUSPECT: "suspect",                 // 의심한다
  DEFEND: "defend",                   // 감싼다(옹호)
  REQUEST_CO: "request_co",           // 역할을 밝혀라
  ASK_HUMAN: "ask_human",             // 인간이라고 말해
  SMALLTALK: "smalltalk",             // 잡담한다
  VOTE_FOR: "vote_for",               // 투표해라
  VOTE_NOT: "vote_not",               // 투표하지 마라
  EXCLUDE_ALL: "exclude_all",         // 전원 배제해라

  // 부속(루트 뒤)
  AGREE_SUSPECT: "agree_suspect",     // 의심에 동의한다
  AGREE_DEFEND: "agree_defend",       // 함께 감싼다
  JOIN_DEFEND: "join_defend",         // 변호에 가담한다
  JOIN_REBUT: "join_rebut",           // 반론에 가담한다
  ASK_AGREE: "ask_agree",             // 동의를 구한다
  EMPHASIZE: "emphasize",             // 과장해서 말한다
  BLOCK_REBUT: "block_rebut",         // 반론을 막는다

  // 반응(타겟/상대가 응수)
  DENY: "deny",                       // 부정한다
  REBUT: "rebut",                     // 반론한다
  COUNTER: "counter",                 // 반격한다
  EVADE: "evade",                     // 얼버무린다
  ASK_HELP: "ask_help",               // 도움을 요청한다
  SAD: "sad",                         // 슬퍼한다
  DONT_FOOL: "dont_fool",             // 속지마라
  THANK: "thank",                     // 감사한다
  LOUD: "loud",                       // 시끄러워
  DO_GE_ZA: "dogeza",                 // 도게자한다 (투표 결과 후)

  // 공개/CO 연쇄
  CO_ROLE: "co_role",                 // 역할을 밝힌다
  CO_ME_TOO: "co_me_too",             // 자신도 밝힌다
  CO_NONE: "co_none",                 // 아무도 밝히지 않는다(숨김용)

  // 확정 선언
  CERT_HUMAN: "cert_human",           // 반드시 인간이다
  CERT_ENEMY: "cert_enemy",           // 반드시 적이다

  // 협력 (낮이 아닌 밤 자유행동에서 사용되는 "제안"은 별도 nightActions에 있음)
  COOPERATE: "cooperate",             // 협력하자 (낮 커맨드: 1일 1회, 협력중 아닐 때)

  // 숨김용 meta (UI에 노출 X)
  META_AGREE: "_meta_agree",
  META_DISAGREE: "_meta_disagree",
  META_STOP: "_meta_stop",
  META_DECLARE_HUMAN: "_meta_declare_human",
  META_REFUSE_DECLARE: "_meta_refuse_declare",
  META_STOP_DECLARE: "_meta_stop_declare",
  META_JOIN_SMALLTALK: "_meta_join_smalltalk",
  META_STOP_SMALLTALK: "_meta_stop_smalltalk",
};

// 커맨드 카테고리
const TYPE = {
  ROOT: "root",
  FOLLOW: "follow",
  REACT: "react",
  META: "meta",
  RESOLVE: "resolve",
};

// 공통: 스탯 조건
function statAtLeast(actor, key, v) {
  return (actor?.stats?.[key] ?? 0) >= v;
}

// 공통: 하루/루프 제한 체크는 game가 하도록, 여기서는 "키"만 제공
function dayLimitKey(actorId, commandId) {
  return `${actorId}:${commandId}`;
}

// 공통: 효과 계산(기본식)
// - 실제 밸런스는 추후 조정 가능하지만, "완성형"으로 일관되게 동작하도록 설계
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// 공격(의심/반론 등): 논리=trust dmg, 연기=favor dmg, 카리스마=동조 유도
function calcAttackBase(actor) {
  const logic = actor.stats.logic ?? 0;
  const acting = actor.stats.acting ?? 0;
  const charisma = actor.stats.charisma ?? 0;
  // 기본 데미지: 0~50 스탯이므로 0~ 대략 12~20 정도 나오게 스케일
  const trust = (logic / 50) * 16;
  const favor = (acting / 50) * 16;
  const chain = (charisma / 50) * 0.35; // 동조 확률 보정(0~0.35)
  return { trust, favor, chain };
}

// 방어(귀염성): 피해 감소율
function calcDefenseRate(target) {
  const charm = target.stats.charm ?? 0;
  // 0 -> 0%, 50 -> 45% 정도 피해 감소
  return clamp((charm / 50) * 0.45, 0, 0.45);
}

// 어그로: 발언/강한 커맨드일수록 증가. 스텔스로 완화.
function calcAggroDelta(actor, base) {
  const stealth = actor.stats.stealth ?? 0;
  const reduce = clamp((stealth / 50) * 0.55, 0, 0.55); // 최대 55% 완화
  return base * (1 - reduce);
}

// 거짓말 관련: acting(연기력)이 높을수록 들킬 확률 감소. intuition(직감)이 높을수록 탐지 확률 증가.
// 실제 판정은 roles.js/ai.js에서 하고, commands는 "노출/탐지 기회"만 만들 수 있음.
function liarExposureWeight(actor) {
  const acting = actor.stats.acting ?? 0;
  // 연기 높으면 노출 낮음
  return clamp(1.15 - (acting / 50) * 0.7, 0.35, 1.15);
}

function intuitionDetectWeight(observer) {
  const intu = observer.stats.intuition ?? 0;
  return clamp((intu / 50) * 1.0, 0, 1.0);
}

/**
 * Effect 구조:
 * game.js가 받아서 적용할 데이터
 *
 * effects = {
 *  rel: [
 *    { from, to, trustDelta, favorDelta, reason }
 *  ],
 *  aggro: [
 *    { who, delta, reason }
 *  ],
 *  flags: [
 *    { type, ...payload }
 *  ],
 *  turn: {
 *    // 턴 컨텍스트 변경 요청(반론 봉쇄, 루트 기록 등)
 *  },
 *  log: [
 *    { speaker, text, tag }
 *  ]
 * }
 */
function E() {
  return { rel: [], aggro: [], flags: [], turn: {}, log: [] };
}

// 로그는 최종적으로 game.js에서 "유저가 쓸 대사 패턴"으로 교체해도 되게 tag를 남긴다.
function pushLog(e, speaker, tag, text) {
  e.log.push({ speaker, tag, text });
}

// -------- TurnContext 접근 규약( game.js가 유지 ) --------
// ctx = {
//   phase: "day"|"night",
//   dayIndex: number,
//   stepInDay: 1..5,
//   root: { id, actorId, targetId, roleKey?, ... } | null,
//   chain: { actorIdsSpoken:Set, ended:boolean },
//   blockRebuttal: { active:boolean, byActorId?, againstActorId? } | null,
//   lastTargetId: number|null,
//   lastRootTargetId: number|null,
//   allow: Set<commandId> or null(=game가 계산),
//   // ... etc
// }

// canUse helpers
function alreadySpokeThisTurn(ctx, actorId) {
  return !!ctx?.chain?.actorIdsSpoken?.has(actorId);
}

function isTurnEnded(ctx) {
  return !!ctx?.chain?.ended;
}

function requireRoot(ctx, rootId) {
  return ctx?.root?.id === rootId;
}

// “반론 막기” 활성 중: 변호/반론/가담 등 ‘루트 주장에 반대되는 발언’을 차단
// - 실제로 무엇이 “반대”인지는 턴에서 root가 suspect냐 defend냐로 갈림
function rebuttalBlocked(ctx, candidateCommandId) {
  if (!ctx?.blockRebuttal?.active) return false;
  const rootId = ctx?.root?.id;
  // 의심 루트에서 "변호/감싸기" 계열이 반대
  if (rootId === COMMAND_ID.SUSPECT) {
    return (
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND ||
      candidateCommandId === COMMAND_ID.DEFEND
    );
  }
  // 감싼다 루트에서 "의심/반론" 계열이 반대
  if (rootId === COMMAND_ID.DEFEND) {
    return (
      candidateCommandId === COMMAND_ID.SUSPECT ||
      candidateCommandId === COMMAND_ID.REBUT ||
      candidateCommandId === COMMAND_ID.AGREE_SUSPECT ||
      candidateCommandId === COMMAND_ID.JOIN_REBUT
    );
  }
  return false;
}

// -------- Command Definitions --------
// command object fields:
// - id, name, type
// - statReq(actor, game, ctx) -> boolean
// - contextReq(game, ctx, actorId, targetId) -> boolean
// - target: "required"|"optional"|"none"
// - limitKey: (actorId, ctx)=>string|null  (1일1회/루프1회 등)
// - apply({game, ctx, actor, target, actorId, targetId, meta}) -> effects
// - nextAllowed: (ctx)=>commandId[]  (턴 내 다음에 허용될 후보 힌트; 최종 결정은 game가)
// - hidden: UI 미노출 여부
//
// ⚠️ 여기서는 "기획서대로" 조건을 최대한 반영.
//  - 단, “확률적으로 누가 동조/응수할지”는 ai.js가 결정한다.

export const COMMANDS = new Map();

/** 등록 헬퍼 */
function define(cmd) {
  COMMANDS.set(cmd.id, cmd);
  return cmd;
}

/** 공통: 루트 시작 */
function startTurnRoot(ctx, e, rootId, actorId, targetId, extra = {}) {
  e.turn.root = { id: rootId, actorId, targetId, ...extra };
  e.turn.chain = { markSpoken: actorId };
  e.turn.lastTargetId = targetId ?? null;
  e.turn.lastRootTargetId = targetId ?? null;
}

/** 공통: 발언 처리(1턴 1회) */
function markSpoken(e, actorId) {
  e.turn.chain = e.turn.chain || {};
  e.turn.chain.markSpoken = actorId;
}

/** 공통: 턴 종료 요청 */
function endTurn(e, reason = "no_more_speakers") {
  e.turn.chain = e.turn.chain || {};
  e.turn.chain.end = { reason };
}

// -------------------- 1) 의심한다 (ROOT) --------------------
define({
  id: COMMAND_ID.SUSPECT,
  name: "의심한다",
  type: TYPE.ROOT,
  target: "required",
  statReq: () => true,
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    // 라운드(턴) 시작에만 사용 가능: game가 stepInDay에서 강제
    return targetId != null;
  },
  limitKey: null,
  apply: ({ game, ctx, actor, target, actorId, targetId }) => {
    const e = E();
    startTurnRoot(ctx, e, COMMAND_ID.SUSPECT, actorId, targetId);

    const atk = calcAttackBase(actor);
    const def = calcDefenseRate(target);

    const trustDmg = atk.trust * (1 - def);
    const favorDmg = atk.favor * (1 - def);

    // target이 "모두에게" 의심 받는 효과는 game.js에서 여론(대상에 대한 공용 suspicion)으로 적용.
    // 여기서는 관계도 변화: 발언자 -> 타겟 (신뢰/우호 감소)
    e.rel.push({
      from: actorId,
      to: targetId,
      trustDelta: -trustDmg,
      favorDelta: -favorDmg,
      reason: "suspect_attack",
    });

    // 어그로 증가(발언자)
    e.aggro.push({
      who: actorId,
      delta: calcAggroDelta(actor, 7.5),
      reason: "suspect_spoke",
    });

    // 동조 유도 플래그(카리스마 기반)
    e.flags.push({
      type: "OPEN_SUPPORT_WINDOW",
      mode: "suspect",
      rootActorId: actorId,
      targetId,
      baseFollowChance: clamp(0.12 + atk.chain, 0.12, 0.47),
    });

    pushLog(e, actorId, "CMD_SUSPECT", `${actor.name}:[의심한다] ${target.name} (의심 발언)`);
    return e;
  },
  nextAllowed: (ctx) => [
    COMMAND_ID.ASK_AGREE,
    COMMAND_ID.EMPHASIZE,
    COMMAND_ID.BLOCK_REBUT,
    COMMAND_ID.AGREE_SUSPECT,
    COMMAND_ID.DENY,
    COMMAND_ID.DEFEND, // 변호는 "의심"에 대한 반대이므로 봉쇄 가능
    COMMAND_ID.REBUT,
    COMMAND_ID.COUNTER,
    COMMAND_ID.EVADE,
    COMMAND_ID.ASK_HELP,
    COMMAND_ID.SAD,
    COMMAND_ID.DONT_FOOL,
    COMMAND_ID.LOUD,
  ],
});

// -------------------- 2) 의심에 동의한다 (FOLLOW) --------------------
define({
  id: COMMAND_ID.AGREE_SUSPECT,
  name: "의심에 동의한다",
  type: TYPE.FOLLOW,
  target: "none", // 타겟은 루트 타겟을 따라감
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.SUSPECT)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    // 부정/변호 전(창구가 아직 열려있을 때) - game가 supportWindow로 관리
    return true;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    const targetId = ctx.root.targetId;
    const target = ctx.game?.actors?.[targetId]; // 안전: game.js에서 채워도 됨

    const atk = calcAttackBase(actor);
    // 동의는 약한 공격 + 어그로 덜
    const trustDmg = atk.trust * 0.55;
    const favorDmg = atk.favor * 0.55;

    e.flags.push({ type: "ADD_SUPPORTER", mode: "suspect", supporterId: actorId });

    e.rel.push({
      from: actorId,
      to: targetId,
      trustDelta: -trustDmg,
      favorDelta: -favorDmg,
      reason: "agree_suspect_attack",
    });

    e.aggro.push({
      who: actorId,
      delta: calcAggroDelta(actor, 3.2),
      reason: "agree_suspect_spoke",
    });

    pushLog(e, actorId, "CMD_AGREE_SUSPECT", `${actor.name}:[의심에 동의한다] (동의)`);
    return e;
  },
  nextAllowed: () => [],
});

// -------------------- 3) 부정한다 (REACT) --------------------
define({
  id: COMMAND_ID.DENY,
  name: "부정한다",
  type: TYPE.REACT,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.SUSPECT)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    // 자신이 의심 대상일 때만
    return ctx.root.targetId === actorId;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    const rootActorId = ctx.root.actorId;

    const atk = calcAttackBase(actor);
    // 부정: 자기 신뢰/우호 회복(“여론” 회복은 game.js가), 상대 신뢰 약간 감소
    e.rel.push({
      from: actorId,
      to: rootActorId,
      trustDelta: -(atk.trust * 0.25),
      favorDelta: -(atk.favor * 0.15),
      reason: "deny_counter_pressure",
    });

    // 자기 방어 회복 플래그(관계도 전체에 분산 회복은 game가 처리)
    e.flags.push({
      type: "DENY_DEFENSE",
      who: actorId,
      power: clamp(0.18 + (actor.stats.logic ?? 0) / 50 * 0.35, 0.18, 0.55),
    });

    // 부정은 어그로 약간 증가(말하니까)
    e.aggro.push({
      who: actorId,
      delta: calcAggroDelta(actor, 2.8),
      reason: "deny_spoke",
    });

    // 부정 이후엔 “동조 창구 닫힘” (더 이상 의심 동조 불가)
    e.flags.push({ type: "CLOSE_SUPPORT_WINDOW", mode: "suspect" });

    pushLog(e, actorId, "CMD_DENY", `${actor.name}:[부정한다] (반박)`);
    return e;
  },
});

// -------------------- 4) 변호한다 (FOLLOW/REACT 성격) --------------------
// 기획서상: 의심/의심동의/부정 직후 사용 가능. 여기선 "suspect 세션 중" + 루트 타겟 보호로 처리.
define({
  id: COMMAND_ID.DEFEND,
  name: "변호한다/감싼다",
  type: TYPE.FOLLOW,
  target: "none", // 루트 타겟
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;

    // 두 경우:
    // A) 루트가 의심(suspect)일 때: "변호"로 작동(반대 발언)
    // B) 루트가 감싼다(defend)일 때: "감싼다" 루트로 쓰는 건 별도 COMMAND_ID.DEFEND(root)로 분리해야 하나
    //    기획서에 '감싼다'가 루트. 여기서는 따로 ROOT로 정의(아래)하고, 이 DEFEND는 "변호"로 사용.
    if (requireRoot(ctx, COMMAND_ID.SUSPECT)) {
      // 반론 막기 중이면 차단됨(도움 요청 성공 시 해제됨)
      if (ctx.blockRebuttal?.active) return false;
      return true;
    }
    // 루트가 감싼다일 때 변호는 의미가 없으니 불가
    return false;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    const targetId = ctx.root.targetId;

    const atk = calcAttackBase(actor);
    // 변호는 회복: 논리로 신뢰 회복, 연기로 우호 회복
    const trustHeal = (atk.trust * 0.85);
    const favorHeal = (atk.favor * 0.85);

    e.rel.push({
      from: actorId,
      to: targetId,
      trustDelta: +trustHeal,
      favorDelta: +favorHeal,
      reason: "defend_heal",
    });

    // 변호는 동조 창구 열 수 있음(카리스마)
    e.flags.push({
      type: "OPEN_SUPPORT_WINDOW",
      mode: "defend",
      rootActorId: actorId,
      targetId,
      baseFollowChance: clamp(0.10 + (actor.stats.charisma ?? 0) / 50 * 0.33, 0.10, 0.43),
    });

    // 어그로: 변호도 말한 거라 증가(다만 의심보단 낮게)
    e.aggro.push({
      who: actorId,
      delta: calcAggroDelta(actor, 4.8),
      reason: "defend_spoke",
    });

    pushLog(e, actorId, "CMD_DEFEND", `${actor.name}:[변호한다] (옹호)`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.JOIN_DEFEND, COMMAND_ID.EMPHASIZE],
});

// -------------------- 5) 변호에 가담한다 (FOLLOW) --------------------
define({
  id: COMMAND_ID.JOIN_DEFEND,
  name: "변호에 가담한다",
  type: TYPE.FOLLOW,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!ctx?.flags?.supportWindow?.defendOpen) return true; // game 구현에 따라 달라질 수 있어 허용
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    // 직전이 변호였거나, defend 창구가 열렸을 때
    return true;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    const targetId = ctx.root.targetId;
    const atk = calcAttackBase(actor);

    e.rel.push({
      from: actorId,
      to: targetId,
      trustDelta: +(atk.trust * 0.55),
      favorDelta: +(atk.favor * 0.55),
      reason: "join_defend_heal",
    });

    e.aggro.push({
      who: actorId,
      delta: calcAggroDelta(actor, 2.6),
      reason: "join_defend_spoke",
    });

    pushLog(e, actorId, "CMD_JOIN_DEFEND", `${actor.name}:[변호에 가담한다] (동조-옹호)`);
    return e;
  },
});

// -------------------- 6) 감싼다 (ROOT) --------------------
define({
  id: COMMAND_ID.DEFEND + "_root",
  name: "감싼다",
  type: TYPE.ROOT,
  target: "required",
  statReq: () => true,
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return targetId != null;
  },
  limitKey: null,
  apply: ({ ctx, actor, target, actorId, targetId }) => {
    const e = E();
    startTurnRoot(ctx, e, COMMAND_ID.DEFEND, actorId, targetId);

    const atk = calcAttackBase(actor);

    // 감싼다: 대상 호감/신뢰 상승(논리/연기 기반)
    e.rel.push({
      from: actorId,
      to: targetId,
      trustDelta: +(atk.trust * 0.95),
      favorDelta: +(atk.favor * 0.95),
      reason: "cover_heal",
    });

    // 어그로(말했으니) + 스텔스 보정
    e.aggro.push({
      who: actorId,
      delta: calcAggroDelta(actor, 5.2),
      reason: "cover_spoke",
    });

    // 동조 창구(함께 감싼다) 열기
    e.flags.push({
      type: "OPEN_SUPPORT_WINDOW",
      mode: "cover",
      rootActorId: actorId,
      targetId,
      baseFollowChance: clamp(0.12 + (actor.stats.charisma ?? 0) / 50 * 0.28, 0.12, 0.40),
    });

    pushLog(e, actorId, "CMD_COVER", `${actor.name}:[감싼다] ${target.name} (옹호 발언)`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.AGREE_DEFEND, COMMAND_ID.REBUT, COMMAND_ID.BLOCK_REBUT, COMMAND_ID.EMPHASIZE],
});

// -------------------- 7) 함께 감싼다 (FOLLOW) --------------------
define({
  id: COMMAND_ID.AGREE_DEFEND,
  name: "함께 감싼다",
  type: TYPE.FOLLOW,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.DEFEND)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    const targetId = ctx.root.targetId;
    const atk = calcAttackBase(actor);

    e.rel.push({
      from: actorId,
      to: targetId,
      trustDelta: +(atk.trust * 0.55),
      favorDelta: +(atk.favor * 0.55),
      reason: "agree_cover_heal",
    });

    e.aggro.push({
      who: actorId,
      delta: calcAggroDelta(actor, 2.4),
      reason: "agree_cover_spoke",
    });

    pushLog(e, actorId, "CMD_AGREE_COVER", `${actor.name}:[함께 감싼다] (동조-옹호)`);
    return e;
  },
});

// -------------------- 8) 감사한다 (REACT) --------------------
define({
  id: COMMAND_ID.THANK,
  name: "감사한다",
  type: TYPE.REACT,
  target: "required", // 감싸준 사람(또는 반드시 인간이다 선언한 사람)
  statReq: () => true,
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return targetId != null;
  },
  apply: ({ actor, actorId, targetId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 감사: 내 어그로 낮추고(귀염성), 상대에게 호감 상승
    const charm = actor.stats.charm ?? 0;
    const aggroDown = clamp(2.5 + (charm / 50) * 7.0, 2.5, 9.5);

    e.aggro.push({ who: actorId, delta: -aggroDown, reason: "thank_aggro_down" });

    e.rel.push({
      from: actorId,
      to: targetId,
      trustDelta: +(1.5 + (charm / 50) * 5.0),
      favorDelta: +(3.5 + (charm / 50) * 7.0),
      reason: "thank_gratitude",
    });

    pushLog(e, actorId, "CMD_THANK", `${actor.name}:[감사한다] (답례)`);
    return e;
  },
});

// -------------------- 9) 반론한다 (REACT/FOLLOW) --------------------
define({
  id: COMMAND_ID.REBUT,
  name: "반론한다",
  type: TYPE.REACT,
  target: "none", // 보통 루트 타겟/루트 주장을 향함
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;

    // 감싼다 또는 투표해라/투표하지마라 이후 사용 가능(=그 주장에 반대)
    // 여기서는 root가 COVER/VOTE_FOR/VOTE_NOT/EXCLUDE_ALL 일 때 허용.
    const root = ctx.root?.id;
    if (!root) return false;
    if (root === COMMAND_ID.DEFEND || root === COMMAND_ID.VOTE_FOR || root === COMMAND_ID.VOTE_NOT || root === COMMAND_ID.EXCLUDE_ALL) {
      // 봉쇄 중이면 차단
      if (ctx.blockRebuttal?.active) return false;
      return true;
    }
    return false;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 반론의 대상은 "루트 주장자"에게 압력 + 루트 타겟에게도 압력(상황별)
    const rootActorId = ctx.root.actorId;
    const rootTargetId = ctx.root.targetId;

    const atk = calcAttackBase(actor);

    // 반론: 주장자 신뢰 하락, (커버 루트라면) 타겟에 대한 신뢰/우호도도 하락
    e.rel.push({
      from: actorId,
      to: rootActorId,
      trustDelta: -(atk.trust * 0.55),
      favorDelta: -(atk.favor * 0.25),
      reason: "rebut_pressure_root_actor",
    });

    if (ctx.root.id === COMMAND_ID.DEFEND && rootTargetId != null) {
      e.rel.push({
        from: actorId,
        to: rootTargetId,
        trustDelta: -(atk.trust * 0.45),
        favorDelta: -(atk.favor * 0.45),
        reason: "rebut_attack_root_target",
      });
    }

    e.aggro.push({
      who: actorId,
      delta: calcAggroDelta(actor, 5.8),
      reason: "rebut_spoke",
    });

    // 반론 동조 창구 열기(반론에 가담)
    e.flags.push({
      type: "OPEN_SUPPORT_WINDOW",
      mode: "rebut",
      rootActorId: actorId,
      targetId: rootTargetId,
      baseFollowChance: clamp(0.10 + (actor.stats.charisma ?? 0) / 50 * 0.30, 0.10, 0.40),
    });

    pushLog(e, actorId, "CMD_REBUT", `${actor.name}:[반론한다] (반박)`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.JOIN_REBUT, COMMAND_ID.EMPHASIZE],
});

// -------------------- 10) 반론에 가담한다 (FOLLOW) --------------------
define({
  id: COMMAND_ID.JOIN_REBUT,
  name: "반론에 가담한다",
  type: TYPE.FOLLOW,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.DEFEND) && ctx.root?.id !== COMMAND_ID.VOTE_FOR && ctx.root?.id !== COMMAND_ID.VOTE_NOT && ctx.root?.id !== COMMAND_ID.EXCLUDE_ALL) {
      // 원칙상 rebut 이후이므로, game가 window로 제어. 여기선 완화.
    }
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    const rootActorId = ctx.root.actorId;
    const atk = calcAttackBase(actor);

    e.rel.push({
      from: actorId,
      to: rootActorId,
      trustDelta: -(atk.trust * 0.35),
      favorDelta: -(atk.favor * 0.15),
      reason: "join_rebut_pressure",
    });

    e.aggro.push({
      who: actorId,
      delta: calcAggroDelta(actor, 2.9),
      reason: "join_rebut_spoke",
    });

    pushLog(e, actorId, "CMD_JOIN_REBUT", `${actor.name}:[반론에 가담한다] (동조-반박)`);
    return e;
  },
});

// -------------------- 11) 시끄러워 (REACT) --------------------
define({
  id: COMMAND_ID.LOUD,
  name: "시끄러워",
  type: TYPE.REACT,
  target: "required", // 말 많은 사람
  statReq: () => true,
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return targetId != null;
  },
  apply: ({ actor, actorId, targetId }) => {
    const e = E();
    markSpoken(e, actorId);

    const atk = calcAttackBase(actor);
    e.rel.push({
      from: actorId,
      to: targetId,
      trustDelta: -(atk.trust * 0.25),
      favorDelta: -(atk.favor * 0.25),
      reason: "loud_attack",
    });

    // 대상 어그로 상승(말 많음 지적)
    e.aggro.push({ who: targetId, delta: 3.8, reason: "loud_target_aggro" });

    pushLog(e, actorId, "CMD_LOUD", `${actor.name}:[시끄러워] (비난)`);
    return e;
  },
});

// -------------------- 12) 역할을 밝힌다 / 자신도 밝힌다 / 역할을 밝혀라 --------------------

// 역할을 밝혀라 (ROOT, 하루 1회/역할별 1회는 game가 관리)
define({
  id: COMMAND_ID.REQUEST_CO,
  name: "역할을 밝혀라",
  type: TYPE.ROOT,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "charisma", 10),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  // "같은 역할에 대해선 하루 1회"는 game.js가 request_co:roleKey 로 제한
  limitKey: (actorId, ctx) => dayLimitKey(actorId, COMMAND_ID.REQUEST_CO),
  apply: ({ ctx, actor, actorId, meta }) => {
    const e = E();
    // meta.roleKey: 요청하는 역할(엔지니어/닥터/선내대기인 등)
    const roleKey = meta?.roleKey || "engineer";

    startTurnRoot(ctx, e, COMMAND_ID.REQUEST_CO, actorId, null, { roleKey });

    // 어그로 증가(강한 압박)
    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 6.0), reason: "request_co_spoke" });

    // CO 요청 플래그(누가 어떤 roleKey로 요청했는지)
    e.flags.push({
      type: "OPEN_CO_WINDOW",
      roleKey,
      requestedBy: actorId,
      // 카리스마가 높을수록 사람들이 CO할 확률이 오름(실제 선택은 ai.js)
      pressure: clamp(0.18 + (actor.stats.charisma ?? 0) / 50 * 0.55, 0.18, 0.73),
    });

    pushLog(e, actorId, "CMD_REQUEST_CO", `${actor.name}:[역할을 밝혀라] (${roleKey})`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.CO_ROLE, COMMAND_ID.CO_ME_TOO, COMMAND_ID.CO_NONE],
});

// 역할을 밝힌다 (FOLLOW) - 요청된 roleKey에 대해 "정말 그 역할이거나, 거짓말 가능한 역할(엔지/닥터/AC 등)"만 가능
define({
  id: COMMAND_ID.CO_ROLE,
  name: "역할을 밝힌다",
  type: TYPE.FOLLOW,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.REQUEST_CO)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true; // 실제 가능 여부(그 역할/사칭 가능)는 roles.js에서 판정, 여기선 플래그만 발생
  },
  apply: ({ ctx, actor, actorId, meta }) => {
    const e = E();
    markSpoken(e, actorId);

    const roleKey = ctx.root.roleKey;
    // meta.claimRoleKey가 있으면 그걸 우선, 없으면 요청 roleKey로
    const claimRoleKey = meta?.claimRoleKey || roleKey;

    e.flags.push({
      type: "ROLE_CLAIM",
      who: actorId,
      claimRoleKey,
      // 거짓말 노출 가중치(연기력 기반)
      lieExposure: liarExposureWeight(actor),
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 4.2), reason: "co_role_spoke" });

    pushLog(e, actorId, "CMD_CO_ROLE", `${actor.name}:[역할을 밝힌다] (${claimRoleKey})`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.CO_ME_TOO],
});

// 자신도 밝힌다 (FOLLOW) - “역할을 밝힌다” 직후, 같은 체인에서
define({
  id: COMMAND_ID.CO_ME_TOO,
  name: "자신도 밝힌다",
  type: TYPE.FOLLOW,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.REQUEST_CO)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ ctx, actor, actorId, meta }) => {
    const e = E();
    markSpoken(e, actorId);

    const claimRoleKey = meta?.claimRoleKey || ctx.root.roleKey;

    e.flags.push({
      type: "ROLE_CLAIM",
      who: actorId,
      claimRoleKey,
      lieExposure: liarExposureWeight(actor),
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 4.0), reason: "co_me_too_spoke" });
    pushLog(e, actorId, "CMD_CO_ME_TOO", `${actor.name}:[자신도 밝힌다] (${claimRoleKey})`);
    return e;
  },
});

// 아무도 밝히지 않는다(숨김용)
define({
  id: COMMAND_ID.CO_NONE,
  name: "아무도 밝히지 않는다",
  type: TYPE.META,
  hidden: true,
  target: "none",
  statReq: () => true,
  contextReq: () => true,
  apply: ({ actorId }) => {
    const e = E();
    markSpoken(e, actorId);
    pushLog(e, actorId, "CMD_CO_NONE", `(아무도 커밍아웃하지 않았다)`);
    endTurn(e, "co_none");
    return e;
  },
});

// -------------------- 13) 역할을 밝힌다(기본) --------------------
// 기획서의 "역할을 밝힌다" 단독 커맨드는 CO 체인 외에도 가능(자칭/거짓말 가능한 역할)
// 여기서는 CO 연쇄가 아닐 때 사용 가능한 별도 커맨드로 제공.
define({
  id: "co_role_free",
  name: "역할을 밝힌다(자칭)",
  type: TYPE.ROOT,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  limitKey: (actorId, ctx) => dayLimitKey(actorId, "co_role_free"),
  apply: ({ ctx, actor, actorId, meta }) => {
    const e = E();
    const claimRoleKey = meta?.claimRoleKey || "engineer";
    startTurnRoot(ctx, e, "co_role_free", actorId, null, { claimRoleKey });

    e.flags.push({
      type: "ROLE_CLAIM",
      who: actorId,
      claimRoleKey,
      lieExposure: liarExposureWeight(actor),
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 4.6), reason: "co_free_spoke" });
    pushLog(e, actorId, "CMD_CO_FREE", `${actor.name}:[역할을 밝힌다] (${claimRoleKey})`);
    return e;
  },
});

// -------------------- 14) 역할을 밝혀라의 “요청 roleKey에 따른 제한” 힌트 --------------------
// (실제 판정은 roles.js에서: claim 가능 여부/선내대기인 사칭 불가 등)
// 여기서는 힌트용으로 플래그만.
// game.js가 claim을 처리할 때 roles.canClaim(roleKey, actorRole, config)를 호출할 예정.

// -------------------- 15) 과장해서 말한다 (FOLLOW) --------------------
define({
  id: COMMAND_ID.EMPHASIZE,
  name: "과장해서 말한다",
  type: TYPE.FOLLOW,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "acting", 15),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    // 동조 가능한 발언 뒤: suspect/defend/rebut 등
    return !!ctx.root;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 강조: favor(연기) 쪽 효과를 증폭, 어그로 추가
    e.flags.push({
      type: "AMPLIFY_LAST_EFFECT",
      by: actorId,
      factorFavor: 1.25,
      factorTrust: 1.05,
      reason: "emphasize",
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 2.2), reason: "emphasize_extra_aggro" });
    pushLog(e, actorId, "CMD_EMPHASIZE", `${actor.name}:[과장해서 말한다] (강조)`);
    return e;
  },
});

// -------------------- 16) 동의를 구한다 (FOLLOW) --------------------
define({
  id: COMMAND_ID.ASK_AGREE,
  name: "동의를 구한다",
  type: TYPE.FOLLOW,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "charisma", 25),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    // 동조 가능한 발언 뒤
    return !!ctx.root && (ctx.root.id === COMMAND_ID.SUSPECT || ctx.root.id === COMMAND_ID.DEFEND);
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 동의 요청: “추가 동조 확률” 상승 플래그. 아무도 안 하면 어그로만 쌓일 수 있음(실제는 ai가)
    e.flags.push({
      type: "BOOST_FOLLOW_CHANCE",
      by: actorId,
      amount: clamp(0.10 + (actor.stats.charisma ?? 0) / 50 * 0.25, 0.10, 0.35),
      mode: ctx.root.id === COMMAND_ID.SUSPECT ? "suspect" : "cover",
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 3.0), reason: "ask_agree_aggro" });
    pushLog(e, actorId, "CMD_ASK_AGREE", `${actor.name}:[동의를 구한다] (호소)`);
    return e;
  },
});

// -------------------- 17) 반론을 막는다 (FOLLOW) --------------------
define({
  id: COMMAND_ID.BLOCK_REBUT,
  name: "반론을 막는다",
  type: TYPE.FOLLOW,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "charisma", 40),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    // 의심/감싼다 등 동의 가능한 발언 이후 가능, 단 반론 뒤에는 불가(=root가 rebut이면 불가)
    if (!ctx.root) return false;
    if (ctx.root.id === COMMAND_ID.REBUT) return false;
    return true;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 봉쇄 플래그: 이 턴에서 “반대 발언”을 막는다.
    e.turn.blockRebuttal = { active: true, byActorId: actorId };

    // 어그로 대폭 증가
    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 10.0), reason: "block_rebut_big_aggro" });

    pushLog(e, actorId, "CMD_BLOCK_REBUT", `${actor.name}:[반론을 막는다] (봉쇄)`);
    return e;
  },
});

// -------------------- 18) 얼버무린다 (REACT) --------------------
define({
  id: COMMAND_ID.EVADE,
  name: "얼버무린다",
  type: TYPE.REACT,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "stealth", 25),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.SUSPECT)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    // 공격받은 뒤: 의심 루트의 타겟일 때 의미가 큼, 아니어도 가능(기획서상 공격당한 뒤)
    return true;
  },
  apply: ({ actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 얼버무림: 즉시 토론 종료(추가 공격 끊기), 대신 옹호도 받기 어려움 -> 플래그로 남김
    e.flags.push({ type: "EVADE_END_DISCUSSION", by: actorId });
    endTurn(e, "evade");

    // 어그로는 약간 감소(스텔스 느낌) + 의심도(여론) 증가/감소는 game가 처리
    e.aggro.push({ who: actorId, delta: -calcAggroDelta(actor, 2.0), reason: "evade_aggro_down" });

    pushLog(e, actorId, "CMD_EVADE", `${actor.name}:[얼버무린다] (회피로 종료)`);
    return e;
  },
});

// -------------------- 19) 반격한다 (REACT) --------------------
define({
  id: COMMAND_ID.COUNTER,
  name: "반격한다",
  type: TYPE.REACT,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "logic", 25) && statAtLeast(actor, "acting", 25),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.SUSPECT)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    const attackerId = ctx.root.actorId;
    const atk = calcAttackBase(actor);

    // 반격: 공격자(의심한 사람)의 신뢰/우호 하락
    e.rel.push({
      from: actorId,
      to: attackerId,
      trustDelta: -(atk.trust * 0.95),
      favorDelta: -(atk.favor * 0.95),
      reason: "counter_attack_attacker",
    });

    // 반격은 위험: 어그로도 많이 쌓임
    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 7.0), reason: "counter_big_aggro" });

    // 반격 후엔 “다른 사람이 공격자 의심에 동조 가능” 플래그
    e.flags.push({
      type: "OPEN_SUPPORT_WINDOW",
      mode: "counter_follow",
      rootActorId: actorId,
      targetId: attackerId,
      baseFollowChance: clamp(0.10 + (actor.stats.charisma ?? 0) / 50 * 0.25, 0.10, 0.35),
    });

    pushLog(e, actorId, "CMD_COUNTER", `${actor.name}:[반격한다] (역공)`);
    return e;
  },
});

// -------------------- 20) 도움을 요청한다 (REACT) --------------------
define({
  id: COMMAND_ID.ASK_HELP,
  name: "도움을 요청한다",
  type: TYPE.REACT,
  target: "required", // 변호 요청 대상
  statReq: (actor) => statAtLeast(actor, "acting", 30),
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.SUSPECT)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    // 공격받았을 때: 의심 대상이거나 공격이 열려 있는 상황
    return targetId != null;
  },
  apply: ({ ctx, actor, actorId, targetId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 도움요청: 성공 여부는 AI/관계에 따라 결정해야 하므로 플래그만
    // 성공 시 "반론 봉쇄 무효화"도 수행(네 요구)
    e.flags.push({
      type: "REQUEST_HELP",
      from: actorId,
      to: targetId,
      // 연기/카리스마가 높을수록 성공 확률 상승 (실제 계산은 ai.js)
      weight: clamp(0.25 + (actor.stats.acting ?? 0) / 50 * 0.35 + (actor.stats.charisma ?? 0) / 50 * 0.25, 0.25, 0.85),
      cancelBlockOnSuccess: true,
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 2.5), reason: "ask_help_spoke" });

    pushLog(e, actorId, "CMD_ASK_HELP", `${actor.name}:[도움을 요청한다] (변호 요청)`);
    return e;
  },
});

// -------------------- 21) 슬퍼한다 (REACT) --------------------
define({
  id: COMMAND_ID.SAD,
  name: "슬퍼한다",
  type: TYPE.REACT,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "charm", 25),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.SUSPECT)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    const charm = actor.stats.charm ?? 0;
    // 동정 유도: 다른 사람들이 변호할 확률 증가 플래그
    e.flags.push({
      type: "PITY_AURA",
      who: actorId,
      amount: clamp(0.20 + (charm / 50) * 0.55, 0.20, 0.75),
    });

    // 방어 보정(피해 감소) 플래그
    e.flags.push({
      type: "TEMP_DEFENSE_UP",
      who: actorId,
      rate: clamp(0.12 + (charm / 50) * 0.25, 0.12, 0.37),
      duration: "this_turn",
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 1.5), reason: "sad_spoke" });
    pushLog(e, actorId, "CMD_SAD", `${actor.name}:[슬퍼한다] (동정 유도)`);
    return e;
  },
});

// -------------------- 22) 속지마라 (REACT) --------------------
define({
  id: COMMAND_ID.DONT_FOOL,
  name: "속지마라",
  type: TYPE.REACT,
  target: "required", // 나를 공격한 상대
  statReq: (actor) => statAtLeast(actor, "intuition", 30),
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.SUSPECT)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return targetId != null;
  },
  apply: ({ actor, actorId, targetId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 속지마라: "거짓말 노출 확률 증가" 상태를 부여(다음 날 보고 끝까지)
    e.flags.push({
      type: "EXPOSE_LIE_BUFF",
      from: actorId,
      to: targetId,
      amount: clamp(0.25 + intuitionDetectWeight(actor) * 0.60, 0.25, 0.85),
      until: "end_of_next_report",
      oncePerTargetUntilExpire: true,
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 2.0), reason: "dont_fool_spoke" });

    pushLog(e, actorId, "CMD_DONT_FOOL", `${actor.name}:[속지마라] (경고)`);
    return e;
  },
});

// -------------------- 23) 투표해라 / 투표하지 마라 (ROOT) --------------------
define({
  id: COMMAND_ID.VOTE_FOR,
  name: "투표해라",
  type: TYPE.ROOT,
  target: "required",
  statReq: (actor) => statAtLeast(actor, "logic", 10),
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return targetId != null;
  },
  limitKey: (actorId, ctx) => dayLimitKey(actorId, COMMAND_ID.VOTE_FOR),
  apply: ({ ctx, actor, actorId, target, targetId }) => {
    const e = E();
    startTurnRoot(ctx, e, COMMAND_ID.VOTE_FOR, actorId, targetId);

    e.flags.push({
      type: "VOTE_PROPOSAL",
      mode: "vote_for",
      proposer: actorId,
      targetId,
      // 논리력이 높을수록 설득력
      pressure: clamp(0.18 + (actor.stats.logic ?? 0) / 50 * 0.55, 0.18, 0.73),
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 5.5), reason: "vote_for_spoke" });

    pushLog(e, actorId, "CMD_VOTE_FOR", `${actor.name}:[투표해라] ${target.name}`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.META_AGREE, COMMAND_ID.META_DISAGREE],
});

define({
  id: COMMAND_ID.VOTE_NOT,
  name: "투표하지 마라",
  type: TYPE.ROOT,
  target: "required",
  statReq: (actor) => statAtLeast(actor, "logic", 15),
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return targetId != null;
  },
  limitKey: (actorId, ctx) => dayLimitKey(actorId, COMMAND_ID.VOTE_NOT),
  apply: ({ ctx, actor, actorId, target, targetId }) => {
    const e = E();
    startTurnRoot(ctx, e, COMMAND_ID.VOTE_NOT, actorId, targetId);

    e.flags.push({
      type: "VOTE_PROPOSAL",
      mode: "vote_not",
      proposer: actorId,
      targetId,
      pressure: clamp(0.18 + (actor.stats.logic ?? 0) / 50 * 0.50, 0.18, 0.68),
      duration: "this_day",
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 4.5), reason: "vote_not_spoke" });

    pushLog(e, actorId, "CMD_VOTE_NOT", `${actor.name}:[투표하지 마라] ${target.name}`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.META_AGREE, COMMAND_ID.META_DISAGREE],
});

// 찬성/반대 meta (숨김)
define({
  id: COMMAND_ID.META_AGREE,
  name: "찬성한다",
  type: TYPE.META,
  hidden: true,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    const root = ctx.root?.id;
    return root === COMMAND_ID.VOTE_FOR || root === COMMAND_ID.VOTE_NOT || root === COMMAND_ID.EXCLUDE_ALL;
  },
  apply: ({ actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);
    e.flags.push({ type: "META_VOTE_OPINION", who: actorId, opinion: "agree" });
    pushLog(e, actorId, "META_AGREE", `${actor.name}:(찬성한다)`);
    return e;
  },
});

define({
  id: COMMAND_ID.META_DISAGREE,
  name: "반대한다",
  type: TYPE.META,
  hidden: true,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    const root = ctx.root?.id;
    return root === COMMAND_ID.VOTE_FOR || root === COMMAND_ID.VOTE_NOT || root === COMMAND_ID.EXCLUDE_ALL;
  },
  apply: ({ actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);
    e.flags.push({ type: "META_VOTE_OPINION", who: actorId, opinion: "disagree" });
    pushLog(e, actorId, "META_DISAGREE", `${actor.name}:(반대한다)`);
    // 네 규칙: 반대 나오면 즉시 종료
    endTurn(e, "disagree_end");
    return e;
  },
});

// -------------------- 24) 반드시 인간이다 / 반드시 적이다 --------------------
define({
  id: COMMAND_ID.CERT_HUMAN,
  name: "반드시 인간이다",
  type: TYPE.ROOT,
  target: "required",
  statReq: (actor) => statAtLeast(actor, "logic", 20),
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return targetId != null;
  },
  limitKey: (actorId, ctx) => dayLimitKey(actorId, COMMAND_ID.CERT_HUMAN),
  apply: ({ ctx, actor, actorId, target, targetId }) => {
    const e = E();
    startTurnRoot(ctx, e, COMMAND_ID.CERT_HUMAN, actorId, targetId);

    e.flags.push({ type: "CERTIFY", mode: "human", by: actorId, targetId });
    // 대상 호감도 상승(지목된 쪽이 지목자에게)
    e.rel.push({
      from: targetId,
      to: actorId,
      trustDelta: +2.0,
      favorDelta: +6.0,
      reason: "cert_human_gratitude",
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 4.2), reason: "cert_human_spoke" });
    pushLog(e, actorId, "CMD_CERT_HUMAN", `${actor.name}:[반드시 인간이다] ${target.name}`);
    return e;
  },
});

define({
  id: COMMAND_ID.CERT_ENEMY,
  name: "반드시 적이다",
  type: TYPE.ROOT,
  target: "required",
  statReq: (actor) => statAtLeast(actor, "logic", 20),
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return targetId != null;
  },
  limitKey: (actorId, ctx) => dayLimitKey(actorId, COMMAND_ID.CERT_ENEMY),
  apply: ({ ctx, actor, actorId, target, targetId }) => {
    const e = E();
    startTurnRoot(ctx, e, COMMAND_ID.CERT_ENEMY, actorId, targetId);

    e.flags.push({ type: "CERTIFY", mode: "enemy", by: actorId, targetId });
    // 대상은 활동 불가 플래그(이후 턴들에서 game가 행동 금지)
    e.flags.push({ type: "SILENCE_TARGET", targetId, reason: "cert_enemy" });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 5.0), reason: "cert_enemy_spoke" });
    pushLog(e, actorId, "CMD_CERT_ENEMY", `${actor.name}:[반드시 적이다] ${target.name}`);
    return e;
  },
});

// -------------------- 25) 전원 배제해라 (ROOT) --------------------
define({
  id: COMMAND_ID.EXCLUDE_ALL,
  name: "전원 배제해라",
  type: TYPE.ROOT,
  target: "none", // roleKey를 meta로 받음
  statReq: (actor) => statAtLeast(actor, "logic", 30),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  limitKey: (actorId, ctx) => `${ctx.dayIndex}:loop:${actorId}:${COMMAND_ID.EXCLUDE_ALL}`,
  apply: ({ ctx, actor, actorId, meta }) => {
    const e = E();
    const roleKey = meta?.roleKey || "engineer";
    startTurnRoot(ctx, e, COMMAND_ID.EXCLUDE_ALL, actorId, null, { roleKey });

    e.flags.push({
      type: "EXCLUDE_ALL_ROLE",
      roleKey,
      by: actorId,
      pressure: clamp(0.15 + (actor.stats.logic ?? 0) / 50 * 0.55, 0.15, 0.70),
      // 찬반 메타 진행
      needsOpinion: true,
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 6.5), reason: "exclude_all_spoke" });
    pushLog(e, actorId, "CMD_EXCLUDE_ALL", `${actor.name}:[전원 배제해라] (${roleKey})`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.META_AGREE, COMMAND_ID.META_DISAGREE],
});

// -------------------- 26) 잡담한다 (ROOT) --------------------
define({
  id: COMMAND_ID.SMALLTALK,
  name: "잡담한다",
  type: TYPE.ROOT,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "stealth", 10),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  limitKey: (actorId, ctx) => dayLimitKey(actorId, COMMAND_ID.SMALLTALK),
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    startTurnRoot(ctx, e, COMMAND_ID.SMALLTALK, actorId, null);

    // 잡담: 어그로 감소 + 참여자들과 우호 상승 (참여자는 meta로 처리)
    e.aggro.push({ who: actorId, delta: -calcAggroDelta(actor, 5.0), reason: "smalltalk_aggro_down" });

    e.flags.push({
      type: "OPEN_SMALLTALK",
      hostId: actorId,
      maxJoiners: 3,
      // 누군가가 중단 가능
      stoppable: true,
    });

    pushLog(e, actorId, "CMD_SMALLTALK", `${actor.name}:[잡담한다] (잡담 시작)`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.META_JOIN_SMALLTALK, COMMAND_ID.META_STOP_SMALLTALK],
});

// 참여/중단 meta(숨김) - 기획서: 잡담 참여는 누구나 가능(체크 목록에 안 넣음)
define({
  id: COMMAND_ID.META_JOIN_SMALLTALK,
  name: "잡담에 참여한다",
  type: TYPE.META,
  hidden: true,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.SMALLTALK)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    e.flags.push({ type: "JOIN_SMALLTALK", who: actorId });

    // 참여자들과 호감도 상승은 game가 일괄 적용(호스트/참여자 상호)
    pushLog(e, actorId, "META_JOIN_SMALLTALK", `${actor.name}:(잡담에 참여한다)`);
    return e;
  },
});

define({
  id: COMMAND_ID.META_STOP_SMALLTALK,
  name: "잡담을 중단시킨다",
  type: TYPE.META,
  hidden: true,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.SMALLTALK)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    e.flags.push({ type: "STOP_SMALLTALK", by: actorId });
    pushLog(e, actorId, "META_STOP_SMALLTALK", `${actor.name}:(잡담을 중단시킨다)`);
    endTurn(e, "smalltalk_stopped");
    return e;
  },
});

// -------------------- 27) 협력하자 (ROOT) --------------------
define({
  id: COMMAND_ID.COOPERATE,
  name: "협력하자",
  type: TYPE.ROOT,
  target: "required",
  statReq: (actor) => statAtLeast(actor, "charm", 15),
  contextReq: (game, ctx, actorId, targetId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return targetId != null;
  },
  limitKey: (actorId, ctx) => dayLimitKey(actorId, COMMAND_ID.COOPERATE),
  apply: ({ ctx, actor, actorId, target, targetId }) => {
    const e = E();
    startTurnRoot(ctx, e, COMMAND_ID.COOPERATE, actorId, targetId);

    // 협력: 성공 여부는 상대가 받아들이는지(귀염성/우호/성격) -> ai가 결정
    e.flags.push({
      type: "PROPOSE_COOP",
      from: actorId,
      to: targetId,
      weight: clamp(0.20 + (actor.stats.charm ?? 0) / 50 * 0.55, 0.20, 0.75),
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 3.5), reason: "cooperate_spoke" });
    pushLog(e, actorId, "CMD_COOPERATE", `${actor.name}:[협력하자] ${target.name}`);
    return e;
  },
});

// -------------------- 28) 인간이라고 말해 (ROOT) --------------------
define({
  id: COMMAND_ID.ASK_HUMAN,
  name: "인간이라고 말해",
  type: TYPE.ROOT,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "intuition", 20),
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  limitKey: (actorId, ctx) => `${ctx.dayIndex}:loop:${actorId}:${COMMAND_ID.ASK_HUMAN}`,
  apply: ({ ctx, actor, actorId }) => {
    const e = E();
    startTurnRoot(ctx, e, COMMAND_ID.ASK_HUMAN, actorId, null);

    e.flags.push({
      type: "OPEN_DECLARE_HUMAN",
      startedBy: actorId,
      stoppable: true,
      // 말할수록 거짓말 노출 기회가 생김(실제 판정은 roles/ai)
      lieExposureBase: 0.22,
      detectWeightBoost: 0.20,
    });

    e.aggro.push({ who: actorId, delta: calcAggroDelta(actor, 5.0), reason: "ask_human_spoke" });
    pushLog(e, actorId, "CMD_ASK_HUMAN", `${actor.name}:[인간이라고 말해] (선언 요구)`);
    return e;
  },
  nextAllowed: () => [COMMAND_ID.META_DECLARE_HUMAN, COMMAND_ID.META_REFUSE_DECLARE, COMMAND_ID.META_STOP_DECLARE],
});

// 선언/거부/중단 meta(숨김)
define({
  id: COMMAND_ID.META_DECLARE_HUMAN,
  name: "나는 인간이야(선언)",
  type: TYPE.META,
  hidden: true,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.ASK_HUMAN)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 선언: “거짓말 노출 기회” 플래그(역할이 인간이 아닌 경우 거짓말일 수 있음)
    e.flags.push({
      type: "DECLARE_HUMAN",
      who: actorId,
      lieExposure: liarExposureWeight(actor),
      detectBoost: intuitionDetectWeight(actor),
    });

    pushLog(e, actorId, "META_DECLARE_HUMAN", `${actor.name}:(나는 인간이야)`);
    return e;
  },
});

define({
  id: COMMAND_ID.META_REFUSE_DECLARE,
  name: "선언하지 않는다",
  type: TYPE.META,
  hidden: true,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.ASK_HUMAN)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 거부는 의심 요인
    e.flags.push({ type: "REFUSE_DECLARE", who: actorId, suspicion: 0.18 });
    pushLog(e, actorId, "META_REFUSE_DECLARE", `${actor.name}:(선언하지 않았다)`);
    return e;
  },
});

define({
  id: COMMAND_ID.META_STOP_DECLARE,
  name: "선언을 중단시킨다",
  type: TYPE.META,
  hidden: true,
  target: "none",
  statReq: () => true,
  contextReq: (game, ctx, actorId) => {
    if (ctx.phase !== "day") return false;
    if (!requireRoot(ctx, COMMAND_ID.ASK_HUMAN)) return false;
    if (isTurnEnded(ctx)) return false;
    if (alreadySpokeThisTurn(ctx, actorId)) return false;
    return true;
  },
  apply: ({ actor, actorId }) => {
    const e = E();
    markSpoken(e, actorId);

    // 중단자는 큰 의심 요인(기획서)
    e.flags.push({ type: "STOP_DECLARE", by: actorId, suspicion: 0.40 });
    pushLog(e, actorId, "META_STOP_DECLARE", `${actor.name}:(선언을 중단시킨다)`);
    endTurn(e, "declare_stopped");
    return e;
  },
});

// -------------------- 29) 도게자한다 (RESOLVE) --------------------
define({
  id: COMMAND_ID.DO_GE_ZA,
  name: "도게자한다",
  type: TYPE.RESOLVE,
  target: "none",
  statReq: (actor) => statAtLeast(actor, "stealth", 35), // (기획서: 스텔스 35)
  contextReq: (game, ctx, actorId) => {
    // 투표로 콜드슬립 대상이 되었을 때만: game가 resolve 단계에서 호출
    return true;
  },
  limitKey: (actorId, ctx) => `${ctx.dayIndex}:loop:${actorId}:${COMMAND_ID.DO_GE_ZA}`,
  apply: ({ actor, actorId }) => {
    const e = E();
    // 도게자: 콜드슬립 회피 확률 생성(연기력 기반이라 적혀있었지만 조건은 스텔스)
    const acting = actor.stats.acting ?? 0;

    e.flags.push({
      type: "DODGE_COLDSLEEP",
      who: actorId,
      chance: clamp(0.12 + (acting / 50) * 0.35, 0.12, 0.47),
    });

    pushLog(e, actorId, "CMD_DOGEZA", `${actor.name}:[도게자한다] (살려달라)`);
    return e;
  },
});

// -------------------- 30) 밤 시간 커맨드(추가): “협력을 제안” --------------------
// - 기획서 추가 사항: 밤 자유행동에서 a가 b에게 협력 요청(성공/거절)
// - 이건 낮 커맨드 목록에 보일 필요는 있지만, 실행은 밤에서만.
// - game.js가 nightFreeAction에서 이 커맨드를 선택할 수 있게 사용할 예정.
export const NIGHT_ACTIONS = new Map();

function defineNight(a) {
  NIGHT_ACTIONS.set(a.id, a);
  return a;
}

defineNight({
  id: "night_propose_coop",
  name: "밤-협력을 제안",
  statReq: () => true, // 스탯 조건 없음(추가 요구)
  target: "required",
  contextReq: (game, ctx, actorId, targetId) => {
    return ctx.phase === "night" && ctx.nightStep === 1 && targetId != null;
  },
  apply: ({ actor, actorId, targetId }) => {
    const e = E();
    // 성공 여부는 ai에서(우호/성격/욕망/사회성 등)
    e.flags.push({
      type: "NIGHT_COOP_PROPOSE",
      from: actorId,
      to: targetId,
      weight: clamp(0.25 + (actor.personality?.social ?? 0) * 0.25, 0.20, 0.85),
    });
    pushLog(e, actorId, "NIGHT_COOP", `${actor.name}:(밤에 협력을 제안했다)`);
    return e;
  },
});

// -------------------- 유틸: 커맨드 리스트(유저 체크용) --------------------
// 네 요구: "스탯상 불가능한 커맨드는 체크 불가, 하지만 성향으로 쓰지 않을 커맨드는 유저가 체크해서 제외"
// => UI는 아래 리스트를 써서 체크박스를 만들고, 각 캐릭터의 enabledCommands로 저장하면 됨.
// (잡담 '참여', 찬반, 선언 등 meta는 UI에 노출하지 않음)
export function getUserSelectableCommandDefs() {
  const out = [];
  for (const cmd of COMMANDS.values()) {
    if (cmd.hidden) continue;
    // '감싼다' 루트는 별도 id라 UI에서 명확히 분리
    if (cmd.id === COMMAND_ID.DEFEND) continue; // 변호(의심세션용)만이라 혼동 방지
    out.push({
      id: cmd.id,
      name: cmd.name,
      type: cmd.type,
      // UI는 actor 스탯 넣어서 statReq 통과 여부 판단 후 체크 활성화/비활성화 처리
      statReq: cmd.statReq,
      // 설명은 ui.js에서 별도 텍스트로 매핑 권장
    });
  }
  // 감싼다 루트 추가 노출
  out.push({
    id: COMMAND_ID.DEFEND + "_root",
    name: "감싼다",
    type: TYPE.ROOT,
    statReq: () => true,
  });

  // 밤 협력 제안(체크 노출)
  out.push({
    id: "night_propose_coop",
    name: "밤-협력을 제안",
    type: "night",
    statReq: () => true,
  });

  return out;
}

// -------------------- 검증용: 존재 확인 --------------------
export function hasCommand(id) {
  return COMMANDS.has(id);
}
export function getCommand(id) {
  return COMMANDS.get(id) || null;
}
