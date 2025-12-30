export function runNight(game) {
  const gnosis = game.characters.filter(c => c.role === "그노시아" && c.alive);
  const humans = game.characters.filter(c => c.role !== "그노시아" && c.alive);

  if (gnosis.length === 0 || humans.length === 0) return;

  const target = humans[Math.floor(Math.random() * humans.length)];
  target.alive = false;
  game.log.push(`밤:[그노시아] ${target.name}이(가) 습격당했다.`);
}

