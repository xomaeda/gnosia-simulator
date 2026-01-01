// engine/commands.js
// =======================================================
// 커맨드 정의 + 실행/연쇄(부속 커맨드) 처리
//
// 설계 목표
// - 기획서 2-2-1 커맨드 전부 포함
// - “부속 커맨드” 연쇄(한 턴 = 한 연쇄) 지원
// - 스테이터스 조건/1일 1회/1턴 1회 등 제한 지원
// - 효과(신뢰/우호/어그로/거짓말 들킴) 반영
// - 반론 봉쇄(반론을 막는다) + 도움 요청 성공 시 봉쇄 무효
//
// NOTE: 숫자 밸런스는 완성형 엔진에서 튜닝 가능.
// =======================================================

/**
 * @typedef {Object} Stats
 * @property {number} charisma
 * @property {number} logic
 * @property {number} acting
 * @property {number} charm
 * @property {number} stealth
 * @property {number} intuition
 */

/**
 * 관계(관계도)는 "관찰자 관점"에서 per-character matrix로 관리:
 * rel.trust[aId][bId] : a가 b를 얼마나 믿는지
 * rel.like[aId][bId]  : a가 b를 얼마나 좋아하는지
 *
 * 여기서는 "관계 업데이트 유틸"만 제공한다.
 */

// -------------------------------------------------------
// 유틸
// -------------------------------------------------------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const rnd = () => Math.random();

