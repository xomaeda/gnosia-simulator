// engine/game.js
// ============================================================================
// Real-ish Gnosia simulator engine (step-based)
// - Works with your commands.js / roles.js exports
// - Avoids /engine/engine/... path issues by using relative paths from engine/
// ============================================================================

import { COMMAND_DEFS, isCommandEligibleBasic } from "./commands.js";
import { ROLE, ROLE_INFO, SIDE, assignRoles, normalizeGameConfig } from "./roles.js";

// relation.js는 선택(없어도 동작). 있으면 initRelations/getRelationsText를 사용.
let relationApi = null;
try {
  relationApi = await import("./relation.js");
} catch (_) {
  relationApi = null;
}

// -------------------------------
// RNG
// -------------------------------
function makeRng(seed) {
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    return { next: () => Math.random() };
  }
  let s = (seed >>> 0) || 123456789;
  return {
    next: () => {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 0x100000000;
    },
  };
}
function randInt(rng, n) {
  return Math.floor(rng.next() * n);
}
function pickOne(arr, rng) {
  if (!arr || arr.length === 0) return null;
  return arr[randInt(rng, arr.length)];
}
function safeName(c, fallback = "?") {
  return c?.name ?? c?.id ?? fallback;
}

// -------------------------------
// Minimal relation matrix (fallback when relation.js missing)
// trust[aId][bId] in [0..1]
// -------------------------------
function makeRelationFallback(chars) {
  const trust = new Map(); // id -> Map<id, number>
  for (const a of chars) {
    const row = new Map();
    for (const b of chars) {
      if (a.id === b.id) continue;
      row.set(b.id, 0.5);
    }
    trust.set(a.id, row);
  }
  return {
    trust,
    getTrust(aId, bId) {
      return trust.get(aId)?.get(bId) ?? 0.5;
    },
    addTrust(aId, bId, delta) {
      const row = trust.get(aId);
      if (!row) return;
      const v = row.get(bId) ?? 0.5;
      const nv = Math.max(0, Math.min(1, v + delta));
      row.set(bId, nv);
    },
  };
}

// -------------------------------
// Phase machine
// -------------------------------
const PHASE = {
  INIT: "INIT",
  DAY_TALK: "DAY_TALK",
  DAY_VOTE: "DAY_VOTE",
  NIGHT: "NIGHT",
  MORNING: "MORNING",
  ENDED: "ENDED",
};

export class GameEngine {
  constructor(characters = [], settings = {}, rngOrSeed = null) {
    // logs
    this.logs = [];

    // rng
    if (rngOrSeed && typeof rngOrSeed.next === "function") this.rng = rngOrSeed;
    else if (typeof rngOrSeed === "number") this.rng = makeRng(rngOrSeed);
    else this.rng = makeRng(null);

    // settings normalization (uses roles.js helper)
    this.settings = settings || {};

    // clone chars + normalize enabledCommands(Set)
    this.characters = (characters || []).map((c, idx) => {
      const enabled = c?.enabledCommands;
      const enabledSet =
        enabled instanceof Set
          ? new Set([...enabled])
          : Array.isArray(enabled)
            ? new Set(enabled)
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
        locked: !!c?.locked, // 필요하면
      };
    });

    // internal state
    this.phase = PHASE.INIT;
    this.ended = false;

    this.day = 1;
    this.talkStepInDay = 0;
    this.talkStepsPerDay = 0;

    // role map
    this.roleById = new Map();

    // night memory
    this._lastNight = {
      guardedId: null,
      attackedId: null,
      diedId: null,
    };

    // relations
    this.relations = null;

