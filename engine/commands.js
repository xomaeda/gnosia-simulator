// /engine/commands.js
// Gnosia-like Simulator — Command Catalog (Complete)
// Author: (generated)
// NOTE: This module is intentionally self-contained and data-driven.
// It exports:
//  - COMMANDS: Map of commandId -> CommandDef
//  - PUBLIC_COMMAND_ORDER: for UI listing (only public commands)
//  - getCommandDef(id)
//  - listPublicCommands()
//  - computeEligiblePublicCommandsForCharacter(state, charId): based on STAT req only
//  - getUsableCommands(state, ctx, speakerId): based on STAT req + context (root/phase/limits)
//  - buildCommandIntent(state, ctx, action): validates & returns intent events (no state mutation here)
//
// game.js will:
//  - manage turn sessions (root + subcommands in one turn)
//  - apply intents to the state (relations/aggro/claims/cooldowns)
//  - enforce “1 character 1 action per turn” using ctx.turnUsage
//
// This file encodes your spec:
//  - Root vs accessory commands (부속 커맨드)
//  - “block rebuttal” that prevents counter-defend/rebut in that turn unless askHelp succeeds
//  - “vote/avoid vote/eliminate all role/say human/smalltalk” accept/oppose/stop flows
//  - A new Night action: “협력 요청(밤)” (no stat req, user-checkable)

export const CommandPhase = Object.freeze({
  DAY_START: "day_start",        // turn root candidates (start of a turn in daytime)
  DAY_REACT: "day_react",        // accessory / reactions inside same turn session
  DAY_VOTE: "day_vote",          // vote proposals turn root candidates
  NIGHT_FREE: "night_free",      // free actions phase 1
  NIGHT_RESOLVE: "night_resolve" // special role execution handled elsewhere
});

export const CommandKind = Object.freeze({
  ROOT: "root",
  ACCESSORY: "accessory",
  INTERNAL: "internal" // not shown to user (찬성/반대/중단/참여/선언 등)
});

