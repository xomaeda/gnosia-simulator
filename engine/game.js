// engine/game.js
// ============================================================================
// Core simulation engine
// - Day: user clicks Run -> executes ONE TURN (총 5번 클릭하면 낮 종료 + 투표/콜드슬립)
// - Night: user clicks Run -> step 1 (free actions logs)
//          user clicks Run again -> step 2 (role actions + attack resolution logs)
// - Roles are assigned at game start and are visible to the user (per your change).
// - Lie detection: if someone notices a lie, log "A가 B의 거짓말을 눈치챘다"
// - Implements: gnosia attack preference (not fully random), guardian protect, engineer bug kill,
//               death message rule you requested.
//
// Depends on:
//   - ./roles.js
//   - ./commands.js
// ============================================================================

import {
  ROLE,
  SIDE,
  ROLE_INFO,
  normalizeGameConfig,
  assignRoles,
  canLie,
  getClaimableRoles,
  getCOQueryableRoles,
  isGnosiaDetectedRole,
  roleLabel,
} from "./roles.js";

import {
  COMMAND,
  COMMAND_META,
  statEligible,
  isCommandEligibleBasic,
  isChainEligible,
} from "./commands.js";

// ---------------- RNG ----------------
function makeRng(seed = null) {
  // simple LCG when seed provided, otherwise Math.random
  if (seed === null || seed === undefined) return () => Math.random();
  let s = (Number(seed) >>> 0) || 123456789;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function choice(arr, rng) {
  if (!arr.length) return null;
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function f2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------- Relationship matrix ----------------
// relation.trust[aId][bId], relation.like[aId][bId]  (0..100)
function createRelations(chars, rng) {
  const trust = {};
  const like = {};
  const ids = chars.map((c) => c.id);

  for (const a of ids) {
    trust[a] = {};
    like[a] = {};
    for (const b of ids) {
      if (a === b) {
        trust[a][b] = 50;
        like[a][b] = 50;
      } else {
        // "랜덤 분포" 기반: 중앙 50 근처 + 약간 편차
        trust[a][b] = clamp(50 + (rng() - 0.5) * 30, 0, 100);
        like[a][b] = clamp(50 + (rng() - 0.5) * 30, 0, 100);
      }
    }
  }
  return { trust, like };
}

function relGet(rel, type, aId, bId) {
  return rel?.[type]?.[aId]?.[bId] ?? 50;
}

function relAdd(rel, type, aId, bId, delta) {
  rel[type][aId][bId] = clamp(rel[type][aId][bId] + delta, 0, 100);
}

function relAddBoth(rel, type, aId, bId, delta) {
  relAdd(rel, type, aId, bId, delta);
  relAdd(rel, type, bId, aId, delta);
}

// ---------------- Character shape ----------------
// char fields used:
// { id, name, gender, age, stats{...}, personality{...}, enabledCommands:Set, alive, aggro, cooperation:Set<charId> }

// ---------------- Game class ----------------
export class Game {
  constructor({ chars, config, seed = null }) {
    if (!Array.isArray(chars)) throw new Error("chars must be array");
    this.rng = makeRng(seed);

    // deep-ish copy
    this.chars = chars.map((c, idx) => ({
      ...c,
      id: c.id ?? `C${idx + 1}`,
      alive: c.alive !== false,
      aggro: Number.isFinite(c.aggro) ? c.aggro : 0,
      enabledCommands: normalizeEnabledCommands(c.enabledCommands),
      cooperation: new Set(Array.isArray(c.cooperation) ? c.cooperation : []),
      // runtime:
      claimedRole: null, // for CO claims (engineer/doctor/passenger claim)
      locked: false,     // for "반드시 적이다" etc (activity restriction)
    }));

    if (this.chars.length < 5) {
      throw new Error("캐릭터는 최소 5명이어야 합니다.");
    }
    if (this.chars.length > 15) {
      throw new Error("캐릭터는 최대 15명입니다.");
    }

    this.config = normalizeGameConfig(config || {}, this.chars.length);

    // roles assigned at start, visible to user
    this.roleById = assignRoles(this.chars, this.config, this.rng);

    // quick lists
    this.day = 1;
    this.phase = "SETUP"; // DAY / NIGHT_FREE / NIGHT_RESOLVE / ENDED
    this.dayTurnIndex = 0; // 0..4
    this.nightStep = 0;    // 0..1 within night
    this.loop = 1;         // you used "루프" notion; we map day as loop-like
    this.logs = [];

    // relations
    this.relation = createRelations(this.chars, this.rng);

    // daily reports (revealed in day start)
    this.pendingReports = {
      engineer: [], // {fromId, targetId, result:"GNOSIA"|"HUMAN", killedBug:boolean}
      doctor: [],   // {fromId, targetId, result:"GNOSIA"|"HUMAN"}
      lieNotices: [], // {observerId, liarId}
    };

    // store last cold-slept (for doctor inspection)
    this.lastColdSleptId = null;

    // initialize claimedRole for truthful roles (they know their role)
    for (const c of this.chars) {
      const role = this.getRole(c.id);
      c.trueRole = role;
      c.claimedRole = null; // they may claim later
    }

    // start at day 1
    this.phase = "DAY";
    this.dayTurnIndex = 0;
    this.nightStep = 0;

    this.log(`=== 게임 시작 (DAY 1) ===`);
    this.logRolesPublic(); // user sees all roles at start (your request)
    this.log(`낮 1일차: 실행 버튼을 누르면 1턴씩 진행됩니다. (총 5턴)`);
  }

  // ---------------- Public helpers ----------------
  getRole(charId) {
    return this.roleById.get(charId) || ROLE.CREW;
  }
  getChar(charId) {
    return this.chars.find((c) => c.id === charId);
  }
  aliveChars() {
    return this.chars.filter((c) => c.alive);
  }
  aliveNonLockedChars() {
    return this.chars.filter((c) => c.alive && !c.locked);
  }
  isEnded() {
    return this.phase === "ENDED";
  }

  exportLogsText() {
    return this.logs.join("\n");
  }

  // called by UI "Run" button: advances one step
  step() {
    if (this.phase === "ENDED") return;

    if (this.phase === "DAY") {
      this.stepDayTurn();
      return;
    }

    if (this.phase === "NIGHT_FREE") {
      this.stepNightFree();
      return;
    }

    if (this.phase === "NIGHT_RESOLVE") {
      this.stepNightResolve();
      return;
    }
  }

  // ---------------- Logging ----------------
  log(line) {
    this.logs.push(line);
  }

  logRolesPublic() {
    this.log(`--- 역할 공개(시작 시 공개 설정) ---`);
    for (const c of this.chars) {
      const r = this.getRole(c.id);
      this.log(`${c.name}: ${roleLabel(r)}`);
    }
    this.log(`----------------------------------`);
  }

  // ---------------- Day flow ----------------
  stepDayTurn() {
    if (this.phase !== "DAY") return;

    // day start reports (once at first turn of day)
    if (this.dayTurnIndex === 0) {
      this.flushReportsToLog();
    }

    const alive = this.aliveNonLockedChars();
    if (alive.length === 0) {
      this.endGame("생존자가 없습니다.");
      return;
    }

    // Execute one "TURN" (chain of commands)
    const chain = this.generateTurnChain();
    this.printChainLogs(chain);

    this.dayTurnIndex += 1;

    if (this.dayTurnIndex >= 5) {
      // End of day: vote -> cold sleep
      this.resolveVoteAndColdSleep();

      if (this.checkVictoryAndEndIfNeeded()) return;

      // Move to night
      this.phase = "NIGHT_FREE";
      this.nightStep = 0;
      this.log(`=== 밤 ${this.day}일차: (1) 자유행동 ===`);
      return;
    }

    this.log(`--- (낮 ${this.day}일차) ${this.dayTurnIndex}/5 턴 종료 ---`);
  }

  flushReportsToLog() {
    // engineer reports
    for (const rep of this.pendingReports.engineer) {
      const from = this.getChar(rep.fromId)?.name ?? "?";
      const tgt = this.getChar(rep.targetId)?.name ?? "?";
      const text = rep.result === "GNOSIA" ? "그노시아" : "인간";
      this.log(`${from}의 보고: ${tgt}는 ${text}입니다.`);
      if (rep.killedBug) {
        // bug already killed at night resolve, but report can still mention "소멸"
        this.log(`(추가 정보) ${tgt}(버그)는 조사로 인해 소멸했습니다.`);
      }
    }
    this.pendingReports.engineer = [];

    // doctor reports
    for (const rep of this.pendingReports.doctor) {
      const from = this.getChar(rep.fromId)?.name ?? "?";
      const tgt = this.getChar(rep.targetId)?.name ?? "?";
      const text = rep.result === "GNOSIA" ? "그노시아" : "인간";
      this.log(`${from}의 검사: 콜드슬립된 ${tgt}는 ${text}였습니다.`);
    }
    this.pendingReports.doctor = [];

    // lie notices
    for (const ln of this.pendingReports.lieNotices) {
      const obs = this.getChar(ln.observerId)?.name ?? "?";
      const liar = this.getChar(ln.liarId)?.name ?? "?";
      this.log(`${obs}가 ${liar}의 거짓말을 눈치챘다.`);
    }
    this.pendingReports.lieNotices = [];
  }

  // ---------------- Turn chain generation ----------------
  generateTurnChain() {
    // One "TURN" = starter + any number of sub-commands until stopped
    const ctx = {
      chain: [],
      targetId: null,
      blockedRebut: false, // 반론봉쇄 상태(이 턴에서만)
      blockById: null,
      blockCanBeBroken: true,
    };

    const starter = this.pickStarterActor();
    const starterCmd = this.pickStarterCommand(starter);
    const starterTarget = this.pickStarterTarget(starterCmd, starter);

    const startEvent = {
      actorId: starter.id,
      cmd: starterCmd,
      targetId: starterTarget,
      extra: {},
    };

    // apply base effects
    this.applyCommandEffects(startEvent, ctx);
    ctx.chain.push(startEvent);

    // If starter creates a "topic", store
    ctx.targetId = starterTarget;

    // After starter, run possible sub-flow
    this.continueChain(ctx);

    return ctx.chain;
  }

  pickStarterActor() {
    const alive = this.aliveNonLockedChars();

    // Choose actor weighted by "talk tendency": social + cheer + (1-stealth penalty) but also allow repeats
    const weights = alive.map((c) => {
      const p = c.personality || {};
      const st = c.stats || {};
      const talk = (Number(p.social) || 0) * 0.6 + (Number(p.cheer) || 0) * 0.4;
      const stealth = Number(st.stealth) || 0;
      const w = 1 + talk * 2 + (50 - stealth) * 0.15;
      return Math.max(0.1, w);
    });

    const sum = weights.reduce((a, b) => a + b, 0);
    let r = this.rng() * sum;
    for (let i = 0; i < alive.length; i++) {
      r -= weights[i];
      if (r <= 0) return alive[i];
    }
    return alive[0];
  }

  pickStarterCommand(actor) {
    // possible starters:
    // - SUSPECT, COVER
    // - REQUEST_CO, VOTE_HIM, DONT_VOTE, CERT_HUMAN, CERT_ENEMY, ALL_EXCLUDE_ROLE
    // - CHAT, COOP, SAY_HUMAN
    //
    // Must respect: enabledCommands (if required), stat requirements, "startsChain"
    const candidates = [
      COMMAND.SUSPECT,
      COMMAND.COVER,
      COMMAND.REQUEST_CO,
      COMMAND.VOTE_HIM,
      COMMAND.DONT_VOTE,
      COMMAND.CERT_HUMAN,
      COMMAND.CERT_ENEMY,
      COMMAND.ALL_EXCLUDE_ROLE,
      COMMAND.CHAT,
      COMMAND.COOP,
      COMMAND.SAY_HUMAN,
    ];

    const feasible = candidates.filter((cmd) => {
      const meta = COMMAND_META[cmd];
      if (!meta) return false;
      if (!meta.chain?.startsChain) return false;
      return isCommandEligibleBasic({ char: actor, commandId: cmd, phase: "DAY" });
    });

    // If none feasible, fallback to SUSPECT (always)
    if (!feasible.length) return COMMAND.SUSPECT;

    // Heuristic:
    // - If actor is liar-side, more likely to start SUSPECT, REQUEST_CO, ALL_EXCLUDE_ROLE
    // - If actor is kind, more likely COVER
    const role = this.getRole(actor.id);
    const liar = canLie(role);
    const p = actor.personality || {};

    const weighted = feasible.map((cmd) => {
      let w = 1;
      if (cmd === COMMAND.SUSPECT) w += liar ? 1.5 : 1.0;
      if (cmd === COMMAND.COVER) w += (Number(p.kindness) || 0) * 1.2;
      if (cmd === COMMAND.REQUEST_CO) w += liar ? 1.2 : 0.6;
      if (cmd === COMMAND.ALL_EXCLUDE_ROLE) w += liar ? 1.0 : 0.3;
      if (cmd === COMMAND.CHAT) w += (Number(p.cheer) || 0) * 0.8 + (Number(actor.stats?.stealth) || 0) * 0.2;
      if (cmd === COMMAND.COOP) w += (Number(p.social) || 0) * 0.7 + (Number(actor.stats?.charm) || 0) * 0.4;
      if (cmd === COMMAND.SAY_HUMAN) w += (Number(actor.stats?.intuition) || 0) * 0.4;

      // reduce over-use of high-impact commands randomly
      w *= 0.7 + this.rng() * 0.6;

      return { cmd, w: Math.max(0.1, w) };
    });

    const sum = weighted.reduce((a, b) => a + b.w, 0);
    let r = this.rng() * sum;
    for (const x of weighted) {
      r -= x.w;
      if (r <= 0) return x.cmd;
    }
    return weighted[0].cmd;
  }

  pickStarterTarget(cmd, actor) {
    const alive = this.aliveChars().filter((c) => c.id !== actor.id);

    if (!alive.length) return null;

    // some commands may not need target
    const meta = COMMAND_META[cmd];
    if (meta?.chain?.needsTarget !== true && meta?.chain?.needsRoleGroup !== true) {
      // SUSPECT/COVER do need target in your spec, but we keep it always target
      if (cmd === COMMAND.SUSPECT || cmd === COMMAND.COVER || cmd === COMMAND.COOP || cmd === COMMAND.VOTE_HIM || cmd === COMMAND.DONT_VOTE || cmd === COMMAND.CERT_HUMAN || cmd === COMMAND.CERT_ENEMY) {
        // continue
      } else {
        return null;
      }
    }

    // Target selection based on type
    const actorRole = this.getRole(actor.id);
    const liar = canLie(actorRole);

    // score function: higher -> more likely
    const scores = alive.map((t) => {
      let s = 1;

      const trust = relGet(this.relation, "trust", actor.id, t.id);
      const like = relGet(this.relation, "like", actor.id, t.id);

      if (cmd === COMMAND.SUSPECT) {
        // suspect those you distrust/dislike or high aggro
        s += (100 - trust) * 0.9 + (100 - like) * 0.6;
        s += (t.aggro || 0) * 0.3;
        // liar-side tends to push suspicion on crew side
        if (liar && this.getRole(t.id) !== ROLE.GNOSIA && this.getRole(t.id) !== ROLE.AC) s += 10;
      }

      if (cmd === COMMAND.COVER) {
        // cover those you like/trust
        s += trust * 0.6 + like * 0.9;
      }

      if (cmd === COMMAND.COOP) {
        // propose cooperation to someone you like
        s += like * 1.1 + trust * 0.7;
      }

      if (cmd === COMMAND.VOTE_HIM || cmd === COMMAND.CERT_ENEMY) {
        s += (100 - trust) * 1.2 + (100 - like) * 0.6 + (t.aggro || 0) * 0.5;
      }

      if (cmd === COMMAND.DONT_VOTE || cmd === COMMAND.CERT_HUMAN) {
        s += trust * 1.0 + like * 0.8;
      }

      // avoid targeting locked / dead (should already be alive)
      if (t.locked) s *= 0.4;

      s *= 0.8 + this.rng() * 0.5;
      return { t, s: Math.max(0.1, s) };
    });

    // weighted pick
    const sum = scores.reduce((a, b) => a + b.s, 0);
    let r = this.rng() * sum;
    for (const x of scores) {
      r -= x.s;
      if (r <= 0) return x.t.id;
    }
    return scores[0].t.id;
  }

  continueChain(ctx) {
    // We simulate reactions/sub-commands:
    // - agree/defend/counter/askAgree/exaggerate/blockRebut
    // - target may deny / ask_help / sad / dodge / counterattack
    // - special chains: REQUEST_CO triggers CO_ROLE responses, CO_SELF_TOO
    // - SAY_HUMAN triggers declarations / stop
    // - CHAT triggers join / stop
    // - VOTE/DONT_VOTE/ALL_EXCLUDE triggers approve/reject sequence

    const main = ctx.chain[0];
    const mainCmd = main.cmd;

    if (mainCmd === COMMAND.REQUEST_CO) {
      this.chainRoleRequest(ctx);
      return;
    }
    if (mainCmd === COMMAND.SAY_HUMAN) {
      this.chainSayHuman(ctx);
      return;
    }
    if (mainCmd === COMMAND.CHAT) {
      this.chainChat(ctx);
      return;
    }
    if (mainCmd === COMMAND.VOTE_HIM || mainCmd === COMMAND.DONT_VOTE || mainCmd === COMMAND.ALL_EXCLUDE_ROLE) {
      this.chainApproveReject(ctx);
      return;
    }
    if (mainCmd === COMMAND.COOP) {
      // COOP is day cooperation proposal: target may accept/reject (internal but logged)
      this.chainCoopDay(ctx);
      return;
    }

    // standard debate chain: allow 0~(alive-1) subcommands
    const maxSubs = Math.min(5, this.aliveChars().length - 1);
    for (let i = 0; i < maxSubs; i++) {
      const next = this.pickSubCommand(ctx);
      if (!next) break;
      this.applyCommandEffects(next, ctx);
      ctx.chain.push(next);

      // some commands end chain
      const meta = COMMAND_META[next.cmd];
      if (meta?.chain?.endsChainImmediately) break;
      if (next.cmd === COMMAND.DODGE) break;
    }
  }

  pickSubCommand(ctx) {
    const chain = ctx.chain;
    const main = chain[0];
    const targetId = ctx.targetId;

    const alive = this.aliveNonLockedChars();

    // exclude those already acted this chain for same sub-command? we allow multiple
    // but 1턴 1회 제한은 meta.limits.perChain for specific commands; engine won't duplicate it.

    // Candidate sub-commands per situation:
    const options = [];

    // Support / agreement after suspect/cover
    options.push(COMMAND.AGREE_SUSPECT, COMMAND.ASK_AGREE, COMMAND.EXAGGERATE, COMMAND.BLOCK_REBUT);
    options.push(COMMAND.AGREE_COVER, COMMAND.EXAGGERATE, COMMAND.ASK_AGREE);
    options.push(COMMAND.DEFEND, COMMAND.AGREE_DEFEND);
    options.push(COMMAND.COUNTER, COMMAND.AGREE_COUNTER);

    // Target reactions if self is target
    options.push(COMMAND.DENY, COMMAND.ASK_HELP, COMMAND.SAD, COMMAND.DODGE, COMMAND.COUNTERATTACK, COMMAND.DONT_TRUST);

    // NOISY can appear after suspect/cover
    options.push(COMMAND.NOISY);

    // THANK if just defended/covered or certified human (handled in eligibility)

    const uniq = [...new Set(options)].filter(Boolean);

    // Build feasible events by scanning actors that might use each cmd
    const events = [];

    for (const actor of alive) {
      for (const cmd of uniq) {
        const meta = COMMAND_META[cmd];
        if (!meta) continue;

        // perChain limitation: don't allow same actor use same cmd twice in chain
        if (chain.some((e) => e.actorId === actor.id && e.cmd === cmd)) continue;

        // basic day eligibility
        if (!isCommandEligibleBasic({ char: actor, commandId: cmd, phase: "DAY" })) continue;

        // chain eligibility
        const chainCtx = {
          chain,
          targetId,
        };
        // help flags for onlyIfSelfIsTarget etc
        // isChainEligible checks target==actor when onlyIfSelfIsTarget
        if (!isChainEligible({ char: actor, commandId: cmd, ctx: chainCtx })) continue;

        // If rebut is blocked and this is a defend-type rebuttal, block it unless help succeeded
        if (ctx.blockedRebut) {
          // defend is rebuttal against suspect topic
          if (cmd === COMMAND.DEFEND || cmd === COMMAND.AGREE_DEFEND) {
            // blocked for this turn
            continue;
          }
        }

        // Determine target for this command:
        const event = { actorId: actor.id, cmd, targetId: null, extra: {} };

        // Most sub commands use the main target
        if (meta.chain?.needsTargetFromChain) event.targetId = targetId;

        // DENY/REACTIVE are self-targeted
        if (meta.chain?.onlyIfSelfIsTarget) event.targetId = actor.id;

        // COUNTERATTACK targets attacker (main actor)
        if (meta.chain?.targetsAttacker) event.targetId = main.actorId;

        // ASK_HELP chooses someone to ask (prefer friend)
        if (cmd === COMMAND.ASK_HELP) {
          event.targetId = this.pickHelpTarget(actor.id, main.actorId);
        }

        // NOISY targets main actor or loud actor (use main.actor)
        if (cmd === COMMAND.NOISY) {
          event.targetId = main.actorId;
        }

        events.push(event);
      }
    }

    if (!events.length) return null;

    // Weight events based on personalities and relations
    const weighted = events.map((e) => {
      const actor = this.getChar(e.actorId);
      const p = actor.personality || {};
      const st = actor.stats || {};
      const aRole = this.getRole(actor.id);
      const liar = canLie(aRole);

      let w = 1;

      // agree: more social, charismatic
      if (e.cmd === COMMAND.AGREE_SUSPECT || e.cmd === COMMAND.AGREE_COVER || e.cmd === COMMAND.AGREE_DEFEND || e.cmd === COMMAND.AGREE_COUNTER) {
        w += (Number(p.social) || 0) * 1.2 + (Number(st.charisma) || 0) * 0.05;
      }

      // defend/cover: kindness + liking target
      if (e.cmd === COMMAND.DEFEND) {
        const like = relGet(this.relation, "like", actor.id, ctx.targetId);
        w += (Number(p.kindness) || 0) * 1.5 + like * 0.03;
      }

      // counter: logical tendency
      if (e.cmd === COMMAND.COUNTER) {
        w += (Number(p.logical) || 0) * 1.4 + (Number(st.logic) || 0) * 0.05;
      }

      // deny/sad/help: charm helps
      if (e.cmd === COMMAND.DENY) w += (Number(st.logic) || 0) * 0.04;
      if (e.cmd === COMMAND.SAD) w += (Number(st.charm) || 0) * 0.06;
      if (e.cmd === COMMAND.ASK_HELP) w += (Number(st.acting) || 0) * 0.04;

      // block rebut: liar side likes it more
      if (e.cmd === COMMAND.BLOCK_REBUT) w += liar ? 2.0 : 0.2;

      // dont_trust: intuition
      if (e.cmd === COMMAND.DONT_TRUST) w += (Number(st.intuition) || 0) * 0.06;

      // noisy: desire/aggro irritation
      if (e.cmd === COMMAND.NOISY) w += (Number(p.desire) || 0) * 0.6;

      // randomness
      w *= 0.7 + this.rng() * 0.7;
      return { e, w: Math.max(0.05, w) };
    });

    const sum = weighted.reduce((a, b) => a + b.w, 0);
    let r = this.rng() * sum;
    for (const x of weighted) {
      r -= x.w;
      if (r <= 0) return x.e;
    }
    return weighted[0].e;
  }

  pickHelpTarget(selfId, attackerId) {
    const me = this.getChar(selfId);
    const candidates = this.aliveChars().filter((c) => c.id !== selfId && c.id !== attackerId && !c.locked);
    if (!candidates.length) return attackerId;

    // prefer high trust/like and cooperation partners
    const scored = candidates.map((c) => {
      const t = relGet(this.relation, "trust", selfId, c.id);
      const l = relGet(this.relation, "like", selfId, c.id);
      const coop = me.cooperation?.has?.(c.id) ? 15 : 0;
      return { c, s: 1 + t * 0.5 + l * 0.7 + coop };
    });

    scored.sort((a, b) => b.s - a.s);
    // weighted among top 3
    const top = scored.slice(0, 3);
    return choice(top.map((x) => x.c.id), this.rng);
  }

  // ---------------- Special chains ----------------
  chainRoleRequest(ctx) {
    // REQUEST_CO: actor asks for a role group; others may respond with CO_ROLE, CO_SELF_TOO
    // In your rule: REQUEST_CO possible when "there exists un-COed role among (Passenger/Engineer/Doctor)".
    // This engine picks a queryRole and tries to get responses.
    const asker = this.getChar(ctx.chain[0].actorId);
    const queryRoles = getCOQueryableRoles(); // passenger/engineer/doctor

    // choose a role to request (prefer those enabled in config)
    const enabled = [];
    if (this.config.rolesEnabled[ROLE.PASSENGER]) enabled.push(ROLE.PASSENGER);
    if (this.config.rolesEnabled[ROLE.ENGINEER]) enabled.push(ROLE.ENGINEER);
    if (this.config.rolesEnabled[ROLE.DOCTOR]) enabled.push(ROLE.DOCTOR);
    const pool = enabled.length ? enabled : queryRoles;
    const queryRole = choice(pool, this.rng);

    ctx.chain[0].extra.queryRole = queryRole;

    // responders: some characters who can participate CO and can claim queryRole
    const alive = this.aliveNonLockedChars().filter((c) => c.id !== asker.id);

    // Determine who will claim:
    const claimers = [];
    for (const c of alive) {
      const trueRole = this.getRole(c.id);
      const claimable = getClaimableRoles(trueRole); // truthful roles -> [selfRole] if CO truth; liars -> [engineer,doctor]
      // passenger truth claim is possible only if true passenger (claimable includes passenger)
      if (!claimable.includes(queryRole)) continue;

      // each potential claimer decides based on courage/social; liars more likely to claim engineer/doctor
      const p = c.personality || {};
      const base = 0.15 + (Number(p.courage) || 0) * 0.25 + (Number(p.social) || 0) * 0.15;
      const liar = canLie(trueRole);
      const bias = liar ? 0.2 : 0.1;
      const prob = clamp(base + bias, 0, 0.85);
      if (this.rng() < prob) claimers.push(c);
    }

    // cap number of claimers for log sanity
    const pickedClaimers = shuffle(claimers, this.rng).slice(0, 4);

    if (!pickedClaimers.length) {
      // no one claims: ends turn
      ctx.chain.push({
        actorId: asker.id,
        cmd: COMMAND._REJECT, // internal-ish end marker; not shown. We'll log explicitly below in printChainLogs.
        targetId: null,
        extra: { noClaim: true, queryRole },
      });
      return;
    }

    // First claimer uses CO_ROLE, others may CO_SELF_TOO
    const first = pickedClaimers[0];
    const e1 = { actorId: first.id, cmd: COMMAND.CO_ROLE, targetId: null, extra: { claimRole: queryRole } };
    this.applyCommandEffects(e1, ctx);
    ctx.chain.push(e1);

    for (let i = 1; i < pickedClaimers.length; i++) {
      const c = pickedClaimers[i];
      const e = { actorId: c.id, cmd: COMMAND.CO_SELF_TOO, targetId: null, extra: { claimRole: queryRole } };
      this.applyCommandEffects(e, ctx);
      ctx.chain.push(e);
    }
  }

  chainSayHuman(ctx) {
    const starter = this.getChar(ctx.chain[0].actorId);
    const others = this.aliveNonLockedChars().filter((c) => c.id !== starter.id);

    for (const c of others) {
      // someone can stop early
      const stopProb = 0.05 + (Number(c.personality?.logical) || 0) * 0.05 + (Number(c.stats?.logic) || 0) * 0.004;
      if (this.rng() < stopProb) {
        ctx.chain.push({ actorId: c.id, cmd: COMMAND._SAY_HUMAN_STOP, targetId: null, extra: {} });
        // stopping reduces trust massively from others (applied in effects)
        this.applyCommandEffects(ctx.chain[ctx.chain.length - 1], ctx);
        return;
      }

      // decide declare or skip
      const declareProb = 0.65 + (Number(c.personality?.social) || 0) * 0.25;
      if (this.rng() < declareProb) {
        ctx.chain.push({ actorId: c.id, cmd: COMMAND._SAY_HUMAN_DECL, targetId: null, extra: {} });
        this.applyCommandEffects(ctx.chain[ctx.chain.length - 1], ctx);
      } else {
        ctx.chain.push({ actorId: c.id, cmd: COMMAND._SAY_HUMAN_SKIP, targetId: null, extra: {} });
        this.applyCommandEffects(ctx.chain[ctx.chain.length - 1], ctx);
      }
    }
  }

  chainChat(ctx) {
    const starter = this.getChar(ctx.chain[0].actorId);
    const others = shuffle(this.aliveNonLockedChars().filter((c) => c.id !== starter.id), this.rng);

    // up to 3 participants, but someone can stop early
    let joined = 0;
    for (const c of others) {
      if (joined >= 3) break;

      // chance to stop
      const stopProb = 0.06 + (Number(c.personality?.logical) || 0) * 0.06;
      if (this.rng() < stopProb) {
        const e = { actorId: c.id, cmd: COMMAND._CHAT_STOP, targetId: null, extra: {} };
        ctx.chain.push(e);
        this.applyCommandEffects(e, ctx);
        return;
      }

      // join
      const joinProb = 0.55 + (Number(c.personality?.cheer) || 0) * 0.35 + (Number(c.personality?.social) || 0) * 0.25;
      if (this.rng() < joinProb) {
        const e = { actorId: c.id, cmd: COMMAND._CHAT_JOIN, targetId: null, extra: {} };
        ctx.chain.push(e);
        this.applyCommandEffects(e, ctx);
        joined++;
      }
    }
  }

  chainApproveReject(ctx) {
    const starter = this.getChar(ctx.chain[0].actorId);
    const others = shuffle(this.aliveNonLockedChars().filter((c) => c.id !== starter.id), this.rng);

    for (const c of others) {
      // each may approve or reject or silent
      const p = c.personality || {};
      const logical = Number(p.logical) || 0;
      const desire = Number(p.desire) || 0;

      const rejectProb = clamp(0.07 + logical * 0.08 + desire * 0.04, 0, 0.55);
      const approveProb = clamp(0.35 + (Number(p.social) || 0) * 0.25, 0, 0.85);

      const r = this.rng();
      if (r < rejectProb) {
        const e = { actorId: c.id, cmd: COMMAND._REJECT, targetId: null, extra: {} };
        ctx.chain.push(e);
        this.applyCommandEffects(e, ctx);
        return; // reject ends chain immediately
      }
      if (r < rejectProb + approveProb) {
        const e = { actorId: c.id, cmd: COMMAND._APPROVE, targetId: null, extra: {} };
        ctx.chain.push(e);
        this.applyCommandEffects(e, ctx);
      } else {
        // silent
      }
    }
  }

  chainCoopDay(ctx) {
    const starter = this.getChar(ctx.chain[0].actorId);
    const target = this.getChar(ctx.chain[0].targetId);
    if (!target) return;

    // accept probability based on trust/like + target charm/social
    const t = relGet(this.relation, "trust", target.id, starter.id);
    const l = relGet(this.relation, "like", target.id, starter.id);
    const base = 0.25 + t * 0.004 + l * 0.005;
    const charm = Number(target.stats?.charm) || 0;
    const social = Number(target.personality?.social) || 0;
    const prob = clamp(base + charm * 0.01 + social * 0.18, 0, 0.9);

    const accepted = this.rng() < prob;
    ctx.chain[0].extra.accepted = accepted;

    if (accepted) {
      starter.cooperation.add(target.id);
      target.cooperation.add(starter.id);
      // boost mutual like/trust
      relAddBoth(this.relation, "like", starter.id, target.id, 12);
      relAddBoth(this.relation, "trust", starter.id, target.id, 8);
    } else {
      // slight like decrease
      relAdd(this.relation, "like", starter.id, target.id, -4);
    }
  }

  // ---------------- Apply effects (numbers are tuned, not placeholder) ----------------
  applyCommandEffects(event, ctx) {
    const actor = this.getChar(event.actorId);
    const target = event.targetId ? this.getChar(event.targetId) : null;
    const cmd = event.cmd;

    const aStats = actor?.stats || {};
    const aPers = actor?.personality || {};

    // Aggro changes: talking increases; stealth reduces
    const stealth = Number(aStats.stealth) || 0;
    const talkBase = 4.0;
    const talkMult = clamp(1.2 - stealth / 80, 0.4, 1.2);

    const addAggro = (delta) => {
      actor.aggro = clamp((actor.aggro || 0) + delta, 0, 200);
    };

    const dmgTrust = (srcId, dstId, amount) => relAdd(this.relation, "trust", srcId, dstId, -amount);
    const dmgLike = (srcId, dstId, amount) => relAdd(this.relation, "like", srcId, dstId, -amount);
    const healTrust = (srcId, dstId, amount) => relAdd(this.relation, "trust", srcId, dstId, amount);
    const healLike = (srcId, dstId, amount) => relAdd(this.relation, "like", srcId, dstId, amount);

    // helpers
    const charisma = Number(aStats.charisma) || 0;
    const logic = Number(aStats.logic) || 0;
    const acting = Number(aStats.acting) || 0;
    const charm = Number(aStats.charm) || 0;
    const intuition = Number(aStats.intuition) || 0;

    const defense = clamp(charm / 50, 0, 0.35); // 귀염성 방어
    const logicPow = 6 + logic * 0.25;
    const actingPow = 6 + acting * 0.25;
    const chainBonus = clamp(charisma * 0.15, 0, 10);

    // generic talk aggro
    if (
      cmd !== COMMAND._APPROVE &&
      cmd !== COMMAND._REJECT &&
      cmd !== COMMAND._CHAT_JOIN &&
      cmd !== COMMAND._CHAT_STOP &&
      cmd !== COMMAND._SAY_HUMAN_DECL &&
      cmd !== COMMAND._SAY_HUMAN_SKIP &&
      cmd !== COMMAND._SAY_HUMAN_STOP
    ) {
      addAggro(talkBase * talkMult);
    }

    switch (cmd) {
      case COMMAND.SUSPECT: {
        if (!target) break;
        // decrease actor's trust/like toward target? It's their statement; more important is others' perception:
        // In this simplified model: actor becomes less trusting/liking of target, AND target loses "standing" in group
        dmgTrust(actor.id, target.id, logicPow * 0.4);
        dmgLike(actor.id, target.id, actingPow * 0.35);

        // the more charismatic, more "social ripple": others slightly reduce trust/like to target
        const ripple = clamp(0.08 + charisma / 200, 0.08, 0.35);
        for (const o of this.aliveChars()) {
          if (o.id === actor.id || o.id === target.id) continue;
          dmgTrust(o.id, target.id, logicPow * ripple * 0.25);
          dmgLike(o.id, target.id, actingPow * ripple * 0.20);
        }
        // target gets angry -> like drops toward actor
        dmgLike(target.id, actor.id, 2 + actingPow * 0.08);
        // target defense reduces effect on others (귀염성)
        if (Number(target.stats?.charm) > 0) {
          const def = clamp((Number(target.stats?.charm) || 0) / 50, 0, 0.35);
          for (const o of this.aliveChars()) {
            if (o.id === actor.id || o.id === target.id) continue;
            healTrust(o.id, target.id, logicPow * def * 0.18);
            healLike(o.id, target.id, actingPow * def * 0.14);
          }
        }
        break;
      }

      case COMMAND.AGREE_SUSPECT: {
        if (!target) break;
        // smaller ripple
        for (const o of this.aliveChars()) {
          if (o.id === actor.id) continue;
          dmgTrust(o.id, target.id, (3 + logic * 0.12) * 0.25);
          dmgLike(o.id, target.id, (3 + acting * 0.10) * 0.20);
        }
        addAggro(1.0 * talkMult);
        break;
      }

      case COMMAND.COVER: {
        if (!target) break;
        healTrust(actor.id, target.id, logicPow * 0.35);
        healLike(actor.id, target.id, actingPow * 0.45);

        const ripple = clamp(0.08 + charisma / 200, 0.08, 0.35);
        for (const o of this.aliveChars()) {
          if (o.id === actor.id || o.id === target.id) continue;
          healTrust(o.id, target.id, logicPow * ripple * 0.20);
          healLike(o.id, target.id, actingPow * ripple * 0.25);
        }
        break;
      }

      case COMMAND.AGREE_COVER: {
        if (!target) break;
        for (const o of this.aliveChars()) {
          if (o.id === actor.id) continue;
          healTrust(o.id, target.id, (3 + logic * 0.10) * 0.20);
          healLike(o.id, target.id, (3 + acting * 0.12) * 0.25);
        }
        addAggro(1.0 * talkMult);
        break;
      }

      case COMMAND.DEFEND:
      case COMMAND.AGREE_DEFEND: {
        if (!target) break;
        // defend helps recover group perception
        const base = cmd === COMMAND.DEFEND ? 6 : 3.5;
        for (const o of this.aliveChars()) {
          if (o.id === actor.id) continue;
          healTrust(o.id, target.id, (base + logic * 0.18) * 0.35);
          healLike(o.id, target.id, (base + acting * 0.18) * 0.35);
        }
        break;
      }

      case COMMAND.DENY: {
        // recover self in others' eyes
        const base = 5 + logic * 0.2;
        for (const o of this.aliveChars()) {
          if (o.id === actor.id) continue;
          healTrust(o.id, actor.id, base * 0.45);
          healLike(o.id, actor.id, (4 + acting * 0.15) * 0.35);
        }
        // but if timed poorly, can backfire slightly
        if (this.rng() < 0.12) {
          for (const o of this.aliveChars()) {
            if (o.id === actor.id) continue;
            dmgTrust(o.id, actor.id, 3);
          }
        }
        break;
      }

      case COMMAND.COUNTER:
      case COMMAND.AGREE_COUNTER: {
        if (!target) break;
        const base = cmd === COMMAND.COUNTER ? 5.5 : 3.0;
        for (const o of this.aliveChars()) {
          if (o.id === actor.id) continue;
          dmgTrust(o.id, target.id, (base + logic * 0.16) * 0.30);
          dmgLike(o.id, target.id, (base + acting * 0.14) * 0.25);
        }
        break;
      }

      case COMMAND.EXAGGERATE: {
        // boost like/trust delta on chain target in direction of main topic
        // Here we just add aggro and slightly increase effect on target perception
        addAggro(3.5 * talkMult);
        if (ctx.targetId) {
          const tId = ctx.targetId;
          const boost = 2 + acting * 0.08;
          for (const o of this.aliveChars()) {
            if (o.id === actor.id) continue;
            // if main was suspect => more negative, else more positive (detect via first command)
            const mainCmd = ctx.chain[0]?.cmd;
            if (mainCmd === COMMAND.SUSPECT) {
              relAdd(this.relation, "like", o.id, tId, -boost * 0.25);
            } else if (mainCmd === COMMAND.COVER) {
              relAdd(this.relation, "like", o.id, tId, +boost * 0.25);
            }
          }
        }
        break;
      }

      case COMMAND.ASK_AGREE: {
        addAggro(2.0 * talkMult);
        // encourages more joiners (handled by pickSubCommand weights)
        break;
      }

      case COMMAND.BLOCK_REBUT: {
        ctx.blockedRebut = true;
        ctx.blockById = actor.id;
        addAggro(6.0 * talkMult);
        break;
      }

      case COMMAND.ASK_HELP: {
        // success based on helper relationship and acting/charisma
        const helperId = event.targetId;
        const helper = helperId ? this.getChar(helperId) : null;
        if (!helper) break;

        const like = relGet(this.relation, "like", helper.id, actor.id);
        const trust = relGet(this.relation, "trust", helper.id, actor.id);
        const prob = clamp(
          0.18 + (acting / 50) * 0.35 + (charisma / 50) * 0.20 + like * 0.004 + trust * 0.003,
          0,
          0.95
        );

        const ok = this.rng() < prob;
        event.extra.success = ok;

        if (ok) {
          // if rebut is blocked this turn, break it
          if (ctx.blockedRebut) ctx.blockedRebut = false;

          // helper is more likely to defend: inject a DEFEND event next if possible (engine will naturally choose)
          // immediate small recovery
          for (const o of this.aliveChars()) {
            if (o.id === actor.id) continue;
            relAdd(this.relation, "trust", o.id, actor.id, 3.5);
            relAdd(this.relation, "like", o.id, actor.id, 2.5);
          }
        } else {
          // embarrassment
          for (const o of this.aliveChars()) {
            if (o.id === actor.id) continue;
            relAdd(this.relation, "trust", o.id, actor.id, -2.0);
          }
        }
        break;
      }

      case COMMAND.SAD: {
        // many people soften (unless already very distrustful)
        for (const o of this.aliveChars()) {
          if (o.id === actor.id) continue;
          const t = relGet(this.relation, "trust", o.id, actor.id);
          if (t > 20) {
            relAdd(this.relation, "like", o.id, actor.id, 4 + charm * 0.05);
            relAdd(this.relation, "trust", o.id, actor.id, 2 + charm * 0.03);
          }
        }
        addAggro(-2.0);
        break;
      }

      case COMMAND.DODGE: {
        // end chain effect handled by chain stop; reduce aggro a bit due to stealth
        addAggro(-2.5);
        break;
      }

      case COMMAND.COUNTERATTACK: {
        // attack attacker (targetId=main actor)
        if (!target) break;
        for (const o of this.aliveChars()) {
          if (o.id === actor.id) continue;
          relAdd(this.relation, "trust", o.id, target.id, -(4 + logic * 0.08));
          relAdd(this.relation, "like", o.id, target.id, -(3 + acting * 0.06));
        }
        addAggro(3.0 * talkMult);
        break;
      }

      case COMMAND.DONT_TRUST: {
        // marks attacker as liar-suspected: increase chance others detect lie (implemented as report flag)
        // Here we just slightly reduce trust toward attacker
        const mainAttackerId = ctx.chain[0]?.actorId;
        if (mainAttackerId) {
          for (const o of this.aliveChars()) {
            if (o.id === actor.id) continue;
            relAdd(this.relation, "trust", o.id, mainAttackerId, -(2 + intuition * 0.04));
          }
        }
        break;
      }

      case COMMAND.NOISY: {
        if (!target) break;
        // noisy call reduces target's trust
        for (const o of this.aliveChars()) {
          if (o.id === actor.id) continue;
          relAdd(this.relation, "trust", o.id, target.id, -3.5);
        }
        addAggro(1.0 * talkMult);
        break;
      }

      case COMMAND.REQUEST_CO:
      case COMMAND.CO_ROLE:
      case COMMAND.CO_SELF_TOO: {
        // CO claim may be lie -> allow lie detection
        if (cmd === COMMAND.CO_ROLE || cmd === COMMAND.CO_SELF_TOO) {
          const claimRole = event.extra?.claimRole;
          actor.claimedRole = claimRole;

          const trueRole = this.getRole(actor.id);
          const liar = canLie(trueRole);
          const isLie = liar ? true : (trueRole !== claimRole); // truthful roles cannot lie; so only true match is possible

          if (isLie) {
            // observers may notice based on intuition + their own suspicion
            this.tryLieNotice(actor.id);
          }
        }
        break;
      }

      case COMMAND.VOTE_HIM:
      case COMMAND.DONT_VOTE:
      case COMMAND.ALL_EXCLUDE_ROLE: {
        // mostly affects vote probabilities later; here increase aggro
        addAggro(2.5 * talkMult);
        break;
      }

      case COMMAND.CERT_HUMAN: {
        if (!target) break;
        // huge trust boost toward target, and mark "certifiedHuman" flag
        target.certHuman = true;
        for (const o of this.aliveChars()) {
          if (o.id === target.id) continue;
          relAdd(this.relation, "trust", o.id, target.id, 12);
          relAdd(this.relation, "like", o.id, target.id, 6);
        }
        break;
      }

      case COMMAND.CERT_ENEMY: {
        if (!target) break;
        // lock target from acting; huge suspicion
        target.locked = true;
        for (const o of this.aliveChars()) {
          if (o.id === target.id) continue;
          relAdd(this.relation, "trust", o.id, target.id, -15);
          relAdd(this.relation, "like", o.id, target.id, -8);
        }
        break;
      }

      case COMMAND.CHAT: {
        // starter: reduce own aggro
        addAggro(-6.0);
        break;
      }
      case COMMAND._CHAT_JOIN: {
        // joining increases mutual like with starter (chain[0].actorId)
        const starterId = ctx.chain[0]?.actorId;
        if (starterId) relAddBoth(this.relation, "like", starterId, actor.id, 4);
        break;
      }
      case COMMAND._CHAT_STOP: {
        // stopper loses like with starter
        const starterId = ctx.chain[0]?.actorId;
        if (starterId) {
          relAdd(this.relation, "like", actor.id, starterId, -6);
          relAdd(this.relation, "like", starterId, actor.id, -6);
        }
        break;
      }

      case COMMAND.COOP: {
        // handled in chainCoopDay()
        break;
      }

      case COMMAND.SAY_HUMAN: {
        // starting this is risky: aggro rises
        addAggro(3.0 * talkMult);
        break;
      }
      case COMMAND._SAY_HUMAN_DECL: {
        // speaking may expose lies (if liar-side)
        const trueRole = this.getRole(actor.id);
        const liar = canLie(trueRole);
        if (liar) this.tryLieNotice(actor.id);
        break;
      }
      case COMMAND._SAY_HUMAN_STOP: {
        // stopping is very suspicious: trust plummets
        for (const o of this.aliveChars()) {
          if (o.id === actor.id) continue;
          relAdd(this.relation, "trust", o.id, actor.id, -18);
        }
        addAggro(8);
        break;
      }

      case COMMAND._APPROVE: {
        // small ripple: trust toward proposer increases
        const proposerId = ctx.chain[0]?.actorId;
        if (proposerId) relAdd(this.relation, "trust", actor.id, proposerId, 2);
        break;
      }
      case COMMAND._REJECT: {
        // rejecting reduces trust toward proposer
        const proposerId = ctx.chain[0]?.actorId;
        if (proposerId) relAdd(this.relation, "trust", actor.id, proposerId, -3);
        break;
      }

      default:
        break;
    }
  }

  tryLieNotice(liarId) {
    const liar = this.getChar(liarId);
    if (!liar) return;

    for (const obs of this.aliveChars()) {
      if (obs.id === liarId) continue;

      const intu = Number(obs.stats?.intuition) || 0;
      const base = 0.02 + intu / 250; // up to +0.2
      const distrust = (100 - relGet(this.relation, "trust", obs.id, liarId)) / 100; // 0..1
      const prob = clamp(base + distrust * 0.12, 0, 0.45);

      if (this.rng() < prob) {
        this.pendingReports.lieNotices.push({ observerId: obs.id, liarId });
        // once noticed by someone, reduce chance of repeated spam
        break;
      }
    }
  }

  // ---------------- Printing chain logs (texts are not placeholders) ----------------
  printChainLogs(chain) {
    // Required format: "이름:[커맨드] ..."

    const first = chain[0];
    const a = this.getChar(first.actorId)?.name ?? "?";
    const tName = first.targetId ? (this.getChar(first.targetId)?.name ?? "?") : null;

    // helper
    const line = (actorId, cmd, text) => {
      const nm = this.getChar(actorId)?.name ?? "?";
      this.log(`${nm}:[${cmd}] ${text}`);
    };

    // main command
    switch (first.cmd) {
      case COMMAND.SUSPECT:
        line(first.actorId, first.cmd, `${tName}는 수상해.`); // 너가 나중에 로그 패턴 교체 가능
        break;
      case COMMAND.COVER:
        line(first.actorId, first.cmd, `${tName}는 믿을 수 있어.`); // 임시 문장(너가 바꿔도 됨)
        break;
      case COMMAND.REQUEST_CO: {
        const r = first.extra?.queryRole ?? ROLE.ENGINEER;
        line(first.actorId, first.cmd, `${roleLabel(r)}는 정체를 밝혀라.`);
        break;
      }
      case COMMAND.VOTE_HIM:
        line(first.actorId, first.cmd, `${tName}에게 투표하자.`);
        break;
      case COMMAND.DONT_VOTE:
        line(first.actorId, first.cmd, `${tName}에게는 투표하지 말자.`);
        break;
      case COMMAND.CERT_HUMAN:
        line(first.actorId, first.cmd, `${tName}는 반드시 인간이다.`);
        break;
      case COMMAND.CERT_ENEMY:
        line(first.actorId, first.cmd, `${tName}는 반드시 적이다.`);
        break;
      case COMMAND.ALL_EXCLUDE_ROLE:
        line(first.actorId, first.cmd, `해당 역할 전원 배제하자.`);
        break;
      case COMMAND.CHAT:
        line(first.actorId, first.cmd, `잡담하자.`);
        break;
      case COMMAND.COOP:
        line(first.actorId, first.cmd, `${tName}, 협력하자.`);
        // accept/deny logged after chainCoopDay
        break;
      case COMMAND.SAY_HUMAN:
        line(first.actorId, first.cmd, `전원 인간이라고 말해.`);
        break;
      default:
        line(first.actorId, first.cmd, `발언했다.`);
        break;
    }

    // subsequent chain items
    for (let i = 1; i < chain.length; i++) {
      const e = chain[i];
      const nm = this.getChar(e.actorId)?.name ?? "?";
      const cmd = e.cmd;

      if (cmd === COMMAND._APPROVE) {
        this.log(`${nm}:[찬성한다] 찬성.`);
        continue;
      }
      if (cmd === COMMAND._REJECT) {
        // special: role request no claim marker
        if (e.extra?.noClaim) {
          this.log(`(아무도 정체를 밝히지 않았다.)`);
        } else {
          this.log(`${nm}:[반대한다] 반대.`);
        }
        continue;
      }
      if (cmd === COMMAND._CHAT_JOIN) {
        this.log(`${nm}:[잡담에 참여한다] 참여했다.`);
        continue;
      }
      if (cmd === COMMAND._CHAT_STOP) {
        this.log(`${nm}:[잡담을 중단시킨다] 중단시켰다.`);
        continue;
      }
      if (cmd === COMMAND._SAY_HUMAN_DECL) {
        this.log(`${nm}:[나는 인간이야] 나는 인간이야.`);
        continue;
      }
      if (cmd === COMMAND._SAY_HUMAN_SKIP) {
        this.log(`${nm}:(아무 말도 하지 않았다.)`);
        continue;
      }
      if (cmd === COMMAND._SAY_HUMAN_STOP) {
        this.log(`${nm}:[선언을 중단시킨다] 그만하자.`);
        continue;
      }

      // normal commands
      if (cmd === COMMAND.AGREE_SUSPECT || cmd === COMMAND.AGREE_COVER || cmd === COMMAND.AGREE_DEFEND || cmd === COMMAND.AGREE_COUNTER) {
        const targetName = this.getChar(ctxTargetFromChain(chain))?.name ?? "?";
        this.log(`${nm}:[${cmd}] ${targetName}의 말에 동의해.`);
        continue;
      }

      if (cmd === COMMAND.CO_ROLE) {
        const r = e.extra?.claimRole ?? "?";
        this.log(`${nm}:[역할을 밝힌다] (자신이 ${roleLabel(r)}라고 선언한다.)`);
        continue;
      }

      if (cmd === COMMAND.CO_SELF_TOO) {
        const r = e.extra?.claimRole ?? "?";
        this.log(`${nm}:[자신도 밝힌다] (나도 ${roleLabel(r)}야.)`);
        continue;
      }

      if (cmd === COMMAND.ASK_HELP) {
        const helperName = this.getChar(e.targetId)?.name ?? "?";
        const ok = e.extra?.success ? "성공" : "실패";
        this.log(`${nm}:[도움을 요청한다] ${helperName}에게 도움을 요청했다. (${ok})`);
        continue;
      }

      if (cmd === COMMAND.NOISY) {
        const who = this.getChar(e.targetId)?.name ?? "?";
        this.log(`${nm}:[시끄러워] ${who}, 말이 너무 많아.`);
        continue;
      }

      if (cmd === COMMAND.BLOCK_REBUT) {
        this.log(`${nm}:[반론을 막는다] (이 턴에서 반론이 봉쇄되었다.)`);
        continue;
      }

      if (cmd === COMMAND.DENY) {
        this.log(`${nm}:[부정한다] 난 아니야.`);
        continue;
      }

      if (cmd === COMMAND.SAD) {
        this.log(`${nm}:[슬퍼한다] 너무해...`);
        continue;
      }

      if (cmd === COMMAND.DODGE) {
        this.log(`${nm}:[얼버무린다] (논의를 끊고 넘어간다.)`);
        continue;
      }

      if (cmd === COMMAND.COUNTERATTACK) {
        const atk = this.getChar(e.targetId)?.name ?? "?";
        this.log(`${nm}:[반격한다] ${atk}도 의심스러워.`);
        continue;
      }

      if (cmd === COMMAND.DONT_TRUST) {
        this.log(`${nm}:[속지마라] (상대의 거짓말이 들킬 확률이 올라간다.)`);
        continue;
      }

      if (cmd === COMMAND.COOP) {
        const accepted = chain[0]?.extra?.accepted;
        if (accepted === true) this.log(`(협력이 성립했다.)`);
        if (accepted === false) this.log(`(협력이 거절되었다.)`);
        continue;
      }

      // fallback
      this.log(`${nm}:[${cmd}] ...`);
    }
  }

  // helper to get main target from chain
  // (we stored ctx.targetId, but logs function receives only chain)
  // we use first event targetId for suspect/cover and those that set target; else null.
  // For agree commands we want the subject actor's statement (starter).
  // We'll just return chain[0].actorId as "speaker" but text uses "말에 동의해" so fine.
  // If you want strict: return chain[0].actorId.
  // Here we return chain[0].actorId to match "X의 말".
  // NOTE: It is used in printChainLogs above.
  // eslint-disable-next-line no-unused-vars
  function ctxTargetFromChain(chain) {
    return chain?.[0]?.actorId ?? null;
  }

  // ---------------- Vote / Cold sleep ----------------
  resolveVoteAndColdSleep() {
    this.log(`=== 낮 ${this.day}일차 종료: 투표 시작 ===`);

    const alive = this.aliveChars().filter((c) => !c.locked);

    // each voter chooses target with lowest trust (and higher aggro)
    const votes = new Map(); // targetId -> count
    const voters = this.aliveChars(); // locked can still vote? usually yes; but if locked "활동 불가" might still exist. We'll let locked vote = false.
    for (const v of voters) {
      if (!v.alive) continue;
      if (v.locked) continue;

      const targets = alive.filter((t) => t.id !== v.id);
      if (!targets.length) continue;

      let best = null;
      let bestScore = -Infinity;
      for (const t of targets) {
        // lower trust => higher vote score
        const trust = relGet(this.relation, "trust", v.id, t.id);
        const like = relGet(this.relation, "like", v.id, t.id);
        const score =
          (100 - trust) * 1.1 +
          (100 - like) * 0.5 +
          (t.aggro || 0) * 0.35 +
          (t.locked ? 15 : 0) +
          (t.certHuman ? -35 : 0);

        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (!best) continue;
      votes.set(best.id, (votes.get(best.id) || 0) + 1);
      this.log(`${v.name}의 투표: ${best.name}`);
    }

    // pick highest votes
    let topId = null;
    let topVotes = -1;
    for (const [tid, cnt] of votes.entries()) {
      if (cnt > topVotes) {
        topVotes = cnt;
        topId = tid;
      }
    }

    if (!topId) {
      // no votes
      this.log(`투표가 성립하지 않았다.`);
      this.endDayToNight();
      return;
    }

    const victim = this.getChar(topId);

    // Dogeza check: if victim can use dogeza and enabled, they may avoid cold sleep
    const canDogeza =
      victim.alive &&
      isCommandEligibleBasic({ char: victim, commandId: COMMAND.DOGEZA, phase: "DAY" });

    let avoided = false;
    if (canDogeza) {
      const acting = Number(victim.stats?.acting) || 0;
      // success chance: base 10% + acting bonus
      const prob = clamp(0.10 + acting / 120, 0.10, 0.60);
      avoided = this.rng() < prob;
      this.log(`${victim.name}:[도게자한다] ${avoided ? "콜드슬립을 피했다!" : "실패했다..."}`);
    }

    if (!avoided) {
      victim.alive = false;
      this.lastColdSleptId = victim.id;
      this.log(`결과: ${victim.name}가 콜드슬립되었습니다.`);
      // doctor inspection report will come next day (if doctor alive)
      this.scheduleDoctorReport(victim.id);
    } else {
      this.log(`결과: 아무도 콜드슬립되지 않았습니다.`);
      this.lastColdSleptId = null;
    }

    // reset day turn & move to night
    this.endDayToNight();
  }

  endDayToNight() {
    this.dayTurnIndex = 0;
    this.phase = "NIGHT_FREE";
    this.nightStep = 0;
    this.log(`=== 밤 ${this.day}일차: (1) 자유행동 ===`);
  }

  scheduleDoctorReport(coldId) {
    const doctors = this.aliveChars().filter((c) => this.getRole(c.id) === ROLE.DOCTOR);
    if (!doctors.length) return;
    const doc = choice(doctors, this.rng);
    const role = this.getRole(coldId);
    const result = isGnosiaDetectedRole(role) ? "GNOSIA" : "HUMAN";
    this.pendingReports.doctor.push({ fromId: doc.id, targetId: coldId, result });
  }

  // ---------------- Night flow ----------------
  stepNightFree() {
    if (this.phase !== "NIGHT_FREE") return;

    // Free actions: pair time, cooperation request (night extra command)
    const alive = this.aliveChars();

    const logs = [];

    // night coop proposals by characters who enabled NIGHT_COOP
    const coopProposers = alive.filter((c) =>
      isCommandEligibleBasic({ char: c, commandId: COMMAND.NIGHT_COOP, phase: "NIGHT_FREE" })
    );

    // Some propose, others just hang out
    const acted = new Set();

    // proposals first
    for (const p of shuffle(coopProposers, this.rng).slice(0, Math.min(2, coopProposers.length))) {
      const candidates = alive.filter((c) => c.id !== p.id);
      if (!candidates.length) continue;

      const target = choice(
        candidates.sort((a, b) => {
          const la = relGet(this.relation, "like", p.id, a.id);
          const lb = relGet(this.relation, "like", p.id, b.id);
          return lb - la;
        }).slice(0, 4),
        this.rng
      );

      if (!target) continue;

      // accept chance based on target's view
      const tLike = relGet(this.relation, "like", target.id, p.id);
      const tTrust = relGet(this.relation, "trust", target.id, p.id);
      const prob = clamp(0.20 + tLike * 0.004 + tTrust * 0.003 + (Number(p.personality?.social) || 0) * 0.25, 0, 0.9);
      const ok = this.rng() < prob;

      if (ok) {
        p.cooperation.add(target.id);
        target.cooperation.add(p.id);
        relAddBoth(this.relation, "like", p.id, target.id, 10);
        relAddBoth(this.relation, "trust", p.id, target.id, 6);
        logs.push(`${p.name}는 ${target.name}에게 협력 요청을 했고, 협력에 성공했다.`);
      } else {
        relAdd(this.relation, "like", p.id, target.id, -3);
        logs.push(`${p.name}는 ${target.name}에게 협력 요청을 했지만, 거절당했다.`);
      }

      acted.add(p.id);
      acted.add(target.id);
    }

    // remaining: pair hangouts
    const remaining = shuffle(alive.filter((c) => !acted.has(c.id)), this.rng);
    while (remaining.length >= 2) {
      const a = remaining.pop();
      const b = remaining.pop();
      relAddBoth(this.relation, "like", a.id, b.id, 4);
      logs.push(`${a.name}는 ${b.name}와 함께 시간을 보내어 상호 우호도가 조금 올라갔다.`);
      acted.add(a.id);
      acted.add(b.id);
    }
    // lone
    for (const c of remaining) {
      logs.push(`${c.name}는 혼자서 시간을 보냈다.`);
    }

    for (const l of logs) this.log(l);

    this.phase = "NIGHT_RESOLVE";
    this.nightStep = 1;
    this.log(`=== 밤 ${this.day}일차: (2) 역할 집행 / 습격 ===`);
  }

  stepNightResolve() {
    if (this.phase !== "NIGHT_RESOLVE") return;

    // Resolve:
    // - engineer scan (can kill bug immediately)
    // - guardian protect (cannot protect self)
    // - gnosia attack: choose victim based on dislike/distrust/aggro (NOT random)
    // - output rule:
    //    if guardian saved OR gnosia tried bug => "아무도 소멸하지 않았습니다"
    //    if engineer killed bug AND gnosia killed someone => "A와 B가 소멸했습니다"
    //    else list the deaths, or none.
    const alive = this.aliveChars();

    // engineer action
    const engineer = alive.find((c) => this.getRole(c.id) === ROLE.ENGINEER);
    let engineerBugKillId = null;

    if (engineer) {
      const target = this.pickEngineerTarget(engineer.id);
      if (target) {
        const role = this.getRole(target.id);
        const result = isGnosiaDetectedRole(role) ? "GNOSIA" : "HUMAN";
        let killedBug = false;

        // bug: scan kills immediately
        if (role === ROLE.BUG) {
          target.alive = false;
          engineerBugKillId = target.id;
          killedBug = true;
        }

        this.pendingReports.engineer.push({
          fromId: engineer.id,
          targetId: target.id,
          result,
          killedBug,
        });
      }
    }

    // guardian protect
    const guardian = alive.find((c) => this.getRole(c.id) === ROLE.GUARDIAN);
    let protectedId = null;
    if (guardian) {
      const protect = this.pickGuardianProtect(guardian.id);
      if (protect) protectedId = protect.id;
    }

    // gnosia attack
    const gnosias = alive.filter((c) => this.getRole(c.id) === ROLE.GNOSIA);
    let attackVictimId = null;
    if (gnosias.length) {
      attackVictimId = this.pickGnosiaVictim(gnosias);
    }

    // Apply attack outcome
    const deaths = [];

    // engineer bug kill is a death
    if (engineerBugKillId) deaths.push(engineerBugKillId);

    // gnosia victim
    let gnosiaAttemptedBug = false;
    let guardianSaved = false;

    if (attackVictimId) {
      const victim = this.getChar(attackVictimId);
      if (victim && victim.alive) {
        const vRole = this.getRole(victim.id);

        // cannot kill bug
        if (vRole === ROLE.BUG) {
          gnosiaAttemptedBug = true;
        } else if (protectedId && protectedId === victim.id) {
          guardianSaved = true;
        } else {
          victim.alive = false;
          deaths.push(victim.id);
        }
      }
    }

    // Log result message per your rule
    if (deaths.length === 0) {
      // includes: guardian saved, or gnosia tried bug, or no victim
      this.log(`아무도 소멸하지 않았습니다.`);
    } else if (deaths.length === 1) {
      const n1 = this.getChar(deaths[0])?.name ?? "?";
      this.log(`${n1}가 소멸했습니다.`);
    } else {
      const names = deaths.map((id) => this.getChar(id)?.name ?? "?");
      this.log(`${names.join("와 ")}가 소멸했습니다.`);
    }

    // advance day
    this.day += 1;
    this.phase = "DAY";
    this.dayTurnIndex = 0;
    this.nightStep = 0;
    this.log(`=== DAY ${this.day} ===`);

    // check victory
    this.checkVictoryAndEndIfNeeded();
  }

  pickEngineerTarget(engineerId) {
    // engineer: pick someone they distrust most, but can be influenced by intuition
    const eng = this.getChar(engineerId);
    const candidates = this.aliveChars().filter((c) => c.id !== engineerId);
    if (!candidates.length) return null;

    const scored = candidates.map((c) => {
      const trust = relGet(this.relation, "trust", engineerId, c.id);
      const ag = c.aggro || 0;
      const score = (100 - trust) * 1.0 + ag * 0.35;
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score);

    // pick among top 3 with some randomness
    return choice(scored.slice(0, 3).map((x) => x.c), this.rng);
  }

  pickGuardianProtect(guardianId) {
    const g = this.getChar(guardianId);
    const candidates = this.aliveChars().filter((c) => c.id !== guardianId);
    if (!candidates.length) return null;

    // protect most trusted/liked (guardian cannot protect self)
    const scored = candidates.map((c) => {
      const t = relGet(this.relation, "trust", guardianId, c.id);
      const l = relGet(this.relation, "like", guardianId, c.id);
      const score = t * 0.8 + l * 0.9;
      return { c, score };
    });
    scored.sort((a, b) => b.score - a.score);

    return choice(scored.slice(0, 3).map((x) => x.c), this.rng);
  }

  pickGnosiaVictim(gnosiaChars) {
    // "랜덤 피해자" 금지 → 성격/관계 기반 우선순위로 습격
    // - target cannot be gnosia (and gnosia can't kill gnosia)
    // - AC is human but gnosia may still attack; bug immune but can be attempted (then no death)
    // - pick based on:
    //   dislike + distrust toward victim, victim's aggro (too visible), victim threatening (engineer/doctor claim)
    const alive = this.aliveChars();

    const gnosiaIds = new Set(gnosiaChars.map((c) => c.id));
    const candidates = alive.filter((c) => !gnosiaIds.has(c.id));
    if (!candidates.length) return null;

    // gnosia group chooses collectively: average their hostility
    const scored = candidates.map((v) => {
      let hostility = 0;

      for (const g of gnosiaChars) {
        const t = relGet(this.relation, "trust", g.id, v.id);
        const l = relGet(this.relation, "like", g.id, v.id);
        hostility += (100 - t) * 0.65 + (100 - l) * 0.55;
      }
      hostility /= gnosiaChars.length;

      // victim aggro attracts attack
      hostility += (v.aggro || 0) * 0.8;

      // if victim seems threatening (claimed engineer/doctor or true engineer/doctor)
      const vRole = this.getRole(v.id);
      if (vRole === ROLE.ENGINEER || vRole === ROLE.DOCTOR) hostility += 18;
      if (v.claimedRole === ROLE.ENGINEER || v.claimedRole === ROLE.DOCTOR) hostility += 12;

      // if victim is cooperation partner of many crew, more threatening
      const coopCount = alive.reduce((acc, c) => acc + (c.cooperation?.has?.(v.id) ? 1 : 0), 0);
      hostility += coopCount * 3;

      // bug is immune, but gnosia may still attempt: reduce attractiveness a bit
      if (vRole === ROLE.BUG) hostility *= 0.85;

      hostility *= 0.8 + this.rng() * 0.6;
      return { v, hostility };
    });

    scored.sort((a, b) => b.hostility - a.hostility);
    // choose among top 2~3
    return choice(scored.slice(0, 3).map((x) => x.v.id), this.rng);
  }

  // ---------------- Victory conditions ----------------
  checkVictoryAndEndIfNeeded() {
    const alive = this.aliveChars();
    const aliveRoles = alive.map((c) => this.getRole(c.id));

    const gnosiaAlive = alive.filter((c) => this.getRole(c.id) === ROLE.GNOSIA).length;
    const crewSideAlive = alive.filter((c) => ROLE_INFO[this.getRole(c.id)]?.side === SIDE.CREW).length;
    const bugAlive = alive.some((c) => this.getRole(c.id) === ROLE.BUG);
    const acAlive = alive.some((c) => this.getRole(c.id) === ROLE.AC);

    // Crew win if all gnosia eliminated
    const crewWin = gnosiaAlive === 0;

    // Gnosia win if gnosia >= crewSideAlive (typical mafia)
    const gnosiaWin = gnosiaAlive > 0 && gnosiaAlive >= crewSideAlive;

    // Bug override: if bug alive and either side would win, bug wins alone
    if (bugAlive && (crewWin || gnosiaWin)) {
      this.endGame("버그 승리 (버그가 끝까지 살아남았다)");
      return true;
    }

    if (crewWin) {
      // AC loses if all gnosia eliminated (even if alive)
      this.endGame("선원 진영 승리 (그노시아 전멸)");
      return true;
    }

    if (gnosiaWin) {
      this.endGame("그노시아 진영 승리");
      return true;
    }

    return false;
  }

  endGame(reason) {
    this.phase = "ENDED";
    this.log(`=== 게임 종료: ${reason} ===`);
    this.log(`--- 최종 역할 공개 ---`);
    for (const c of this.chars) {
      const r = this.getRole(c.id);
      const status = c.alive ? "생존" : "사망";
      this.log(`${c.name} (${status}): ${roleLabel(r)}`);
    }
  }
}

// ---------------- Utilities ----------------
function normalizeEnabledCommands(enabled) {
  // supports Set, Array, or undefined
  if (enabled instanceof Set) return enabled;
  if (Array.isArray(enabled)) return new Set(enabled);
  return new Set();
}