function pickOne(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function stat(c, key) {
  return Number(c?.stats?.[key] ?? 0);
}

function hasAllowed(c, name) {
  // 유저 체크(allowedCommands) 안에 없으면 사용 불가
  // 단, 숨김 커맨드(HIDDEN_*)는 UI에 노출 안되며 allowed 체크도 생략 가능
  if (name.startsWith("HIDDEN_")) return true;
  const list = c?.allowedCommands ?? [];
  return list.includes(name);
}

function meetsReq(c, req) {
  if (!req || req.length === 0) return true;
  return req.every(([k, min]) => stat(c, k) >= min);
}

export function statusMeetsReq(stats, req) {
  if (!req || req.length === 0) return true;
  return req.every(([k, min]) => Number(stats?.[k] ?? 0) >= min);
}

// -------------------------------------------------------
// 턴/연쇄 컨텍스트
// -------------------------------------------------------
/**
 * turnCtx는 "이번 턴의 연쇄 상태"를 저장한다.
 *
 * @typedef {Object} TurnCtx
 * @property {string|null} rootCmd       - 루트 커맨드 이름 (의심한다/감싼다/역할을 밝혀라/인간이라고 말해/잡담한다/투표해라/전원배제해라 등)
 * @property {number|null} rootActorId   - 루트 커맨드 발동자
 * @property {number|null} targetId      - 기본 타겟(의심/감싸/투표 등)
 * @property {boolean} blockCounter      - 반론 봉쇄 중인지 (반론/변호 같은 "반대 의견"을 막음)
 * @property {number|null} blockTargetId - 봉쇄 대상(보통 targetId)
 * @property {Set<number>} spokeIds      - 이번 턴에 발언한 인물
 * @property {boolean} ended            - 턴 종료 여부
 * @property {Object} meta              - 커맨드별 임시 데이터
 */

// -------------------------------------------------------
// 관계/수치 적용(기본 정책)
// -------------------------------------------------------
export function createRelations(charIds) {
  const trust = {};
  const like = {};
  for (const a of charIds) {
    trust[a] = {};
    like[a] = {};
    for (const b of charIds) {
      if (a === b) continue;
      trust[a][b] = 0;
      like[a][b] = 0;
    }
  }
  return { trust, like };
}

export function relAddTrust(rel, fromId, toId, delta, clampMin = -100, clampMax = 100) {
  if (fromId === toId) return;
  rel.trust[fromId][toId] = clamp((rel.trust[fromId][toId] ?? 0) + delta, clampMin, clampMax);
}

export function relAddLike(rel, fromId, toId, delta, clampMin = -100, clampMax = 100) {
  if (fromId === toId) return;
  rel.like[fromId][toId] = clamp((rel.like[fromId][toId] ?? 0) + delta, clampMin, clampMax);
}

// -------------------------------------------------------
// 수치 밸런싱(완성 엔진에서 튜닝 가능)
// -------------------------------------------------------
function baseAttackLogic(actor, crowdFactor = 1) {
  // 논리력 공격(신뢰 감소/회복)
  // 인원수 많을수록 카리스마 효율 커지고 논리 영향 줄어든다는 설명 반영
  const logic = stat(actor, "logic");
  return (0.35 + logic * 0.065) * crowdFactor;
}

function baseAttackActing(actor, crowdFactor = 1) {
  // 연기력 공격(우호 감소/회복)
  const acting = stat(actor, "acting");
  return (0.35 + acting * 0.065) * crowdFactor;
}

function defenseCharm(target) {
  // 귀염성 방어
  const charm = stat(target, "charm");
  return clamp(1 - charm * 0.012, 0.35, 1); // charm 높을수록 피해 감소
}

function hateGain(actor, intensity = 1) {
  // 어그로 증가: 스텔스가 높을수록 누적 완화
  const stealth = stat(actor, "stealth");
  const mult = clamp(1 - stealth * 0.01, 0.35, 1);
  return 1.0 * intensity * mult;
}

function charismaPull(actor) {
  // 동조 유도력(카리스마 기반)
  const ch = stat(actor, "charisma");
  return clamp(0.10 + ch * 0.012, 0.10, 0.75);
}

function lieEvasion(actor) {
  // 연기력 기반 거짓말 들킴 회피
  const a = stat(actor, "acting");
  return clamp(0.15 + a * 0.01, 0.15, 0.70); // 높을수록 "들킴 방지"
}

function intuitionDetect(detector) {
  // 직감 기반 탐지
  const it = stat(detector, "intuition");
  return clamp(0.10 + it * 0.012, 0.10, 0.80);
}

// -------------------------------------------------------
// 커맨드 결과 로그(문구는 main/game에서 템플릿 붙일 수 있도록 최소화)
// -------------------------------------------------------
export function logLine(actorName, cmdName, text = "") {
  return `${actorName}:[${cmdName}] ${text}`.trim();
}

// -------------------------------------------------------
// 커맨드 타입/분류
// -------------------------------------------------------
export const CMD_KIND = {
  ROOT: "ROOT",     // 턴을 시작하는 커맨드(의심한다/감싼다/역할을 밝혀라/인간이라고 말해/잡담한다/투표해라/전원배제해라 등)
  FOLLOW: "FOLLOW", // 루트 이후 붙는 부속 커맨드(동의/가담/반대/중단/나는 인간이야/참여/찬성/반대 등)
  REACT: "REACT",   // 공격/옹호에 대한 반응(부정/얼버무/반격/도움요청/슬퍼 등)
};

// -------------------------------------------------------
// 커맨드 정의
// -------------------------------------------------------
/**
 * CommandDef
 * @typedef {Object} CommandDef
 * @property {string} name
 * @property {string} kind
 * @property {Array<[keyof Stats, number]>} req
 * @property {(ctx: any) => boolean} canUse    - 현재 턴 컨텍스트/게임 상태에서 사용 가능한지
 * @property {(ctx: any) => void} apply        - 효과 적용
 * @property {(ctx: any) => string[]} logs     - 로그 반환
 * @property {boolean} hidden                 - UI 미노출용(찬성/반대/중단 등)
 */

// "현재 턴 컨텍스트 + 게임 상태"는 game.js에서 넘겨줄 예정.
// ctx는 아래 형태를 가정:
// ctx = {
//   phase: "DAY"|"NIGHT_FREE"|"NIGHT_RESOLVE",
//   aliveIds: number[],
//   actor: characterObj,
//   target: characterObj|null,
//   turn: TurnCtx,
//   rel,
//   state: { day, stepInDay, loop, ... },
//   flags: { perDayUsed: Map(actorId->Set(cmdName)), perTurnUsed: Set(actorId+cmdName) },
//   effects: { hatred: Map(id->number), cooperation: Set("a-b"), ... },
//   truth: { roleOf: Map(id->roleName), lieFlags: Map(id->bool), ... },
//   rng: Math.random,
//   events: [] // 특수 이벤트(거짓말 들킴 등)
// }

function oncePerTurn(ctx, cmdName) {
  const key = `${ctx.actor.id}:${cmdName}`;
  if (!ctx.flags?.perTurnUsed) ctx.flags.perTurnUsed = new Set();
  if (ctx.flags.perTurnUsed.has(key)) return false;
  ctx.flags.perTurnUsed.add(key);
  return true;
}

function oncePerDay(ctx, cmdName) {
  if (!ctx.flags?.perDayUsed) ctx.flags.perDayUsed = new Map();
  const m = ctx.flags.perDayUsed;
  if (!m.has(ctx.actor.id)) m.set(ctx.actor.id, new Set());
  const s = m.get(ctx.actor.id);
  if (s.has(cmdName)) return false;
  s.add(cmdName);
  return true;
}

function ensureSpoke(ctx) {
  if (!ctx.turn.spokeIds) ctx.turn.spokeIds = new Set();
  ctx.turn.spokeIds.add(ctx.actor.id);
}

// -------------------------------------------------------
// 핵심 효과 적용 함수들
// -------------------------------------------------------
function applySuspect(ctx, powerMult = 1, hateMult = 1, exaggerateLikeSide = 0) {
  // actor가 target을 의심 -> target에 대한 "전체 분위기"를 rel에 반영:
  // 여기서는 단순화를 위해 "모든 청자(=alive)"가 target을 덜 믿고/덜 좋아하게 만들 수 있다.
  const actor = ctx.actor;
  const target = ctx.target;
  const alive = ctx.aliveIds;

  const crowdFactor = clamp(1.2 - alive.length * 0.03, 0.65, 1.2); // 인원수 많으면 논리 영향 약화
  const logicDmg = baseAttackLogic(actor, crowdFactor) * powerMult;
  const likeDmg = baseAttackActing(actor, 1) * powerMult;

  // 방어(귀염성)
  const def = defenseCharm(target);

  // 카리스마 동조 가중치: actor가 말하면 일부 인물이 추가로 영향을 받는다.
  const pullP = charismaPull(actor);
  for (const listenerId of alive) {
    if (listenerId === actor.id) continue;
    // 동조 확률(상대의 사회성/쾌활함 등은 game.js에서 반영 가능)
    const follow = rnd() < pullP;
    const mult = follow ? 1.0 : 0.35; // 동조 안 하면 영향 적음

    // listener가 target을 덜 믿고/덜 좋아함
    relAddTrust(ctx.rel, listenerId, target.id, -logicDmg * mult * def);
    relAddLike(ctx.rel, listenerId, target.id, -(likeDmg * (1 + exaggerateLikeSide)) * mult * def);
  }

  // 어그로(발언자에게 누적)
  ctx.effects.hate.set(actor.id, (ctx.effects.hate.get(actor.id) ?? 0) + hateGain(actor, hateMult));
}

function applyDefend(ctx, powerMult = 1, hateMult = 1, exaggerateLikeSide = 0) {
  // actor가 target을 감싸/변호 -> 주변이 target을 더 믿고/더 좋아함
  const actor = ctx.actor;
  const target = ctx.target;
  const alive = ctx.aliveIds;

  const crowdFactor = clamp(1.2 - alive.length * 0.03, 0.65, 1.2);
  const trustUp = baseAttackLogic(actor, crowdFactor) * powerMult;
  const likeUp = baseAttackActing(actor, 1) * powerMult;

  const pullP = charismaPull(actor);
  for (const listenerId of alive) {
    if (listenerId === actor.id) continue;
    const follow = rnd() < pullP;
    const mult = follow ? 1.0 : 0.35;

    relAddTrust(ctx.rel, listenerId, target.id, trustUp * mult);
    relAddLike(ctx.rel, listenerId, target.id, (likeUp * (1 + exaggerateLikeSide)) * mult);
  }

  ctx.effects.hate.set(actor.id, (ctx.effects.hate.get(actor.id) ?? 0) + hateGain(actor, hateMult));
}

function applyCounterArg(ctx, powerMult = 1, hateMult = 1) {
  // 반론한다: 옹호/투표제안 등에 반론 -> target(=주장 대상)의 신뢰/우호 감소
  applySuspect(ctx, 0.85 * powerMult, 0.9 * hateMult);
}

function tryDetectLie(ctx, suspectId, liarId, bonus = 0) {
  // “a가 b의 거짓말을 눈치챘다” 로그 이벤트 생성.
  // detector = ctx.actor, liar = ctx.target 또는 지정
  const detector = ctx.charactersById.get(suspectId);
  const liar = ctx.charactersById.get(liarId);
  if (!detector || !liar) return false;

  // liar가 실제로 거짓말 상태여야 의미 있음(역할 사칭/인간이라고 말해 등)
  const isLying = !!ctx.truth?.lieFlags?.get(liarId);
  if (!isLying) return false;

  const pDetect = clamp(intuitionDetect(detector) + bonus, 0, 0.95);
  const pEvade = lieEvasion(liar); // 연기력으로 회피
  const roll = rnd();

  // detect 성공 조건: roll < pDetect*(1 - pEvade*0.6)
  const eff = pDetect * (1 - pEvade * 0.6);
  if (roll < eff) {
    ctx.events.push({ type: "LIE_DETECTED", detectorId: suspectId, liarId });
    return true;
  }
  return false;
}

// -------------------------------------------------------
// 부속 커맨드: “찬성/반대/중단/참여/나는 인간이야” 등 숨김 커맨드
// (UI에는 노출할 필요 없음)
// -------------------------------------------------------
const HIDDEN = {
  AGREE: "HIDDEN_찬성한다",
  DISAGREE: "HIDDEN_반대한다",
  STOP: "HIDDEN_중단시킨다",
  HUMAN_CLAIM: "HIDDEN_나는 인간이야",
  HUMAN_SILENT: "HIDDEN_선언하지 않는다",
  CHAT_JOIN: "HIDDEN_잡담에 참여한다",
};

// -------------------------------------------------------
// 커맨드 registry
// -------------------------------------------------------
export const COMMANDS = /** @type {CommandDef[]} */ ([
  // =========================
  // DAY ROOT: 의심/감싸
  // =========================
  {
    name: "의심한다",
    kind: CMD_KIND.ROOT,
    req: [],
    canUse: (ctx) => ctx.phase === "DAY" && !!ctx.target && hasAllowed(ctx.actor, "의심한다"),
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "의심한다")) return;
      ensureSpoke(ctx);
      ctx.turn.rootCmd = "의심한다";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = ctx.target.id;
      ctx.turn.blockCounter = false;
      ctx.turn.blockTargetId = null;
      ctx.turn.meta = { type: "suspect" };

      applySuspect(ctx, 1.0, 1.0);
    },
    logs: (ctx) => [logLine(ctx.actor.name, "의심한다", `${ctx.target.name}을(를) 의심했다.`)],
    hidden: false,
  },
  {
    name: "감싼다",
    kind: CMD_KIND.ROOT,
    req: [],
    canUse: (ctx) => ctx.phase === "DAY" && !!ctx.target && hasAllowed(ctx.actor, "감싼다"),
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "감싼다")) return;
      ensureSpoke(ctx);
      ctx.turn.rootCmd = "감싼다";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = ctx.target.id;
      ctx.turn.blockCounter = false;
      ctx.turn.blockTargetId = null;
      ctx.turn.meta = { type: "defend" };

      applyDefend(ctx, 1.0, 1.0);
    },
    logs: (ctx) => [logLine(ctx.actor.name, "감싼다", `${ctx.target.name}을(를) 감쌌다.`)],
    hidden: false,
  },

  // =========================
  // DAY FOLLOW: 동의/가담
  // =========================
  {
    name: "의심에 동의한다",
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      hasAllowed(ctx.actor, "의심에 동의한다") &&
      ctx.turn.rootCmd === "의심한다" &&
      !ctx.turn.ended &&
      !!ctx.turn.targetId &&
      ctx.charactersById.has(ctx.turn.targetId),
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "의심에 동의한다")) return;
      ensureSpoke(ctx);
      // root target을 향해 약한 의심 효과 + 어그로 적게
      const t = ctx.charactersById.get(ctx.turn.targetId);
      ctx.target = t;
      applySuspect(ctx, 0.55, 0.55);
    },
    logs: (ctx) => {
      const t = ctx.charactersById.get(ctx.turn.targetId);
      return [logLine(ctx.actor.name, "의심에 동의한다", `${t?.name ?? "대상"}의 말에 동의했다.`)];
    },
    hidden: false,
  },
  {
    name: "함께 감싼다",
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      hasAllowed(ctx.actor, "함께 감싼다") &&
      ctx.turn.rootCmd === "감싼다" &&
      !ctx.turn.ended &&
      !!ctx.turn.targetId,
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "함께 감싼다")) return;
      ensureSpoke(ctx);
      const t = ctx.charactersById.get(ctx.turn.targetId);
      ctx.target = t;
      applyDefend(ctx, 0.55, 0.55);
    },
    logs: (ctx) => {
      const t = ctx.charactersById.get(ctx.turn.targetId);
      return [logLine(ctx.actor.name, "함께 감싼다", `${t?.name ?? "대상"}의 말에 동의했다.`)];
    },
    hidden: false,
  },

  // =========================
  // DAY REACT: 부정/변호/반론 등
  // =========================
  {
    name: "부정한다",
    kind: CMD_KIND.REACT,
    req: [],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "부정한다")) return false;
      if (ctx.turn.ended) return false;
      // 자신이 target(=의심 대상)이었을 때만 의미
      return ctx.turn.rootCmd === "의심한다" && ctx.turn.targetId === ctx.actor.id;
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "부정한다")) return;
      ensureSpoke(ctx);

      // 부정 = “더 이상 동조 못하게 막는다” 효과:
      // 단순화: 이후 FOLLOW(의심에 동의한다) 확률/효과를 약화시키는 플래그
      ctx.turn.meta.denied = true;

      // 자신에 대한 신뢰/우호 회복(논리/연기 기반)
      // 주변이 자신을 조금 더 믿고 좋아하게
      const alive = ctx.aliveIds;
      const crowdFactor = clamp(1.2 - alive.length * 0.03, 0.65, 1.2);
      const trustUp = baseAttackLogic(ctx.actor, crowdFactor) * 0.8;
      const likeUp = baseAttackActing(ctx.actor, 1) * 0.8;

      for (const listenerId of alive) {
        if (listenerId === ctx.actor.id) continue;
        relAddTrust(ctx.rel, listenerId, ctx.actor.id, trustUp * 0.5);
        relAddLike(ctx.rel, listenerId, ctx.actor.id, likeUp * 0.5);
      }
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 0.6));
    },
    logs: (ctx) => [logLine(ctx.actor.name, "부정한다", `의심에 반박했다.`)],
    hidden: false,
  },

  {
    name: "변호한다",
    kind: CMD_KIND.REACT,
    req: [],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "변호한다")) return false;
      if (ctx.turn.ended) return false;

      // 의심 턴에서 target을 변호하거나, 부정 직후에도 변호 가능
      if (ctx.turn.rootCmd === "의심한다" && !!ctx.turn.targetId) {
        // 반론 봉쇄 중이면 "반대 의견"이므로 불가
        if (ctx.turn.blockCounter && ctx.turn.blockTargetId === ctx.turn.targetId) return false;
        return true;
      }
      return false;
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "변호한다")) return;
      ensureSpoke(ctx);

      const t = ctx.charactersById.get(ctx.turn.targetId);
      ctx.target = t;
      applyDefend(ctx, 0.85, 0.9);
    },
    logs: (ctx) => {
      const t = ctx.charactersById.get(ctx.turn.targetId);
      return [logLine(ctx.actor.name, "변호한다", `${t?.name ?? "대상"}을(를) 변호했다.`)];
    },
    hidden: false,
  },

  {
    name: "변호에 가담한다",
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      hasAllowed(ctx.actor, "변호에 가담한다") &&
      ctx.turn.rootCmd === "의심한다" &&
      !ctx.turn.ended &&
      !!ctx.turn.targetId &&
      // 봉쇄 중이면 변호 가담도 불가
      !(ctx.turn.blockCounter && ctx.turn.blockTargetId === ctx.turn.targetId),
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "변호에 가담한다")) return;
      ensureSpoke(ctx);
      const t = ctx.charactersById.get(ctx.turn.targetId);
      ctx.target = t;
      applyDefend(ctx, 0.55, 0.6);
    },
    logs: (ctx) => {
      const t = ctx.charactersById.get(ctx.turn.targetId);
      return [logLine(ctx.actor.name, "변호에 가담한다", `${t?.name ?? "대상"}의 말에 동의했다.`)];
    },
    hidden: false,
  },

  {
    name: "반론한다",
    kind: CMD_KIND.REACT,
    req: [],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "반론한다")) return false;
      if (ctx.turn.ended) return false;

      // 감싼다(옹호) 또는 투표제안(루트)에 반론 가능.
      if (ctx.turn.rootCmd === "감싼다" && !!ctx.turn.targetId) return true;
      if (ctx.turn.rootCmd === "투표해라" && !!ctx.turn.targetId) return true;
      if (ctx.turn.rootCmd === "투표하지 마라" && !!ctx.turn.targetId) return true;
      return false;
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "반론한다")) return;
      ensureSpoke(ctx);
      const t = ctx.charactersById.get(ctx.turn.targetId);
      ctx.target = t;
      applyCounterArg(ctx, 1.0, 1.0);
    },
    logs: (ctx) => {
      const t = ctx.charactersById.get(ctx.turn.targetId);
      return [logLine(ctx.actor.name, "반론한다", `${t?.name ?? "대상"}에 반론했다.`)];
    },
    hidden: false,
  },

  {
    name: "반론에 가담한다",
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      hasAllowed(ctx.actor, "반론에 가담한다") &&
      (ctx.turn.rootCmd === "감싼다" || ctx.turn.rootCmd === "투표해라" || ctx.turn.rootCmd === "투표하지 마라") &&
      !ctx.turn.ended &&
      !!ctx.turn.targetId,
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "반론에 가담한다")) return;
      ensureSpoke(ctx);
      const t = ctx.charactersById.get(ctx.turn.targetId);
      ctx.target = t;
      applyCounterArg(ctx, 0.6, 0.7);
    },
    logs: (ctx) => {
      const t = ctx.charactersById.get(ctx.turn.targetId);
      return [logLine(ctx.actor.name, "반론에 가담한다", `${t?.name ?? "대상"}에 동조했다.`)];
    },
    hidden: false,
  },

  // =========================
  // 강화/제어 부속 커맨드
  // =========================
  {
    name: "과장해서 말한다",
    kind: CMD_KIND.FOLLOW,
    req: [["acting", 15]],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "과장해서 말한다")) return false;
      if (!meetsReq(ctx.actor, [["acting", 15]])) return false;
      if (ctx.turn.ended) return false;
      // “동조 가능한 발언 뒤” = 의심/감싸/변호/반론 같은 주요 발언 직후
      const okRoot = ["의심한다", "감싼다"].includes(ctx.turn.rootCmd);
      return okRoot;
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "과장해서 말한다")) return;
      ensureSpoke(ctx);
      // 이번 턴 meta에 "과장" 표시 -> 이후 동조의 우호(연기) 영향 강화, 어그로 조금 증가
      ctx.turn.meta.exaggerate = true;
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 0.35));
    },
    logs: (ctx) => [logLine(ctx.actor.name, "과장해서 말한다", `강하게 주장했다.`)],
    hidden: false,
  },

  {
    name: "동의를 구한다",
    kind: CMD_KIND.FOLLOW,
    req: [["charisma", 25]],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "동의를 구한다")) return false;
      if (!meetsReq(ctx.actor, [["charisma", 25]])) return false;
      if (ctx.turn.ended) return false;
      // 의심/감싸 뒤
      return ["의심한다", "감싼다"].includes(ctx.turn.rootCmd);
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "동의를 구한다")) return;
      ensureSpoke(ctx);
      ctx.turn.meta.askAgree = true;
      // 어그로 추가
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 0.55));
    },
    logs: (ctx) => [logLine(ctx.actor.name, "동의를 구한다", `동의를 요청했다.`)],
    hidden: false,
  },

  {
    name: "반론을 막는다",
    kind: CMD_KIND.FOLLOW,
    req: [["charisma", 40]],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "반론을 막는다")) return false;
      if (!meetsReq(ctx.actor, [["charisma", 40]])) return false;
      if (ctx.turn.ended) return false;
      // 의심/감싸 후 사용 가능, 단 "반론" 뒤에는 불가.
      // 여기서는 단순: 루트가 의심/감싸일 때만
      return ["의심한다", "감싼다"].includes(ctx.turn.rootCmd);
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "반론을 막는다")) return;
      ensureSpoke(ctx);

      // 반론 봉쇄 on: 루트 타겟에 대한 반대의견(변호/반론)을 막음
      ctx.turn.blockCounter = true;
      ctx.turn.blockTargetId = ctx.turn.targetId;

      // 어그로 매우 크게 증가
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 1.6));
    },
    logs: (ctx) => [logLine(ctx.actor.name, "반론을 막는다", `반대 의견을 봉쇄했다.`)],
    hidden: false,
  },

  // =========================
  // REACT: 얼버무/반격/도움요청/슬퍼/속지마라
  // =========================
  {
    name: "얼버무린다",
    kind: CMD_KIND.REACT,
    req: [["stealth", 25]],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "얼버무린다")) return false;
      if (!meetsReq(ctx.actor, [["stealth", 25]])) return false;
      if (ctx.turn.ended) return false;
      // “의심 등으로 공격당한 뒤” = 자신이 루트 타겟이었을 때
      return ctx.turn.rootCmd === "의심한다" && ctx.turn.targetId === ctx.actor.id;
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "얼버무린다")) return;
      ensureSpoke(ctx);

      // 즉시 논의 종료
      ctx.turn.ended = true;

      // 스텔스 기반 방어: 청자들의 신뢰/우호 하락을 완화(간단히 "회복"으로 처리)
      const alive = ctx.aliveIds;
      for (const listenerId of alive) {
        if (listenerId === ctx.actor.id) continue;
        relAddTrust(ctx.rel, listenerId, ctx.actor.id, 1.5);
        relAddLike(ctx.rel, listenerId, ctx.actor.id, 1.0);
      }

      // 어그로는 오히려 덜 쌓이게
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 0.15));
    },
    logs: (ctx) => [logLine(ctx.actor.name, "얼버무린다", `대화를 얼버무려 턴을 끝냈다.`)],
    hidden: false,
  },

  {
    name: "반격한다",
    kind: CMD_KIND.REACT,
    req: [["logic", 25], ["acting", 25]],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "반격한다")) return false;
      if (!meetsReq(ctx.actor, [["logic", 25], ["acting", 25]])) return false;
      if (ctx.turn.ended) return false;
      // 공격당한 뒤(의심 턴에서 target)
      return ctx.turn.rootCmd === "의심한다" && ctx.turn.targetId === ctx.actor.id;
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "반격한다")) return;
      ensureSpoke(ctx);

      // 반격 대상 = 루트 발언자(의심한 사람)
      const attacker = ctx.charactersById.get(ctx.turn.rootActorId);
      if (!attacker) return;

      // attacker에 대해 신뢰/우호를 공격(청자 전체에 영향)
      ctx.target = attacker;
      applySuspect(ctx, 0.75, 1.1);

      // 반격은 “자기 회복 없음”
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 1.0));
    },
    logs: (ctx) => {
      const attacker = ctx.charactersById.get(ctx.turn.rootActorId);
      return [logLine(ctx.actor.name, "반격한다", `${attacker?.name ?? "상대"}에게 반격했다.`)];
    },
    hidden: false,
  },

  {
    name: "도움을 요청한다",
    kind: CMD_KIND.REACT,
    req: [["acting", 30]],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "도움을 요청한다")) return false;
      if (!meetsReq(ctx.actor, [["acting", 30]])) return false;
      if (ctx.turn.ended) return false;
      // 공격당했을 때
      return ctx.turn.rootCmd === "의심한다" && ctx.turn.targetId === ctx.actor.id;
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "도움을 요청한다")) return;
      ensureSpoke(ctx);

      // 누구에게 요청할지는 game.js가 선택해 ctx.target로 넣어줄 것.
      // 여기서는 target이 "도움 요청 대상"이라고 가정.
      const helper = ctx.target;
      if (!helper) return;

      // 성공 확률: 연기력 + 카리스마 + (우호/협력) 보정은 game.js에서 넣을 것
      const p = clamp(0.30 + stat(ctx.actor, "acting") * 0.008 + stat(helper, "charisma") * 0.005, 0.15, 0.85);
      const ok = rnd() < p;

      ctx.turn.meta.helpRequested = { helperId: helper.id, ok };

      // 반론 봉쇄 무효화: “반론을 막는다”가 켜져 있더라도, 도움요청 성공이면 풀린다(너가 지정)
      if (ok && ctx.turn.blockCounter) {
        ctx.turn.blockCounter = false;
        ctx.turn.blockTargetId = null;
        ctx.turn.meta.blockBroken = true;
      }

      // 어그로 약간
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 0.45));

      // 성공하면 helper가 변호(가담)하는 효과를 즉시 한 번 적용
      if (ok) {
        // helper가 target(=요청자)을 변호한 것처럼 주변이 약간 회복
        const savedActor = ctx.actor;
        ctx.actor = helper;
        ctx.target = savedActor;
        applyDefend(ctx, 0.55, 0.35);
        // ctx.actor 복구
        ctx.actor = savedActor;
      }
    },
    logs: (ctx) => {
      const r = ctx.turn.meta.helpRequested;
      const helper = r ? ctx.charactersById.get(r.helperId) : null;
      if (!r) return [logLine(ctx.actor.name, "도움을 요청한다", `도움을 요청했다.`)];
      return [
        logLine(
          ctx.actor.name,
          "도움을 요청한다",
          `${helper?.name ?? "상대"}에게 도움을 요청했다. (${r.ok ? "성공" : "실패"})`
        ),
      ];
    },
    hidden: false,
  },

  {
    name: "슬퍼한다",
    kind: CMD_KIND.REACT,
    req: [["charm", 25]],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "슬퍼한다")) return false;
      if (!meetsReq(ctx.actor, [["charm", 25]])) return false;
      if (ctx.turn.ended) return false;
      return ctx.turn.rootCmd === "의심한다" && ctx.turn.targetId === ctx.actor.id;
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "슬퍼한다")) return;
      ensureSpoke(ctx);

      // 동정심 유도: 주변이 자신을 약간 더 좋아/믿게
      const alive = ctx.aliveIds;
      const bonus = clamp(1.0 + stat(ctx.actor, "charm") * 0.03, 1.0, 2.5);
      for (const listenerId of alive) {
        if (listenerId === ctx.actor.id) continue;
        relAddLike(ctx.rel, listenerId, ctx.actor.id, 1.2 * bonus);
        relAddTrust(ctx.rel, listenerId, ctx.actor.id, 0.7 * bonus);
      }

      // 어그로는 낮게
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 0.25));
    },
    logs: (ctx) => [logLine(ctx.actor.name, "슬퍼한다", `슬퍼하며 동정심을 유도했다.`)],
    hidden: false,
  },

  {
    name: "속지마라",
    kind: CMD_KIND.REACT,
    req: [["intuition", 30]],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "속지마라")) return false;
      if (!meetsReq(ctx.actor, [["intuition", 30]])) return false;
      if (ctx.turn.ended) return false;
      // 공격당했을 때만 사용 가능
      return ctx.turn.rootCmd === "의심한다" && ctx.turn.targetId === ctx.actor.id;
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "속지마라")) return;
      ensureSpoke(ctx);

      // 속지마라 대상 = 공격자(루트 발언자)
      const attacker = ctx.charactersById.get(ctx.turn.rootActorId);
      if (!attacker) return;

      // 다음날 보고까지 “attacker의 거짓말이 들킬 확률↑” 플래그
      // game.js가 이 플래그를 유지시키며 거짓말 탐지 시 bonus를 준다.
      if (!ctx.effects.lieExposeBonus) ctx.effects.lieExposeBonus = new Map();
      ctx.effects.lieExposeBonus.set(attacker.id, clamp((ctx.effects.lieExposeBonus.get(attacker.id) ?? 0) + 0.25, 0, 0.8));

      // 어그로 약간
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 0.35));

      // 즉시 탐지 체크(즉발 로그)
      tryDetectLie(ctx, ctx.actor.id, attacker.id, ctx.effects.lieExposeBonus.get(attacker.id) ?? 0);
    },
    logs: (ctx) => {
      const attacker = ctx.charactersById.get(ctx.turn.rootActorId);
      return [logLine(ctx.actor.name, "속지마라", `${attacker?.name ?? "상대"}의 거짓말을 의심했다.`)];
    },
    hidden: false,
  },

  // =========================
  // 역할 관련
  // =========================
  {
    name: "역할을 밝혀라",
    kind: CMD_KIND.ROOT,
    req: [["charisma", 10]],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      hasAllowed(ctx.actor, "역할을 밝혀라") &&
      meetsReq(ctx.actor, [["charisma", 10]]),
    apply: (ctx) => {
      if (!oncePerDay(ctx, "역할을 밝혀라")) return;
      ensureSpoke(ctx);

      ctx.turn.rootCmd = "역할을 밝혀라";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = null; // 특정 대상이 아니라 "특정 역할"을 요구
      ctx.turn.meta = {
        // game.js가 어떤 역할을 요구할지 결정(엔지/닥터/선내대기인 등)
        requestedRole: ctx.turn.meta?.requestedRole ?? null,
        someoneCameOut: false,
      };
    },
    logs: (ctx) => [logLine(ctx.actor.name, "역할을 밝혀라", `역할 공개를 요구했다.`)],
    hidden: false,
  },

  {
    name: "역할을 밝힌다",
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "역할을 밝힌다")) return false;
      if (ctx.turn.ended) return false;
      if (ctx.turn.rootCmd !== "역할을 밝혀라") return false;

      // (중요) 요청된 역할에 대해 "밝힐 수 있는 사람만" 가능:
      // - 진짜 그 역할인 사람
      // - 또는 그 역할을 거짓말로 사칭 가능한 사람(엔지/닥터는 AC/그노시아도 사칭 가능, 선내대기인은 사칭 불가 등)
      // 이 판정은 roles.js에서 provideCanClaimRole(actorId, roleName)로 넘겨줄 예정.
      const role = ctx.turn.meta?.requestedRole;
      if (!role) return false;
      const canClaim = ctx.rolesApi?.canClaimRole?.(ctx.actor.id, role) ?? false;
      return canClaim;
    },
    apply: (ctx) => {
      if (!oncePerDay(ctx, `역할을 밝힌다:${ctx.turn.meta?.requestedRole ?? ""}`)) return;
      ensureSpoke(ctx);
      ctx.turn.meta.someoneCameOut = true;

      const role = ctx.turn.meta?.requestedRole;
      if (!ctx.truth.claimedRole) ctx.truth.claimedRole = new Map();
      ctx.truth.claimedRole.set(ctx.actor.id, role);

      // 거짓말 여부 표시 (진짜 역할과 다르면 lieFlags)
      const trueRole = ctx.truth.roleOf?.get(ctx.actor.id);
      const isLie = !!role && !!trueRole && role !== trueRole;
      ctx.truth.lieFlags.set(ctx.actor.id, isLie);

      // 누군가 직감으로 눈치챌 수 있음 (즉시 로그 이벤트)
      for (const otherId of ctx.aliveIds) {
        if (otherId === ctx.actor.id) continue;
        const bonus = ctx.effects.lieExposeBonus?.get(ctx.actor.id) ?? 0;
        tryDetectLie(ctx, otherId, ctx.actor.id, bonus);
      }
    },
    logs: (ctx) => {
      const role = ctx.turn.meta?.requestedRole ?? "역할";
      return [logLine(ctx.actor.name, "역할을 밝힌다", `${role}라고 선언했다.`)];
    },
    hidden: false,
  },

  {
    name: "자신도 밝힌다",
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (!hasAllowed(ctx.actor, "자신도 밝힌다")) return false;
      if (ctx.turn.ended) return false;
      if (ctx.turn.rootCmd !== "역할을 밝혀라") return false;
      // “역할을 밝힌다” 뒤에(=누군가 커밍아웃이 있었을 때)
      if (!ctx.turn.meta?.someoneCameOut) return false;
      // 같은 조건(요구 role에 대해 주장 가능한 사람)
      const role = ctx.turn.meta?.requestedRole;
      if (!role) return false;
      const canClaim = ctx.rolesApi?.canClaimRole?.(ctx.actor.id, role) ?? false;
      return canClaim;
    },
    apply: (ctx) => {
      // 하루 1회 제한도 role 기준으로 동일하게 적용
      if (!oncePerDay(ctx, `자신도 밝힌다:${ctx.turn.meta?.requestedRole ?? ""}`)) return;
      ensureSpoke(ctx);

      const role = ctx.turn.meta?.requestedRole;
      if (!ctx.truth.claimedRole) ctx.truth.claimedRole = new Map();
      ctx.truth.claimedRole.set(ctx.actor.id, role);

      const trueRole = ctx.truth.roleOf?.get(ctx.actor.id);
      const isLie = !!role && !!trueRole && role !== trueRole;
      ctx.truth.lieFlags.set(ctx.actor.id, isLie);

      for (const otherId of ctx.aliveIds) {
        if (otherId === ctx.actor.id) continue;
        const bonus = ctx.effects.lieExposeBonus?.get(ctx.actor.id) ?? 0;
        tryDetectLie(ctx, otherId, ctx.actor.id, bonus);
      }
    },
    logs: (ctx) => {
      const role = ctx.turn.meta?.requestedRole ?? "역할";
      return [logLine(ctx.actor.name, "자신도 밝힌다", `${role}라고 선언했다.`)];
    },
    hidden: false,
  },

  // =========================
  // 투표 제안(찬성/반대 포함, Q3: 1턴 1회 제한 적용)
  // =========================
  {
    name: "투표해라",
    kind: CMD_KIND.ROOT,
    req: [["logic", 10]],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      !!ctx.target &&
      hasAllowed(ctx.actor, "투표해라") &&
      meetsReq(ctx.actor, [["logic", 10]]),
    apply: (ctx) => {
      if (!oncePerDay(ctx, "투표해라")) return; // 1일 1회
      if (!oncePerTurn(ctx, "투표해라")) return; // Q3: 1턴 1회
      ensureSpoke(ctx);

      ctx.turn.rootCmd = "투표해라";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = ctx.target.id;
      ctx.turn.meta = { agrees: new Set(), disagrees: new Set() };
    },
    logs: (ctx) => [logLine(ctx.actor.name, "투표해라", `${ctx.target.name}에게 투표하자고 제안했다.`)],
    hidden: false,
  },

  {
    name: "투표하지 마라",
    kind: CMD_KIND.ROOT,
    req: [["logic", 15]],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      !!ctx.target &&
      hasAllowed(ctx.actor, "투표하지 마라") &&
      meetsReq(ctx.actor, [["logic", 15]]),
    apply: (ctx) => {
      if (!oncePerDay(ctx, "투표하지 마라")) return;
      if (!oncePerTurn(ctx, "투표하지 마라")) return; // Q3
      ensureSpoke(ctx);

      ctx.turn.rootCmd = "투표하지 마라";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = ctx.target.id;
      ctx.turn.meta = { agrees: new Set(), disagrees: new Set() };
    },
    logs: (ctx) => [logLine(ctx.actor.name, "투표하지 마라", `${ctx.target.name}에게 투표하지 말자고 제안했다.`)],
    hidden: false,
  },

  // 숨김: 찬성/반대/중단
  {
    name: HIDDEN.AGREE,
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (ctx.turn.ended) return false;
      // 투표해라/투표하지마라/전원배제해라 등 “찬반” 루트에서만 가능
      return ["투표해라", "투표하지 마라", "전원 배제해라"].includes(ctx.turn.rootCmd);
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, HIDDEN.AGREE)) return;
      ensureSpoke(ctx);
      ctx.turn.meta?.agrees?.add(ctx.actor.id);
      // 누가 찬성했는지 기록만 하고, 턴 종료는 "반대"가 나오거나 발언 종료 때 game.js가 처리
    },
    logs: (ctx) => [logLine(ctx.actor.name, "찬성한다", `찬성했다.`)],
    hidden: true,
  },

  {
    name: HIDDEN.DISAGREE,
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) => {
      if (ctx.phase !== "DAY") return false;
      if (ctx.turn.ended) return false;
      return ["투표해라", "투표하지 마라", "전원 배제해라"].includes(ctx.turn.rootCmd);
    },
    apply: (ctx) => {
      if (!oncePerTurn(ctx, HIDDEN.DISAGREE)) return;
      ensureSpoke(ctx);
      ctx.turn.meta?.disagrees?.add(ctx.actor.id);
      // 누군가 반대하면 즉시 종료(너 규칙)
      ctx.turn.ended = true;
    },
    logs: (ctx) => [logLine(ctx.actor.name, "반대한다", `반대했다. (턴 종료)`)],
    hidden: true,
  },

  // =========================
  // 반드시 인간/반드시 적 (logic 20)
  // =========================
  {
    name: "반드시 인간이다",
    kind: CMD_KIND.ROOT,
    req: [["logic", 20]],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      !!ctx.target &&
      hasAllowed(ctx.actor, "반드시 인간이다") &&
      meetsReq(ctx.actor, [["logic", 20]]),
    apply: (ctx) => {
      if (!oncePerDay(ctx, "반드시 인간이다")) return;
      if (!oncePerTurn(ctx, "반드시 인간이다")) return;
      ensureSpoke(ctx);

      // 이후 논의에서 target은 공격 대상에서 제외되도록 game.js가 처리할 "확정" 플래그
      if (!ctx.state.confirmHuman) ctx.state.confirmHuman = new Set();
      ctx.state.confirmHuman.add(ctx.target.id);

      // 지목자는 대상의 호감도 얻는다(상호가 아니라 "대상이 지목자를 좋아함"으로 반영)
      relAddLike(ctx.rel, ctx.target.id, ctx.actor.id, 4.0);

      ctx.turn.rootCmd = "반드시 인간이다";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = ctx.target.id;
      ctx.turn.ended = true;
    },
    logs: (ctx) => [logLine(ctx.actor.name, "반드시 인간이다", `${ctx.target.name}은(는) 반드시 인간이라고 선언했다.`)],
    hidden: false,
  },

  {
    name: "반드시 적이다",
    kind: CMD_KIND.ROOT,
    req: [["logic", 20]],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      !!ctx.target &&
      hasAllowed(ctx.actor, "반드시 적이다") &&
      meetsReq(ctx.actor, [["logic", 20]]),
    apply: (ctx) => {
      if (!oncePerDay(ctx, "반드시 적이다")) return;
      if (!oncePerTurn(ctx, "반드시 적이다")) return;
      ensureSpoke(ctx);

      if (!ctx.state.confirmEnemy) ctx.state.confirmEnemy = new Set();
      ctx.state.confirmEnemy.add(ctx.target.id);

      ctx.turn.rootCmd = "반드시 적이다";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = ctx.target.id;
      ctx.turn.ended = true;
    },
    logs: (ctx) => [logLine(ctx.actor.name, "반드시 적이다", `${ctx.target.name}은(는) 반드시 적이라고 선언했다.`)],
    hidden: false,
  },

  // =========================
  // 전원 배제해라 (logic 30) + 찬반
  // =========================
  {
    name: "전원 배제해라",
    kind: CMD_KIND.ROOT,
    req: [["logic", 30]],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      hasAllowed(ctx.actor, "전원 배제해라") &&
      meetsReq(ctx.actor, [["logic", 30]]),
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "전원 배제해라")) return;
      // 루프당 1회 제한은 game.js에서 state에 넣어 관리할 예정
      ensureSpoke(ctx);

      ctx.turn.rootCmd = "전원 배제해라";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = null;
      ctx.turn.meta = {
        // game.js가 어떤 role을 대상으로 삼는지 넣음 (requestedRole)
        requestedRole: ctx.turn.meta?.requestedRole ?? null,
        agrees: new Set(),
        disagrees: new Set(),
      };
    },
    logs: (ctx) => [logLine(ctx.actor.name, "전원 배제해라", `특정 역할 전원 배제를 제안했다.`)],
    hidden: false,
  },

  // =========================
  // 인간이라고 말해 (intuition 20) - 연쇄(선언/무시/중단)
  // =========================
  {
    name: "인간이라고 말해",
    kind: CMD_KIND.ROOT,
    req: [["intuition", 20]],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      hasAllowed(ctx.actor, "인간이라고 말해") &&
      meetsReq(ctx.actor, [["intuition", 20]]),
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "인간이라고 말해")) return;
      // 루프당 1회 제한은 game.js에서 관리 예정
      ensureSpoke(ctx);

      ctx.turn.rootCmd = "인간이라고 말해";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = null;
      ctx.turn.meta = {
        claims: new Map(), // id -> "CLAIM"|"SILENT"
      };
    },
    logs: (ctx) => [logLine(ctx.actor.name, "인간이라고 말해", `모두에게 "나는 인간이다"라고 말하라고 했다.`)],
    hidden: false,
  },

  {
    name: HIDDEN.HUMAN_CLAIM,
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) => ctx.phase === "DAY" && ctx.turn.rootCmd === "인간이라고 말해" && !ctx.turn.ended,
    apply: (ctx) => {
      if (!oncePerTurn(ctx, HIDDEN.HUMAN_CLAIM)) return;
      ensureSpoke(ctx);

      ctx.turn.meta.claims.set(ctx.actor.id, "CLAIM");

      // 인간이라고 말하는 순간, 인간이 아닌 진영(그노시아/버그)은 거짓말
      const trueRole = ctx.truth.roleOf?.get(ctx.actor.id);
      const isHumanSide = trueRole !== "그노시아" && trueRole !== "버그";
      const isLie = !isHumanSide; // AC주의자=인간이라 거짓말 아님
      ctx.truth.lieFlags.set(ctx.actor.id, isLie);

      // 직감 탐지 이벤트
      for (const otherId of ctx.aliveIds) {
        if (otherId === ctx.actor.id) continue;
        const bonus = ctx.effects.lieExposeBonus?.get(ctx.actor.id) ?? 0;
        tryDetectLie(ctx, otherId, ctx.actor.id, bonus);
      }
    },
    logs: (ctx) => [logLine(ctx.actor.name, "나는 인간이야", `인간이라고 선언했다.`)],
    hidden: true,
  },

  {
    name: HIDDEN.HUMAN_SILENT,
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) => ctx.phase === "DAY" && ctx.turn.rootCmd === "인간이라고 말해" && !ctx.turn.ended,
    apply: (ctx) => {
      if (!oncePerTurn(ctx, HIDDEN.HUMAN_SILENT)) return;
      ensureSpoke(ctx);
      ctx.turn.meta.claims.set(ctx.actor.id, "SILENT");
      // 침묵 자체가 의심 요인이므로, 주변이 약간 불신하게(단순)
      for (const listenerId of ctx.aliveIds) {
        if (listenerId === ctx.actor.id) continue;
        relAddTrust(ctx.rel, listenerId, ctx.actor.id, -1.2);
      }
    },
    logs: (ctx) => [logLine(ctx.actor.name, "선언하지 않는다", `아무 말도 하지 않았다.`)],
    hidden: true,
  },

  {
    name: HIDDEN.STOP,
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) => ctx.phase === "DAY" && ["인간이라고 말해", "잡담한다"].includes(ctx.turn.rootCmd) && !ctx.turn.ended,
    apply: (ctx) => {
      if (!oncePerTurn(ctx, HIDDEN.STOP)) return;
      ensureSpoke(ctx);
      // 중단자는 신뢰 크게 하락
      for (const listenerId of ctx.aliveIds) {
        if (listenerId === ctx.actor.id) continue;
        relAddTrust(ctx.rel, listenerId, ctx.actor.id, -6.5);
      }
      ctx.turn.ended = true;
    },
    logs: (ctx) => [logLine(ctx.actor.name, "중단시킨다", `대화를 중단시켰다. (신뢰 하락)`)],
    hidden: true,
  },

  // =========================
  // 잡담한다 (stealth 10) + 참여/중단
  // =========================
  {
    name: "잡담한다",
    kind: CMD_KIND.ROOT,
    req: [["stealth", 10]],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      hasAllowed(ctx.actor, "잡담한다") &&
      meetsReq(ctx.actor, [["stealth", 10]]),
    apply: (ctx) => {
      if (!oncePerDay(ctx, "잡담한다")) return;
      if (!oncePerTurn(ctx, "잡담한다")) return;
      ensureSpoke(ctx);

      ctx.turn.rootCmd = "잡담한다";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = null;
      ctx.turn.meta = { participants: new Set([ctx.actor.id]) };

      // 어그로 낮춤(스텔스)
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) - 1.0);
    },
    logs: (ctx) => [logLine(ctx.actor.name, "잡담한다", `잡담을 시작했다.`)],
    hidden: false,
  },

  {
    name: HIDDEN.CHAT_JOIN,
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) => ctx.phase === "DAY" && ctx.turn.rootCmd === "잡담한다" && !ctx.turn.ended,
    apply: (ctx) => {
      if (!oncePerTurn(ctx, HIDDEN.CHAT_JOIN)) return;
      ensureSpoke(ctx);

      ctx.turn.meta.participants.add(ctx.actor.id);

      // 참가자들끼리 우호도 상승(상호)
      const ids = Array.from(ctx.turn.meta.participants);
      for (const a of ids) {
        for (const b of ids) {
          if (a === b) continue;
          relAddLike(ctx.rel, a, b, 1.2);
        }
      }
    },
    logs: (ctx) => [logLine(ctx.actor.name, "잡담에 참여한다", `잡담에 참여했다.`)],
    hidden: true,
  },

  // =========================
  // 감사한다 (방금 감싸짐/인간 확정 직후)
  // =========================
  {
    name: "감사한다",
    kind: CMD_KIND.REACT,
    req: [],
    canUse: (ctx) => ctx.phase === "DAY" && hasAllowed(ctx.actor, "감사한다") && !ctx.turn.ended,
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "감사한다")) return;
      ensureSpoke(ctx);

      // 대상(감싸준 사람)이 ctx.target로 들어온다고 가정
      const benefactor = ctx.target;
      if (!benefactor) return;

      // 어그로 감소 + benefactor에 대한 호감 상승
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) - clamp(0.6 + stat(ctx.actor, "charm") * 0.02, 0.6, 1.6));
      relAddLike(ctx.rel, ctx.actor.id, benefactor.id, 3.0);
    },
    logs: (ctx) => [logLine(ctx.actor.name, "감사한다", `${ctx.target?.name ?? "상대"}에게 감사했다.`)],
    hidden: false,
  },

  // =========================
  // 시끄러워 (상대가 너무 말 많을 때)
  // =========================
  {
    name: "시끄러워",
    kind: CMD_KIND.FOLLOW,
    req: [],
    canUse: (ctx) => ctx.phase === "DAY" && hasAllowed(ctx.actor, "시끄러워") && !ctx.turn.ended,
    apply: (ctx) => {
      if (!oncePerTurn(ctx, "시끄러워")) return;
      ensureSpoke(ctx);
      const t = ctx.target;
      if (!t) return;
      // 말 많음 지적: 주변이 t를 조금 덜 믿게
      for (const listenerId of ctx.aliveIds) {
        if (listenerId === ctx.actor.id) continue;
        relAddTrust(ctx.rel, listenerId, t.id, -1.8);
      }
      ctx.effects.hate.set(ctx.actor.id, (ctx.effects.hate.get(ctx.actor.id) ?? 0) + hateGain(ctx.actor, 0.6));
    },
    logs: (ctx) => [logLine(ctx.actor.name, "시끄러워", `${ctx.target?.name ?? "상대"}가 말이 많다고 지적했다.`)],
    hidden: false,
  },

  // =========================
  // 협력하자 (charm 15) - (낮 커맨드)
  // =========================
  {
    name: "협력하자",
    kind: CMD_KIND.ROOT,
    req: [["charm", 15]],
    canUse: (ctx) =>
      ctx.phase === "DAY" &&
      !!ctx.target &&
      hasAllowed(ctx.actor, "협력하자") &&
      meetsReq(ctx.actor, [["charm", 15]]),
    apply: (ctx) => {
      if (!oncePerDay(ctx, "협력하자")) return;
      if (!oncePerTurn(ctx, "협력하자")) return;
      ensureSpoke(ctx);

      ctx.turn.rootCmd = "협력하자";
      ctx.turn.rootActorId = ctx.actor.id;
      ctx.turn.targetId = ctx.target.id;
      ctx.turn.ended = true;

      // 성공 여부는 charm + 상대의 성향/우호는 game.js에서 확률 보정 예정
      // 여기서는 "요청 이벤트"만 기록
      ctx.events.push({ type: "COOP_REQUEST", fromId: ctx.actor.id, toId: ctx.target.id });
    },
    logs: (ctx) => [logLine(ctx.actor.name, "협력하자", `${ctx.target.name}에게 협력을 제안했다.`)],
    hidden: false,
  },

  // =========================
  // 도게자한다 (stealth 35) - 투표 결과 콜드슬립 대상일 때(게임 엔진에서 호출)
  // =========================
  {
    name: "도게자한다",
    kind: CMD_KIND.REACT,
    req: [["stealth", 35]],
    canUse: (ctx) => ctx.phase === "DAY" && hasAllowed(ctx.actor, "도게자한다") && meetsReq(ctx.actor, [["stealth", 35]]),
    apply: (ctx) => {
      // 이 커맨드는 "콜드슬립 확정 직후"에만 엔진이 호출할 예정이라 once 제한 생략 가능
      ensureSpoke(ctx);
      // 회피 확률 이벤트만 기록 (연기력 기반)
      const p = clamp(0.10 + stat(ctx.actor, "acting") * 0.01, 0.10, 0.55);
      ctx.events.push({ type: "DGEJZA", actorId: ctx.actor.id, pAvoid: p });
    },
    logs: (ctx) => [logLine(ctx.actor.name, "도게자한다", `도게자를 했다.`)],
    hidden: false,
  },

  // =========================
  // NIGHT: 협력요청 (너가 추가한 커맨드)
  // =========================
  {
    name: "밤:협력요청",
    kind: CMD_KIND.ROOT,
    req: [],
    canUse: (ctx) => ctx.phase === "NIGHT_FREE" && !!ctx.target && hasAllowed(ctx.actor, "밤:협력요청"),
    apply: (ctx) => {
      if (!oncePerDay(ctx, "밤:협력요청")) return;
      ensureSpoke(ctx);
      // 성공/거절 확률은 game.js에서 계산하도록 이벤트만 발생
      ctx.events.push({ type: "NIGHT_COOP_REQUEST", fromId: ctx.actor.id, toId: ctx.target.id });
    },
    logs: (ctx) => [logLine(ctx.actor.name, "밤:협력요청", `${ctx.target.name}에게 밤에 협력 요청을 했다.`)],
    hidden: false,
  },
]);

