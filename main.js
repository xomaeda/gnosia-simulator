const Character = require("./src/Character");
const GameState = require("./src/GameState");
const runDayTurn = require("./src/DayPhase");
const { runNightFree, runNightAttack } = require("./src/NightPhase");
const Logger = require("./src/Logger");

/*
  ↓↓↓ 여기서 캐릭터를 직접 만든다 ↓↓↓
*/

const characters = [
  new Character(
    "A",
    "F",
    22,
    "적극",
    { charisma: 30, logic: 25, acting: 20, intuition: 15, stealth: 10 },
    "CREW"
  ),
  new Character(
    "B",
    "M",
    24,
    "중립",
    { charisma: 20, logic: 20, acting: 15, intuition: 20, stealth: 15 },
    "GNOSIA"
  ),
  new Character(
    "C",
    "F",
    19,
    "소극",
    { charisma: 15, logic: 18, acting: 25, intuition: 22, stealth: 20 },
    "CREW"
  ),
  new Character(
    "D",
    "M",
    30,
    "중립",
    { charisma: 22, logic: 30, acting: 18, intuition: 10, stealth: 12 },
    "CREW"
  ),
  new Character(
    "E",
    "F",
    27,
    "적극",
    { charisma: 28, logic: 15, acting: 30, intuition: 12, stealth: 8 },
    "GNOSIA"
  )
];

const game = new GameState(characters);

/*
  실행 버튼 시뮬레이션
*/
while (true) {
  const result = game.isGameOver();
  if (result) {
    Logger.header(`${result} 진영 승리`);
    Logger.revealRoles(game.characters);
    break;
  }

  if (game.phase === "DAY") runDayTurn(game);
  else if (game.phase === "NIGHT_FREE") runNightFree(game);
  else if (game.phase === "NIGHT_ATTACK") runNightAttack(game);
}

