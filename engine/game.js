// engine/game.js
// =======================================================
// 게임 진행 엔진 (클릭 1회 = 진행 1스텝)
// - 낮: 클릭 1회 = 1턴(연쇄)  → 총 5번 클릭하면 낮 종료
// - 밤: 클릭 1회 = 자유행동   → 클릭 2회 = 역할집행+습격
// - 커맨드 효과(aggro/관계도) 적용
// =======================================================

import { COMMANDS, shouldEndTurn } from "./commands.js";
import {
  ROLE,
  assignRoles,
  checkWinner,
  resolveNightDeaths,
} from "./roles.js";
import {
  createRelations,
  applyRelEffects,
  applyAggroEffects,
  filterEffectsByAlive,
} from "./relations.js";

export class GameEngine {
  constructor(actors, settings, seed = null) {
    if (actors.length < 5) {
      throw new Error("캐릭터는 최소 5명 이상이어야 실행할 수 있습니다.");
    }
    if (actors.length > 15) {
      throw new Error("캐릭터는 최대 15명까지 가능합니다.");
    }

    this.seed = seed ?? null;
    this.settings = settings;

    // actors input 형식 보정
    this.actors = actors.map((a, idx) => ({
      id: idx,
      name: a.name,
      gender: a.gender,
      age: a.age,
      status: a.status,
      personality: a.personality,
      allowedCommands: Array.isArray(a.allowedCommands) ? a.allowedCommands : [],
      alive: true,
      aggro: 0,
      cooperation: null,
    }));

    // 역할 분배
    const { rolesById } = assignRoles(this.actors, settings, seed);
    this.rolesById = rolesById;

    // 관계도 생성 (랜덤 분포)
    this.relations = createRelations(this.actors.length, {
      baseTrust: 50,
      baseFavor: 50,
      spreadTrust: 12,
      spreadFavor: 12,
      seed: (seed == null ? null : seed + 101),
    });

    this.aliveIds = new Set(this.actors.map((a) => a.id));
    this.logs = [];

    // 진행 상태
    this.dayCount = 1;
    this.phase = "DAY";   // "DAY" | "NIGHT"
    this.dayTurn = 0;     // 0~5
    this.nightStep = 0;   // 0,1,2 (0=밤 시작 전, 1=자유행동 완료, 2=습격 완료)

    this._cachedNight = {
      engineerTarget: null,
      guardianProtect: null,
      gnosiaTarget: null,
    };

    this.log(`--- 1일차 낮 시작 ---`);
    // 유저가 시작부터 역할을 보길 원함(요구사항 반영)
    this.log(`[역할 공개] ${this.actors.map(a => `${a.name}=${this.rolesById.get(a.id)}`).join(", ")}`);
  }

  log(text) {
    this.logs.push(text);
  }

  // -------------------------------------------------------
  // 외부에서 "실행" 버튼 한 번 누르면 호출할 함수
  // -------------------------------------------------------
  step() {
    const win = checkWinner(this.aliveIds, this.rolesById);
    if (win.winner) return; // 이미 끝났으면 더 진행 안함

    if (this.phase === "DAY") {
      this.dayTurn += 1;
      this.log(`(${this.dayCount}일차 낮 - ${this.dayTurn}/5 턴)`);

      this.runTurnSession();

      if (this.dayTurn >= 5) {
        // 낮 종료 → 밤 진입
        this.phase = "NIGHT";
        this.nightStep = 0;
        this.log(`--- ${this.dayCount}일차 밤 시작 ---`);
      }
      return;
    }

    // NIGHT
    if (this.nightStep === 0) {
      // 밤 1/2: 자유행동
      this.nightStep = 1;
      this.log(`(밤 1/2) 자유행동`);
      this.runFreeActions();
      // 밤에 역할 집행 대상 미리 결정(다음 클릭에서 사용)
      this._cachedNight = this.chooseNightTargets();
      return;
    }

    if (this.nightStep === 1) {
      // 밤 2/2: 역할 집행 + 습격
      this.nightStep = 2;
      this.log(`(밤 2/2) 역할 집행 + 습격`);

      const { engineerTarget, guardianProtect, gnosiaTarget } = this._cachedNight;

      const result = resolveNightDeaths({
        actors: this.actors,
        rolesById: this.rolesById,
        aliveIds: this.aliveIds,
        engineerScanTargetId: engineerTarget,
        guardianProtectId: guardianProtect,
        gnosiaTargetId: gnosiaTarget,
      });

      if (result.deathIds.length === 0) {
        this.log("아무도 소멸하지 않았습니다.");
      } else {
        const names = result.deathIds.map((id) => this.actors[id].name);
        this.log(`${names.join("와 ")}가 소멸했습니다.`);
        result.deathIds.forEach((id) => this.kill(id));
      }

      // 승리 판정
      const win2 = checkWinner(this.aliveIds, this.rolesById);
      if (win2.winner) {
        this.log(`=== ${win2.winner} 승리 (${win2.detail}) ===`);
        return;
      }

      // 다음 날로
      this.dayCount += 1;
      this.phase = "DAY";
      this.dayTurn = 0;
      this.nightStep = 0;
      this.log(`--- ${this.dayCount}일차 낮 시작 ---`);
      return;
    }
  }