    // start
    this.logs.push("✅ 게임이 시작되었습니다.");
    this._initEngine();
  }

  // -------------------------------
  // Public helpers
  // -------------------------------
  aliveChars() {
    return this.characters.filter((c) => c.alive);
  }
  getChar(id) {
    return this.characters.find((c) => c.id === id) || null;
  }
  getRole(id) {
    return this.roleById.get(id) ?? this.getChar(id)?.role ?? null;
  }
  getSide(id) {
    const r = this.getRole(id);
    return ROLE_INFO?.[r]?.side ?? null;
  }

  // main.js가 있으면 쓰는 용도
  getPublicRoleLines() {
    // 기본은 공개 정보 없음(원하면 여기에 “CO 현황” 같은 걸 넣을 수 있음)
    return [];
  }
  getRelationsText() {
    try {
      if (relationApi && typeof relationApi.getRelationsText === "function") {
        return relationApi.getRelationsText(this) || "";
      }
    } catch {}
    return "관계도 준비 중…";
  }

  // -------------------------------
  // init
  // -------------------------------
  _initEngine() {
    // 1) 역할 배정
    try {
      const n = this.characters.length;
      const cfg = normalizeGameConfig(this.settings, n);
      // roles.js의 assignRoles는 Map<charId, roleId> 반환
      this.roleById = assignRoles(this.characters, cfg, this.rng.next);
      for (const c of this.characters) {
        c.role = this.roleById.get(c.id) ?? c.role ?? ROLE.CREW;
      }
      this.logs.push("✅ 역할 배정 완료");
    } catch (e) {
      this.logs.push("❌ 역할 배정 실패: " + (e?.message ?? String(e)));
      // 그래도 진행은 가능하게(전부 선원)
      this.roleById = new Map();
      for (const c of this.characters) {
        c.role = ROLE.CREW;
        this.roleById.set(c.id, ROLE.CREW);
      }
    }

    // 2) 관계도 초기화
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

    // 3) 첫날 세팅
    this._startDay();
  }

  _startDay() {
    this.phase = PHASE.DAY_TALK;
    this.talkStepInDay = 0;

    // “대화 스텝 수”는 생존자 수 기반으로(원하면 조정)
    const alive = this.aliveChars().length;
    this.talkStepsPerDay = Math.max(3, Math.min(12, alive)); // 최소 3 ~ 최대 12

    this.logs.push(`\n=== [일 ${this.day}] 낮이 되었습니다. ===`);
    this._checkWinAndEndIfNeeded();
  }

  // -------------------------------
  // Main step (1 button = 1 phase step)
  // -------------------------------
  step() {
    if (this.ended || this.phase === PHASE.ENDED) {
      this.logs.push("ℹ️ 게임이 이미 종료되었습니다.");
      return;
    }

    // 매 step 시작마다 “승리 조건” 체크
    if (this._checkWinAndEndIfNeeded()) return;

    switch (this.phase) {
      case PHASE.DAY_TALK:
        this._stepDayTalk();
        break;
      case PHASE.DAY_VOTE:
        this._stepDayVote();
        break;
      case PHASE.NIGHT:
        this._stepNight();
        break;
      case PHASE.MORNING:
        this._stepMorning();
        break;
      default:
        // 안전장치
        this.phase = PHASE.DAY_TALK;
        this._stepDayTalk();
        break;
    }
  }

  // -------------------------------
  // Day talk
  // -------------------------------
  _stepDayTalk() {
    const alive = this.aliveChars().filter((c) => !c.locked);
    if (alive.length === 0) {
      this.logs.push("❌ 활동 가능한 생존자가 없어 게임 종료");
      this.ended = true;
      this.phase = PHASE.ENDED;
      return;
    }

    // 1 발언 = 1 step
    const speaker = pickOne(alive, this.rng);
    const cmd = this._pickEligibleCommandForSpeaker(speaker);

    if (!cmd) {
      this.logs.push(`🗣️ ${safeName(speaker)}: …(말을 아낀다)`);
    } else {
      this.logs.push(`🗣️ ${safeName(speaker)}: [${cmd.label ?? cmd.id}] 사용`);
      this._applyLightRelationEffect(speaker, cmd.id);
    }

    this.talkStepInDay += 1;
    if (this.talkStepInDay >= this.talkStepsPerDay) {
      this.phase = PHASE.DAY_VOTE;
      this.logs.push(`\n=== 낮 종료: 투표 단계로 이동 ===`);
    }
  }

  _pickEligibleCommandForSpeaker(speaker) {
    const enabled = speaker.enabledCommands instanceof Set ? speaker.enabledCommands : new Set();
    const candidates = [];

    for (const id of enabled) {
      if (!id) continue;

      // 커맨드 정의 찾기
      const def = COMMAND_DEFS.find((d) => d?.id === id);
      if (!def) continue;

      // 스탯 + 체크 기반 “기본 사용 가능” 판정
      if (!isCommandEligibleBasic(speaker, id, null)) continue;

      candidates.push(def);
    }

    if (candidates.length === 0) return null;
    return pickOne(candidates, this.rng);
  }

  // 아주 약하게 관계 변화(없어도 게임은 굴러감)
  _applyLightRelationEffect(speaker, cmdId) {
    if (!this.relations) return;
    const alive = this.aliveChars().filter((c) => c.id !== speaker.id);
    if (alive.length === 0) return;

    const target = pickOne(alive, this.rng);
    // 랜덤 변화(약)
    const delta = (this.rng.next() - 0.5) * 0.04; // -0.02 ~ +0.02
    if (typeof this.relations.addTrust === "function") {
      this.relations.addTrust(speaker.id, target.id, delta);
    }
  }

  // -------------------------------
  // Vote / cold sleep
  // -------------------------------
  _stepDayVote() {
    const voters = this.aliveChars().filter((c) => !c.locked);
    const alive = this.aliveChars();

    if (alive.length <= 1) {
      this.logs.push("✅ 생존자 1명 이하 → 게임 종료");
      this.ended = true;
      this.phase = PHASE.ENDED;
      return;
    }

    // votes: targetId -> count
    const votes = new Map();

    for (const v of voters) {
      const targets = alive.filter((t) => t.id !== v.id);
      if (targets.length === 0) continue;

      const target = this._pickVoteTarget(v, targets);
      if (!target) continue;

      votes.set(target.id, (votes.get(target.id) || 0) + 1);
    }

    if (votes.size === 0) {
      this.logs.push("🗳️ 투표가 성립하지 않았다.");
      this.phase = PHASE.NIGHT;
      this.logs.push(`\n=== [일 ${this.day}] 밤이 되었습니다. ===`);
      return;
    }

    // highest vote
    let max = -1;
    let top = [];
    for (const [tid, cnt] of votes.entries()) {
      if (cnt > max) {
        max = cnt;
        top = [tid];
      } else if (cnt === max) {
        top.push(tid);
      }
    }

    const chosenId = top.length === 1 ? top[0] : pickOne(top, this.rng);
    const chosen = this.getChar(chosenId);

    // log vote summary (짧게)
    this.logs.push("🗳️ 투표 결과:");
    for (const [tid, cnt] of [...votes.entries()].sort((a, b) => b[1] - a[1])) {
      this.logs.push(` - ${safeName(this.getChar(tid))}: ${cnt}표`);
    }

    if (chosen && chosen.alive) {
      chosen.alive = false;
      this.logs.push(`🧊 ${safeName(chosen)} 님이 냉동수면(퇴출) 되었습니다.`);
    } else {
      this.logs.push("🧊 퇴출 대상이 확정되지 않았다.");
    }

    // next: night
    this.phase = PHASE.NIGHT;
    this.logs.push(`\n=== [일 ${this.day}] 밤이 되었습니다. ===`);
    this._checkWinAndEndIfNeeded();
  }

  _pickVoteTarget(voter, targets) {
    // 기본: 신뢰도가 가장 낮은 대상
    if (this.relations && typeof this.relations.getTrust === "function") {
      let best = null;
      let bestScore = Infinity;
      for (const t of targets) {
        const tr = this.relations.getTrust(voter.id, t.id);
        if (tr < bestScore) {
          bestScore = tr;
          best = t;
        }
      }
      // 약간 랜덤 흔들림
      if (best && this.rng.next() < 0.15) return pickOne(targets, this.rng);
      return best || pickOne(targets, this.rng);
    }
    return pickOne(targets, this.rng);
  }

  // -------------------------------
  // Night: guardian protect + gnosia attack
  // -------------------------------
  _stepNight() {
    // reset last night
    this._lastNight = { guardedId: null, attackedId: null, diedId: null };

    const alive = this.aliveChars();
    if (alive.length <= 1) {
      this.logs.push("✅ 생존자 1명 이하 → 게임 종료");
      this.ended = true;
      this.phase = PHASE.ENDED;
      return;
    }

    const gnosia = alive.filter((c) => this.getSide(c.id) === SIDE.GNOSIA && this.getRole(c.id) === ROLE.GNOSIA);
    const guardians = alive.filter((c) => this.getRole(c.id) === ROLE.GUARDIAN);

    // 1) guardian protect (단순: 한 명 무작위 보호)
    if (guardians.length > 0) {
      const guard = pickOne(guardians, this.rng);
      const candidates = alive.filter((c) => c.id !== guard.id);
      const protectedChar = pickOne(candidates.length ? candidates : alive, this.rng);
      if (protectedChar) {
        this._lastNight.guardedId = protectedChar.id;
      }
    }

    // 2) gnosia attack (그노시아가 없으면 아무 일 없음)
    if (!gnosia.length) {
      this.logs.push("🌙 밤이 조용히 지나갔습니다.");
      this.phase = PHASE.MORNING;
      return;
    }

    // target: non-gnosia alive
    const victims = alive.filter((c) => this.getSide(c.id) !== SIDE.GNOSIA);
    const victim = pickOne(victims, this.rng);

    if (!victim) {
      this.logs.push("🌙 공격할 대상이 없습니다.");
      this.phase = PHASE.MORNING;
      return;
    }

    this._lastNight.attackedId = victim.id;

    // protected?
    if (this._lastNight.guardedId && this._lastNight.guardedId === victim.id) {
      this.logs.push("🛡️ 누군가가 습격당했지만… 수호천사의 힘으로 무사했습니다.");
      this.phase = PHASE.MORNING;
      return;
    }

    // die
    victim.alive = false;
    this._lastNight.diedId = victim.id;
    this.logs.push("💀 밤중에 누군가가 습격당했습니다…");

    this.phase = PHASE.MORNING;
  }

  // -------------------------------
  // Morning report + next day
  // -------------------------------
  _stepMorning() {
    if (this._lastNight.diedId) {
      const dead = this.getChar(this._lastNight.diedId);
      this.logs.push(`☀️ 아침이 되었습니다. ${safeName(dead)} 님이 사망했습니다.`);
    } else {
      this.logs.push("☀️ 아침이 되었습니다. 사망자는 없습니다.");
    }

    this.day += 1;
    this._startDay();
  }

  // -------------------------------
  // Win conditions (simple)
  // -------------------------------
  _checkWinAndEndIfNeeded() {
    const alive = this.aliveChars();
    const aliveGnosia = alive.filter((c) => this.getRole(c.id) === ROLE.GNOSIA).length;
    const aliveCrewSide = alive.filter((c) => this.getSide(c.id) === SIDE.CREW).length;
    const aliveBug = alive.filter((c) => this.getRole(c.id) === ROLE.BUG).length;

    // Crew win: no gnosia alive
    if (aliveGnosia === 0) {
      // (간단 처리) 버그가 살아있으면 "버그 승리"로 바꾸고 싶다면 여기서 분기 가능
      if (aliveBug > 0) {
        this.logs.push("\n🏁 그노시아가 전멸했지만… 버그가 살아남았습니다. (버그 승리 처리)");
      } else {
        this.logs.push("\n🏁 그노시아가 전멸했습니다. (선원 진영 승리)");
      }
      this.ended = true;
      this.phase = PHASE.ENDED;
      return true;
    }

    // Gnosia win: gnosia >= others
    const others = alive.length - aliveGnosia;
    if (aliveGnosia >= others) {
      this.logs.push("\n🏁 그노시아가 과반을 장악했습니다. (그노시아 진영 승리)");
      this.ended = true;
      this.phase = PHASE.ENDED;
      return true;
    }

    // Continue
    return false;
  }
}
