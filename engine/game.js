// engine/game.js
// ============================================================================
// Gnosia-like fan simulator engine (auto-sim)
// - Day: 5 turns (each "turn" = one chain of main+sub commands)
// - Night: step1 free actions, step2 role resolution + attack
//
// 규칙 반영(사용자 확정):
// - 거짓말 가능: 그노시아/AC/버그
// - 거짓말 불가(=진실만): 선원/선내대기인/엔지니어/닥터/수호천사
// - 커밍아웃(역할 밝히기/요구): 엔지니어/닥터/선내대기인만 대상
// - 엔지/닥 사칭 가능: 거짓말 가능 진영(그노시아/AC/버그)
// - 수호천사: 커밍아웃 불가(역할 관련 커맨드에 참여 X)
//
// 추가 요구 반영:
// - 밤2단계: 수호천사 보호 성공 OR 그노시아가 버그를 노렸다면 => "아무도 소멸하지 않았습니다"
// - 엔지니어가 버그 조사 성공 + 그노시아가 인간(버그 제외)을 소멸 => "A와 B가 소멸했습니다"
// - 죽은 캐릭터는 절대 발언/행동 못함
// - 게임 시작 시 역할을 유저가 알 수 있게 state에 roleOf를 포함(표시 여부는 UI에서)
// - 거짓말 눈치챔 로그: "A가 B의 거짓말을 눈치챘다"
//
// NOTE:
// - UI는 이 엔진이 생성하는 logs 배열을 그대로 뿌려주면 됨.
// - "대사 패턴"은 UI/commands.js에서 갈아끼워도 되게 여기선 텍스트를 단순화함.
// - 커맨드 효과(우호/신뢰/어그로 등)는 '높은 완성도'를 목표로 현실감 있게 반영.
//
// 의존:
// - engine/roles.js (사용자 규칙이 들어간 최신 버전)
// ============================================================================

import {
  ROLES,
  normalizeRoleConfig,
  assignRoles,
  getFaction,
  canLieByRole,
  canClaimRole,
  pickRequestedRole,
  getGuardDutyPair,
} from "./roles.js";

// --------------------------- helpers ---------------------------
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const rnd = (rng) => rng();
const rint = (rng, a, b) => Math.floor(rnd(rng) * (b - a + 1)) + a;