// -------------------------------------------------------
// 커맨드 맵
// -------------------------------------------------------
export const COMMAND_MAP = new Map(COMMANDS.map((c) => [c.name, c]));

// UI에 보여줄 커맨드 목록(숨김 제외)
export function listVisibleCommands() {
  return COMMANDS.filter((c) => !c.hidden).map((c) => ({ name: c.name, req: c.req ?? [] }));
}

// 캐릭터가 “스탯 조건상 가능”한 커맨드 리스트(유저 체크 후보)
export function listEligibleCommandsByStats(character) {
  return COMMANDS
    .filter((c) => !c.hidden)
    .filter((c) => meetsReq(character, c.req))
    .map((c) => c.name);
}

// -------------------------------------------------------
// 커맨드 실행 API
// -------------------------------------------------------
export function createEmptyTurnCtx() {
  return {
    rootCmd: null,
    rootActorId: null,
    targetId: null,
    blockCounter: false,
    blockTargetId: null,
    spokeIds: new Set(),
    ended: false,
    meta: {},
  };
}

/**
 * 실행 가능한 커맨드인지 최종 판정
 * - allowedCommands(유저 체크)
 * - req(스탯)
 * - canUse(턴 문맥)
 */
export function canUseCommand(ctx, cmdName) {
  const def = COMMAND_MAP.get(cmdName);
  if (!def) return false;

  // 숨김 커맨드는 allowed 체크 생략, 그 외는 allowed 필요
  if (!def.hidden && !hasAllowed(ctx.actor, def.name)) return false;

  // 스탯 조건
  if (!meetsReq(ctx.actor, def.req)) return false;

  // 턴/페이즈 조건
  return def.canUse(ctx);
}

