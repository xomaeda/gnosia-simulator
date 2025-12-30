import Logger from "./Logger.js";

export default class GameState {
  constructor() {
    this.characters = [];

    this.dayCount = 1;
    this.isDay = true;

    this.dayTurn = 0;
    this.nightStep = 0;

    this.gameOver = false;
  }

  addCharacter(char) {
    this.characters.push(char);
  }

  startGame() {
    // 역할 배정
    const shuffled = [...this.characters].sort(
      () => Math.random() - 0.5
    );

    const gnosiaCount = Math.max(1, Math.floor(this.characters.length / 4));

    shuffled.forEach((c, i) => {
      if (i < gnosiaCount) {
        c.role = "그노시아";
      } else {
        c.role = "선원";
      }
    });

    Logger.write("게임이 시작되었습니다.");
    Logger.write("역할이 비공개로 배정되었습니다.");
  }

  execute() {
    if (this.gameOver) {
      Logger.write("게임은 이미 종료되었습니다.");
      return;
    }

    // 첫 실행 시 게임 시작
    if (this.dayCount === 1 && this.dayTurn === 0 && this.nightStep === 0) {
      this.startGame();
    }

    if (this.isDay) {
      this.processDay();
    } else {
      this.processNight();
    }

    this.checkWinCondition();
  }

  processDay() {
    this.dayTurn++;

    Logger.write(
      `낮 ${this.dayCount}일차 - 턴 ${this.dayTurn}`
    );

    if (this.dayTurn >= 5) {
      Logger.write("낮이 끝났습니다.");
      this.isDay = false;
      this.dayTurn = 0;
    }
  }

  processNight() {
    this.nightStep++;

    if (this.nightStep === 1) {
      Logger.write(`밤 ${this.dayCount}일차 - 자유행동`);

      this.characters.forEach(c => {
        if (!c.alive) return;

        if (Math.random() < 0.5) {
          Logger.write(`${c.name}은(는) 혼자 시간을 보냈습니다.`);
        } else {
          const others = this.characters.filter(
            o => o !== c && o.alive
          );
          if (others.length > 0) {
            const target =
              others[Math.floor(Math.random() * others.length)];
            Logger.write(
              `${c.name}은(는) ${target.name}와 함께 시간을 보냈습니다.`
            );
          }
        }
      });

      return;
    }

    if (this.nightStep === 2) {
      Logger.write(`밤 ${this.dayCount}일차 - 그노시아 습격`);

      const gnosiaAlive = this.characters.filter(
        c => c.alive && c.role === "그노시아"
      );

      if (gnosiaAlive.length > 0) {
        const victims = this.characters.filter(
          c => c.alive && c.role === "선원"
        );

        if (victims.length > 0) {
          const victim =
            victims[Math.floor(Math.random() * victims.length)];
          victim.alive = false;
          Logger.write(
            `${victim.name}이(가) 그노시아에 의해 습격당했습니다.`
          );
        }
      }

      this.nightStep = 0;
      this.isDay = true;
      this.dayCount++;

      Logger.write("다음 날로 넘어갑니다.");
    }
  }

  checkWinCondition() {
    const aliveGnosia = this.characters.filter(
      c => c.alive && c.role === "그노시아"
    ).length;

    const aliveCrew = this.characters.filter(
      c => c.alive && c.role === "선원"
    ).length;

    if (aliveGnosia === 0) {
      this.endGame("선원");
    } else if (aliveGnosia >= aliveCrew) {
      this.endGame("그노시아");
    }
  }

  endGame(winner) {
    this.gameOver = true;

    Logger.write(`게임 종료! ${winner} 진영의 승리입니다.`);
    Logger.write("모든 캐릭터의 역할을 공개합니다.");

    this.characters.forEach(c => {
      const state = c.alive ? "생존" : "사망";
      Logger.write(
        `${c.name} : ${c.role} (${state})`
      );
    });
  }
}