export const TargetType = Object.freeze({
  NONE: "none",
  SINGLE: "single",
  ROLE: "role",       // pick a role name for “전원 배제해라”
  SELF: "self",
  MULTI: "multi"      // engine decides participants
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

export function getCommandDef(id) {
  return COMMANDS[id] || null;
}

export function listPublicCommands() {
  return PUBLIC_COMMAND_ORDER.map((id) => COMMANDS[id]).filter(Boolean);
}

// ----- State shape expectations (engine contract) -----
// state = {
//   day: number, phase: one of CommandPhase,
//   characters: [{ id, name, alive, role, stats, personality, aggro, flags, claims, cooldowns, perDayUsed, enabledCommands }],
//   relations: { trust: number[][], like: number[][] }, // directed [from][to] in 0..100
//   rng(): float 0..1,
// }
// stats: { charisma, logic, acting, charm, stealth, intuition } each 0..50 (float ok)
// personality: { cheer, social, logical, kindness, desire, courage } each 0..1 (float)
// enabledCommands: Set<string> chosen by user (subset of eligible public commands)
//
// ctx = {
//   phase: CommandPhase,
//   day: number,
//   turnIndex: number, // 1..5 in daytime (for your system)
//   session: {
//     rootAction: Action | null,
//     chain: Action[], // applied actions in this turn session
//     // Session flags:
//     blockedRebuttal: boolean,
//     blockedRebuttalTargetId: string|null,
//     allowHelpBreakBlock: boolean,
//     // Proposal context (vote / sayHuman / smalltalk / eliminateAllRole):
//     proposalType: null|"vote_for"|"vote_avoid"|"eliminate_role"|"say_human"|"smalltalk",
//     proposalData: any,
//     proposalOpen: boolean,
//     // for sayHuman / smalltalk, can be stopped
//     stopped: boolean,
//     // track participants for smalltalk
//     smalltalkParticipants: Set<charId>
//   },
//   turnUsage: Set<charId> // who already acted this turn session (1 action per char)
// }
//
// action = { cmdId, speakerId, targetId?, roleName?, meta? }
//
// IMPORTANT: This module never mutates state. It returns intents (events).
// engine applies events and builds logs.

function getChar(state, id) {
  return state.characters.find((c) => c.id === id) || null;
}

function aliveCharIds(state) {
  return state.characters.filter((c) => c.alive).map((c) => c.id);
}

function stat(c, key) {
  const v = c?.stats?.[key];
  return isNum(v) ? v : 0;
}

function pers(c, key) {
  const v = c?.personality?.[key];
  return isNum(v) ? v : 0;
}

function canUseByStat(c, req = {}) {
  // req: { charisma?:n, logic?:n, acting?:n, charm?:n, stealth?:n, intuition?:n }
  for (const k of Object.keys(req)) {
    if (stat(c, k) < req[k]) return false;
  }
  return true;
}

function isEnabledByUser(c, cmdId) {
  // enabledCommands is user selection (checkbox) for public commands
  // internal commands ignore this
  const def = COMMANDS[cmdId];
  if (!def) return false;
  if (def.kind === CommandKind.INTERNAL) return true;
  if (!c.enabledCommands) return false;
  return c.enabledCommands.has(cmdId);
}

function isAliveTarget(state, targetId) {
  const t = getChar(state, targetId);
  return !!t && t.alive;
}

// ---- Impact model helpers (numbers are tuned defaults, can be rebalanced later) ----
// Relations are 0..100. 50 ~ neutral.
// “Attack trust/like” etc. Engine will clamp.
// charisma influences “pull supporters” at session-level; here we express supporter-capable attacks.

function baseTrustAttack(c) {
  // logic-driven
  return 2.0 + stat(c, "logic") * 0.35; // 2..19.5
}
function baseLikeAttack(c) {
  // acting-driven
  return 2.0 + stat(c, "acting") * 0.35;
}
function baseDefendHealTrust(c) {
  return 1.5 + stat(c, "logic") * 0.28;
}
function baseDefendHealLike(c) {
  return 1.5 + stat(c, "acting") * 0.28;
}
function aggroGainForSpeaking(c) {
  // stealth reduces aggro gain
  const raw = 3.5; // default per command
  const s = stat(c, "stealth"); // 0..50
  return raw * (1.0 - clamp(s / 80, 0, 0.55)); // up to -55%
}
function aggroDropForCute(c, strength = 1) {
  // charm helps reduce being voted/targeted
  return (2.0 + stat(c, "charm") * 0.20) * strength; // 2..12
}

// Intuition/Acting lie system hooks: the engine will decide if a statement is a lie (role claim etc).
// Here we provide a helper for detection chance.
export function computeLieDetectionChance(observer, liar) {
  // intuition raises detection, liar acting reduces it.
  const i = stat(observer, "intuition"); // 0..50
  const a = stat(liar, "acting");        // 0..50
  const base = 0.06;                     // 6%
  const bonus = i * 0.010;               // +0..50%
  const resist = a * 0.007;              // -0..35%
  return clamp(base + bonus - resist, 0.01, 0.75);
}

// -----------------------------------------------------
// Command definitions
// Each def:
// {
//   id, name, kind, phaseTags: [CommandPhase...], targetType,
//   statReq: {...}, public: boolean, perDayLimit?:n, perLoopLimit?:n,
//   isAccessoryAfter?: (rootCmdId, ctx)=>boolean,
//   usableIf?: (state, ctx, speakerId, actionDraft)=>{ok:boolean, reason?:string},
//   buildIntent: (state, ctx, action)=>Intent
// }
//
// Intent is { events: Event[], flags?: any }
// Event examples:
// { type:"REL_TRUST_DELTA", fromId, toId, delta }
// { type:"REL_LIKE_DELTA", fromId, toId, delta }
// { type:"AGGRO_DELTA", charId, delta }
// { type:"SESSION_FLAG", key, value }
// { type:"CLAIM_ROLE", charId, roleName, isLie?:boolean }
// { type:"REQUEST_HELP", speakerId, targetId, successChance }
// { type:"HELP_BREAK_BLOCK", successChance }
// { type:"PROPOSAL_OPEN", proposalType, data }
// { type:"PROPOSAL_VOTE_WEIGHT", targetId, weightDelta, sourceId }
// { type:"MARK_CERTAIN_HUMAN", targetId, byId }
// { type:"MARK_CERTAIN_ENEMY", targetId, byId }
// { type:"TURN_LOG", text, meta? } // engine may replace with your real text patterns later
//
// engine decides supporter behavior; we encode “supportable” as flags in events.
// e.g. REL_ATTACK_SUPPORTABLE means other chars can add damage.

function mustBeDifferentTarget(action) {
  return action.targetId && action.targetId !== action.speakerId;
}

function requireRoot(ctx) {
  return !!ctx.session?.rootAction;
}

function rootCmdId(ctx) {
  return ctx.session?.rootAction?.cmdId || null;
}

function isTurnStopped(ctx) {
  return !!ctx.session?.stopped;
}

function isBlockedRebuttal(ctx) {
  return !!ctx.session?.blockedRebuttal;
}

function blockTarget(ctx) {
  return ctx.session?.blockedRebuttalTargetId || null;
}

function enforceOneActionPerTurn(ctx, speakerId) {
  if (ctx.turnUsage && ctx.turnUsage.has(speakerId)) {
    return { ok: false, reason: "이 턴에서 이미 행동했습니다." };
  }
  return { ok: true };
}

function enforceAliveSpeaker(state, speakerId) {
  const s = getChar(state, speakerId);
  if (!s || !s.alive) return { ok: false, reason: "사망한 인물은 행동할 수 없습니다." };
  return { ok: true };
}

function enforceAliveTargetIfNeeded(state, def, action) {
  if (def.targetType === TargetType.SINGLE) {
    if (!action.targetId) return { ok: false, reason: "대상이 필요합니다." };
    if (!isAliveTarget(state, action.targetId)) return { ok: false, reason: "대상은 생존 인물이어야 합니다." };
    if (!mustBeDifferentTarget(action)) return { ok: false, reason: "자기 자신을 대상으로 할 수 없습니다." };
  }
  return { ok: true };
}

function enforcePhase(def, ctx) {
  if (!def.phaseTags.includes(ctx.phase)) return { ok: false, reason: "지금 단계에서는 사용할 수 없습니다." };
  return { ok: true };
}

function enforceStatAndEnabled(state, speakerId, cmdId) {
  const s = getChar(state, speakerId);
  const def = COMMANDS[cmdId];
  if (!s || !def) return { ok: false, reason: "잘못된 명령입니다." };
  if (!canUseByStat(s, def.statReq || {})) return { ok: false, reason: "스테이터스 조건이 부족합니다." };
  if (!isEnabledByUser(s, cmdId)) return { ok: false, reason: "이 인물은 이 커맨드를 사용하지 않도록 설정되어 있습니다." };
  return { ok: true };
}

function enforceAccessoryWindow(def, ctx) {
  if (def.kind !== CommandKind.ACCESSORY) return { ok: true };
  if (!requireRoot(ctx)) return { ok: false, reason: "부속 커맨드는 루트 커맨드 뒤에만 사용할 수 있습니다." };
  const r = rootCmdId(ctx);
  if (def.isAccessoryAfter && !def.isAccessoryAfter(r, ctx)) {
    return { ok: false, reason: "지금 커맨드 흐름에서는 사용할 수 없습니다." };
  }
  return { ok: true };
}

function enforceBlockRebuttalRule(def, ctx, action) {
  // If rebuttal is blocked, nobody can “defend/rebut (counter to root)” against the root claim target.
  // BUT if askHelp succeeds, the block is lifted in that turn.
  if (!isBlockedRebuttal(ctx)) return { ok: true };

  const blockedTarget = blockTarget(ctx);
  if (!blockedTarget) return { ok: true };

  // define which commands are “counter arguments”:
  const counterCmds = new Set([
    "DEFEND", "JOIN_DEFEND", "COVER", "JOIN_COVER" // defending the attacked target
  ]);

  if (counterCmds.has(def.id)) {
    // If they try to defend the blocked target in this turn, deny.
    if (action.targetId === blockedTarget) {
      return { ok: false, reason: "이번 턴에서는 반론이 봉쇄되어 변호할 수 없습니다." };
    }
  }
  return { ok: true };
}

// Proposal flow: if proposal open, allow only agree/oppose/stop + some direct reactions.
function enforceProposalFlow(def, ctx) {
  if (!ctx.session?.proposalOpen) return { ok: true };
  const allowed = new Set([
    "AGREE", "OPPOSE", "STOP",
    // also allow ASK_HELP by targeted person if block exists,
    "ASK_HELP"
  ]);
  if (allowed.has(def.id)) return { ok: true };
  return { ok: false, reason: "지금은 제안에 대한 찬반/중단만 가능합니다." };
}

// Say-human / Smalltalk flows:
function enforceSayHumanFlow(def, ctx) {
  if (ctx.session?.proposalType !== "say_human") return { ok: true };
  const allowed = new Set(["DECLARE_HUMAN", "STOP"]);
  if (allowed.has(def.id)) return { ok: true };
  return { ok: false, reason: "지금은 '나는 인간이다' 선언 또는 중단만 가능합니다." };
}
function enforceSmalltalkFlow(def, ctx) {
  if (ctx.session?.proposalType !== "smalltalk") return { ok: true };
  const allowed = new Set(["PARTICIPATE_SMALLTALK", "STOP"]);
  if (allowed.has(def.id)) return { ok: true };
  return { ok: false, reason: "지금은 잡담 참여 또는 중단만 가능합니다." };
}

// ----- Command Catalog -----

const make = (def) => def;

export const COMMANDS = Object.freeze({
  // --- INTERNAL (not shown to user) ---
  AGREE: make({
    id: "AGREE",
    name: "찬성한다",
    kind: CommandKind.INTERNAL,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: {},
    buildIntent: (state, ctx, action) => ({
      events: [
        { type: "TURN_LOG", text: `${getChar(state, action.speakerId).name}:[찬성한다] 찬성.` },
        { type: "PROPOSAL_VOTE_WEIGHT", targetId: ctx.session?.proposalData?.targetId ?? null, weightDelta: +1, sourceId: action.speakerId }
      ]
    })
  }),

  OPPOSE: make({
    id: "OPPOSE",
    name: "반대한다",
    kind: CommandKind.INTERNAL,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: {},
    buildIntent: (state, ctx, action) => ({
      events: [
        { type: "TURN_LOG", text: `${getChar(state, action.speakerId).name}:[반대한다] 반대.` },
        { type: "PROPOSAL_CLOSE", reason: "opposed" } // engine ends turn immediately on oppose (per spec)
      ]
    })
  }),

  STOP: make({
    id: "STOP",
    name: "중단시킨다",
    kind: CommandKind.INTERNAL,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: {},
    buildIntent: (state, ctx, action) => ({
      events: [
        { type: "TURN_LOG", text: `${getChar(state, action.speakerId).name}:[중단] 이만하자.` },
        { type: "SESSION_FLAG", key: "stopped", value: true },
        { type: "PROPOSAL_CLOSE", reason: "stopped" }
      ]
    })
  }),

  DECLARE_HUMAN: make({
    id: "DECLARE_HUMAN",
    name: "나는 인간이야",
    kind: CommandKind.INTERNAL,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: {},
    buildIntent: (state, ctx, action) => ({
      events: [
        { type: "TURN_LOG", text: `${getChar(state, action.speakerId).name}:[선언] 나는 인간이야.` },
        // engine will evaluate if this is a lie and run detection events:
        { type: "STATEMENT", speakerId: action.speakerId, statementType: "DECLARE_HUMAN" }
      ]
    })
  }),

  PARTICIPATE_SMALLTALK: make({
    id: "PARTICIPATE_SMALLTALK",
    name: "잡담에 참여한다",
    kind: CommandKind.INTERNAL,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: {},
    buildIntent: (state, ctx, action) => ({
      events: [
        { type: "TURN_LOG", text: `${getChar(state, action.speakerId).name}:[참여] 잡담에 끼어든다.` },
        { type: "SMALLTALK_JOIN", charId: action.speakerId }
      ]
    })
  }),

  // --- PUBLIC ROOT & ACCESSORY ---
  SUSPECT: make({
    id: "SUSPECT",
    name: "의심한다",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.SINGLE,
    statReq: {},
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      const trustDmg = baseTrustAttack(s);
      const likeDmg = baseLikeAttack(s);
      const ag = aggroGainForSpeaking(s);

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[의심한다] ${t.name}... 뭔가 수상해.` },
          // Supportable attack: other chars may stack onto this (charisma / their own stats handled in game.js)
          { type: "REL_ATTACK_SUPPORTABLE", axis: "trust", targetId: t.id, base: trustDmg, sourceId: s.id },
          { type: "REL_ATTACK_SUPPORTABLE", axis: "like", targetId: t.id, base: likeDmg, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag },
          { type: "SESSION_FLAG", key: "proposalOpen", value: true },
          { type: "SESSION_FLAG", key: "proposalType", value: null },
          { type: "SESSION_FLAG", key: "proposalData", value: { rootType: "suspect", targetId: t.id } }
        ]
      };
    }
  }),

  AGREE_SUSPECT: make({
    id: "AGREE_SUSPECT",
    name: "의심에 동의한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE, // implied target = root target
    statReq: {},
    isAccessoryAfter: (rootId) => rootId === "SUSPECT",
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const root = ctx.session.rootAction;
      const t = getChar(state, root.targetId);
      const trustDmg = baseTrustAttack(s) * 0.55;
      const likeDmg = baseLikeAttack(s) * 0.55;
      const ag = aggroGainForSpeaking(s) * 0.60;

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[의심에 동의한다] ${t.name} 말이야... 나도 그렇게 생각해.` },
          { type: "REL_ATTACK_SUPPORT_ADD", axis: "trust", targetId: t.id, add: trustDmg, sourceId: s.id },
          { type: "REL_ATTACK_SUPPORT_ADD", axis: "like", targetId: t.id, add: likeDmg, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag }
        ]
      };
    }
  }),

  DENY: make({
    id: "DENY",
    name: "부정한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE, // only usable by root target
    statReq: {},
    isAccessoryAfter: (rootId, ctx) => rootId === "SUSPECT",
    usableIf: (state, ctx, speakerId) => {
      const root = ctx.session.rootAction;
      if (!root || root.cmdId !== "SUSPECT") return { ok: false, reason: "부정은 의심 직후에만 가능합니다." };
      if (root.targetId !== speakerId) return { ok: false, reason: "의심당한 본인만 부정할 수 있습니다." };
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const healT = baseDefendHealTrust(s);
      const healL = baseDefendHealLike(s);
      const ag = aggroGainForSpeaking(s) * 0.85;

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[부정한다] 아니야, 난 아니야.` },
          // Recover own public perception somewhat (engine will apply as others' trust/like toward s)
          { type: "SELF_DEFEND", charId: s.id, healTrust: healT, healLike: healL },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag },
          // Deny can “cut” further easy piling-on; engine may reduce further support probability
          { type: "SESSION_FLAG", key: "denyUsed", value: true }
        ]
      };
    }
  }),

  DEFEND: make({
    id: "DEFEND",
    name: "변호한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE, // implied target = root target (who is being suspected)
    statReq: {},
    isAccessoryAfter: (rootId) => rootId === "SUSPECT" || rootId === "DENY",
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const root = ctx.session.rootAction;
      const targetId = root?.targetId;
      const t = getChar(state, targetId);
      const healT = baseDefendHealTrust(s);
      const healL = baseDefendHealLike(s);
      const ag = aggroGainForSpeaking(s);

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[변호한다] ${t.name}는 아닐 거야.` },
          { type: "REL_DEFEND_SUPPORTABLE", axis: "trust", targetId: t.id, base: healT, sourceId: s.id },
          { type: "REL_DEFEND_SUPPORTABLE", axis: "like", targetId: t.id, base: healL, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag }
        ]
      };
    }
  }),

  JOIN_DEFEND: make({
    id: "JOIN_DEFEND",
    name: "변호에 가담한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: {},
    isAccessoryAfter: (rootId) => rootId === "DEFEND" || rootId === "SUSPECT" || rootId === "DENY",
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const root = ctx.session.rootAction;
      const t = getChar(state, root.targetId);
      const healT = baseDefendHealTrust(s) * 0.55;
      const healL = baseDefendHealLike(s) * 0.55;
      const ag = aggroGainForSpeaking(s) * 0.60;

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[변호에 가담한다] 나도 동의해.` },
          { type: "REL_DEFEND_SUPPORT_ADD", axis: "trust", targetId: t.id, add: healT, sourceId: s.id },
          { type: "REL_DEFEND_SUPPORT_ADD", axis: "like", targetId: t.id, add: healL, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag }
        ]
      };
    }
  }),

  COVER: make({
    id: "COVER",
    name: "감싼다",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.SINGLE,
    statReq: {},
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      const healT = baseDefendHealTrust(s);
      const healL = baseDefendHealLike(s);
      const ag = aggroGainForSpeaking(s);

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[감싼다] ${t.name}는 안전해.` },
          { type: "REL_DEFEND_SUPPORTABLE", axis: "trust", targetId: t.id, base: healT, sourceId: s.id },
          { type: "REL_DEFEND_SUPPORTABLE", axis: "like", targetId: t.id, base: healL, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag }
        ]
      };
    }
  }),

  JOIN_COVER: make({
    id: "JOIN_COVER",
    name: "함께 감싼다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: {},
    isAccessoryAfter: (rootId) => rootId === "COVER",
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const root = ctx.session.rootAction;
      const t = getChar(state, root.targetId);
      const healT = baseDefendHealTrust(s) * 0.55;
      const healL = baseDefendHealLike(s) * 0.55;
      const ag = aggroGainForSpeaking(s) * 0.60;

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[함께 감싼다] 나도 그렇게 생각해.` },
          { type: "REL_DEFEND_SUPPORT_ADD", axis: "trust", targetId: t.id, add: healT, sourceId: s.id },
          { type: "REL_DEFEND_SUPPORT_ADD", axis: "like", targetId: t.id, add: healL, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag }
        ]
      };
    }
  }),

  THANK: make({
    id: "THANK",
    name: "감사한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.SINGLE, // thank the defender
    statReq: {},
    usableIf: (state, ctx, speakerId, draft) => {
      // usable right after being covered/defended OR after being marked certainly human (game.js sets session flags)
      const okByFlag = !!ctx.session?.thankWindow?.has?.(speakerId);
      if (!okByFlag) return { ok: false, reason: "지금은 감사할 타이밍이 아닙니다." };
      if (!draft.targetId) return { ok: false, reason: "감사할 대상이 필요합니다." };
      if (!isAliveTarget(state, draft.targetId)) return { ok: false, reason: "대상은 생존 인물이어야 합니다." };
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      const drop = aggroDropForCute(s, 1.0);
      const likeUp = 2.0 + stat(s, "charm") * 0.25;

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[감사한다] ${t.name}, 고마워.` },
          { type: "AGGRO_DELTA", charId: s.id, delta: -drop },
          { type: "REL_LIKE_DELTA", fromId: s.id, toId: t.id, delta: +likeUp }
        ]
      };
    }
  }),

  REBUT: make({
    id: "REBUT",
    name: "반론한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE, // implied target = root target of COVER or proposal target, etc.
    statReq: {},
    isAccessoryAfter: (rootId, ctx) => rootId === "COVER" || rootId === "VOTE_FOR" || rootId === "VOTE_AVOID",
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      // Determine rebut target:
      const rt = ctx.session?.rootAction;
      const proposal = ctx.session?.proposalData;
      let targetId = rt?.targetId ?? proposal?.targetId ?? null;
      const t = getChar(state, targetId);

      const trustDmg = baseTrustAttack(s);
      const likeDmg = baseLikeAttack(s);
      const ag = aggroGainForSpeaking(s);

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[반론한다] ${t.name}는 위험해.` },
          { type: "REL_ATTACK_SUPPORTABLE", axis: "trust", targetId: t.id, base: trustDmg, sourceId: s.id },
          { type: "REL_ATTACK_SUPPORTABLE", axis: "like", targetId: t.id, base: likeDmg, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag }
        ]
      };
    }
  }),

  JOIN_REBUT: make({
    id: "JOIN_REBUT",
    name: "반론에 가담한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: {},
    isAccessoryAfter: (rootId) => rootId === "REBUT",
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const rt = ctx.session?.rootAction;
      const proposal = ctx.session?.proposalData;
      const targetId = rt?.targetId ?? proposal?.targetId ?? null;
      const t = getChar(state, targetId);

      const trustDmg = baseTrustAttack(s) * 0.55;
      const likeDmg = baseLikeAttack(s) * 0.55;
      const ag = aggroGainForSpeaking(s) * 0.60;

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[반론에 가담한다] 나도 동의해.` },
          { type: "REL_ATTACK_SUPPORT_ADD", axis: "trust", targetId: t.id, add: trustDmg, sourceId: s.id },
          { type: "REL_ATTACK_SUPPORT_ADD", axis: "like", targetId: t.id, add: likeDmg, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag }
        ]
      };
    }
  }),

  NOISY: make({
    id: "NOISY",
    name: "시끄러워",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.SINGLE,
    statReq: {},
    usableIf: (state, ctx, speakerId, draft) => {
      // usable when someone is “talking too much” and started with suspect/cover
      if (!draft.targetId) return { ok: false, reason: "대상이 필요합니다." };
      const okWindow = !!ctx.session?.noisyWindow?.has?.(draft.targetId);
      if (!okWindow) return { ok: false, reason: "지금은 사용할 수 없습니다." };
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      const trustDmg = 2.5 + stat(s, "logic") * 0.20;
      const ag = aggroGainForSpeaking(s) * 0.70;
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[시끄러워] ${t.name}, 말이 너무 많아.` },
          { type: "REL_TRUST_DELTA_PUBLIC", toId: t.id, delta: -trustDmg, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag }
        ]
      };
    }
  }),

  CLAIM_ROLE: make({
    id: "CLAIM_ROLE",
    name: "역할을 밝힌다",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.NONE,
    statReq: {},
    perDayLimit: 1, // per role per day enforced in roles.js/game.js
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      // action.meta.roleName must be set by AI/user to a claimable role
      const roleName = action.meta?.roleName || "선원";
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[역할을 밝힌다] (${roleName}라고 선언한다.)` },
          { type: "CLAIM_ROLE", charId: s.id, roleName },
          { type: "STATEMENT", speakerId: s.id, statementType: "ROLE_CLAIM", roleName }
        ]
      };
    }
  }),

  CLAIM_TOO: make({
    id: "CLAIM_TOO",
    name: "자신도 밝힌다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: {},
    isAccessoryAfter: (rootId) => rootId === "CLAIM_ROLE" || rootId === "DEMAND_CLAIM",
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const roleName = action.meta?.roleName || "선원";
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[자신도 밝힌다] (나도 ${roleName}야.)` },
          { type: "CLAIM_ROLE", charId: s.id, roleName },
          { type: "STATEMENT", speakerId: s.id, statementType: "ROLE_CLAIM", roleName }
        ]
      };
    }
  }),

  DEMAND_CLAIM: make({
    id: "DEMAND_CLAIM",
    name: "역할을 밝혀라",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.NONE,
    statReq: { charisma: 10 },
    perDayLimit: 1, // “same role once per day” enforced later (roleName-specific)
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const demandedRole = action.meta?.roleName || "엔지니어"; // engine/AI sets which role is demanded
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[역할을 밝혀라] ${demandedRole}는 나와봐.` },
          // Open a “claim window” in this turn: eligible claimers may respond with CLAIM_ROLE / CLAIM_TOO
          { type: "SESSION_FLAG", key: "proposalOpen", value: true },
          { type: "SESSION_FLAG", key: "proposalType", value: "claim_role" },
          { type: "SESSION_FLAG", key: "proposalData", value: { demandedRole } },
          { type: "AGGRO_DELTA", charId: s.id, delta: +aggroGainForSpeaking(s) }
        ]
      };
    }
  }),

  EXAGGERATE: make({
    id: "EXAGGERATE",
    name: "과장해서 말한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: { acting: 15 },
    isAccessoryAfter: (rootId) => new Set(["SUSPECT","COVER","DEFEND","REBUT"]).has(rootId),
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      // This increases LIKE-axis impact of the current supportable action in session.
      const boost = 1.0 + stat(s, "acting") / 60; // ~1.25 at 15, up to 1.83 at 50
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[과장해서 말한다] (감정적으로 강하게 말한다.)` },
          { type: "SESSION_MOD", key: "likePowerMultiplier", mul: boost, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +aggroGainForSpeaking(s) * 0.30 }
        ]
      };
    }
  }),

  ASK_AGREEMENT: make({
    id: "ASK_AGREEMENT",
    name: "동의를 구한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: { charisma: 25 },
    isAccessoryAfter: (rootId) => new Set(["SUSPECT","COVER","DEFEND","REBUT"]).has(rootId),
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const boost = 1.0 + stat(s, "charisma") / 70; // ~1.35..1.71
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[동의를 구한다] 다들 그렇게 생각하지?` },
          { type: "SESSION_MOD", key: "supportPullMultiplier", mul: boost, sourceId: s.id },
          { type: "AGGRO_DELTA", charId: s.id, delta: +aggroGainForSpeaking(s) * 0.35 }
        ]
      };
    }
  }),

  BLOCK_REBUTTAL: make({
    id: "BLOCK_REBUTTAL",
    name: "반론을 막는다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: { charisma: 40 },
    isAccessoryAfter: (rootId, ctx) => new Set(["SUSPECT","COVER"]).has(rootId) && !ctx.session?.usedBlockRebuttal,
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const root = ctx.session.rootAction;
      const blockedTargetId = root?.targetId || null;
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[반론을 막는다] 반박하지 마.` },
          { type: "SESSION_FLAG", key: "blockedRebuttal", value: true },
          { type: "SESSION_FLAG", key: "blockedRebuttalTargetId", value: blockedTargetId },
          { type: "SESSION_FLAG", key: "allowHelpBreakBlock", value: true },
          { type: "SESSION_FLAG", key: "usedBlockRebuttal", value: true },
          { type: "AGGRO_DELTA", charId: s.id, delta: +aggroGainForSpeaking(s) * 2.2 } // huge aggro
        ]
      };
    }
  }),

  EVADE: make({
    id: "EVADE",
    name: "얼버무린다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: { stealth: 25 },
    usableIf: (state, ctx, speakerId) => {
      // only usable when being attacked (root suspect/rebut on self)
      const root = ctx.session.rootAction;
      const proposal = ctx.session.proposalData;
      const attackedId = root?.targetId ?? proposal?.targetId ?? null;
      if (attackedId !== speakerId) return { ok: false, reason: "공격당한 상황에서만 사용할 수 있습니다." };
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const cutAggro = 1.0 + stat(s, "stealth") * 0.08;
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[얼버무린다] (대화를 흐린다.)` },
          { type: "AGGRO_DELTA", charId: s.id, delta: -cutAggro },
          { type: "SESSION_FLAG", key: "stopped", value: true },
          { type: "PROPOSAL_CLOSE", reason: "evaded" }
        ]
      };
    }
  }),

  COUNTERATTACK: make({
    id: "COUNTERATTACK",
    name: "반격한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE, // target = attacker (root speaker)
    statReq: { logic: 25, acting: 25 },
    usableIf: (state, ctx, speakerId) => {
      const root = ctx.session.rootAction;
      if (!root || root.cmdId !== "SUSPECT") return { ok: false, reason: "반격은 의심당한 상황에서만 가능합니다." };
      if (root.targetId !== speakerId) return { ok: false, reason: "의심당한 본인만 반격할 수 있습니다." };
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const defender = getChar(state, action.speakerId);
      const attacker = getChar(state, ctx.session.rootAction.speakerId);

      const trustDmg = baseTrustAttack(defender) * 0.95;
      const likeDmg = baseLikeAttack(defender) * 0.95;

      return {
        events: [
          { type: "TURN_LOG", text: `${defender.name}:[반격한다] ${attacker.name}도 수상해.` },
          { type: "REL_ATTACK_SUPPORTABLE", axis: "trust", targetId: attacker.id, base: trustDmg, sourceId: defender.id },
          { type: "REL_ATTACK_SUPPORTABLE", axis: "like", targetId: attacker.id, base: likeDmg, sourceId: defender.id },
          { type: "AGGRO_DELTA", charId: defender.id, delta: +aggroGainForSpeaking(defender) }
        ]
      };
    }
  }),

  ASK_HELP: make({
    id: "ASK_HELP",
    name: "도움을 요청한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.SINGLE,
    statReq: { acting: 30 },
    usableIf: (state, ctx, speakerId, draft) => {
      // used when attacked (root target) or when block exists and you are blocked target
      const root = ctx.session.rootAction;
      const attackedId = root?.targetId ?? null;
      if (attackedId !== speakerId) return { ok: false, reason: "공격당한 상황에서만 사용할 수 있습니다." };
      if (!draft.targetId) return { ok: false, reason: "도움을 요청할 대상이 필요합니다." };
      if (!isAliveTarget(state, draft.targetId)) return { ok: false, reason: "대상은 생존 인물이어야 합니다." };
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const helper = getChar(state, action.targetId);
      // success chance depends on s acting + charisma, and helper's like/trust toward s (applied in game.js)
      const base = 0.20 + stat(s, "acting") * 0.01 + stat(s, "charisma") * 0.005; // ~0.20..0.95
      const chance = clamp(base, 0.10, 0.90);

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[도움을 요청한다] ${helper.name}, 나 좀 도와줘.` },
          { type: "REQUEST_HELP", speakerId: s.id, targetId: helper.id, baseChance: chance },
          // If blockedRebuttal exists, this request can break it (engine will compute final success)
          { type: "HELP_BREAK_BLOCK", baseChance: chance }
        ]
      };
    }
  }),

  SAD: make({
    id: "SAD",
    name: "슬퍼한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: { charm: 25 },
    usableIf: (state, ctx, speakerId) => {
      const root = ctx.session.rootAction;
      const attackedId = root?.targetId ?? null;
      if (attackedId !== speakerId) return { ok: false, reason: "공격당한 상황에서만 사용할 수 있습니다." };
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const pity = 3.0 + stat(s, "charm") * 0.30; // 10.5..18
      const ag = aggroGainForSpeaking(s) * 0.50;

      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[슬퍼한다] ...정말 너무해.` },
          { type: "PITY_DEFEND_AURA", targetId: s.id, strength: pity },
          { type: "AGGRO_DELTA", charId: s.id, delta: +ag }
        ]
      };
    }
  }),

  DONT_FOOL_ME: make({
    id: "DONT_FOOL_ME",
    name: "속지마라",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.SINGLE, // accuse attacker liar
    statReq: { intuition: 30 },
    usableIf: (state, ctx, speakerId, draft) => {
      const root = ctx.session.rootAction;
      if (!root) return { ok: false, reason: "지금은 사용할 수 없습니다." };
      const attackedId = root?.targetId ?? null;
      if (attackedId !== speakerId) return { ok: false, reason: "공격당한 상황에서만 사용할 수 있습니다." };
      if (!draft.targetId) return { ok: false, reason: "대상이 필요합니다." };
      if (!isAliveTarget(state, draft.targetId)) return { ok: false, reason: "대상은 생존 인물이어야 합니다." };
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const liar = getChar(state, action.targetId);
      const boost = 0.10 + stat(s, "intuition") * 0.006; // +0.28 at 30, +0.40 at 50
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[속지마라] ${liar.name} 거짓말이야.` },
          { type: "LIE_DETECT_BOOST", observerId: s.id, targetId: liar.id, boostChance: boost, until: "end_of_next_report" }
        ]
      };
    }
  }),

  VOTE_FOR: make({
    id: "VOTE_FOR",
    name: "투표해라",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_VOTE, CommandPhase.DAY_START],
    targetType: TargetType.SINGLE,
    statReq: { logic: 10 },
    perDayLimit: 1,
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[투표해라] 오늘은 ${t.name}에 투표하자.` },
          { type: "PROPOSAL_OPEN", proposalType: "vote_for", data: { targetId: t.id } },
          { type: "AGGRO_DELTA", charId: s.id, delta: +aggroGainForSpeaking(s) }
        ]
      };
    }
  }),

  VOTE_AVOID: make({
    id: "VOTE_AVOID",
    name: "투표하지 마라",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_VOTE, CommandPhase.DAY_START],
    targetType: TargetType.SINGLE,
    statReq: { logic: 15 },
    perDayLimit: 1,
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[투표하지 마라] ${t.name}은(는) 오늘은 제외하자.` },
          { type: "PROPOSAL_OPEN", proposalType: "vote_avoid", data: { targetId: t.id } },
          { type: "AGGRO_DELTA", charId: s.id, delta: +aggroGainForSpeaking(s) * 0.8 }
        ]
      };
    }
  }),

  CERTAIN_HUMAN: make({
    id: "CERTAIN_HUMAN",
    name: "반드시 인간이다",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.SINGLE,
    statReq: { logic: 20 },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[반드시 인간이다] ${t.name}는 인간이야.` },
          { type: "MARK_CERTAIN_HUMAN", targetId: t.id, byId: s.id },
          { type: "REL_LIKE_DELTA", fromId: t.id, toId: s.id, delta: +3.5 }, // target likes the one who cleared them
          { type: "SESSION_FLAG", key: "thankWindowOpenFor", value: t.id }
        ]
      };
    }
  }),

  CERTAIN_ENEMY: make({
    id: "CERTAIN_ENEMY",
    name: "반드시 적이다",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.SINGLE,
    statReq: { logic: 20 },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[반드시 적이다] ${t.name}는 적이야.` },
          { type: "MARK_CERTAIN_ENEMY", targetId: t.id, byId: s.id },
          // engine will “silence” that target in discussions
          { type: "SILENCE_CHAR", charId: t.id, reason: "certain_enemy" }
        ]
      };
    }
  }),

  ELIMINATE_ALL_ROLE: make({
    id: "ELIMINATE_ALL_ROLE",
    name: "전원 배제해라",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.ROLE,
    statReq: { logic: 30 },
    perLoopLimit: 1,
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const roleName = action.roleName || action.meta?.roleName || "엔지니어";
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[전원 배제해라] ${roleName} 전원 배제하자.` },
          { type: "PROPOSAL_OPEN", proposalType: "eliminate_role", data: { roleName } },
          { type: "AGGRO_DELTA", charId: s.id, delta: +aggroGainForSpeaking(s) * 1.2 }
        ]
      };
    }
  }),

  SMALLTALK: make({
    id: "SMALLTALK",
    name: "잡담한다",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.NONE,
    statReq: { stealth: 10 },
    perDayLimit: 1,
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const drop = 1.5 + stat(s, "stealth") * 0.08;
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[잡담한다] (잡담을 시작한다.)` },
          { type: "PROPOSAL_OPEN", proposalType: "smalltalk", data: { hostId: s.id } },
          { type: "AGGRO_DELTA", charId: s.id, delta: -drop }
        ]
      };
    }
  }),

  COOPERATE: make({
    id: "COOPERATE",
    name: "협력하자",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.SINGLE,
    statReq: { charm: 15 },
    perDayLimit: 1,
    usableIf: (state, ctx, speakerId) => {
      const s = getChar(state, speakerId);
      if (s?.flags?.cooperatingWith) return { ok: false, reason: "이미 협력 중입니다." };
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      const base = 0.25 + stat(s, "charm") * 0.01; // 0.40 at 15, 0.75 at 50
      const chance = clamp(base, 0.20, 0.85);
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[협력하자] ${t.name}, 같이 가자.` },
          { type: "COOP_REQUEST", fromId: s.id, toId: t.id, baseChance: chance }
        ]
      };
    }
  }),

  SAY_HUMAN: make({
    id: "SAY_HUMAN",
    name: "인간이라고 말해",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.DAY_START],
    targetType: TargetType.NONE,
    statReq: { intuition: 20 },
    perLoopLimit: 1,
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[인간이라고 말해] 모두 '나는 인간'이라고 말해.` },
          { type: "PROPOSAL_OPEN", proposalType: "say_human", data: { hostId: s.id } },
          { type: "AGGRO_DELTA", charId: s.id, delta: +aggroGainForSpeaking(s) * 0.8 }
        ]
      };
    }
  }),

  DOGEZA: make({
    id: "DOGEZA",
    name: "도게자한다",
    kind: CommandKind.ACCESSORY,
    public: true,
    phaseTags: [CommandPhase.DAY_REACT],
    targetType: TargetType.NONE,
    statReq: { stealth: 35 }, // per your spec
    usableIf: (state, ctx, speakerId) => {
      // Only when voted to cold sleep (engine sets a window flag on that result)
      if (!ctx.session?.dogezaWindow?.has?.(speakerId)) {
        return { ok: false, reason: "지금은 사용할 수 없습니다." };
      }
      return { ok: true };
    },
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const chance = clamp(0.20 + stat(s, "acting") * 0.008 + stat(s, "stealth") * 0.006, 0.15, 0.65);
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[도게자한다] 살려줘... 부탁이야.` },
          { type: "DODGE_COLD_SLEEP", charId: s.id, baseChance: chance }
        ]
      };
    }
  }),

  // --- NIGHT (new, user-checkable) ---
  NIGHT_COOP_REQUEST: make({
    id: "NIGHT_COOP_REQUEST",
    name: "밤: 협력을 제안한다",
    kind: CommandKind.ROOT,
    public: true,
    phaseTags: [CommandPhase.NIGHT_FREE],
    targetType: TargetType.SINGLE,
    statReq: {}, // no stat requirement per your addition
    buildIntent: (state, ctx, action) => {
      const s = getChar(state, action.speakerId);
      const t = getChar(state, action.targetId);
      // acceptance chance influenced by mutual like/trust in game.js
      return {
        events: [
          { type: "TURN_LOG", text: `${s.name}:[밤 협력요청] ${t.name}에게 협력을 제안했다.` },
          { type: "NIGHT_COOP_REQUEST", fromId: s.id, toId: t.id, baseChance: 0.45 }
        ]
      };
    }
  })
});

