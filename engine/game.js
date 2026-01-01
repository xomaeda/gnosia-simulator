// engine/game.js
import { COMMAND_DEFS, isChainEligible } from "./commands.js";
import { ROLE, ROLE_INFO, SIDE, assignRoles, normalizeGameConfig } from "./roles.js";

let relationApi = null;
try { relationApi = await import("./relation.js"); } catch (_) { relationApi = null; }

// ---------------- RNG ----------------
function makeRng(seed) {
  if (typeof seed !== "number" || !Number.isFinite(seed)) return { next: () => Math.random() };
  let s = (seed >>> 0) || 123456789;
  return { next: () => ((s = (1664525 * s + 1013904223) >>> 0), s / 0x100000000) };
}
function pickOne(arr, rng) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(rng.next() * arr.length)];
}
const safeName = (c, fb = "?") => c?.name ?? c?.id ?? fb;

// -------------- fallback relation --------------
function makeRelationFallback(chars) {
  const trust = new Map();
  for (const a of chars) {
    const row = new Map();
    for (const b of chars) if (a.id !== b.id) row.set(b.id, 0.5);
    trust.set(a.id, row);
  }
  return {
    getTrust(aId, bId) { return trust.get(aId)?.get(bId) ?? 0.5; },
    addTrust(aId, bId, d) {
      const row = trust.get(aId); if (!row) return;
      const v = row.get(bId) ?? 0.5;
      row.set(bId, Math.max(0, Math.min(1, v + d)));
    },
  };
}

// ---------------- phase ----------------
const PHASE = {
  DAY_TALK: "DAY_TALK",
  DAY_VOTE: "DAY_VOTE",
  NIGHT: "NIGHT",
  MORNING: "MORNING",
  ENDED: "ENDED",
};

export class GameEngine {
  constructor(characters = [], settings = {}, rngOrSeed = null) {
    this.logs = [];
    this.settings = settings || {};
    this.rng = (rngOrSeed && typeof rngOrSeed.next === "function") ? rngOrSeed
      : (typeof rngOrSeed === "number") ? makeRng(rngOrSeed)
      : makeRng(null);

    // clone chars
    this.characters = (characters || []).map((c, idx) => {
      const enabled = c?.enabledCommands;
      const enabledSet =
        enabled instanceof Set ? new Set([...enabled])
        : Array.isArray(enabled) ? new Set(enabled)
        : new Set();

      return {
        id: c?.id ?? String(idx),
        name: c?.name ?? `캐릭터${idx + 1}`,
        gender: c?.gender ?? "범성",
        age: Number.isFinite(Number(c?.age)) ? Number(c?.age) : 0,
        stats: { ...(c?.stats || {}) },
        personality: { ...(c?.personality || {}) },
        enabledCommands: enabledSet,
        role: c?.role ?? null,
        alive: c?.alive !== false,
        locked: !!c?.locked,
      };
    });

    this.roleById = new Map();
    this.relations = null;

    // ✅ 체인 컨텍스트(핵심)
    this.ctx = {
      chain: [],     // [{cmd, actorId, targetId, extra}]
      targetId: null // 최근 “핵심 타겟”(의심/변호/감싸 등에서 생김)
    };

    // ✅ 한 라운드(낮) = 5턴
    this.day = 1;
    this.phase = PHASE.DAY_TALK;
    this.turnInDay = 0;
    this.TURNS_PER_DAY = 5;

    this.logs.push("✅ 게임이 시작되었습니다.");
    this._initEngine();
  }

  aliveChars() { return this.characters.filter((c) => c.alive); }
  getChar(id) { return this.characters.find((c) => c.id === id) || null; }
  getRole(id) { return this.roleById.get(id) ?? this.getChar(id)?.role ?? null; }
  getSide(id) { return ROLE_INFO?.[this.getRole(id)]?.side ?? null; }