function pickWeighted(rng, items, weightFn) {
  let total = 0;
  const ws = items.map((it) => {
    const w = Math.max(0, weightFn(it) || 0);
    total += w;
    return w;
  });
  if (total <= 0) return items[Math.floor(rnd(rng) * items.length)];
  let x = rnd(rng) * total;
  for (let i = 0; i < items.length; i++) {
    x -= ws[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

function fmtName(c) {
  return c?.name ?? "???";
}

// 관계값은 -100..100으로 관리 (UI 시각화는 정규화해서 쓰면 됨)
function normRel(v) {
  return clamp(v, -100, 100);
}

// 성격: 0.00 ~ 1.00 (UI 입력 조건)
function clampPersonality01(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return clamp(x, 0, 1);
}

// 스테이터스: 0..50 (소수 1자리 허용)
function clampStat50(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return clamp(Math.round(x * 10) / 10, 0, 50);
}

// --------------------------- command ids ---------------------------
// (UI에서 캐릭터 생성 시 체크하는 "사용 가능 커맨드"는 여기 id 문자열과 매칭)
export const COMMAND = {
  // day core
  SUSPECT: "의심한다",
  AGREE_SUSPECT: "의심에 동의한다",
  DENY: "부정한다",
  DEFEND: "변호한다",
  AGREE_DEFEND: "변호에 가담한다",
  COVER: "감싼다",
  AGREE_COVER: "함께 감싼다",
  THANK: "감사한다",
  COUNTER: "반론한다",
  AGREE_COUNTER: "반론에 가담한다",
  NOISY: "시끄러워",
  CO_ROLE: "역할을 밝힌다",
  CO_SELF_TOO: "자신도 밝힌다",
  REQUEST_CO: "역할을 밝혀라",
  EXAGGERATE: "과장해서 말한다",
  ASK_AGREE: "동의를 구한다",
  BLOCK_REBUT: "반론을 막는다",
  DODGE: "얼버무린다",
  COUNTERATTACK: "반격한다",
  ASK_HELP: "도움을 요청한다",
  SAD: "슬퍼한다",
  DONT_TRUST: "속지마라",
  VOTE_HIM: "투표해라",
  DONT_VOTE: "투표하지 마라",
  CERT_HUMAN: "반드시 인간이다",
  CERT_ENEMY: "반드시 적이다",
  ALL_EXCLUDE_ROLE: "전원 배제해라",
  CHAT: "잡담한다",
  COOP: "협력하자",
  SAY_HUMAN: "인간이라고 말해",
  DOGEZA: "도게자한다",

  // night-only additional (요구 추가)
  NIGHT_COOP: "밤에 협력을 제안",
};

// 부속 커맨드(찬성/반대/참여/중단) - UI에 공개할 필요 없음
const INTERNAL = {
  APPROVE: "찬성한다",
  REJECT: "반대한다",
  JOIN_CHAT: "잡담에 참여한다",
  STOP_CHAT: "잡담을 중단시킨다",
  SAY_HUMAN_DECL: "나는 인간이야",
  SAY_HUMAN_SKIP: "아무 말도 하지 않는다",
  SAY_HUMAN_STOP: "선언을 중단시킨다",
};

// 커맨드 스테이터스 요구(기획서)
const REQ = {
  [COMMAND.ROLE_REQ_CO]: { charisma: 10 }, // 역할을 밝혀라
};

// --------------------------- engine core ---------------------------
export class Game {
  /**
   * @param {Object} params
   * @param {Array<Object>} params.characters  // user created list, id required
   * @param {Object} params.roleConfigRaw      // from UI
   * @param {() => number} params.rng
   */
  constructor({ characters, roleConfigRaw, rng = Math.random }) {
    this.rng = rng;

    // alive/dead
    this.characters = characters.map((c, idx) => ({
      id: c.id ?? idx + 1,
      name: String(c.name ?? `캐릭터${idx + 1}`),
      gender: c.gender ?? "범성",
      age: Math.max(0, Number(c.age ?? 0)),

      // stats 0..50
      stats: {
        charisma: clampStat50(c?.stats?.charisma),
        logic: clampStat50(c?.stats?.logic),
        acting: clampStat50(c?.stats?.acting),
        charm: clampStat50(c?.stats?.charm),
        stealth: clampStat50(c?.stats?.stealth),
        intuition: clampStat50(c?.stats?.intuition),
      },

      // personality 0..1
      personality: {
        cheer: clampPersonality01(c?.personality?.cheer),
        social: clampPersonality01(c?.personality?.social),
        logical: clampPersonality01(c?.personality?.logical),
        kindness: clampPersonality01(c?.personality?.kindness),
        desire: clampPersonality01(c?.personality?.desire),
        courage: clampPersonality01(c?.personality?.courage),
      },

      // enabled commands (user check)
      enabledCommands: new Set(Array.isArray(c.enabledCommands) ? c.enabledCommands : []),

      // talk/aggro
      aggro: 0, // higher => more suspicious & more targeted by gnosia
      alive: true,

      // role/claims per loop
      claim: null, // string role claim (for CO)
      claimDay: -1,

      // per-day usage limits
      usedToday: new Set(),
      usedThisLoop: new Set(),
    }));

    // relationship matrices (directed): fromId -> toId => {trust,favor}
    this.relation = new Map();
    for (const a of this.characters) {
      const m = new Map();
      for (const b of this.characters) {
        if (a.id === b.id) continue;
        m.set(b.id, { trust: 0, favor: 0 });
      }
      this.relation.set(a.id, m);
    }

    // configuration
    this.roleConfig = normalizeRoleConfig(this.characters.length, roleConfigRaw);
    this.roleOf = assignRoles(this.characters, this.roleConfig, this.rng);

    // pair for guard duty
    this.guardDutyPair = getGuardDutyPair(this.roleOf);

    // game clock
    this.day = 1;
    this.phase = "DAY"; // DAY, NIGHT_FREE, NIGHT_RESOLVE, ENDED
    this.dayTurn = 1; // 1..5 within day
    this.logs = [];

    // last outcomes
    this.lastColdSleepId = null; // voted out in day
    this.lastNightDeaths = []; // ids
    this.lastEngineerReport = null; // {engineerId, targetId, result}
    this.lastDoctorReport = null; // {doctorId, targetId, result}
    this.guardProtectId = null;

    // meta for a chain-turn
    this.turnCtx = null;

    // global markers
    this.confirmedHuman = new Set(); // from CERT_HUMAN
    this.confirmedEnemy = new Set(); // from CERT_ENEMY

    // start logs: reveal roles (요구: 유저가 시작부터 역할을 알 수 있었으면)
    this._log(`=== 게임 시작 (Day ${this.day}) ===`);
    this._log(`[역할 공개] (유저용)`);
    for (const c of this.characters) {
      this._log(`- ${c.name}: ${this.roleOf.get(c.id)}`);
    }
    if (this.guardDutyPair) {
      const [a, b] = this.guardDutyPair.map((id) => this.getChar(id));
      this._log(
        `선내대기인: ${fmtName(a)} ↔ ${fmtName(b)} (서로 인간 확정)`
      );
      // 관계 보정: 서로 신뢰/우호 상승
      this._addRel(a.id, b.id, +25, +25);
      this._addRel(b.id, a.id, +25, +25);
      this.confirmedHuman.add(a.id);
      this.confirmedHuman.add(b.id);
    }
  }

  // ------------- public getters -------------
  getChar(id) {
    return this.characters.find((c) => c.id === id) || null;
  }
  getAlive() {
    return this.characters.filter((c) => c.alive);
  }
  isAlive(id) {
    const c = this.getChar(id);
    return !!c?.alive;
  }

  // 관계 가져오기
  _rel(fromId, toId) {
    return this.relation.get(fromId)?.get(toId) || { trust: 0, favor: 0 };
  }
  _addRel(fromId, toId, trustDelta, favorDelta) {
    if (fromId === toId) return;
    const m = this.relation.get(fromId);
    if (!m) return;
    const r = m.get(toId);
    if (!r) return;
    r.trust = normRel(r.trust + trustDelta);
    r.favor = normRel(r.favor + favorDelta);
  }

  _log(line) {
    this.logs.push(line);
  }

  // ------------- core step -------------
  /**
   * 실행 버튼 1회 = 현재 phase에 맞는 1 step 진행
   */
  step() {
    if (this.phase === "ENDED") {
      this._log("이미 게임이 종료되었습니다.");
      return;
    }

    if (this.phase === "DAY") {
      // 1 click = 1 chain-turn
      this._dayChainTurn();
      // after 5 turns => vote + move to night_free
      if (this.dayTurn > 5) {
        this._dayVoteAndAdvance();
      }
      return;
    }

    if (this.phase === "NIGHT_FREE") {
      this._nightFreeActions();
      this.phase = "NIGHT_RESOLVE";
      return;
    }

    if (this.phase === "NIGHT_RESOLVE") {
      this._nightResolveAndAdvance();
      return;
    }
  }

  // ------------- day logic -------------
  _dayChainTurn() {
    this._log(`--- Day ${this.day} / Turn ${this.dayTurn} ---`);

    const alive = this.getAlive();
    if (alive.length <= 1) {
      this._endIfNeeded();
      this.dayTurn++;
      return;
    }

    // build a chain context for subcommands
    const ctx = {
      day: this.day,
      turn: this.dayTurn,
      chain: [], // {actorId, cmd, targetId, extra}
      topic: null, // "SUSPECT"|"COVER"|"REQUEST_CO"|...
      targetId: null,
      rebuttalBlockedForTarget: null, // if BLOCK_REBUT is used
      rebuttalBlockerId: null,
      rebuttalBlockBroken: false, // if ASK_HELP succeeds
      requestedRole: null, // if REQUEST_CO used
      voteProposal: null, // {type, ...} if vote-type used
      stopped: false,
    };
    this.turnCtx = ctx;

    const speaker = this._pickSpeaker(alive);
    if (!speaker) {
      this.dayTurn++;
      return;
    }

    // decide main command to start the chain
    const main = this._pickMainCommand(speaker, ctx);
    if (!main) {
      this._log(`${speaker.name}: (침묵)`);
      speaker.aggro = Math.max(0, speaker.aggro - 1);
      this.dayTurn++;
      return;
    }

    // execute main
    this._execCommand(speaker.id, main.cmd, main.targetId, ctx, main.extra);

    // follow-ups (subcommands) until natural stop
    if (!ctx.stopped) this._runFollowUps(ctx);

    // finalize
    this.dayTurn++;
  }

  _pickSpeaker(alive) {
    // weight: social + cheer + charisma, but too high aggro => less talk (stealth reduces)
    return pickWeighted(this.rng, alive, (c) => {
      const p = c.personality;
      const s = c.stats;
      const base =
        1 +
        2.0 * p.social +
        1.0 * p.cheer +
        0.04 * s.charisma +
        0.02 * s.logic;

      const stealthFactor = 1 + (s.stealth / 50) * 0.8;
      const aggroPenalty = 1 / (1 + c.aggro * 0.15);

      return base * aggroPenalty / stealthFactor;
    });
  }

  _pickMainCommand(speaker, ctx) {
    const alive = this.getAlive().filter((c) => c.id !== speaker.id);
    if (alive.length === 0) return null;

    // candidate list (speaker enabled + stat requirements)
    const enabled = (cmd) => speaker.enabledCommands.has(cmd);

    // Determine if we should do a special topic sometimes
    // - REQUEST_CO (역할을 밝혀라): if allowed + stat>=10 + role config has requestable roles
    // - SAY_HUMAN: if enabled + stat intuition>=20
    // - CHAT: if enabled + stealth>=10 (기획서)
    // - CERT_*: if enabled + logic>=20 and certain evidence exists (we simulate with probability)
    const candidates = [];

    // (A) topic suspects/cover are always allowed even if not checked? (기획서: 누구나 가능)
    candidates.push({ cmd: COMMAND.SUSPECT, w: 4 });
    candidates.push({ cmd: COMMAND.COVER, w: 2 });

    if (enabled(COMMAND.REQUEST_CO) && speaker.stats.charisma >= 10) {
      const r = pickRequestedRole(this.roleConfig, this.rng);
      if (r) candidates.push({ cmd: COMMAND.REQUEST_CO, w: 1.4, extra: { requestedRole: r } });
    }
    if (enabled(COMMAND.SAY_HUMAN) && speaker.stats.intuition >= 20) {
      candidates.push({ cmd: COMMAND.SAY_HUMAN, w: 0.9 });
    }
    if (enabled(COMMAND.CHAT) && speaker.stats.stealth >= 10) {
      candidates.push({ cmd: COMMAND.CHAT, w: 1.0 });
    }

    // pick
    const picked = pickWeighted(this.rng, candidates, (x) => x.w);
    const cmd = picked.cmd;
    const extra = picked.extra || {};

    // choose target for relevant commands
    let targetId = null;
    if (
      cmd === COMMAND.SUSPECT ||
      cmd === COMMAND.COVER ||
      cmd === COMMAND.REQUEST_CO
    ) {
      targetId = this._pickDiscussionTarget(speaker, cmd);
      if (!targetId) targetId = alive[Math.floor(rnd(this.rng) * alive.length)].id;
    }

    // CHAT / SAY_HUMAN target none
    return { cmd, targetId, extra };
  }

  _pickDiscussionTarget(speaker, cmd) {
    const alive = this.getAlive().filter((c) => c.id !== speaker.id);
    if (alive.length === 0) return null;

    // For SUSPECT: choose who speaker distrusts / dislikes / sees as risky
    // For COVER: choose who speaker likes / trusts / wants to protect
    if (cmd === COMMAND.SUSPECT) {
      return pickWeighted(this.rng, alive, (t) => {
        if (this.confirmedHuman.has(t.id)) return 0.2;
        if (this.confirmedEnemy.has(t.id)) return 6.0;

        const rel = this._rel(speaker.id, t.id);
        const aggro = t.aggro;

        // suspicion view includes: low trust, low favor, target aggro, and if target is very talkative
        const w =
          1.2 +
          (-(rel.trust) + 20) / 40 +
          (-(rel.favor) + 20) / 50 +
          0.25 * aggro +
          (1 - t.stats.stealth / 50) * 0.6;
        return Math.max(0.1, w);
      });
    }

    if (cmd === COMMAND.COVER) {
      return pickWeighted(this.rng, alive, (t) => {
        if (this.confirmedEnemy.has(t.id)) return 0.05;
        const rel = this._rel(speaker.id, t.id);
        const w =
          1.0 +
          (rel.trust + 20) / 50 +
          (rel.favor + 20) / 50 +
          speaker.personality.kindness * 1.2;
        return Math.max(0.05, w);
      });
    }

    if (cmd === COMMAND.REQUEST_CO) {
      // target is "someone who hasn't come out" (claim is null)
      const pool = alive.filter((t) => !t.claim);
      const base = pool.length ? pool : alive;
      return pickWeighted(this.rng, base, (t) => {
        // push suspicious or silent people
        const rel = this._rel(speaker.id, t.id);
        const w =
          1.0 +
          (-(rel.trust) + 10) / 40 +
          (t.stats.stealth < 15 ? 0.5 : 0);
        return Math.max(0.1, w);
      });
    }

    return alive[Math.floor(rnd(this.rng) * alive.length)].id;
  }

  _runFollowUps(ctx) {
    const alive = this.getAlive();
    if (alive.length <= 2) return;

    // up to N followups; stop early based on randomness
    const maxFollow = 2 + (alive.length >= 10 ? 2 : 1);
    let used = 0;

    while (!ctx.stopped && used < maxFollow) {
      // choose a responder among alive excluding last actor sometimes
      const last = ctx.chain.length ? ctx.chain[ctx.chain.length - 1] : null;
      const candidates = alive.filter((c) => !last || c.id !== last.actorId);

      // decide if anyone responds
      const respondChance = 0.55 + (alive.length <= 6 ? 0.15 : 0);
      if (rnd(this.rng) > respondChance) break;

      const actor = pickWeighted(this.rng, candidates, (c) => {
        // social/cheer encourages participation; high stealth reduces; high aggro reduces
        const p = c.personality;
        const s = c.stats;
        const base =
          1 +
          1.2 * p.social +
          0.7 * p.cheer +
          0.03 * s.charisma +
          0.02 * s.logic;
        const stealth = 1 + (s.stealth / 50) * 0.9;
        const aggroPenalty = 1 / (1 + c.aggro * 0.12);
        return base * aggroPenalty / stealth;
      });

      if (!actor) break;

      const follow = this._pickFollowCommand(actor, ctx);
      if (!follow) break;

      this._execCommand(actor.id, follow.cmd, follow.targetId, ctx, follow.extra);
      used++;
    }
  }

  _pickFollowCommand(actor, ctx) {
    if (!actor.alive) return null;

    const enabled = (cmd) => actor.enabledCommands.has(cmd);
    const chain = ctx.chain;
    if (!chain.length) return null;

    const main = chain[0];
    const targetId = ctx.targetId;

    // If actor is the target, they may deny/dodge/counterattack/sad/ask_help
    if (targetId && actor.id === targetId) {
      const opts = [];

      opts.push({ cmd: COMMAND.DENY, w: 2.0 });
      if (enabled(COMMAND.DODGE) && actor.stats.stealth >= 25) opts.push({ cmd: COMMAND.DODGE, w: 0.9 });
      if (enabled(COMMAND.COUNTERATTACK) && actor.stats.logic >= 25 && actor.stats.acting >= 25) opts.push({ cmd: COMMAND.COUNTERATTACK, w: 0.8 });
      if (enabled(COMMAND.SAD) && actor.stats.charm >= 25) opts.push({ cmd: COMMAND.SAD, w: 0.9 });
      if (enabled(COMMAND.ASK_HELP) && actor.stats.acting >= 30) opts.push({ cmd: COMMAND.ASK_HELP, w: 0.7 });

      if (ctx.rebuttalBlockedForTarget === targetId && !ctx.rebuttalBlockBroken) {
        // if rebuttal blocked, denying is still allowed (it's not "defend by others")
        // (기획서: 반론 봉쇄는 "다른 인물이 옹호(반론) 못함"에 초점)
      }

      const pick = pickWeighted(this.rng, opts, (x) => x.w);
      return { cmd: pick.cmd, targetId: pick.cmd === COMMAND.COUNTERATTACK ? main.actorId : null };
    }

    // If topic is SUSPECT or COVER, responders may agree/defend/counter/block/exaggerate/ask_agree
    const topicCmd = main.cmd;

    const opts = [];

    if (topicCmd === COMMAND.SUSPECT) {
      // agree suspect (always available)
      opts.push({ cmd: COMMAND.AGREE_SUSPECT, w: 1.2 });

      // defend target (if they like target) – but blocked by BLOCK_REBUT
      if (!(ctx.rebuttalBlockedForTarget === targetId && !ctx.rebuttalBlockBroken)) {
        opts.push({ cmd: COMMAND.DEFEND, w: 0.9 });
        opts.push({ cmd: COMMAND.COVER, w: 0.6 });
      }

      // block rebuttal (needs charisma>=40 and enabled)
      if (enabled(COMMAND.BLOCK_REBUT) && actor.stats.charisma >= 40) {
        opts.push({ cmd: COMMAND.BLOCK_REBUT, w: 0.25 });
      }

      // ask agree (needs charisma>=25 and enabled)
      if (enabled(COMMAND.ASK_AGREE) && actor.stats.charisma >= 25) {
        opts.push({ cmd: COMMAND.ASK_AGREE, w: 0.45 });
      }

      // exaggerate (needs acting>=15 and enabled)
      if (enabled(COMMAND.EXAGGERATE) && actor.stats.acting >= 15) {
        opts.push({ cmd: COMMAND.EXAGGERATE, w: 0.35 });
      }

      // noisy (situational)
      if (enabled(COMMAND.NOISY)) opts.push({ cmd: COMMAND.NOISY, w: 0.15 });

      const chosen = this._pickByRelationWeight(actor, targetId, topicCmd, opts);
      if (!chosen) return null;

      return { cmd: chosen, targetId: targetId };
    }

    if (topicCmd === COMMAND.COVER) {
      // agree cover
      opts.push({ cmd: COMMAND.AGREE_COVER, w: 1.0 });
      // counter to cover
      opts.push({ cmd: COMMAND.COUNTER, w: 0.6 });

      if (enabled(COMMAND.ASK_AGREE) && actor.stats.charisma >= 25) opts.push({ cmd: COMMAND.ASK_AGREE, w: 0.35 });
      if (enabled(COMMAND.EXAGGERATE) && actor.stats.acting >= 15) opts.push({ cmd: COMMAND.EXAGGERATE, w: 0.25 });

      const chosen = this._pickByRelationWeight(actor, targetId, topicCmd, opts);
      return { cmd: chosen, targetId };
    }

    if (topicCmd === COMMAND.REQUEST_CO) {
      // someone may CO if they can (true or lie-allowed)
      // actor chooses to respond if they are asked or they have high courage
      const askedId = ctx.targetId;
      const isAsked = actor.id === askedId;
      const courage = actor.personality.courage;

      if (!isAsked && rnd(this.rng) > (0.22 + 0.35 * courage)) return null;

      // pick claim role among allowed ones
      const allowedClaim = [ROLES.ENGINEER, ROLES.DOCTOR, ROLES.GUARD_DUTY];
      const claim = pickWeighted(this.rng, allowedClaim, (r) => {
        // if asked requestedRole exists, prefer that
        if (ctx.requestedRole && r === ctx.requestedRole) return 3.0;
        return 1.0;
      });

      // verify canClaimRole
      if (!canClaimRole(this.roleOf, actor.id, claim)) return null;

      // "하루 1회 같은 역할" 제한은 game.js에서 처리 (usedToday with tag)
      return { cmd: COMMAND.CO_ROLE, targetId: null, extra: { claimRole: claim } };
    }

    if (topicCmd === COMMAND.SAY_HUMAN) {
      // each actor can declare / stay silent / stop
      // chain is driven by engine execution when SAY_HUMAN is executed (we don't choose here)
      return null;
    }

    if (topicCmd === COMMAND.CHAT) {
      // chat is driven internally; optional stop
      return null;
    }

    return null;
  }

  _pickByRelationWeight(actor, targetId, topicCmd, opts) {
    if (!opts.length) return null;
    const rel = targetId ? this._rel(actor.id, targetId) : { trust: 0, favor: 0 };

    // adjust weights depending on relation:
    // - in SUSPECT topic: if actor likes target, defend more; if dislikes, agree suspect more
    // - in COVER topic: if actor likes target, agree cover; if dislikes, counter
    const adjusted = opts.map((o) => {
      let w = o.w;
      if (topicCmd === COMMAND.SUSPECT) {
        if (o.cmd === COMMAND.DEFEND || o.cmd === COMMAND.COVER) {
          w *= 1 + (rel.favor + 30) / 120; // more if like
        }
        if (o.cmd === COMMAND.AGREE_SUSPECT) {
          w *= 1 + (-(rel.favor) + 30) / 140;
        }
      }
      if (topicCmd === COMMAND.COVER) {
        if (o.cmd === COMMAND.AGREE_COVER) w *= 1 + (rel.favor + 30) / 120;
        if (o.cmd === COMMAND.COUNTER) w *= 1 + (-(rel.favor) + 30) / 140;
      }
      return { cmd: o.cmd, w: Math.max(0.01, w) };
    });

    return pickWeighted(this.rng, adjusted, (x) => x.w).cmd;
  }

  _execCommand(actorId, cmd, targetId, ctx, extra = null) {
    const actor = this.getChar(actorId);
    if (!actor || !actor.alive) return;

    // set ctx target once (for chain)
    if (cmd === COMMAND.SUSPECT || cmd === COMMAND.COVER || cmd === COMMAND.REQUEST_CO) {
      ctx.targetId = targetId;
    }
    if (cmd === COMMAND.REQUEST_CO && extra?.requestedRole) {
      ctx.requestedRole = extra.requestedRole;
    }

    // enforce: dead target cannot be referenced (if died mid chain - should not happen)
    if (targetId && !this.isAlive(targetId)) targetId = null;

    // add to chain
    ctx.chain.push({ actorId, cmd, targetId, extra });

    // apply command effects + logs
    switch (cmd) {
      case COMMAND.SUSPECT:
        this._cmdSuspect(actor, targetId, ctx);
        break;
      case COMMAND.AGREE_SUSPECT:
        this._cmdAgreeSuspect(actor, targetId, ctx);
        break;
      case COMMAND.DENY:
        this._cmdDeny(actor, ctx);
        break;
      case COMMAND.DEFEND:
        this._cmdDefend(actor, targetId, ctx);
        break;
      case COMMAND.AGREE_DEFEND:
        this._cmdAgreeDefend(actor, targetId, ctx);
        break;
      case COMMAND.COVER:
        this._cmdCover(actor, targetId, ctx);
        break;
      case COMMAND.AGREE_COVER:
        this._cmdAgreeCover(actor, targetId, ctx);
        break;
      case COMMAND.THANK:
        this._cmdThank(actor, targetId, ctx);
        break;
      case COMMAND.COUNTER:
        this._cmdCounter(actor, targetId, ctx);
        break;
      case COMMAND.AGREE_COUNTER:
        this._cmdAgreeCounter(actor, targetId, ctx);
        break;
      case COMMAND.NOISY:
        this._cmdNoisy(actor, targetId, ctx);
        break;
      case COMMAND.REQUEST_CO:
        this._cmdRequestCo(actor, targetId, ctx);
        break;
      case COMMAND.CO_ROLE:
        this._cmdCoRole(actor, ctx, extra);
        break;
      case COMMAND.CO_SELF_TOO:
        this._cmdCoSelfToo(actor, ctx, extra);
        break;
      case COMMAND.EXAGGERATE:
        this._cmdExaggerate(actor, targetId, ctx);
        break;
      case COMMAND.ASK_AGREE:
        this._cmdAskAgree(actor, targetId, ctx);
        break;
      case COMMAND.BLOCK_REBUT:
        this._cmdBlockRebut(actor, targetId, ctx);
        break;
      case COMMAND.DODGE:
        this._cmdDodge(actor, ctx);
        break;
      case COMMAND.COUNTERATTACK:
        this._cmdCounterAttack(actor, targetId, ctx);
        break;
      case COMMAND.ASK_HELP:
        this._cmdAskHelp(actor, ctx);
        break;
      case COMMAND.SAD:
        this._cmdSad(actor, ctx);
        break;
      case COMMAND.DONT_TRUST:
        this._cmdDontTrust(actor, targetId, ctx);
        break;
      case COMMAND.CHAT:
        this._cmdChat(actor, ctx);
        break;
      case COMMAND.SAY_HUMAN:
        this._cmdSayHuman(actor, ctx);
        break;
      default:
        this._log(`${actor.name}:[${cmd}] ...`);
        break;
    }
  }

  // -------------------- command implementations (day) --------------------
  _cmdSuspect(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[의심한다] ${t.name}는 수상해.`);

    // effects: reduce trust/favor of target in others; actor aggro increases
    actor.aggro += 2 * (1 - actor.stats.stealth / 50);

    // damage = logic+acting; charisma helps pull supporters => will be applied via agree
    const dmgTrust = 3 + actor.stats.logic * 0.18;
    const dmgFavor = 2 + actor.stats.acting * 0.14;

    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      // others adjust their view of target slightly if they trust speaker
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.25 + clamp((trustSpeaker + 30) / 120, 0.1, 0.9);
      this._addRel(other.id, t.id, -dmgTrust * factor, -dmgFavor * factor);
    }

    // target gets suspicious pressure
    t.aggro += 1.2;
  }

  _cmdAgreeSuspect(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[의심에 동의한다] ${t.name} 쪽이 수상해.`);

    // smaller aggro gain
    actor.aggro += 0.7 * (1 - actor.stats.stealth / 50);

    // smaller damage, but adds chain "charisma synergy"
    const dmgTrust = 1.5 + actor.stats.logic * 0.10;
    const dmgFavor = 1.0 + actor.stats.acting * 0.08;

    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.18 + clamp((trustSpeaker + 25) / 150, 0.08, 0.6);
      this._addRel(other.id, t.id, -dmgTrust * factor, -dmgFavor * factor);
    }
    t.aggro += 0.6;
  }

  _cmdDeny(actor, ctx) {
    // deny reduces some of own aggro, increases distrust to attacker
    const first = ctx.chain[0];
    const attacker = this.getChar(first?.actorId);
    this._log(`${actor.name}:[부정한다] 난 아니야.`);

    const timingRisk = rnd(this.rng); // sometimes backfires
    if (timingRisk < 0.18) {
      // backfire
      actor.aggro += 1.2;
      if (attacker) this._addRel(actor.id, attacker.id, -6, -4);
      this._log(`(타이밍 실패) ${actor.name}의 부정이 역효과를 냈다.`);
    } else {
      actor.aggro = Math.max(0, actor.aggro - (2.0 + actor.stats.charm * 0.03));
      if (attacker) this._addRel(actor.id, attacker.id, -3, -2);
      // others slightly restore trust to actor based on actor's logic/acting
      for (const other of this.getAlive()) {
        if (other.id === actor.id) continue;
        const factor = 0.08 + (actor.stats.logic + actor.stats.acting) / 200;
        this._addRel(other.id, actor.id, +6 * factor, +4 * factor);
      }
    }
  }

  _cmdDefend(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;

    // blocked?
    if (ctx.rebuttalBlockedForTarget === t.id && !ctx.rebuttalBlockBroken) {
      this._log(`${actor.name}:(변호하려 했지만 반론이 막혀 있다)`);
      return;
    }

    this._log(`${actor.name}:[변호한다] ${t.name}는 그렇게 수상하지 않아.`);

    actor.aggro += 1.5 * (1 - actor.stats.stealth / 50);

    const healTrust = 2.5 + actor.stats.logic * 0.14;
    const healFavor = 2.0 + actor.stats.acting * 0.12;

    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.18 + clamp((trustSpeaker + 25) / 150, 0.08, 0.65);
      this._addRel(other.id, t.id, +healTrust * factor, +healFavor * factor);
    }
    t.aggro = Math.max(0, t.aggro - 0.8);
  }

  _cmdAgreeDefend(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    if (ctx.rebuttalBlockedForTarget === t.id && !ctx.rebuttalBlockBroken) {
      this._log(`${actor.name}:(가담하려 했지만 반론이 막혀 있다)`);
      return;
    }

    this._log(`${actor.name}:[변호에 가담한다] ${t.name} 쪽을 믿겠어.`);
    actor.aggro += 0.7 * (1 - actor.stats.stealth / 50);

    const healTrust = 1.5 + actor.stats.logic * 0.09;
    const healFavor = 1.0 + actor.stats.acting * 0.07;

    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.12 + clamp((trustSpeaker + 25) / 170, 0.06, 0.5);
      this._addRel(other.id, t.id, +healTrust * factor, +healFavor * factor);
    }
    t.aggro = Math.max(0, t.aggro - 0.4);
  }

  _cmdCover(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[감싼다] ${t.name}는 안전해.`);

    actor.aggro += 1.6 * (1 - actor.stats.stealth / 50);

    const healTrust = 3 + actor.stats.logic * 0.16;
    const healFavor = 3 + actor.stats.acting * 0.16;

    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.20 + clamp((trustSpeaker + 25) / 140, 0.08, 0.75);
      this._addRel(other.id, t.id, +healTrust * factor, +healFavor * factor);
    }

    t.aggro = Math.max(0, t.aggro - 1.0);
    // t likes actor
    this._addRel(t.id, actor.id, +4, +6);
  }

  _cmdAgreeCover(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[함께 감싼다] ${t.name} 편이야.`);

    actor.aggro += 0.9 * (1 - actor.stats.stealth / 50);

    const healTrust = 1.5 + actor.stats.logic * 0.10;
    const healFavor = 1.5 + actor.stats.acting * 0.10;

    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.12 + clamp((trustSpeaker + 25) / 170, 0.06, 0.55);
      this._addRel(other.id, t.id, +healTrust * factor, +healFavor * factor);
    }

    t.aggro = Math.max(0, t.aggro - 0.5);
    this._addRel(t.id, actor.id, +2, +3);
  }

  _cmdThank(actor, targetId, ctx) {
    // used when actor was covered or certified human; simplified trigger
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[감사한다] ${t.name}, 고마워.`);
    actor.aggro = Math.max(0, actor.aggro - (2 + actor.stats.charm * 0.05));
    this._addRel(actor.id, t.id, +2, +8);
    this._addRel(t.id, actor.id, +2, +6);
  }

  _cmdCounter(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;

    // if counter is used against a cover/vote-proposal chain, treat it as attack
    this._log(`${actor.name}:[반론한다] ${t.name}는 위험해.`);

    actor.aggro += 1.7 * (1 - actor.stats.stealth / 50);

    const dmgTrust = 2.6 + actor.stats.logic * 0.16;
    const dmgFavor = 2.0 + actor.stats.acting * 0.14;
    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.18 + clamp((trustSpeaker + 25) / 150, 0.08, 0.65);
      this._addRel(other.id, t.id, -dmgTrust * factor, -dmgFavor * factor);
    }
    t.aggro += 0.8;
  }

  _cmdAgreeCounter(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[반론에 가담한다] ${t.name} 쪽이 의심돼.`);
    actor.aggro += 0.7 * (1 - actor.stats.stealth / 50);

    const dmgTrust = 1.3 + actor.stats.logic * 0.09;
    const dmgFavor = 1.0 + actor.stats.acting * 0.07;
    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.12 + clamp((trustSpeaker + 25) / 170, 0.06, 0.55);
      this._addRel(other.id, t.id, -dmgTrust * factor, -dmgFavor * factor);
    }
    t.aggro += 0.4;
  }

  _cmdNoisy(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[시끄러워] ${t.name}, 말이 너무 많아.`);
    // noisy increases target aggro and slightly reduces their trust
    t.aggro += 1.2;
    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      this._addRel(other.id, t.id, -1.2, -0.5);
    }
  }

  _cmdRequestCo(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    const requestedRole = ctx.requestedRole || pickRequestedRole(this.roleConfig, this.rng);
    ctx.requestedRole = requestedRole;

    this._log(`${actor.name}:[역할을 밝혀라] ${t.name}, ${requestedRole ?? "역할"} 밝혀.`);

    actor.aggro += 1.2 * (1 - actor.stats.stealth / 50);
    t.aggro += 0.7;
  }

  _cmdCoRole(actor, ctx, extra) {
    const claimRole = extra?.claimRole;
    if (!claimRole) return;

    // enforce "하루 1회 / 같은 역할은 하루 1회" (간단: actor만 1회)
    const tag = `CO:${claimRole}`;
    if (actor.usedToday.has(tag)) return;
    actor.usedToday.add(tag);

    // validate via roles.js (거짓말 가능 진영만 사칭 가능)
    if (!canClaimRole(this.roleOf, actor.id, claimRole)) return;

    actor.claim = claimRole;
    actor.claimDay = this.day;
    this._log(`${actor.name}:[역할을 밝힌다] (나는 ${claimRole}다.)`);

    // claim affects trust: logical people trust claims slightly, but can also distrust liars later
    for (const other of this.getAlive()) {
      if (other.id === actor.id) continue;
      const p = other.personality;
      const delta = 2.0 * p.logical + 0.8 * p.social;
      this._addRel(other.id, actor.id, +delta, 0);
    }

    // optional "자신도 밝힌다" follow-up if enabled
    if (actor.enabledCommands.has(COMMAND.CO_SELF_TOO) && rnd(this.rng) < (0.25 + actor.personality.courage * 0.35)) {
      this._execCommand(actor.id, COMMAND.CO_SELF_TOO, null, ctx, { claimRole });
    }
  }

  _cmdCoSelfToo(actor, ctx, extra) {
    const claimRole = extra?.claimRole || actor.claim;
    if (!claimRole) return;
    this._log(`${actor.name}:[자신도 밝힌다] (${claimRole} 맞아.)`);
    actor.aggro += 0.6;
  }

  _cmdExaggerate(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[과장해서 말한다] ${t.name}는 더 위험해 보여.`);
    actor.aggro += 1.0;

    // amplify last effect on favor dimension (acting)
    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.10 + clamp((trustSpeaker + 25) / 180, 0.05, 0.45);
      this._addRel(other.id, t.id, 0, -(1.8 + actor.stats.acting * 0.06) * factor);
    }
  }

  _cmdAskAgree(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[동의를 구한다] 다들 ${t.name}에 대해 어떻게 생각해?`);
    actor.aggro += 1.1;

    // encourages more followups by boosting chain potential (handled naturally by engine; here slight)
    for (const other of this.getAlive()) {
      if (other.id === actor.id) continue;
      this._addRel(other.id, actor.id, +1.0, 0);
    }
  }

  _cmdBlockRebut(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    // block only makes sense in suspect chain; we allow anyway
    ctx.rebuttalBlockedForTarget = t.id;
    ctx.rebuttalBlockerId = actor.id;
    this._log(`${actor.name}:[반론을 막는다] ${t.name} 편 드는 말은 그만해!`);
    actor.aggro += 3.0; // huge aggro as spec
  }

  _cmdDodge(actor, ctx) {
    this._log(`${actor.name}:[얼버무린다] (논의를 끊었다)`);
    actor.aggro = Math.max(0, actor.aggro - (1.5 + actor.stats.stealth * 0.04));
    ctx.stopped = true; // ends the chain immediately
  }

  _cmdCounterAttack(actor, targetId, ctx) {
    const attacker = this.getChar(targetId);
    if (!attacker) return;
    this._log(`${actor.name}:[반격한다] ${attacker.name}도 수상해!`);

    actor.aggro += 1.0;
    attacker.aggro += 0.8;

    // damage attacker trust/favor in others
    const dmgTrust = 2.0 + actor.stats.logic * 0.14;
    const dmgFavor = 1.6 + actor.stats.acting * 0.12;

    for (const other of this.getAlive()) {
      if (other.id === attacker.id) continue;
      const trustSpeaker = this._rel(other.id, actor.id).trust;
      const factor = 0.16 + clamp((trustSpeaker + 25) / 160, 0.07, 0.6);
      this._addRel(other.id, attacker.id, -dmgTrust * factor, -dmgFavor * factor);
    }
  }

  _cmdAskHelp(actor, ctx) {
    // ask a likely ally to defend actor (break rebuttal block if exists)
    const alive = this.getAlive().filter((c) => c.id !== actor.id);
    if (!alive.length) return;

    const ally = pickWeighted(this.rng, alive, (c) => {
      const rel = this._rel(actor.id, c.id);
      return 1 + (rel.favor + 30) / 40 + (rel.trust + 30) / 50;
    });

    this._log(`${actor.name}:[도움을 요청한다] ${ally.name}, 나 좀 변호해줘.`);

    // success depends on acting + charisma and ally favor
    const rel = this._rel(ally.id, actor.id);
    const chance =
      0.25 +
      actor.stats.acting / 120 +
      actor.stats.charisma / 200 +
      clamp((rel.favor + 20) / 120, 0, 0.5);

    if (rnd(this.rng) < chance) {
      this._log(`(성공) ${ally.name}가 ${actor.name}를 변호했다.`);
      // break block if any
      if (ctx.rebuttalBlockedForTarget === actor.id && !ctx.rebuttalBlockBroken) {
        ctx.rebuttalBlockBroken = true;
        this._log(`(반론 봉쇄 무효) 도움 요청으로 반론 봉쇄가 깨졌다.`);
      }
      // apply defend effect
      this._cmdDefend(ally, actor.id, ctx);
    } else {
      this._log(`(실패) ${ally.name}는 나서지 않았다.`);
      actor.aggro += 0.6;
    }
  }

  _cmdSad(actor, ctx) {
    this._log(`${actor.name}:[슬퍼한다] ...정말 너무해.`);
    // reduces incoming suspicion by raising favor from others
    actor.aggro = Math.max(0, actor.aggro - 1.2);
    for (const other of this.getAlive()) {
      if (other.id === actor.id) continue;
      this._addRel(other.id, actor.id, +1.0, +3.0 + actor.stats.charm * 0.04);
    }
  }

  _cmdDontTrust(actor, targetId, ctx) {
    const t = this.getChar(targetId);
    if (!t) return;
    this._log(`${actor.name}:[속지마라] ${t.name} 말, 조심해.`);
    // marks a warning for next day; simplified: reduces trust of target in others
    for (const other of this.getAlive()) {
      if (other.id === t.id) continue;
      this._addRel(other.id, t.id, -2.0, 0);
    }
  }

  _cmdChat(actor, ctx) {
    this._log(`${actor.name}:[잡담한다] (가벼운 대화를 시작했다)`);
    actor.aggro = Math.max(0, actor.aggro - (1.8 + actor.stats.stealth * 0.05));

    // participants up to 3 (even if they didn't enable CHAT; rule)
    const alive = this.getAlive().filter((c) => c.id !== actor.id);
    const maxJoin = Math.min(3, alive.length);
    const joined = [];

    for (let i = 0; i < maxJoin; i++) {
      if (rnd(this.rng) < 0.75) {
        const p = pickWeighted(this.rng, alive.filter((c) => !joined.includes(c.id)), (c) => {
          const rel = this._rel(c.id, actor.id);
          return 1 + (rel.favor + 30) / 50 + c.personality.social;
        });
        if (p) joined.push(p.id);
      }
    }

    for (const id of joined) {
      const c = this.getChar(id);
      if (!c) continue;
      this._log(`${c.name}:[잡담에 참여한다]`);
      // mutual favor up
      this._addRel(actor.id, c.id, 0, +4);
      this._addRel(c.id, actor.id, 0, +4);
    }

    // someone might stop
    if (joined.length && rnd(this.rng) < 0.25) {
      const stopper = this.getChar(joined[Math.floor(rnd(this.rng) * joined.length)]);
      if (stopper) {
        this._log(`${stopper.name}:[잡담을 중단시킨다]`);
        this._addRel(actor.id, stopper.id, 0, -3);
        this._addRel(stopper.id, actor.id, 0, -3);
      }
    }
    ctx.stopped = true; // treat as a whole chain-turn
  }

  _cmdSayHuman(actor, ctx) {
    this._log(`${actor.name}:[인간이라고 말해] 모두 "나는 인간이다"라고 말해.`);

    // sequential declarations; someone may stop; someone may stay silent
    const alive = this.getAlive().filter((c) => c.id !== actor.id);
    let stopped = false;

    // if someone stops, it heavily reduces trust to that stopper
    for (const c of alive) {
      if (stopped) break;

      const liar = canLieByRole(this.roleOf.get(c.id));
      // choose action
      let action = INTERNAL.SAY_HUMAN_DECL;

      // humans may sometimes stay silent depending on personality (욕망/용기 낮음)
      if (!liar) {
        const silentChance = 0.08 + (1 - c.personality.social) * 0.12;
        if (rnd(this.rng) < silentChance) action = INTERNAL.SAY_HUMAN_SKIP;
      } else {
        // liars face dilemma: say human (lie) or skip or stop
        const stopChance = 0.08 + c.personality.desire * 0.10;
        const skipChance = 0.12 + (1 - c.personality.courage) * 0.12;
        const x = rnd(this.rng);
        if (x < stopChance) action = INTERNAL.SAY_HUMAN_STOP;
        else if (x < stopChance + skipChance) action = INTERNAL.SAY_HUMAN_SKIP;
        else action = INTERNAL.SAY_HUMAN_DECL; // lie "I am human"
      }

      if (action === INTERNAL.SAY_HUMAN_DECL) {
        this._log(`${c.name}:(나는 인간이야.)`);

        if (liar) {
          // lie detection: listeners with intuition can catch
          for (const listener of this.getAlive()) {
            if (listener.id === c.id) continue;
            const chance =
              0.05 +
              listener.stats.intuition / 120 +
              (listener.personality.logical * 0.12);

            if (rnd(this.rng) < chance) {
              this._log(`※ ${listener.name}가 ${c.name}의 거짓말을 눈치챘다`);
              // listener distrusts liar strongly
              this._addRel(listener.id, c.id, -18, -8);
              c.aggro += 0.8;
            }
          }
        }
      } else if (action === INTERNAL.SAY_HUMAN_SKIP) {
        this._log(`${c.name}:(아무 말도 하지 않았다)`);
        c.aggro += 0.7;
        for (const other of this.getAlive()) {
          if (other.id === c.id) continue;
          this._addRel(other.id, c.id, -2.0, 0);
        }
      } else if (action === INTERNAL.SAY_HUMAN_STOP) {
        this._log(`${c.name}:(선언을 중단시켰다)`);
        stopped = true;
        c.aggro += 2.2;
        for (const other of this.getAlive()) {
          if (other.id === c.id) continue;
          this._addRel(other.id, c.id, -10, -4);
        }
      }
    }

    ctx.stopped = true;
  }

  // -------------------- vote & day->night --------------------
  _dayVoteAndAdvance() {
    // vote
    const alive = this.getAlive();
    if (alive.length <= 1) {
      this._endIfNeeded(true);
      return;
    }

    this._log(`=== Day ${this.day} 투표 ===`);

    // build vote target weights per voter
    const votes = new Map(); // targetId -> count
    for (const voter of alive) {
      const targets = alive.filter((c) => c.id !== voter.id);

      const choice = pickWeighted(this.rng, targets, (t) => {
        if (this.confirmedHuman.has(t.id)) return 0.05;
        if (this.confirmedEnemy.has(t.id)) return 4.0;

        // voter suspicion weight: low trust, target aggro, and voter logicalness
        const rel = this._rel(voter.id, t.id);
        const logicBias = 0.6 + voter.personality.logical * 0.9;

        const w =
          1.0 +
          (-(rel.trust) + 15) / 35 * logicBias +
          0.35 * t.aggro +
          (1 - t.stats.stealth / 50) * 0.5;

        return Math.max(0.05, w);
      });

      votes.set(choice.id, (votes.get(choice.id) || 0) + 1);
    }

    // find max
    let maxId = null;
    let maxCnt = -1;
    for (const [id, cnt] of votes.entries()) {
      if (cnt > maxCnt) {
        maxCnt = cnt;
        maxId = id;
      } else if (cnt === maxCnt && rnd(this.rng) < 0.5) {
        maxId = id;
      }
    }

    if (!maxId) {
      this._log("투표 결과를 결정할 수 없었다.");
      this.phase = "NIGHT_FREE";
      this.dayTurn = 1;
      return;
    }

    const target = this.getChar(maxId);
    this._log(`콜드슬립 대상: ${target.name} (득표 ${maxCnt})`);

    // DOGEZA chance (loop 1회, stealth>=35, enabled)
    if (target.enabledCommands.has(COMMAND.DOGEZA) && target.stats.stealth >= 35) {
      // effect depends on acting (기획서: 연기력)
      const chance = 0.12 + target.stats.acting / 200;
      if (rnd(this.rng) < chance) {
        this._log(`${target.name}:[도게자한다] (콜드슬립을 피했다!)`);
        // reduce suspicion a bit, but keeps some stigma
        target.aggro = Math.max(0, target.aggro - 1.0);
        // choose next highest
        let secondId = null;
        let secondCnt = -1;
        for (const [id, cnt] of votes.entries()) {
          if (id === maxId) continue;
          if (cnt > secondCnt) {
            secondCnt = cnt;
            secondId = id;
          }
        }
        if (secondId) {
          const t2 = this.getChar(secondId);
          this._log(`대신 ${t2.name}가 콜드슬립 되었다.`);
          this._coldSleep(secondId);
          this.lastColdSleepId = secondId;
        } else {
          this._log(`대체 대상이 없어 아무도 콜드슬립 되지 않았다.`);
          this.lastColdSleepId = null;
        }
      } else {
        this._coldSleep(maxId);
        this.lastColdSleepId = maxId;
      }
    } else {
      this._coldSleep(maxId);
      this.lastColdSleepId = maxId;
    }

    // doctor report (if doctor exists & alive)
    this._doctorCheck();

    // reset day-limits and advance phase
    for (const c of this.characters) c.usedToday.clear();
    this.phase = "NIGHT_FREE";
    this.dayTurn = 1;

    // win check
    if (this._endIfNeeded()) return;
  }

  _coldSleep(id) {
    const c = this.getChar(id);
    if (!c || !c.alive) return;
    c.alive = false;
    this._log(`${c.name}가 콜드슬립 되었다.`);
  }

  _doctorCheck() {
    if (!this.lastColdSleepId) return;

    const doctors = this.getAlive().filter((c) => this.roleOf.get(c.id) === ROLES.DOCTOR);
    if (!doctors.length) return;

    // choose one doctor (if multiple via lie claims we ignore; true doctor only acts)
    const doc = doctors[0];
    const target = this.getChar(this.lastColdSleepId);
    if (!target) return;

    const trueRole = this.roleOf.get(target.id);
    const result = (trueRole === ROLES.GNOSIA) ? "그노시아" : "인간";
    this.lastDoctorReport = { doctorId: doc.id, targetId: target.id, result };

    this._log(`[닥터 보고] ${doc.name}의 검사 결과: ${target.name} = ${result}`);
  }

  // ------------- night logic -------------
  _nightFreeActions() {
    this._log(`=== Night ${this.day} (자유행동) ===`);
    const alive = this.getAlive();

    // Free actions: pair hangout or solo or night coop proposal
    const used = new Set();

    for (const a of alive) {
      if (used.has(a.id)) continue;

      // chance to propose coop if enabled (new command)
      const canNightCoop = a.enabledCommands.has(COMMAND.NIGHT_COOP);

      if (canNightCoop && rnd(this.rng) < (0.18 + a.personality.social * 0.25)) {
        const candidates = alive.filter((c) => c.id !== a.id && !used.has(c.id));
        if (candidates.length) {
          const b = pickWeighted(this.rng, candidates, (c) => {
            const rel = this._rel(a.id, c.id);
            return 1 + (rel.favor + 30) / 40 + a.personality.social;
          });

          // success depends on mutual favor/social
          const relBA = this._rel(b.id, a.id);
          const chance =
            0.25 +
            clamp((relBA.favor + 20) / 120, 0, 0.5) +
            b.personality.social * 0.15;

          if (rnd(this.rng) < chance) {
            this._log(`${a.name}는 ${b.name}에게 협력 요청을 했고, 협력에 성공했다.`);
            // cooperation => big favor both ways
            this._addRel(a.id, b.id, +6, +18);
            this._addRel(b.id, a.id, +6, +18);
          } else {
            this._log(`${a.name}는 ${b.name}에게 협력 요청을 했지만, 거절당했다.`);
            this._addRel(a.id, b.id, -2, -6);
          }

          used.add(a.id);
          used.add(b.id);
          continue;
        }
      }

      // otherwise, hangout with someone or solo
      if (rnd(this.rng) < 0.55) {
        const candidates = alive.filter((c) => c.id !== a.id && !used.has(c.id));
        if (candidates.length) {
          const b = pickWeighted(this.rng, candidates, (c) => {
            const rel = this._rel(a.id, c.id);
            return 1 + (rel.favor + 30) / 50 + a.personality.social;
          });

          this._log(`${a.name}는 ${b.name}와 함께 시간을 보내어 상호 우호도가 올라갔다.`);
          this._addRel(a.id, b.id, 0, +7);
          this._addRel(b.id, a.id, 0, +7);
          used.add(a.id);
          used.add(b.id);
          continue;
        }
      }

      // solo
      this._log(`${a.name}는 혼자서 시간을 보냈다.`);
      a.aggro = Math.max(0, a.aggro - 0.3);
      used.add(a.id);
    }
  }

  _nightResolveAndAdvance() {
    this._log(`=== Night ${this.day} (역할 집행/습격) ===`);
    const alive = this.getAlive();

    // 1) Guardian chooses protect target
    this.guardProtectId = this._guardianProtect();

    // 2) Engineer investigates
    const bugDeath = this._engineerInvestigate(); // returns id if bug died

    // 3) Gnosia attack
    const attackDeath = this._gnosiaAttack(); // returns id if someone died else null

    // 4) Compose night death log rules (요구 반영)
    const deaths = [];
    if (bugDeath) deaths.push(bugDeath);
    if (attackDeath) deaths.push(attackDeath);

    this.lastNightDeaths = deaths.slice();

    if (deaths.length === 0) {
      this._log("아무도 소멸하지 않았습니다.");
    } else if (deaths.length === 1) {
      const d = this.getChar(deaths[0]);
      this._log(`${d.name}가 소멸했습니다.`);
    } else {
      const a = this.getChar(deaths[0]);
      const b = this.getChar(deaths[1]);
      this._log(`${a.name}와 ${b.name}가 소멸했습니다.`);
    }

    // apply deaths
    for (const id of deaths) {
      const c = this.getChar(id);
      if (c && c.alive) c.alive = false;
    }

    // advance day
    this.day++;
    this.phase = "DAY";
    this.dayTurn = 1;

    // clear per-loop usage if needed
    for (const c of this.characters) c.usedThisLoop.clear();

    // win check
    if (this._endIfNeeded(true)) return;

    this._log(`=== Day ${this.day} 시작 ===`);
  }

  _guardianProtect() {
    const guardians = this.getAlive().filter((c) => this.roleOf.get(c.id) === ROLES.GUARDIAN);
    if (!guardians.length) return null;

    const g = guardians[0];
    // cannot protect self
    const candidates = this.getAlive().filter((c) => c.id !== g.id);
    if (!candidates.length) return null;

    const protect = pickWeighted(this.rng, candidates, (t) => {
      // protect those with high favor/trust or high aggro (likely targeted)
      const rel = this._rel(g.id, t.id);
      return 1 + (rel.favor + 30) / 45 + (t.aggro * 0.25);
    });

    this._log(`[수호천사] ${g.name}가 누군가를 보호했다.`);
    return protect.id;
  }

  _engineerInvestigate() {
    const engineers = this.getAlive().filter((c) => this.roleOf.get(c.id) === ROLES.ENGINEER);
    if (!engineers.length) return null;

    const e = engineers[0];
    const targets = this.getAlive().filter((c) => c.id !== e.id);
    if (!targets.length) return null;

    const target = pickWeighted(this.rng, targets, (t) => {
      // investigate suspicious ones (aggro + low trust)
      const rel = this._rel(e.id, t.id);
      return 1 + t.aggro * 0.35 + (-(rel.trust) + 10) / 25;
    });

    const trueRole = this.roleOf.get(target.id);

    // engineer result: only detects gnosia; AC/BUG => "인간"
    const result = (trueRole === ROLES.GNOSIA) ? "그노시아" : "인간";
    this.lastEngineerReport = { engineerId: e.id, targetId: target.id, result };
    this._log(`[엔지니어 보고] ${e.name}의 조사 결과: ${target.name} = ${result}`);

    // if target is BUG => dies immediately (even if protected)
    if (trueRole === ROLES.BUG) {
      this._log(`(버그 소멸) ${target.name}는 엔지니어 조사로 소멸했다.`);
      return target.id;
    }
    return null;
  }

  _gnosiaAttack() {
    const alive = this.getAlive();
    const gnosias = alive.filter((c) => this.roleOf.get(c.id) === ROLES.GNOSIA);
    if (!gnosias.length) return null;

    const victims = alive.filter((c) => this.roleOf.get(c.id) !== ROLES.GNOSIA); // gnosia cannot kill each other
    if (!victims.length) return null;

    // choose victim based on gnosia dislike + victim aggro + "threat"
    const victim = pickWeighted(this.rng, victims, (v) => {
      // aggregate from all gnosias
      let score = 0.5 + v.aggro * 0.35 + (1 - v.stats.stealth / 50) * 0.4;
      for (const g of gnosias) {
        const rel = this._rel(g.id, v.id);
        // gnosia prefers those they dislike OR those who distrust gnosia (low trust)
        score += (-(rel.favor) + 10) / 40;
        score += (-(rel.trust) + 10) / 50;
      }
      // avoid confirmedHuman? actually gnosia may still kill confirmed humans; not avoid
      return Math.max(0.05, score);
    });

    // if victim is BUG => immune; treat as "no one died" (per your rule)
    if (this.roleOf.get(victim.id) === ROLES.BUG) {
      this._log(`[그노시아 습격] 그노시아가 ${victim.name}를 노렸지만, 소멸하지 않았다.`);
      return null;
    }

    // if protected => no death
    if (this.guardProtectId && victim.id === this.guardProtectId) {
      this._log(`[그노시아 습격] ${victim.name}가 보호받아 소멸하지 않았다.`);
      return null;
    }

    this._log(`[그노시아 습격] ${victim.name}가 그노시아에 의해 습격당했다.`);
    return victim.id;
  }

  // ------------- win conditions -------------
  _endIfNeeded(forceLog = false) {
    const alive = this.getAlive();
    const aliveRoles = alive.map((c) => this.roleOf.get(c.id));

    const bugAlive = aliveRoles.includes(ROLES.BUG);

    const trueGnosiaAlive = aliveRoles.filter((r) => r === ROLES.GNOSIA).length;
    const gnosiaSideAlive = aliveRoles.filter((r) => r === ROLES.GNOSIA || r === ROLES.AC).length;
    const humanSideAlive = aliveRoles.filter((r) => getFaction(r) === "HUMAN").length;

    let winner = null;

    // if bug is alive and game ended by other condition, bug overrides (기획서)
    // base human win: all true gnosia eliminated
    if (trueGnosiaAlive === 0) {
      winner = "HUMAN";
      // AC주의자: 살아있어도 패배 처리(그노시아 전멸 시)
    } else if (gnosiaSideAlive >= humanSideAlive && gnosiaSideAlive > 0) {
      winner = "GNOSIA";
    }

    if (!winner) return false;

    if (bugAlive) winner = "BUG";

    this.phase = "ENDED";
    this._log(`=== 게임 종료 ===`);
    if (winner === "HUMAN") this._log(`결과: 선원 진영 승리`);
    if (winner === "GNOSIA") this._log(`결과: 그노시아 진영 승리`);
    if (winner === "BUG") this._log(`결과: 버그 단독 승리`);

    this._log(`[역할 공개]`);
    for (const c of this.characters) {
      const r = this.roleOf.get(c.id);
      const status = c.alive ? "생존" : "사망";
      this._log(`- ${c.name}: ${r} (${status})`);
    }
    return true;
  }
}

