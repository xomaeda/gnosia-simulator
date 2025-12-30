const Logger = require("./Logger");

// 밤 자유행동
function runNightFree(game) {
  Logger.header("밤 - 자유행동");

  const chars = game.livingCharacters();

  chars.forEach(c => {
    if (Math.random() < 0.5) {
      Logger.log(`${c.name}은(는) 혼자 시간을 보냈다.`);
    } else {
      const others = chars.filter(o => o !== c);
      if (others.length === 0) return;

      const partner = others[Math.floor(Math.random() * others.length)];
      const i = game.characters.indexOf(c);
      const j = game.characters.indexOf(partner);

      game.favor[i][j] += 1;
      game.favor[j][i] += 1;

      Logger.log(`${c.name}와 ${partner.name}는 함께 시간을 보내며 가까워졌다.`);
    }
  });

  game.phase = "NIGHT_ATTACK";
}

// 밤 습격
function runNightAttack(game) {
  Logger.header("밤 - 그노시아의 습격");

  const targets = game
    .livingCharacters()
    .filter(c => c.role === "CREW");

  if (targets.length === 0) return;

  // 어그로 기반 확률 선택
  const totalWeight = targets.reduce((s, c) => s + (1 + c.aggro), 0);
  let r = Math.random() * totalWeight;

  let victim = targets[0];
  for (const c of targets) {
    r -= 1 + c.aggro;
    if (r <= 0) {
      victim = c;
      break;
    }
  }

  victim.alive = false;
  Logger.log(`${victim.name}은(는) 밤중에 그노시아에게 습격당했습니다.`);

  game.phase = "DAY";
}

module.exports = { runNightFree, runNightAttack };