  _initEngine() {
    // roles
    try {
      const cfg = normalizeGameConfig(this.settings, this.characters.length);
      this.roleById = assignRoles(this.characters, cfg, this.rng.next);
      for (const c of this.characters) c.role = this.roleById.get(c.id) ?? ROLE.CREW;
      this.logs.push("✅ 역할 배정 완료");
    } catch (e) {
      this.logs.push("⚠️ 역할 배정 실패(전원 선원 처리): " + (e?.message ?? String(e)));
      this.roleById = new Map();
      for (const c of this.characters) { c.role = ROLE.CREW; this.roleById.set(c.id, ROLE.CREW); }
    }

    // relations
    try {
      if (relationApi && typeof relationApi.initRelations === "function") {
        this.relations = relationApi.initRelations(this.characters, this.settings, this.rng);
      } else {
        this.relations = makeRelationFallback(this.characters);
      }
      this.logs.push("✅ 관계도 초기화 완료");
    } catch (e) {
      this.relations = makeRelationFallback(this.characters);
      this.logs.push("⚠️ 관계도 초기화 경고(대체 사용): " + (e?.message ?? String(e)));
    }

    this.logs.push(`\n=== [일 ${this.day}] 낮이 되었습니다. ===`);
  }

  // ---------------- main step ----------------
  step() {
    if (this.phase === PHASE.ENDED) {
      this.logs.push("ℹ️ 게임이 이미 종료되었습니다.");
      return;
    }

    // 승리 조건(간단)
    if (this._checkWin()) return;

    if (this.phase === PHASE.DAY_TALK) return this._stepDayTurn();
    if (this.phase === PHASE.DAY_VOTE) return this._stepVote();
    if (this.phase === PHASE.NIGHT) return this._stepNight();
    if (this.phase === PHASE.MORNING) return this._stepMorning();
  }

  // ---------------- chain-driven day turns ----------------
  _stepDayTurn() {
    const alive = this.aliveChars().filter((c) => !c.locked);
    if (!alive.length) {
      this.logs.push("❌ 활동 가능한 생존자가 없어 종료");
      this.phase = PHASE.ENDED;
      return;
    }

    // 1) 화자 선택
    const speaker = pickOne(alive, this.rng);

    // 2) 타겟 선택(없으면 랜덤)
    const possibleTargets = alive.filter((c) => c.id !== speaker.id);
    const target = possibleTargets.length ? pickOne(possibleTargets, this.rng) : null;

    // 3) 체인 기반 후보 필터링
    const cmd = this._pickChainCommand(speaker, target);

    if (!cmd) {
      // 체인을 끊거나, 그냥 말 안함
      this.logs.push(`🗣️ ${safeName(speaker)}: …`);
      this._resetChain();
    } else {
      // 로그 + 체인 기록
      this.logs.push(`🗣️ ${safeName(speaker)}: [${cmd.id}] 사용`);
      this._pushChain(speaker.id, target?.id ?? null, cmd.id);
      this._lightRelation(speaker.id, target?.id ?? null);
    }

    this.turnInDay += 1;

    // ✅ 라운드당 5턴
    if (this.turnInDay >= this.TURNS_PER_DAY) {
      this.phase = PHASE.DAY_VOTE;
      this.logs.push(`\n=== 낮 종료: 투표 단계로 이동 ===`);
      // 다음날로 넘어가기 전 체인 리셋
      this._resetChain();
    } else {
      // 확률적으로 체인 종료(부속만 계속 이어지는 걸 방지)
      if (this.ctx.chain.length >= 2 && this.rng.next() < 0.35) {
        this._resetChain();
      }
    }
  }

  _pickChainCommand(speaker, target) {
    const enabled = speaker.enabledCommands instanceof Set ? speaker.enabledCommands : new Set();
    const ctx = this.ctx;

    const defsById = new Map(COMMAND_DEFS.map((d) => [d.id, d]));
    const candidates = [];

    for (const id of enabled) {
      const def = defsById.get(id);
      if (!def) continue;

      // ✅ 연쇄 규칙 포함 판정
      if (!isChainEligible(speaker, id, ctx)) continue;

      candidates.push(def);
    }

    if (!candidates.length) {
      // 체인이 너무 빡세서 후보가 없으면:
      // - 체인이 있으면 "끊기" 허용
      // - 체인이 없으면 그냥 null
      return null;
    }

    // 후보 중 랜덤
    return pickOne(candidates, this.rng);
  }

  _pushChain(actorId, targetId, cmdId) {
    // ctx.targetId는 “핵심 타겟”이 생기는 커맨드에서 업데이트하는 게 정교하지만,
    // 지금은 targetId를 그대로 최근 타겟으로 사용(원하면 여기서 커맨드별로 분기 가능)
    this.ctx.chain.push({ cmd: cmdId, actorId, targetId, extra: {} });
    this.ctx.targetId = targetId;
  }

  _resetChain() {
    this.ctx.chain = [];
    this.ctx.targetId = null;
  }

