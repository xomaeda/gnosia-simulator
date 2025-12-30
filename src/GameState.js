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
    char.alive = true;
    char.aggro = 0;
    char.trust = {};
    char.like = {};
    this.characters.push(char);
  }

  initRelations() {
    this.characters.forEach(a => {
      this.characters.forEach(b => {
        if (a !== b) {
          a.trust[b.name] = 0;
          a.like[b.name] = 0;
        }
      });
    });
  }

  startGame() {
    const shuffled = [...this.characters].sort(() => Math.random() - 0.5);
    const gnosiaCount = Math.max(1, Math.floor(this.characters.length / 4));

    shuffled.forEach((c, i) => {
      c.role = i < gnosiaCount ? "그노시아" : "선원";
    });

    this.initRelations();

    Logger.write("게임이 시작되었습니다.");
    Logger.write("역할은 비공개입니다.");
  }

  execute() {
    if (this.gameOver) return;

    if (this.dayCount === 1 && this.dayTurn === 0 && this.nightStep === 0) {
      this.startGame();
    }

    if (this.isDay) this.processDay();
    else this.processNight();

    this.checkWinCondition();
  }

  /* =====================
     낮 / 커맨드 처리
     ===================== */

  processDay() {
    this.dayTurn++;
    Logger.write(`낮 ${this.dayCount}일차 - 턴 ${this.dayTurn}`);

    const alive = this.characters.filter(c => c.alive);

    alive.forEach(c => {
      this.useCommand(c);
    });

    if (this.dayTurn >= 5) {
      Logger.write("투표를 시작합니다.");
      this.processVote();
      this.dayTurn = 0;
      this.isDay = false;
    }
  }

  useCommand(char) {
    const commandList = [
      "의심한다",
      "감싼다",
      "의심에 동의한다",
      "변호한다",
      "침묵"
    ];

    const cmd = commandList[Math.floor(Math.random() * commandList.length)];

    switch (cmd) {
      case "의심한다":
        this.cmdSuspect(char);
        break;
      case "의심에 동의한다":
        this.cmdAgreeSuspect(char);
        break;
      case "변호한다":
        this.cmdDefend(char);
        break;
      case "감싼다":
        this.cmdProtect(char);
        break;
      case "침묵":
        Logger.write(`${char.name}은(는) 침묵했다.`);
        break;
    }
  }

  /* =====================
     커맨드 구현 (틀)
     ===================== */

  pickTarget(char) {
    return this.characters
      .filter(c => c.alive && c !== char)
      .sort(() => Math.random() - 0.5)[0];
  }

  cmdSuspect(char) {
    const t = this.pickTarget(char);
    if (!t) return;

    char.aggro += 2;
    char.trust[t.name] -= 2;
    char.like[t.name] -= 1;

    const lines = [
      `${char.name}:[의심한다] ${t.name}은 싫어.`,
      `${char.name}:[의심한다] ${t.name}은 의심스러워.`,
      `${char.name}:[의심한다] ${t.name}은 확률적으로 수상해.`
    ];

    Logger.write(lines[Math.floor(Math.random() * lines.length)]);
  }

  cmdAgreeSuspect(char) {
    const t = this.pickTarget(char);
    if (!t) return;

    char.aggro += 1;
    char.trust[t.name] -= 1;

    Logger.write(
      `${char.name}:[의심에 동의한다] ${t.name}의 말에 동의해.`
    );
  }

  cmdDefend(char) {
    const t = this.pickTarget(char);
    if (!t) return;

    char.aggro += 1;
    char.trust[t.name] += 1;
    char.like[t.name] += 2;

    const lines = [
      `${char.name}:[변호한다] ${t.name}은 좋아.`,
      `${char.name}:[변호한다] ${t.name}은 믿을 수 있어.`,
      `${char.name}:[변호한다] ${t.name}은 확률적으로 안전해.`
    ];

    cmdSlap(char) {
    const t = this.pickTarget(char);
    Logger.write(`${char.name}:[시끄러워] ${t.name} 좀 조용히 해.`);
    }


    Logger.write(lines[Math.floor(Math.random() * lines.length)]);
  }

  cmdProtect(char) {
    const t = this.pickTarget(char);
    if (!t) return;

    char.aggro += 1;
    char.trust[t.name] += 2;
    char.like[t.name] += 2;

    Logger.write(
      `${char.name}:[감싼다] ${t.name}을 감싼다.`
    );
  }

  /* =====================
     투표
     ===================== */

  processVote() {
    const alive = this.characters.filter(c => c.alive);
    const votes = new Map();

    alive.forEach(voter => {
      const target = this.chooseVoteTarget(voter, alive);
      Logger.write(`${voter.name} → ${target.name} 투표`);
      votes.set(target, (votes.get(target) || 0) + 1);
    });

    let max = 0;
    let list = [];

    votes.forEach((v, c) => {
      if (v > max) {
        max = v;
        list = [c];
      } else if (v === max) {
        list.push(c);
      }
    });

    const frozen = list[Math.floor(Math.random() * list.length)];
    frozen.alive = false;

    Logger.write(`${frozen.name}이(가) 콜드슬립되었습니다.`);
  }

  chooseVoteTarget(voter, alive) {
    const pool = [];

    alive.forEach(c => {
      if (c === voter) return;

      const aggro = c.aggro;
      const trust = voter.trust[c.name] || 0;
      const like = voter.like[c.name] || 0;

      const weight =
        1 +
        aggro * 2 +
        Math.max(0, -trust) * 2 +
        Math.max(0, -like);

      for (let i = 0; i < weight; i++) pool.push(c);
    });

    return pool[Math.floor(Math.random() * pool.length)];
  }

  /* =====================
     밤
     ===================== */

  processNight() {
    this.nightStep++;

    if (this.nightStep === 1) {
      Logger.write(`밤 ${this.dayCount}일차 - 자유행동`);
      return;
    }

    if (this.nightStep === 2) {
      Logger.write(`밤 ${this.dayCount}일차 - 습격`);

      const victims = this.characters.filter(
        c => c.alive && c.role === "선원"
      );

      if (victims.length) {
        const v = victims[Math.floor(Math.random() * victims.length)];
        v.alive = false;
        Logger.write(`${v.name}이(가) 그노시아에 의해 습격당했습니다.`);
      }

      this.nightStep = 0;
      this.isDay = true;
      this.dayCount++;
    }
  }

  /* =====================
     승리 조건
     ===================== */

  checkWinCondition() {
    const g = this.characters.filter(c => c.alive && c.role === "그노시아").length;
    const h = this.characters.filter(c => c.alive && c.role === "선원").length;

    if (g === 0) this.endGame("선원");
    if (g >= h) this.endGame("그노시아");
  }

  endGame(winner) {
    this.gameOver = true;
    Logger.write(`게임 종료! ${winner} 진영 승리`);
    Logger.write("역할 공개:");

    this.characters.forEach(c => {
      Logger.write(
        `${c.name} : ${c.role} (${c.alive ? "생존" : "사망"})`
      );
    });
  }
}
