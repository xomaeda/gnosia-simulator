import { chooseAction } from "./AI.js";
import { Commands } from "./Commands.js";

export function runDiscussion(game) {
  game.characters.forEach(actor => {
    if (!actor.alive) return;
    if (Math.random() < 0.4) return;

    const action = chooseAction(game, actor);
    const log = Commands[action.type](game, actor, action.target);
    game.log.push(log);
  });
}