  _lightRelation(aId, bId) {
    if (!this.relations || !aId || !bId) return;
    if (typeof this.relations.addTrust !== "function") return;
    const delta = (this.rng.next() - 0.5) * 0.06; // 약간 더 변화
    this.relations.addTrust(aId, bId, delta);
  }

  // ---------------- vote ----------------
  _stepVote() {
    const voters = this.aliveChars().filter((c) => !c.locked);
    const alive = this.aliveChars();
    if (alive.length <= 1) { this.logs.push("✅ 생존자 1명 이하 → 종료"); this.phase = PHASE.ENDED; return; }

    const votes = new Map();
    for (const v of voters) {
      const targets = alive.filter((t) => t.id !== v.id);
      if (!targets.length) continue;
      const t = this._pickVoteTarget(v, targets);
      votes.set(t.id, (votes.get(t.id) || 0) + 1);
    }

    this.logs.push("🗳️ 투표 결과:");
    for (const [tid, cnt] of [...votes.entries()].sort((a, b) => b[1] - a[1])) {
      this.logs.push(` - ${safeName(this.getChar(tid))}: ${cnt}표`);
    }

    let max = -1, top = [];
    for (const [tid, cnt] of votes.entries()) {
      if (cnt > max) { max = cnt; top = [tid]; }
      else if (cnt === max) top.push(tid);
    }
    const chosenId = top.length ? pickOne(top, this.rng) : null;
    const chosen = chosenId ? this.getChar(chosenId) : null;

    if (chosen?.alive) {
      chosen.alive = false;
      this.logs.push(`🧊 ${safeName(chosen)} 님이 콜드슬립 되었습니다.`);
    } else {
      this.logs.push("🧊 콜드슬립 대상이 확정되지 않았다.");
    }

    this.phase = PHASE.NIGHT;
    this.logs.push(`\n=== [일 ${this.day}] 밤이 되었습니다. ===`);
  }

  _pickVoteTarget(voter, targets) {
    if (this.relations && typeof this.relations.getTrust === "function") {
      let best = null, bestScore = Infinity;
      for (const t of targets) {
        const tr = this.relations.getTrust(voter.id, t.id);
        if (tr < bestScore) { bestScore = tr; best = t; }
      }
      if (best && this.rng.next() < 0.15) return pickOne(targets, this.rng);
      return best || pickOne(targets, this.rng);
    }
    return pickOne(targets, this.rng);
  }

  // ---------------- night ----------------
  _stepNight() {
    const alive = this.aliveChars();
    const gnosia = alive.filter((c) => this.getRole(c.id) === ROLE.GNOSIA);
    if (!gnosia.length) {
      this.logs.push("🌙 밤이 조용히 지나갔습니다.");
      this.phase = PHASE.MORNING;
      return;
    }

    const victims = alive.filter((c) => this.getSide(c.id) !== SIDE.GNOSIA);
    const victim = pickOne(victims, this.rng);
    if (!victim) { this.logs.push("🌙 공격할 대상이 없습니다."); this.phase = PHASE.MORNING; return; }

    victim.alive = false;
    this.logs.push("💀 밤중에 누군가가 습격당했습니다…");
    this._nightDiedId = victim.id;

    this.phase = PHASE.MORNING;
  }

  _stepMorning() {
    if (this._nightDiedId) {
      this.logs.push(`☀️ 아침이 되었습니다. ${safeName(this.getChar(this._nightDiedId))} 님이 소멸했습니다.`);
      this._nightDiedId = null;
    } else {
      this.logs.push("☀️ 아침이 되었습니다. 소멸한 인물은 없습니다.");
    }

    this.day += 1;
    this.turnInDay = 0;
    this.phase = PHASE.DAY_TALK;
    this._resetChain();
    this.logs.push(`\n=== [일 ${this.day}] 낮이 되었습니다. ===`);
  }

  // ---------------- win ----------------
  _checkWin() {
    const alive = this.aliveChars();
    const g = alive.filter((c) => this.getRole(c.id) === ROLE.GNOSIA).length;
    const others = alive.length - g;

    if (g === 0) {
      this.logs.push("\n🏁 그노시아가 전멸했습니다. (선원 진영 승리)");
      this.phase = PHASE.ENDED;
      return true;
    }
    if (g >= others) {
      this.logs.push("\n🏁 그노시아가 과반을 장악했습니다. (그노시아 진영 승리)");
      this.phase = PHASE.ENDED;
      return true;
    }
    return false;
  }
}
