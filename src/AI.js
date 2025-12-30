export function chooseAction(game, actor) {
  const alive = game.characters.filter(c => c.alive && c !== actor);
  const target = alive[Math.floor(Math.random() * alive.length)];

  if (actor.personality.kind > 30) return { type: "defend", target };
  return { type: "suspect", target };
}