// Public listing order (UI)
export const PUBLIC_COMMAND_ORDER = Object.freeze([
  // Day
  "SUSPECT",
  "AGREE_SUSPECT",
  "DENY",
  "DEFEND",
  "JOIN_DEFEND",
  "COVER",
  "JOIN_COVER",
  "THANK",
  "REBUT",
  "JOIN_REBUT",
  "NOISY",
  "CLAIM_ROLE",
  "CLAIM_TOO",
  "DEMAND_CLAIM",
  "EXAGGERATE",
  "ASK_AGREEMENT",
  "BLOCK_REBUTTAL",
  "EVADE",
  "COUNTERATTACK",
  "ASK_HELP",
  "SAD",
  "DONT_FOOL_ME",
  "VOTE_FOR",
  "VOTE_AVOID",
  "CERTAIN_HUMAN",
  "CERTAIN_ENEMY",
  "ELIMINATE_ALL_ROLE",
  "SMALLTALK",
  "COOPERATE",
  "SAY_HUMAN",
  "DOGEZA",
  // Night
  "NIGHT_COOP_REQUEST"
]);

// ---------- Eligibility helpers ----------

// Eligible = stat requirement met (for checkbox enable list in UI)
export function computeEligiblePublicCommandsForCharacter(state, charId) {
  const c = getChar(state, charId);
  if (!c) return [];
  const res = [];
  for (const id of PUBLIC_COMMAND_ORDER) {
    const def = COMMANDS[id];
    if (!def?.public) continue;
    if (canUseByStat(c, def.statReq || {})) res.push(id);
  }
  return res;
}