/**
 * 커맨드 실행(효과 적용 + 로그 반환)
 * @returns {{ok:boolean, logs:string[]}}
 */
export function runCommand(ctx, cmdName) {
  const def = COMMAND_MAP.get(cmdName);
  if (!def) return { ok: false, logs: [] };
  if (!canUseCommand(ctx, cmdName)) return { ok: false, logs: [] };

  def.apply(ctx);
  const logs = def.logs(ctx) ?? [];
  return { ok: true, logs };
}

// -------------------------------------------------------
// 엔진이 “턴 연쇄”를 만들 때 쓸 도우미
// - 특정 루트에 대해 가능한 FOLLOW/REACT 후보를 뽑는 함수
// -------------------------------------------------------
export function getFollowUpCandidates(ctx) {
  // 턴의 현재 rootCmd에 따라 가능한 후보 커맨드들
  const candidates = [];

  for (const def of COMMANDS) {
    if (def.kind === CMD_KIND.FOLLOW || def.kind === CMD_KIND.REACT) {
      if (canUseCommand(ctx, def.name)) candidates.push(def.name);
    }
  }
  return candidates;
}

export function getHiddenCandidates(ctx) {
  const candidates = [];
  for (const def of COMMANDS) {
    if (def.hidden && (def.kind === CMD_KIND.FOLLOW || def.kind === CMD_KIND.REACT)) {
      if (canUseCommand(ctx, def.name)) candidates.push(def.name);
    }
  }
  return candidates;
}

// -------------------------------------------------------
// 거짓말 감지 이벤트를 로그 문자열로 바꾸는 유틸
// (game.js가 events를 모아 로그로 출력할 때 사용)
// -------------------------------------------------------
export function renderEventsToLogs(ctx) {
  const out = [];
  for (const e of ctx.events ?? []) {
    if (e.type === "LIE_DETECTED") {
      const a = ctx.charactersById.get(e.detectorId);
      const b = ctx.charactersById.get(e.liarId);
      if (a && b) out.push(`${a.name}이(가) ${b.name}의 거짓말을 눈치챘다.`);
    }
  }
  return out;
}

