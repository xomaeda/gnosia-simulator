const Logger = require("./Logger");

// 낮 한 턴 처리
function runDayTurn(game) {
  Logger.header(`낮 ${game.dayTurn}턴`);

  const chars = game.livingCharacters();

  chars.forEach(actor => {
    if (!actor.decideToAct()) return;

    // 대상 선택 (자기 제외)
    const targets = chars.filter(c => c !== actor);
    if (targets.length === 0) return;

    const target = targets[Math.floor(Math.random() * targets.length)];

    // 효과 계산
    const trustGain = actor.stats.logic * 0.1;
    game.trust[game.characters.indexOf(actor)][game.characters.indexOf(target)] += trustGain;

    actor.aggro += 1;

    Logger.log(
      `${actor.name}은(는) ${target.name}에 대해 발언했다. (신뢰 +${trustGain.toFixed(
        1
      )}, 어그로 +1)`
    );
  });

  game.dayTurn++;

  if (game.dayTurn > 5) {
    game.dayTurn = 1;
    game.phase = "NIGHT_FREE";
  }
}

module.exports = runDayTurn;

