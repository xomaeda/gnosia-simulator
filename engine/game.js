// engine/game.js
// ✅ 반드시 "engine/" 폴더 안에 있는 파일 기준으로 상대경로를 잡아야 함!
//   - 여기서는 ./commands.js, ./roles.js, ./relation.js 로 접근한다.
//   - 절대 ./engine/... 를 쓰면 /engine/engine/... 로 꼬여서 404 난다.

import { COMMAND_DEFS } from "./commands.js";

// (선택) roles / relation 모듈은 있으면 쓰고 없으면 무시
let rolesApi = null;
try { rolesApi = await import("./roles.js"); } catch (_) { rolesApi = null; }

let relationApi = null;
try { relationApi = await import("./relation.js"); } catch (_) { relationApi = null; }

// -------------------------------
// 작은 RNG 유틸 (seed 없으면 Math.random)
// -------------------------------
function makeRng(seed) {
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    return { next: () => Math.random() };
  }
  // LCG (간단)
  let s = (seed >>> 0) || 123456789;
  return {
    next: () => {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 0x100000000;
    },
  };
}

function pickOne(arr, rng) {
  if (!arr || arr.length === 0) return null;
  const i = Math.floor(rng.next() * arr.length);
  return arr[Math.max(0, Math.min(arr.length - 1, i))];
}

function safeName(c, fallback) {
  return (c && (c.name || c.id)) ? (c.name || c.id) : fallback;
}