// Usable now = eligible + enabledByUser + phase + context + limits + “proposal flow” constraints
export function getUsableCommands(state, ctx, speakerId) {
  const speaker = getChar(state, speakerId);
  if (!speaker || !speaker.alive) return [];

  const usable = [];
  for (const id of Object.keys(COMMANDS)) {
    const def = COMMANDS[id];
    if (!def) continue;

    // internal commands are driven by engine, but we still allow them when needed
    // public commands require user enabled flag
    const st = enforceStatAndEnabled(state, speakerId, id);
    if (!st.ok) continue;

    const ph = enforcePhase(def, ctx);
    if (!ph.ok) continue;

    if (isTurnStopped(ctx)) continue;

    // “1 action per char per turn”
    const once = enforceOneActionPerTurn(ctx, speakerId);
    if (!once.ok) continue;

    // proposal flows override everything
    const pf = enforceProposalFlow(def, ctx);
    if (!pf.ok && ctx.session?.proposalOpen) continue;

    const sh = enforceSayHumanFlow(def, ctx);
    if (!sh.ok) continue;

    const stf = enforceSmalltalkFlow(def, ctx);
    if (!stf.ok) continue;

    const acc = enforceAccessoryWindow(def, ctx);
    if (!acc.ok) continue;

    usable.push(def.id);
  }
  return usable;
}