  // -------------------------------------------------------
  // 턴(연쇄) 실행: 루트 1개 + 부속 여러 개
  // -------------------------------------------------------
  runTurnSession() {
    const ctx = {
      phase: "DAY",
      rootCommand: null,
      blockedRebuttal: false,
      blockedBy: null,
      aliveIds: this.aliveIds,
      actors: this.actors,
      relations: this.relations,
      rolesById: this.rolesById,
      logs: this.logs,
      flags: {},
    };

    const speakers = Array.from(this.aliveIds).sort(() => Math.random() - 0.5);

    for (const actorId of speakers) {
      if (!this.aliveIds.has(actorId)) continue;

      if (!ctx.rootCommand) {
        const root = this.pickRootCommand(actorId, ctx);
        if (!root) continue;
        ctx.rootCommand = root;

        const eff = COMMANDS[root.name].execute(ctx, actorId, root.targetId) || {};
        this.applyEffects(eff);
        continue;
      }

      const sub = this.pickSubCommand(actorId, ctx);
      if (!sub) continue;

      const eff = COMMANDS[sub.name].execute(ctx, actorId, sub.targetId) || {};
      this.applyEffects(eff);

      if (shouldEndTurn(eff)) break;
    }
  }

  applyEffects(eff) {
    // alive 기반 방어(죽은 사람 대상 효과 제거)
    const aliveFilteredRel = filterEffectsByAlive(eff.rel || [], this.aliveIds);

    applyRelEffects(this.relations, aliveFilteredRel);
    applyAggroEffects(this.actors, eff.aggro || []);
    // flags는 ctx에서 직접 관리하는 구조라 여기선 생략
  }

  // -------------------------------------------------------
  // 커맨드 선택(간이 AI)
  // - 유저가 체크한 allowedCommands 기반으로 "사용 후보"를 제한한다.
  // -------------------------------------------------------
  pickRootCommand(actorId, ctx) {
    const actor = this.actors[actorId];

    const rootCandidates = Object.entries(COMMANDS)
      .filter(([name, cmd]) => cmd.root)
      .filter(([name, cmd]) => {
        // 유저가 체크한 커맨드만 사용 (단, 루트 커맨드 중 의심/감싸/잡담/인간이라고말해 등은 allowed에 있어야 사용)
        if (!actor.allowedCommands.includes(name)) return false;
        if (cmd.canUse && !cmd.canUse(ctx, actorId)) return false;
        return true;
      })
      .map(([name]) => name);

    if (rootCandidates.length === 0) return null;

    const name = rootCandidates[Math.floor(Math.random() * rootCandidates.length)];
    const targetId = this.pickRandomTarget(actorId);
    if (targetId == null) return null;
    return { name, actorId, targetId };
  }

  pickSubCommand(actorId, ctx) {
    const actor = this.actors[actorId];

    const subCandidates = Object.entries(COMMANDS)
      .filter(([name, cmd]) => !cmd.root)
      .filter(([name, cmd]) => {
        // 유저가 체크한 커맨드만 사용
        if (!actor.allowedCommands.includes(name)) return false;

        if (cmd.requiresRoot && (!ctx.rootCommand || cmd.requiresRoot !== ctx.rootCommand.name)) return false;
        if (cmd.requiresFlag && !ctx.flags[cmd.requiresFlag]) return false;
        if (cmd.canUse && !cmd.canUse(ctx, actorId)) return false;
        return true;
      })
      .map(([name]) => name);

    if (subCandidates.length === 0) return null;

    const name = subCandidates[Math.floor(Math.random() * subCandidates.length)];
    // 어떤 커맨드는 helper/target 의미가 다를 수 있으니 일단 랜덤 생존자 1명
    const targetId = this.pickRandomTarget(actorId);
    return { name, actorId, targetId };
  }