// -------------------------------
// GameEngine (main.js가 기대하는 형태)
//  - new GameEngine(characters, settings, rngOrNull)
//  - engine.logs 배열에 문자열 push
//  - engine.step() 1스텝 진행
//  - (선택) getPublicRoleLines(), getRelationsText() 지원
// -------------------------------
export class GameEngine {
  constructor(characters = [], settings = {}, rngOrNull = null) {
    this.logs = [];
    this.turn = 0;
    this.phase = "START";
    this.ended = false;

    // settings 예: { enableEngineer, enableDoctor, ..., gnosiaCount }
    this.settings = settings || {};

    // 캐릭터 복제 + enabledCommands 정규화
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
        age: c?.age ?? 0,
        stats: { ...(c?.stats || {}) },
        personality: { ...(c?.personality || {}) },
        enabledCommands: enabledSet,

        // (선택) 역할/상태용 슬롯
        role: c?.role ?? null,
        alive: c?.alive !== false,
      };
    });

    // rng
    if (rngOrNull && typeof rngOrNull.next === "function") {
      this.rng = rngOrNull;
    } else if (typeof rngOrNull === "number") {
      this.rng = makeRng(rngOrNull);
    } else {
      this.rng = makeRng(null);
    }

    // 초기 로그
    this.logs.push("✅ 게임이 시작되었습니다.");

    // (선택) 역할 배정(roles.js가 있으면)
    this._assignRolesIfPossible();

    // (선택) 관계 초기화(relation.js가 있으면)
    this._initRelationsIfPossible();
  }

  _assignRolesIfPossible() {
    try {
      if (!rolesApi) return;

      // roles.js 쪽 함수명이 다를 수 있으니 유연하게 대응
      const fn =
        rolesApi.assignRoles ||
        rolesApi.buildRoles ||
        rolesApi.initRoles ||
        null;

      if (typeof fn !== "function") return;

      // 인원/설정 전달
      fn(this.characters, this.settings, this.rng);

      // 역할이 들어갔다면 한 줄 정도만 출력(공개용 함수가 있으면 그걸 main.js가 따로 호출하기도 함)
      this.logs.push("ℹ️ 역할 배정 완료");
    } catch (e) {
      this.logs.push("⚠️ 역할 배정 중 경고: " + (e?.message ?? String(e)));
    }
  }

  _initRelationsIfPossible() {
    try {
      if (!relationApi) return;
      const fn =
        relationApi.initRelations ||
        relationApi.createRelations ||
        null;
      if (typeof fn !== "function") return;

      // relation 데이터는 엔진에 보관
      this.relations = fn(this.characters, this.settings, this.rng);
      this.logs.push("ℹ️ 관계도 초기화 완료");
    } catch (e) {
      this.logs.push("⚠️ 관계도 초기화 중 경고: " + (e?.message ?? String(e)));
    }
  }

  // main.js에서 있으면 출력하는 용도 :contentReference[oaicite:1]{index=1}
  getPublicRoleLines() {
    // “공개 역할” 같은 시스템이 아직 없으면 빈 배열
    // roles.js가 public lines를 제공하면 그걸 우선 사용
    try {
      if (rolesApi && typeof rolesApi.getPublicRoleLines === "function") {
        return rolesApi.getPublicRoleLines(this.characters, this.settings) || [];
      }
    } catch {}
    return [];
  }

  // relation.js가 있으면 텍스트로 보여주기(선택)
  getRelationsText() {
    try {
      if (relationApi && typeof relationApi.getRelationsText === "function") {
        return relationApi.getRelationsText(this) || "";
      }
    } catch {}
    return "관계도 준비 중…";
  }

  // -------------------------------
  // 1 스텝 진행
  // -------------------------------
  step() {
    if (this.ended) {
      this.logs.push("ℹ️ 게임이 이미 종료되었습니다.");
      return;
    }

    this.turn += 1;

    // 매우 단순한 페이즈 전개(START -> DAY -> NIGHT -> DAY ...)
    if (this.phase === "START") {
      this.phase = "DAY";
      this.logs.push(`[턴 ${this.turn}] 낮이 되었습니다.`);
      this._doTalkStep();
      return;
    }

    if (this.phase === "DAY") {
      this.phase = "NIGHT";
      this.logs.push(`[턴 ${this.turn}] 밤이 되었습니다.`);
      this._doNightStep();
      return;
    }

    // NIGHT
    this.phase = "DAY";
    this.logs.push(`[턴 ${this.turn}] 다시 낮이 되었습니다.`);
    this._doTalkStep();
  }

  _aliveChars() {
    return this.characters.filter((c) => c.alive);
  }

  _doTalkStep() {
    const alive = this._aliveChars();
    if (alive.length === 0) {
      this.logs.push("❌ 생존자가 없어 게임 종료");
      this.ended = true;
      return;
    }

    const speaker = pickOne(alive, this.rng);
    const enabled = speaker.enabledCommands instanceof Set ? speaker.enabledCommands : new Set();

    // 체크된 커맨드 중에서 정의가 있는 것만 후보로
    const candidates = [...enabled]
      .map((id) => COMMAND_DEFS?.find((d) => d.id === id))
      .filter(Boolean);

    // 아무것도 없으면 기본 대사
    if (candidates.length === 0) {
      this.logs.push(`🗣️ ${safeName(speaker, "누군가")}: …(말을 아낀다)`);
      return;
    }

    const cmd = pickOne(candidates, this.rng);
    this.logs.push(`🗣️ ${safeName(speaker, "누군가")}: [${cmd.label ?? cmd.id}] 사용`);
  }

  _doNightStep() {
    // 아직 “처형/공격” 로직은 없는 간단 버전
    const alive = this._aliveChars();
    if (alive.length <= 1) {
      this.logs.push("✅ 생존자 1명 이하 → 게임 종료");
      this.ended = true;
      return;
    }

    // 랜덤으로 “아무 일도 없었다” / “소소한 이벤트”
    if (this.rng.next() < 0.7) {
      this.logs.push("🌙 밤이 조용히 지나갔습니다.");
      return;
    }

    const a = pickOne(alive, this.rng);
    const b = pickOne(alive.filter((x) => x !== a), this.rng);
    this.logs.push(`🌙 ${safeName(a, "누군가")} ↔ ${safeName(b, "누군가")}: 수상한 기류가 감돕니다…`);
  }
}
