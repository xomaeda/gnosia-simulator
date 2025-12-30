import Logger from "./Logger.js";

export default class GameState {
  constructor() {
    this.characters = [];

    this.dayCount = 1;
    this.isDay = true;

    this.dayTurn = 0;
    this.nightStep = 0;
  }

  addCharacter(char) {
    this.characters.push(char);
  }

  execute() {
    if (this.isDay) {
      this.processDay();
    } else {
      this.processNight();
    }
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

      const victims = this.characters.filter(c => c.alive);
      if (victims.length > 0) {
        const victim =
          victims[Math.floor(Math.random() * victims.length)];
        victim.alive = false;
        Logger.write(
          `${victim.name}이(가) 그노시아에 의해 습격당했습니다.`
        );
      }

      this.nightStep = 0;
      this.isDay = true;
      this.dayCount++;

      Logger.write("다음 날로 넘어갑니다.");
    }
  }
}
