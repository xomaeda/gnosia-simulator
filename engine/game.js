// engine/game.js
// =======================================================
// 게임 진행 엔진
// - 낮/밤 흐름
// - 턴(연쇄) 실행
// - 밤 결과 처리
// - 승리 판정
// =======================================================

import { COMMANDS, shouldEndTurn } from "./commands.js";
import {
  ROLE,
  assignRoles,
  checkWinner,
  resolveNightDeaths,
} from "./roles.js";

// =======================================================
// GameEngine
// =======================================================
export class GameEngine {
  constructor(actors, settings, seed = null) {
    if (actors.length < 5) {
      throw new Error("캐릭터는 최소 5명 이상이어야 실행할 수 있습니다.");
    }

    this.actors = actors.map((a, idx) => ({
      ...a,
      id: idx,
      alive: true,
      aggro: 0,
      cooperation: null,
    }));

    this.settings = settings;
    this.seed = seed;

    const { rolesById } = assignRoles(this.actors, settings, seed);
    this.rolesById = rolesById;

    this.aliveIds = new Set(this.actors.map((a) => a.id));

    this.dayCount = 1;
    this.phase = "DAY";
    this.turnIndex = 0;

    this.logs = [];
  }

  // =====================================================
  // 로그
  // =====================================================
  log(text) {
    this.logs.push(text);
  }

  // =====================================================
  // 낮 진행
  // =====================================================
  startDay() {
    this.phase = "DAY";
    this.turnIndex = 0;
    this.log(`--- ${this.dayCount}일차 낮 ---`);
  }

  runDayTurn() {
    if (this.phase !== "DAY") return;

    if (this.turnIndex >= 5) {
      this.startNight();
      return;
    }

    this.turnIndex++;
    this.log(`(${this.dayCount}일차 낮 - ${this.turnIndex}턴)`);

    this.runTurnSession();
  }

  // =====================================================
  // 턴(연쇄 커맨드) 실행
  // =====================================================
  runTurnSession() {
    const ctx = {
      phase: "DAY",
      rootCommand: null,
      blockedRebuttal: false,
      blockedBy: null,
      aliveIds: this.aliveIds,
      actors: this.actors,
      relations: null,
      rolesById: this.rolesById,
      logs: this.logs,
      flags: {},
    };

    // 발언 순서: 살아있는 캐릭터 중 랜덤
    const speakers = Array.from(this.aliveIds).sort(
      () => Math.random() - 0.5
    );

    for (const actorId of speakers) {
      if (!this.aliveIds.has(actorId)) continue;

      // 아직 루트 커맨드 없으면 루트 시도
      if (!ctx.rootCommand) {
        const root = this.pickRootCommand(actorId);
        if (!root) continue;

        ctx.rootCommand = root;
        COMMANDS[root.name].execute(ctx, actorId, root.targetId);
        continue;
      }

      // 부속 커맨드 시도
      const sub = this.pickSubCommand(actorId, ctx);
      if (!sub) continue;

      const effect = COMMANDS[sub.name].execute(
        ctx,
        actorId,
        sub.targetId
      );

      if (shouldEndTurn(effect)) break;
    }
  }

  // =====================================================
  // 커맨드 선택 로직 (AI 간이 버전)
  // =====================================================
  pickRootCommand(actorId) {
    const actor = this.actors[actorId];

    // 사용 가능 루트 커맨드 목록
    const roots = Object.entries(COMMANDS)
      .filter(
        ([, cmd]) =>
          cmd.root &&
          cmd.canUse &&
          cmd.canUse(
            { phase: "DAY", actors: this.actors },
            actorId
          )
      )
      .map(([name]) => name);

    if (roots.length === 0) return null;

    const name = roots[Math.floor(Math.random() * roots.length)];
    const targetId = this.pickRandomTarget(actorId);
    return { name, actorId, targetId };
  }

  pickSubCommand(actorId, ctx) {
    const subs = Object.entries(COMMANDS)
      .filter(([name, cmd]) => {
        if (cmd.root) return false;
        if (cmd.requiresRoot && cmd.requiresRoot !== ctx.rootCommand.name)
          return false;
        if (cmd.requiresFlag && !ctx.flags[cmd.requiresFlag]) return false;
        if (cmd.canUse && !cmd.canUse(ctx, actorId)) return false;
        return true;
      })
      .map(([name]) => name);

    if (subs.length === 0) return null;

    const name = subs[Math.floor(Math.random() * subs.length)];
    const targetId = this.pickRandomTarget(actorId);
    return { name, actorId, targetId };
  }

  pickRandomTarget(actorId) {
    const candidates = Array.from(this.aliveIds).filter(
      (id) => id !== actorId
    );
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // =====================================================
  // 밤 진행
  // =====================================================
  startNight() {
    this.phase = "NIGHT";
    this.log(`--- ${this.dayCount}일차 밤 ---`);
    this.runNight();
  }

  runNight() {
    // 1. 자유행동 + 협력 요청
    this.runFreeActions();

    // 2. 엔지니어 조사 / 수호천사 보호 / 그노시아 습격
    const engineerId = this.findRole(ROLE.ENGINEER);
    const guardianId = this.findRole(ROLE.GUARDIAN);
    const gnosiaIds = this.findAllRole(ROLE.GNOSIA);

    const engineerTarget =
      engineerId != null ? this.pickRandomAlive(engineerId) : null;
    const guardianTarget =
      guardianId != null ? this.pickRandomAlive(guardianId) : null;

    let gnosiaTarget = null;
    if (gnosiaIds.length > 0) {
      gnosiaTarget =
        gnosiaIds[Math.floor(Math.random() * gnosiaIds.length)];
    }

    const result = resolveNightDeaths({
      actors: this.actors,
      rolesById: this.rolesById,
      aliveIds: this.aliveIds,
      engineerScanTargetId: engineerTarget,
      guardianProtectId: guardianTarget,
      gnosiaTargetId: gnosiaTarget,
    });

    if (result.deathIds.length === 0) {
      this.log("아무도 소멸하지 않았습니다.");
    } else {
      const names = result.deathIds.map(
        (id) => this.actors[id].name
      );
      this.log(`${names.join("와 ")}가 소멸했습니다.`);
      result.deathIds.forEach((id) => this.kill(id));
    }

    // 승리 판정
    const win = checkWinner(this.aliveIds, this.rolesById);
    if (win.winner) {
      this.log(`=== ${win.winner} 승리 (${win.detail}) ===`);
      return;
    }

    // 다음 날
    this.dayCount++;
    this.startDay();
  }

  runFreeActions() {
    for (const id of this.aliveIds) {
      if (Math.random() < 0.3) {
        this.log(`${this.actors[id].name}는 혼자 시간을 보냈다.`);
      } else {
        const other = this.pickRandomAlive(id);
        if (other != null) {
          this.log(
            `${this.actors[id].name}는 ${this.actors[other].name}와 함께 시간을 보냈다.`
          );
        }
      }
    }
  }

  // =====================================================
  // 유틸
  // =====================================================
  kill(id) {
    this.actors[id].alive = false;
    this.aliveIds.delete(id);
  }

  pickRandomAlive(exceptId = null) {
    const candidates = Array.from(this.aliveIds).filter(
      (id) => id !== exceptId
    );
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
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
