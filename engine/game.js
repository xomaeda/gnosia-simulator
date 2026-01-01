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
  isHumanDetectedRole,
  roleLabel,
} from "./roles.js";

import {
  COMMAND,
  COMMAND_META,
  getAllCommandIds,
} from "./commands.js";

// ---------------- Random helpers ----------------
function rand(rng) {
  return typeof rng === "function" ? rng() : Math.random();
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function pickOne(arr, rng) {
  if (!arr.length) return null;
  return arr[Math.floor(rand(rng) * arr.length)];
}
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(rng) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- Engine ----------------
export class GameEngine {
  constructor(chars, config, rng) {
    // deep-ish copy
    this.chars = chars.map((c, idx) => ({
      ...c,
      id: c.id ?? `C${idx + 1}`,
      alive: c.alive ?? true,
      locked: false, // "반드시 적이다" 등으로 활동 불가
      aggro: 0,
      cooperation: new Set(c.cooperation ?? []),
      enabledCommands: new Set(c.enabledCommands ?? []),
    }));

    this.rng = rng;
    this.config = normalizeGameConfig(config, this.chars.length);

    this.roleById = assignRoles(this.chars, this.config, this.rng);

    // public: user can see roles at start (per your change)
    this.publicRolesVisible = true;

    // day/night state
    this.day = 1;
    this.phase = "DAY"; // DAY, NIGHT_FREE, NIGHT_RESOLVE, END
    this.dayTurnIndex = 0; // 0..4
    this.nightStep = 0; // 0 or 1 in NIGHT
    this.ended = false;
    this.winner = null;

    // relationships: trust/like are per (from -> to)
    this.relations = new Map(); // key `${fromId}|${toId}` -> { trust, like }
    this.initRelations();

    // investigation results
    this.engineerClaims = new Map(); // engineerId -> [{ day, targetId, resultRoleLike }]
    this.doctorClaims = new Map(); // doctorId -> [{ day, targetId, resultRoleLike }]
    this.deadToday = []; // ids died during night resolution to print in morning
    this.detectedLies = []; // [{observerId, liarId, day, phase}]
    this.logLines = [];
    this.log(`=== 게임 시작 ===`);
    this.logRolesAtStart();
    this.log(`=== 낮 1일차: (1) 논의 시작 ===`);
  }

  // -------------- Basics --------------
  log(s) {
    this.logLines.push(String(s));
  }
  getLogText() {
    return this.logLines.join("\n");
  }
  getRole(id) {
    return this.roleById.get(id);
  }
  getRoleInfo(id) {
    return ROLE_INFO[this.getRole(id)];
  }
  aliveChars() {
    return this.chars.filter((c) => c.alive);
  }
  getChar(id) {
    return this.chars.find((c) => c.id === id) || null;
  }
  relKey(a, b) {
    return `${a}|${b}`;
  }
  getRel(a, b) {
    return this.relations.get(this.relKey(a, b));
  }
  setRel(a, b, trust, like) {
    this.relations.set(this.relKey(a, b), { trust, like });
  }

  initRelations() {
    // start with neutral values
    for (const a of this.chars) {
      for (const b of this.chars) {
        if (a.id === b.id) continue;
        this.setRel(a.id, b.id, 0, 0);
      }
    }
  }

  logRolesAtStart() {
    this.log(`(시작 시 역할이 공개됩니다)`);
    for (const c of this.chars) {
      const r = this.getRole(c.id);
      this.log(`- ${c.name}: ${roleLabel(r)}`);
    }
  }

  // ---------------- Public data for UI ----------------
  getStateSnapshot() {
    return {
      day: this.day,
      phase: this.phase,
      dayTurnIndex: this.dayTurnIndex,
      nightStep: this.nightStep,
      ended: this.ended,
      winner: this.winner,
      chars: this.chars.map((c) => ({
        id: c.id,
        name: c.name,
        gender: c.gender,
        age: c.age,
        alive: c.alive,
        locked: c.locked,
        aggro: c.aggro,
        stats: c.stats,
        personality: c.personality,
        enabledCommands: [...c.enabledCommands],
      })),
      roles: this.publicRolesVisible
        ? Object.fromEntries(this.roleById.entries())
        : null,
      relations: this.getRelationsMatrix(),
      logLines: [...this.logLines],
    };
  }

  getRelationsMatrix() {
    // returns { fromId: { toId: {trust, like} } }
    const out = {};
    for (const a of this.chars) {
      out[a.id] = {};
      for (const b of this.chars) {
        if (a.id === b.id) continue;
        out[a.id][b.id] = this.getRel(a.id, b.id);
      }
    }
    return out;
  }

  // ---------------- Engine step ----------------
  step() {
    if (this.ended) return;

    if (this.phase === "DAY") {
      this.stepDay();
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

  // ---------------- DAY ----------------
  stepDay() {
    if (this.ended) return;

    // 1 turn chain
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
    for (const [eid, arr] of this.engineerClaims.entries()) {
      for (const rep of arr.filter((x) => x.day === this.day)) {
        const eName = this.getChar(eid)?.name ?? "?";
        const tName = this.getChar(rep.targetId)?.name ?? "?";
        this.log(`${eName}:[조사결과] ${tName}는 ${rep.result}.`);
      }
    }
    // doctor reports
    for (const [did, arr] of this.doctorClaims.entries()) {
      for (const rep of arr.filter((x) => x.day === this.day)) {
        const dName = this.getChar(did)?.name ?? "?";
        const tName = this.getChar(rep.targetId)?.name ?? "?";
        this.log(`${dName}:[검사결과] ${tName}는 ${rep.result}.`);
      }
    }
  }

  // ---------------- NIGHT (1) Free actions ----------------
  stepNightFree() {
    if (this.ended) return;
    if (this.nightStep !== 0) return;

    // free actions logs (friendship, cooperation proposal, etc.)
    const alive = this.aliveChars().filter((c) => !c.locked);
    const order = shuffle(alive, this.rng);

    for (const a of order) {
      // decide action: solo, hang out, cooperate propose (if enabled for this char)
      const canCoop = a.enabledCommands.has(COMMAND.COOP_NIGHT);
      const p = rand(this.rng);

      if (canCoop && p < 0.25) {
        // propose cooperation to someone
        const targets = alive.filter((x) => x.id !== a.id);
        const t = pickOne(targets, this.rng);
        if (!t) continue;

        // acceptance chance based on like + charm-ish
        const rel = this.getRel(t.id, a.id);
        const acceptScore =
          (rel?.like ?? 0) +
          (t.stats?.charm ?? 0) * 0.5 +
          (t.personality?.social ?? 0) * 10;
        const accepted = rand(this.rng) < clamp(0.2 + acceptScore / 200, 0.05, 0.9);

        if (accepted) {
          a.cooperation.add(t.id);
          t.cooperation.add(a.id);

          // boost like both ways
          this.bumpLike(a.id, t.id, 5);
          this.bumpLike(t.id, a.id, 5);

          this.log(`${a.name}는 ${t.name}에게 협력 요청을 했고, 협력에 성공했다.`);
        } else {
          this.log(`${a.name}는 ${t.name}에게 협력 요청을 했지만, 거절당했다.`);
        }
        continue;
      }

      if (p < 0.6) {
        // hang out with someone
        const targets = alive.filter((x) => x.id !== a.id);
        const t = pickOne(targets, this.rng);
        if (!t) continue;
        this.bumpLike(a.id, t.id, 2);
        this.bumpLike(t.id, a.id, 2);
        this.log(`${a.name}는 ${t.name}와 함께 시간을 보내어 상호 우호도가 조금 올라갔다.`);
      } else {
        // solo
        this.log(`${a.name}는 혼자서 시간을 보냈다.`);
      }
    }

    this.nightStep = 1;
    this.phase = "NIGHT_RESOLVE";
    this.log(`=== 밤 ${this.day}일차: (2) 역할 실행/습격 ===`);
  }

  // ---------------- NIGHT (2) Resolve (roles + attack) ----------------
  stepNightResolve() {
    if (this.ended) return;

    // 1) Engineer investigates (if alive and enabled)
    this.resolveEngineerNight();

    // 2) Guardian protects (if alive and enabled)
    const protectedId = this.resolveGuardianNight();

    // 3) Gnosia attack (preference based, not random)
    const attackResult = this.resolveGnosiaAttack(protectedId);

    // collect deaths (engineer might have killed bug; gnosia might have killed someone)
    const died = [];

    // Engineer bug kill is handled in resolveEngineerNight() by killing bug immediately.
    // We'll gather those who are dead and were alive at night start? We track by deadToday list.
    // deadToday contains ids killed during this night resolution.
    // attackResult: {victimId|null, blocked:boolean, triedBug:boolean}
    if (attackResult && attackResult.victimId) died.push(attackResult.victimId);

    // determine message per your rule
    // If guardian successfully protected OR gnosia tried bug => "아무도 소멸하지 않았습니다"
    // BUT if engineer killed bug AND gnosia killed crew in same night => "A와 B가 소멸했습니다"
    const engineerBugKills = this.deadToday.filter((id) => this.getRole(id) === ROLE.BUG);
    const gnosiaKill = attackResult?.victimId ? [attackResult.victimId] : [];

    const combined = [...new Set([...engineerBugKills, ...gnosiaKill])];

    if (combined.length === 0) {
      // either blocked or triedBug or no valid target
      this.log(`아무도 소멸하지 않았습니다.`);
    } else if (combined.length === 1) {
      const nm = this.getChar(combined[0])?.name ?? "?";
      this.log(`${nm}가 소멸했습니다.`);
    } else {
      const names = combined.map((id) => this.getChar(id)?.name ?? "?").join("와 ");
      this.log(`${names}가 소멸했습니다.`);
    }

    // morning transition
    if (this.checkVictoryAndEndIfNeeded()) return;

    this.day += 1;
    this.phase = "DAY";
    this.dayTurnIndex = 0;
    this.nightStep = 0;
    this.deadToday = [];
    this.log(`=== 낮 ${this.day}일차: (1) 논의 시작 ===`);
    this.flushReportsToLog();
  }

  resolveEngineerNight() {
    const alive = this.aliveChars().filter((c) => !c.locked);
    const engs = alive.filter((c) => this.getRole(c.id) === ROLE.ENGINEER);
    for (const e of engs) {
      // choose target with higher suspicion (low trust, high aggro)
      const targets = alive.filter((t) => t.id !== e.id);
      if (!targets.length) continue;

      const t = this.pickInvestigateTarget(e.id, targets);

      const role = this.getRole(t.id);
      const detectedAsGnosia = isGnosiaDetectedRole(role);
      const resultText = detectedAsGnosia ? "그노시아" : "인간";

      // if bug is investigated => bug dies immediately (even if gnosia killed someone too)
      if (role === ROLE.BUG) {
        // bug dies, regardless of protection
        t.alive = false;
        this.deadToday.push(t.id);
      }

      const arr = this.engineerClaims.get(e.id) ?? [];
      arr.push({ day: this.day, targetId: t.id, result: resultText });
      this.engineerClaims.set(e.id, arr);

      // Lie detection: if engineer is lied to by a fake engineer claim in day, this is separate.
    }
  }

  pickInvestigateTarget(engineerId, targets) {
    // prefer those who have attacked engineer or low trust from engineer
    const scored = targets.map((t) => {
      const rel = this.getRel(engineerId, t.id);
      const trust = rel?.trust ?? 0;
      const score = (t.aggro ?? 0) - trust;
      return { t, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].t;
  }

  resolveGuardianNight() {
    const alive = this.aliveChars().filter((c) => !c.locked);
    const guards = alive.filter((c) => this.getRole(c.id) === ROLE.GUARDIAN);
    if (!guards.length) return null;

    const g = guards[0]; // only one
    // can't protect self
    const targets = alive.filter((t) => t.id !== g.id);
    if (!targets.length) return null;

    // protect highest aggro among crew side
    const crewTargets = targets.filter((t) => this.getRoleInfo(t.id).side === SIDE.CREW);
    const pool = crewTargets.length ? crewTargets : targets;
    pool.sort((a, b) => (b.aggro ?? 0) - (a.aggro ?? 0));
    return pool[0]?.id ?? null;
  }

  resolveGnosiaAttack(protectedId) {
    const alive = this.aliveChars().filter((c) => !c.locked);
    const gnosias = alive.filter((c) => this.getRoleInfo(c.id).side === SIDE.GNOSIA);

    if (!gnosias.length) return { victimId: null, blocked: false, triedBug: false };

    // choose victim: based on dislike, threat, or target who suspects them, also high aggro (noticed)
    const candidates = alive.filter((t) => this.getRoleInfo(t.id).side !== SIDE.GNOSIA);

    if (!candidates.length) return { victimId: null, blocked: false, triedBug: false };

    // compute combined preference from each gnosia
    const scores = candidates.map((t) => {
      let s = 0;
      for (const g of gnosias) {
        const relGT = this.getRel(g.id, t.id);
        const relTG = this.getRel(t.id, g.id);
        const dislike = -(relGT?.like ?? 0);
        const distrust = -(relGT?.trust ?? 0);
        const threatens = -(relTG?.trust ?? 0);
        s += dislike * 1.0 + distrust * 0.8 + threatens * 0.5 + (t.aggro ?? 0) * 0.2;
      }
      // prefer killing engineer/doctor (threat roles)
      const r = this.getRole(t.id);
      if (r === ROLE.ENGINEER) s += 6;
      if (r === ROLE.DOCTOR) s += 4;
      return { t, s };
    });

    scores.sort((a, b) => b.s - a.s);
    const victim = scores[0].t;

    // If victim is BUG, gnosia attack has no effect (immune) and message becomes none.
    if (this.getRole(victim.id) === ROLE.BUG) {
      return { victimId: null, blocked: false, triedBug: true };
    }

    // If protected, no death
    if (protectedId && victim.id === protectedId) {
      return { victimId: null, blocked: true, triedBug: false };
    }

    // kill victim
    victim.alive = false;
    this.deadToday.push(victim.id);
    return { victimId: victim.id, blocked: false, triedBug: false };
  }

  // ---------------- relations adjustments ----------------
  bumpTrust(a, b, delta) {
    const r = this.getRel(a, b);
    if (!r) return;
    r.trust = clamp((r.trust ?? 0) + delta, -100, 100);
  }
  bumpLike(a, b, delta) {
    const r = this.getRel(a, b);
    if (!r) return;
    r.like = clamp((r.like ?? 0) + delta, -100, 100);
  }

  // ---------------- Turn chain generation ----------------
  generateTurnChain() {
    // One "turn" is a chain:
    // starter uses a main command (suspect/cover/request_co/etc.)
    // then others may attach sub-commands (agree, ask_agree, exaggerate, block_rebut, deny, defend, ask_help...)
    // until end condition (no more speakers OR someone uses "stop" type)

    const alive = this.aliveChars().filter((c) => !c.locked);
    const starter = pickOne(alive, this.rng);
    if (!starter) return [];

    const ctx = {
      day: this.day,
      phase: this.phase,
      starterId: starter.id,
      targetId: null,
      mainCmd: null,
      chainLocked: false, // "반론을 막는다" etc
    };

    // choose main command based on personality & enabledCommands
    const main = this.pickMainCommand(starter, alive, ctx);
    ctx.mainCmd = main.cmd;
    ctx.targetId = main.targetId;

    const chain = [{ actorId: starter.id, cmd: main.cmd, targetId: main.targetId, extra: main.extra ?? {} }];

    // apply main effects
    this.applyCommandEffects(chain[0], ctx);

    // allow sub-commands by others (random order)
    let speakers = shuffle(alive.filter((c) => c.id !== starter.id), this.rng);

    // up to N additional events in the chain (avoid infinite)
    for (let i = 0; i < 10; i++) {
      if (!speakers.length) break;

      const actor = speakers.shift();
      if (!actor || !actor.alive || actor.locked) continue;

      const ev = this.pickSubCommand(actor, alive, ctx, chain);
      if (!ev) continue;

      chain.push(ev);
      this.applyCommandEffects(ev, ctx);

      // If ev ends chain
      if (ev.cmd === COMMAND._TURN_END || ev.cmd === COMMAND._CHAT_STOP || ev.cmd === COMMAND._SAY_HUMAN_STOP) {
        break;
      }

      // If "반론을 막는다" applied, block defend unless ask_help succeeds
      // handled in applyCommandEffects and eligibility checks
    }

    // aggro accumulation: speaking adds aggro; stealth reduces
    for (const e of chain) {
      const c = this.getChar(e.actorId);
      if (!c) continue;
      const st = c.stats?.stealth ?? 0;
      const base = 2;
      const gain = clamp(base - st / 25, 0.2, 2);
      c.aggro += gain;
    }

    // lie detection (public log): if any actor lied in chain, observers might notice
    this.processLieDetectionFromChain(chain);

    return chain;
  }

  pickMainCommand(starter, alive, ctx) {
    const cmds = [...starter.enabledCommands].filter((id) => {
      const meta = COMMAND_META[id];
      return meta && meta.phase === "DAY_MAIN";
    });

    // always allow basic suspect/cover
    if (!cmds.includes(COMMAND.SUSPECT)) cmds.push(COMMAND.SUSPECT);
    if (!cmds.includes(COMMAND.COVER)) cmds.push(COMMAND.COVER);

    const chosen = pickOne(cmds, this.rng) ?? COMMAND.SUSPECT;

    // pick target if needed
    let targetId = null;
    if (COMMAND_META[chosen]?.needsTarget) {
      const targets = alive.filter((c) => c.id !== starter.id);
      // prefer by relation (dislike -> suspect, like -> cover)
      if (chosen === COMMAND.SUSPECT) {
        targets.sort((a, b) => (this.getRel(starter.id, a.id)?.like ?? 0) - (this.getRel(starter.id, b.id)?.like ?? 0));
        targetId = targets[0]?.id ?? pickOne(targets, this.rng)?.id;
      } else if (chosen === COMMAND.COVER) {
        targets.sort((a, b) => (this.getRel(starter.id, b.id)?.like ?? 0) - (this.getRel(starter.id, a.id)?.like ?? 0));
        targetId = targets[0]?.id ?? pickOne(targets, this.rng)?.id;
      } else {
        targetId = pickOne(targets, this.rng)?.id;
      }
    }

    let extra = {};

    // REQUEST_CO needs queryRole
    if (chosen === COMMAND.REQUEST_CO) {
      const roles = getCOQueryableRoles();
      extra.queryRole = pickOne(roles, this.rng) ?? ROLE.ENGINEER;
    }

    // SAY_HUMAN triggers chain with responses
    if (chosen === COMMAND.SAY_HUMAN) {
      extra = {};
    }

    return { cmd: chosen, targetId, extra };
  }

  pickSubCommand(actor, alive, ctx, chain) {
    // sub commands depend on context main cmd
    const options = [];

    // Agreement type after suspect/cover/defend/counterattack etc.
    options.push(COMMAND.AGREE_SUSPECT, COMMAND.ASK_AGREE, COMMAND.EXAGGERATE, COMMAND.BLOCK_REBUT);
    options.push(COMMAND.AGREE_COVER, COMMAND.EXAGGERATE, COMMAND.ASK_AGREE);
    options.push(COMMAND.DEFEND, COMMAND.AGREE_DEFEND);
    options.push(COMMAND.COUNTERATTACK, COMMAND.AGREE_COUNTER);

    // If actor is target and being attacked -> deny / evade / ask help / sad / dont_trust
    if (ctx.targetId && actor.id === ctx.targetId) {
      options.push(COMMAND.DENY, COMMAND.EVADE, COMMAND.COUNTERATTACK, COMMAND.ASK_HELP, COMMAND.SAD, COMMAND.DONT_TRUST);
    }

    // If SAY_HUMAN main cmd -> respond: say human / skip / stop
    if (ctx.mainCmd === COMMAND.SAY_HUMAN) {
      const p = rand(this.rng);
      if (p < 0.65) return { actorId: actor.id, cmd: COMMAND._SAY_HUMAN, targetId: null, extra: {} };
      if (p < 0.85) return { actorId: actor.id, cmd: COMMAND._SAY_HUMAN_SKIP, targetId: null, extra: {} };
      return { actorId: actor.id, cmd: COMMAND._SAY_HUMAN_STOP, targetId: null, extra: {} };
    }

    // CHAT main cmd -> others can join or stop
    if (ctx.mainCmd === COMMAND.CHAT) {
      const p = rand(this.rng);
      if (p < 0.75) return { actorId: actor.id, cmd: COMMAND._CHAT_JOIN, targetId: ctx.starterId, extra: {} };
      return { actorId: actor.id, cmd: COMMAND._CHAT_STOP, targetId: ctx.starterId, extra: {} };
    }

    // If "반론을 막는다" active, block defend-ish unless ASK_HELP succeeded
    if (ctx.chainLocked && !ctx.helpBreak) {
      // can't defend/cover/deny for the attacked target
      // still can agree with attacker
      // So remove DEFEND and AGREE_COVER etc
      // We'll just avoid choosing commands that would "defend" the target.
    }

    // filter to commands actor can use in this context
    const feasible = options.filter((cmd) => this.isCommandFeasible(actor, cmd, ctx, chain));
    const uniq = [...new Set(feasible)].filter(Boolean);
    const cmd = pickOne(uniq, this.rng);

    if (!cmd) return null;

    // Build event
    let targetId = null;
    if (COMMAND_META[cmd]?.needsTarget) {
      // for agree commands, target is starter (whose statement is being agreed)
      targetId = ctx.starterId;
      if (cmd === COMMAND.DEFEND || cmd === COMMAND.AGREE_DEFEND || cmd === COMMAND.THANKS) {
        targetId = ctx.targetId;
      }
      if (cmd === COMMAND.ASK_HELP) {
        // choose helper: prefer cooperation or high like
        const pool = alive.filter((x) => x.id !== actor.id && x.alive && !x.locked);
        pool.sort((a, b) => (this.getRel(actor.id, b.id)?.like ?? 0) - (this.getRel(actor.id, a.id)?.like ?? 0));
        targetId = pool[0]?.id ?? pickOne(pool, this.rng)?.id;
      }
    }

    const ev = { actorId: actor.id, cmd, targetId, extra: {} };

    // special: CO_ROLE / CO_SELF_TOO in response to REQUEST_CO chain, etc.
    // (simplified) — actual CO chain logic is in main cmd REQUEST_CO in your plan.
    return ev;
  }

  isCommandFeasible(actor, cmd, ctx, chain) {
    // must be enabled for actor except some internal response cmds
    const isInternal = String(cmd).startsWith("_") || cmd === COMMAND._TURN_END;
    if (!isInternal && !actor.enabledCommands.has(cmd)) return false;

    // status thresholds
    const meta = COMMAND_META[cmd];
    if (meta?.needsStat) {
      const v = actor.stats?.[meta.needsStat.key] ?? 0;
      if (v < meta.needsStat.min) return false;
    }

    // context rules
    if (meta?.requiresMain && meta.requiresMain !== ctx.mainCmd) return false;

    // "반론을 막는다": only after suspect/cover and not after rebut
    if (cmd === COMMAND.BLOCK_REBUT) {
      if (!(ctx.mainCmd === COMMAND.SUSPECT || ctx.mainCmd === COMMAND.COVER)) return false;
      // if someone already rebutted in chain, block rebut is not allowed
      if (chain.some((e) => e.cmd === COMMAND.REBUT)) return false;
    }

    // if chainLocked, block defend unless helpBreak
    if (ctx.chainLocked && !ctx.helpBreak) {
      if ([COMMAND.DEFEND, COMMAND.AGREE_DEFEND, COMMAND.COVER, COMMAND.DENY].includes(cmd)) return false;
    }

    // one-turn 1x for some commands - handled by meta?.oncePerTurn
    if (meta?.oncePerTurn) {
      if (chain.some((e) => e.actorId === actor.id && e.cmd === cmd)) return false;
    }

    return true;
  }

  applyCommandEffects(ev, ctx) {
    const actor = this.getChar(ev.actorId);
    const target = ev.targetId ? this.getChar(ev.targetId) : null;
    if (!actor) return;

    const meta = COMMAND_META[ev.cmd];

    // increase/decrease relations & aggro based on command
    switch (ev.cmd) {
      case COMMAND.SUSPECT: {
        if (!target) break;
        // decrease trust/like to target from others depending on charisma/logic/acting
        const powTrust = (actor.stats?.logic ?? 0) / 10;
        const powLike = (actor.stats?.acting ?? 0) / 10;
        this.bumpTrust(target.id, actor.id, -powTrust); // target trusts actor less
        this.bumpLike(target.id, actor.id, -powLike);
        // spread influence: some others follow
        ctx.targetId = target.id;
        break;
      }
      case COMMAND.COVER: {
        if (!target) break;
        const powTrust = (actor.stats?.logic ?? 0) / 10;
        const powLike = (actor.stats?.acting ?? 0) / 10;
        this.bumpTrust(target.id, actor.id, +powTrust);
        this.bumpLike(target.id, actor.id, +powLike);
        ctx.targetId = target.id;
        break;
      }
      case COMMAND.AGREE_SUSPECT:
      case COMMAND.AGREE_COVER:
      case COMMAND.AGREE_DEFEND:
      case COMMAND.AGREE_COUNTER: {
        // small influence
        if (ctx.targetId) {
          const t = this.getChar(ctx.targetId);
          if (t) {
            const powTrust = (actor.stats?.logic ?? 0) / 20;
            const powLike = (actor.stats?.acting ?? 0) / 20;
            // agree suspect => harm target
            if (ev.cmd === COMMAND.AGREE_SUSPECT || ev.cmd === COMMAND.AGREE_COUNTER) {
              this.bumpTrust(t.id, actor.id, -powTrust);
              this.bumpLike(t.id, actor.id, -powLike);
            } else {
              // agree cover/defend => help target
              this.bumpTrust(t.id, actor.id, +powTrust);
              this.bumpLike(t.id, actor.id, +powLike);
            }
          }
        }
        break;
      }
      case COMMAND.BLOCK_REBUT: {
        ctx.chainLocked = true;
        break;
      }
      case COMMAND.ASK_HELP: {
        // attempt to break block
        // success chance based on acting+charisma and helper's like
        if (!target) break;
        const helper = target;
        const rel = this.getRel(helper.id, actor.id);
        const like = rel?.like ?? 0;
        const score = (actor.stats?.acting ?? 0) + (actor.stats?.charisma ?? 0) + like / 5;
        const ok = rand(this.rng) < clamp(0.2 + score / 200, 0.05, 0.9);
        ev.extra.accepted = ok;
        if (ok) ctx.helpBreak = true;
        break;
      }
      case COMMAND.THANKS: {
        if (!target) break;
        // reduce actor aggro and increase like
        const ch = (actor.stats?.charm ?? 0);
        actor.aggro -= clamp(ch / 10, 0, 6);
        this.bumpLike(actor.id, target.id, +2);
        break;
      }
      case COMMAND.CHAT: {
        // starter lowers aggro a bit
        actor.aggro -= clamp((actor.stats?.stealth ?? 0) / 8, 0, 5);
        break;
      }
      default:
        break;
    }

    // some commands end chain instantly
    if (ev.cmd === COMMAND.EVADE) {
      // ends the discussion chain
      ev.cmd = COMMAND._TURN_END;
    }
  }

  processLieDetectionFromChain(chain) {
    // If liar side canLie and event contains a "claim" that contradicts truth, observers may notice
    // Here simplified: when someone uses CO_ROLE / CO_SELF_TOO / request_co etc. we mark as "lie" if claim role != real and actor cannot lie then impossible.
    // For now, detect lies on CO_ROLE only.
    for (const e of chain) {
      if (e.cmd !== COMMAND.CO_ROLE && e.cmd !== COMMAND.CO_SELF_TOO) continue;
      const actorRole = this.getRole(e.actorId);
      const info = ROLE_INFO[actorRole];
      const claim = e.extra?.claimRole;
      if (!claim) continue;

      const isLie = claim !== actorRole;
      if (!isLie) continue;
      if (!info?.canLie) continue;

      // observers: all alive may notice based on intuition vs actor acting
      const liar = this.getChar(e.actorId);
      if (!liar) continue;
      const liarAct = liar.stats?.acting ?? 0;

      for (const ob of this.aliveChars()) {
        if (ob.id === liar.id) continue;
        const intu = ob.stats?.intuition ?? 0;
        const chance = clamp(0.05 + (intu - liarAct) / 200, 0.01, 0.6);
        if (rand(this.rng) < chance) {
          this.log(`${ob.name}가 ${liar.name}의 거짓말을 눈치챘다.`);
        }
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
        line(first.actorId, first.cmd, `${tName}는 수상해.`);
        break;
      case COMMAND.COVER:
        line(first.actorId, first.cmd, `${tName}는 믿을 수 있어.`);
        break;
      case COMMAND.CHAT:
        line(first.actorId, first.cmd, `잡담하자.`);
        break;
      case COMMAND.SAY_HUMAN:
        line(first.actorId, first.cmd, `모두 "나는 인간"이라고 말해.`);
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
      case COMMAND.ALL_EXILE_ROLE: {
        const r = first.extra?.targetRole ?? ROLE.ENGINEER;
        line(first.actorId, first.cmd, `${roleLabel(r)}는 전원 배제하자.`);
        break;
      }
      default:
        line(first.actorId, first.cmd, `...`);
        break;
    }

    // follow-ups
    for (let i = 1; i < chain.length; i++) {
      const e = chain[i];
      const nm = this.getChar(e.actorId)?.name ?? "?";
      const cmd = e.cmd;

      // internal events
      if (cmd === COMMAND._TURN_END) {
        this.log(`${nm}:(얼버무리고 논의를 종료했다.)`);
        continue;
      }
      if (cmd === COMMAND._CHAT_JOIN) {
        const starterName = this.getChar(e.targetId)?.name ?? "?";
        this.log(`${nm}:(잡담에 참여했다: ${starterName})`);
        continue;
      }
      if (cmd === COMMAND._CHAT_STOP) {
        this.log(`${nm}:(잡담을 중단시켰다.)`);
        continue;
      }
      if (cmd === COMMAND._SAY_HUMAN) {
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

      // ✅ FIX: 문법 오류였던 구간을 배열 includes 로 교체
      // agree commands
      if ([COMMAND.AGREE_SUSPECT, COMMAND.AGREE_COVER, COMMAND.AGREE_DEFEND, COMMAND.AGREE_COUNTER].includes(cmd)) {
        const speakerName = this.getChar(chain?.[0]?.actorId)?.name ?? "?";
        this.log(`${nm}:[${cmd}] ${speakerName}의 말에 동의해.`);
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
        const ok = e.extra?.accepted;
        this.log(`${nm}:[도움을 요청한다] ${helperName}… 도와줘! (${ok ? "성공" : "실패"})`);
        continue;
      }

      if (cmd === COMMAND.DEFEND) {
        const targetName = this.getChar(e.targetId)?.name ?? "?";
        this.log(`${nm}:[변호한다] ${targetName}는 믿을 수 있어.`);
        continue;
      }

      if (cmd === COMMAND.DENY) {
        this.log(`${nm}:[부정한다] 아니야! 난 아니야!`);
        continue;
      }

      if (cmd === COMMAND.EVADE) {
        this.log(`${nm}:[얼버무린다] ...`);
        continue;
      }

      if (cmd === COMMAND.SAD) {
        this.log(`${nm}:[슬퍼한다] ...`);
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

      // fallback
      this.log(`${nm}:[${cmd}] ...`);
    }
  }

  // (kept as method - but not required anymore for agree logs)
  ctxTargetFromChain(chain) {
    return chain?.[0]?.actorId ?? null;
  }

  // ---------------- Vote / Cold sleep ----------------
  resolveVoteAndColdSleep() {
    this.log(`=== 낮 ${this.day}일차 종료: 투표 시작 ===`);

    const alive = this.aliveChars().filter((c) => !c.locked);

    // each voter chooses target with lowest trust (and higher aggro)
    const votes = new Map(); // targetId -> count
    const voters = this.aliveChars();
    for (const v of voters) {
      if (!v.alive) continue;
      if (v.locked) continue;

      const targets = alive.filter((t) => t.id !== v.id);
      if (!targets.length) continue;

      targets.sort((a, b) => {
        const ta = this.getRel(v.id, a.id)?.trust ?? 0;
        const tb = this.getRel(v.id, b.id)?.trust ?? 0;
        // lower trust first; if tie, higher aggro first
        if (ta !== tb) return ta - tb;
        return (b.aggro ?? 0) - (a.aggro ?? 0);
      });

      const pick = targets[0];
      votes.set(pick.id, (votes.get(pick.id) ?? 0) + 1);
    }

    // find max
    let max = -1;
    let top = [];
    for (const [id, cnt] of votes.entries()) {
      if (cnt > max) {
        max = cnt;
        top = [id];
      } else if (cnt === max) top.push(id);
    }

    const chosenId = pickOne(top, this.rng);
    const victim = this.getChar(chosenId);

    if (!victim) {
      this.log(`(투표 결과 없음)`);
      this.dayTurnIndex = 0;
      return;
    }

    // "도게자한다" chance if enabled and eligible (simplified)
    let avoided = false;
    if (victim.enabledCommands.has(COMMAND.DOGEZA)) {
      const st = victim.stats?.stealth ?? 0;
      if (st >= 35) {
        const act = victim.stats?.acting ?? 0;
        const chance = clamp(0.08 + act / 300, 0.05, 0.25);
        avoided = rand(this.rng) < chance;
        this.log(`${victim.name}:[도게자한다] ${avoided ? "콜드슬립을 피했다!" : "실패했다..."}`);
      }
    }

    if (!avoided) {
      victim.alive = false;
      this.log(`${victim.name}가 콜드슬립 되었다.`);
      // doctor will see this in next day report; add to doctorClaims later in resolveDoctor (omitted here for brevity)
    }

    this.dayTurnIndex = 0;
  }

  // ---------------- Victory ----------------
  checkVictoryAndEndIfNeeded() {
    const alive = this.aliveChars();
    const aliveSides = alive.map((c) => this.getRoleInfo(c.id).side);

    const gnosiaAlive = alive.filter((c) => this.getRoleInfo(c.id).side === SIDE.GNOSIA).length;
    const crewAlive = alive.filter((c) => this.getRoleInfo(c.id).side === SIDE.CREW).length;
    const bugAlive = alive.filter((c) => this.getRoleInfo(c.id).side === SIDE.BUG).length;

    // If BUG alive at end condition, bug wins (override) — per your rule: only if game ends and bug survived.
    // Game end condition: either crew wins (gnosia=0) or gnosia wins (gnosia>=crew)
    const crewWin = gnosiaAlive === 0 && crewAlive > 0;
    const gnosiaWin = gnosiaAlive >= crewAlive && gnosiaAlive > 0;

    if (crewWin || gnosiaWin) {
      if (bugAlive > 0) {
        this.endGame("BUG");
        return true;
      }
      if (crewWin) this.endGame("CREW");
      else this.endGame("GNOSIA");
      return true;
    }

    return false;
  }

  endGame(winner) {
    this.ended = true;
    this.phase = "END";
    this.winner = winner;

    this.log(`=== 게임 종료 ===`);
    if (winner === "CREW") this.log(`인간(선원) 진영의 승리!`);
    if (winner === "GNOSIA") this.log(`그노시아 진영의 승리!`);
    if (winner === "BUG") this.log(`버그의 승리! (마지막까지 살아남아 승리를 뒤엎었다)`);

    // reveal roles at end (still keep)
    this.log(`(최종 역할 공개)`);
    for (const c of this.chars) {
      const r = this.getRole(c.id);
      this.log(`- ${c.name}: ${roleLabel(r)} ${c.alive ? "(생존)" : "(사망)"}`);
    }
  }
}
