import { suspectLine, defendLine } from "./Dialogues.js";

export const Commands = {
  suspect(game, actor, target) {
    target.trust[actor.id] = (target.trust[actor.id] ?? 50) - actor.stats.logic;
    target.favor[actor.id] = (target.favor[actor.id] ?? 50) - actor.stats.acting;
    actor.aggro += 5 - actor.stats.stealth * 0.1;
    return suspectLine(actor, target);
  },

  defend(game, actor, target) {
    target.trust[actor.id] = (target.trust[actor.id] ?? 50) + actor.stats.logic;
    target.favor[actor.id] = (target.favor[actor.id] ?? 50) + actor.stats.acting;
    actor.aggro += 3;
    return defendLine(actor, target);
  }
};