// Validate a concrete action and return an intent
export function buildCommandIntent(state, ctx, action) {
  const def = COMMANDS[action.cmdId];
  if (!def) return { ok: false, reason: "알 수 없는 커맨드입니다." };

  // speaker alive
  const sp = enforceAliveSpeaker(state, action.speakerId);
  if (!sp.ok) return sp;

  // one action per char per turn
  const once = enforceOneActionPerTurn(ctx, action.speakerId);
  if (!once.ok) return once;

  // phase
  const ph = enforcePhase(def, ctx);
  if (!ph.ok) return ph;

  // stat+enabled
  const se = enforceStatAndEnabled(state, action.speakerId, action.cmdId);
  if (!se.ok) return se;

  // target
  const tg = enforceAliveTargetIfNeeded(state, def, action);
  if (!tg.ok) return tg;

  // accessory window / flow
  const acc = enforceAccessoryWindow(def, ctx);
  if (!acc.ok) return acc;

  // proposal flow restrictions
  if (ctx.session?.proposalOpen) {
    const pf = enforceProposalFlow(def, ctx);
    if (!pf.ok) return pf;
  }
  const sh = enforceSayHumanFlow(def, ctx);
  if (!sh.ok) return sh;
  const stf = enforceSmalltalkFlow(def, ctx);
  if (!stf.ok) return stf;

  // block rebuttal rule
  const br = enforceBlockRebuttalRule(def, ctx, action);
  if (!br.ok) return br;

  // custom usableIf
  if (def.usableIf) {
    const extra = def.usableIf(state, ctx, action.speakerId, action);
    if (!extra.ok) return extra;
  }

  // all good → build intent
  const intent = def.buildIntent(state, ctx, action);
  return { ok: true, intent };
}