  pickRandomTarget(actorId) {
    const candidates = Array.from(this.aliveIds).filter((id) => id !== actorId);
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // -------------------------------------------------------
  // 밤 자유행동 + (추가 커맨드) 협력 요청은 여기서 처리
  // -------------------------------------------------------
  runFreeActions() {
    const alive = Array.from(this.aliveIds);

    // 간단한 자유행동: 혼자/둘이 보내기/협력 요청(allowedCommands에 "밤:협력요청" 체크한 경우)
    for (const id of alive) {
      if (!this.aliveIds.has(id)) continue;

      const actor = this.actors[id];
      const canCoop = actor.allowedCommands.includes("밤:협력요청");

      // 협력 요청 우선 시도(확률)
      if (canCoop && Math.random() < 0.25) {
        const target = this.pickRandomAlive(id);
        if (target == null) {
          this.log(`${actor.name}는 혼자 시간을 보냈다.`);
          continue;
        }
        const other = this.actors[target];
        // 성격(사회성/상냥함) 영향을 좀 줌
        const acceptChance = 50 + (other.personality?.social ?? 0) * 30 + (other.personality?.kindness ?? 0) * 20;
        if (Math.random() * 100 < acceptChance) {
          actor.cooperation = target;
          other.cooperation = id;
          this.log(`${actor.name}는 ${other.name}에게 협력 요청을 했고, 협력에 성공했다.`);
        } else {
          this.log(`${actor.name}는 ${other.name}에게 협력 요청을 했지만, 거절당했다.`);
        }
        continue;
      }

      // 일반 자유행동
      if (Math.random() < 0.4) {
        this.log(`${actor.name}는 혼자 시간을 보냈다.`);
      } else {
        const otherId = this.pickRandomAlive(id);
        if (otherId != null) {
          this.log(`${actor.name}는 ${this.actors[otherId].name}와 함께 시간을 보냈다.`);
        } else {
          this.log(`${actor.name}는 혼자 시간을 보냈다.`);
        }
      }
    }
  }

  pickRandomAlive(exceptId = null) {
    const candidates = Array.from(this.aliveIds).filter((id) => id !== exceptId);
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // -------------------------------------------------------
  // 밤 역할 대상 선택(간이): 살아있는 대상 중 랜덤
  // (너 요구한 "성향 기반 공격"은 다음에 더 정교하게 가중치로 바꾸면 됨)
  // -------------------------------------------------------
  chooseNightTargets() {
    const engineerId = this.findRole(ROLE.ENGINEER);
    const guardianId = this.findRole(ROLE.GUARDIAN);
    const gnosiaIds = this.findAllRole(ROLE.GNOSIA);

    const engineerTarget = (engineerId != null) ? this.pickRandomAlive(engineerId) : null;
    const guardianProtect = (guardianId != null) ? this.pickRandomAlive(guardianId) : null;

    // 그노시아 타깃: 그노시아가 "캐릭터"인 것(플레이어) 중 1명 선택
    let gnosiaTarget = null;
    if (gnosiaIds.length > 0) {
      // 공격자(그노시아) 하나 고르고, 그 그노시아가 공격할 대상 고르기
      const attackerId = gnosiaIds[Math.floor(Math.random() * gnosiaIds.length)];
      // 공격 대상: 살아있는 사람 중 (그노시아 제외) 우선
      const candidates = Array.from(this.aliveIds).filter((id) => id !== attackerId);
      if (candidates.length > 0) gnosiaTarget = candidates[Math.floor(Math.random() * candidates.length)];
    }

    return { engineerTarget, guardianProtect, gnosiaTarget };
  }

  kill(id) {
    if (!this.aliveIds.has(id)) return;
    this.actors[id].alive = false;
    this.aliveIds.delete(id);
  }

  findRole(role) {
    for (const [id, r] of this.rolesById.entries()) {
      if (r === role && this.aliveIds.has(id)) return id;
    }
    return null;
  }

  findAllRole(role) {
    const ids = [];
    for (const [id, r] of this.rolesById.entries()) {
      if (r === role && this.aliveIds.has(id)) ids.push(id);
    }
    return ids;
  }
}
