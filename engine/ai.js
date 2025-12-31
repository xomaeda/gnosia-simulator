import { hasStats } from "./commands.js";

function wRand(items) {
  const total = items.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it;
  }
  return items.at(-1) || null;
}

export function pickRootSpeaker(game) {
  const alive = game.aliveIdx();
  const candidates = [];

  for (const i of alive) {
    const c = game.characters[i];
    // speak probability affected by aggro and stealth
    const base = 1.0;
    const ag = game.aggro[i] ?? 0;
    const stealth = c.stats.stealth / 50;
    const speakPenalty = Math.max(0, (ag / 60) * (1 - stealth)); // more aggro => less likely to start
    const w = base * (1 - Math.min(0.75, speakPenalty)) + 0.05;
    candidates.push({ i, w });
  }

  const pick = wRand(candidates);
  return pick ? pick.i : alive[Math.floor(Math.random()*alive.length)];
}

export function pickRootCommand(game, speakerIdx) {
  const c = game.characters[speakerIdx];
  const allowed = game.allowedCommandsFor(c);

  // candidate root commands for day
  const roots = allowed.filter(x => x.phase === "day" && x.kind === "root");

  // weigh by personality, situation, role, discovered lies
  const scored = roots.map(cmd => {
    let w = 1;

    const p = c.personality;
    const isLogic = ["vote_for","vote_not","human_cert","enemy_cert","all_elim"].includes(cmd.id);
    const isSocial = ["chat","coop_day","cover"].includes(cmd.id);
    const isAggro = ["suspect","counterattack","counter"].includes(cmd.id);
    const isReveal = ["role_reveal","role_ask","human_say"].includes(cmd.id);

    if (isLogic) w *= 0.8 + p.logical * 1.2;
    if (isSocial) w *= 0.8 + (p.social + p.cheer) * 0.8 + p.kindness * 0.6;
    if (isAggro) w *= 0.7 + (1 - p.kindness) * 0.8;
    if (isReveal) w *= 0.7 + p.courage * 1.2;

    // high aggro reduces desire to start risky roots
    const ag = game.aggro[speakerIdx] ?? 0;
    if (["suspect","vote_for","enemy_cert","all_elim","human_say"].includes(cmd.id)) {
      w *= 1 - Math.min(0.55, ag/120);
    }

    // if speaker has detected lies, more likely to suspect / vote
    const mem = game.memory.lieDetectedBy[speakerIdx];
    if (mem && mem.size > 0) {
      if (["suspect","vote_for","enemy_cert"].includes(cmd.id)) w *= 1.6;
    }

    return { cmd, w };
  });

  const pick = wRand(scored);
  return pick?.cmd || roots[Math.floor(Math.random()*roots.length)];
}

export function pickTargetForRoot(game, speakerIdx, cmdId) {
  const alive = game.aliveIdx().filter(i => i !== speakerIdx);
  if (alive.length === 0) return null;

  // special: vote_not targets someone likely to be voted, vote_for targets suspicious, cover targets liked, etc.
  const scored = alive.map(t => {
    const trust = game.relations.trust[speakerIdx][t];
    const favor = game.relations.favor[speakerIdx][t];
    const susp = game.suspicion[t] ?? 50; // higher => more suspicious
    const ag = game.aggro[t] ?? 0;
    let w = 1;

    if (cmdId === "suspect") w = 0.4 + (susp/100) * 1.6 + ( (60 - trust)/60 ) * 0.8;
    else if (cmdId === "cover") w = 0.4 + (favor/100) * 1.6 + (trust/100) * 0.9;
    else if (cmdId === "vote_for") w = 0.5 + (susp/100)*1.8 + (ag/120);
    else if (cmdId === "vote_not") w = 0.6 + (favor/100)*1.2 + (trust/100)*1.0;
    else if (cmdId === "human_cert") w = 0.7 + (trust/100)*1.5;
    else if (cmdId === "enemy_cert") w = 0.7 + (susp/100)*2.0 + ((60-trust)/60);
    else if (cmdId === "coop_day") w = 0.8 + (favor/100)*1.7;
    else if (cmdId === "role_ask") w = 1.0;
    else if (cmdId === "all_elim") w = 1.0; // target may be role-group later
    else w = 1.0;

    // if already certified human, avoid attacking
    if (cmdId === "suspect" && game.flags.humanCertified.has(t)) w *= 0.05;
    // if enemy certified, avoid covering
    if (cmdId === "cover" && game.flags.enemyCertified.has(t)) w *= 0.05;

    return { t, w: Math.max(0, w) };
  });

  const pick = wRand(scored);
  return pick?.t ?? alive[Math.floor(Math.random()*alive.length)];
}

export function pickFollowUp(game, ctx) {
  // participants remaining
  const alive = game.aliveIdx();
  const remaining = alive.filter(i => !ctx.participants.has(i));
  if (remaining.length === 0) return null;

  // each remaining character decides either speak or silent
  const candidates = [];
  for (const i of remaining) {
    const c = game.characters[i];

    // "silence" probability (Q4): influenced by aggro & stealth
    const ag = game.aggro[i] ?? 0;
    const stealth = c.stats.stealth / 50;
    const speakBase = 0.55 + stealth*0.25 - Math.min(0.35, ag/180);

    if (Math.random() > speakBase) continue; // silent

    const cmd = pickBestFollowCommand(game, i, ctx);
    if (!cmd) continue;

    const w = 1; // already weighted inside
    candidates.push({ i, cmd, w });
  }

  if (candidates.length === 0) return null;
  const pick = wRand(candidates);
  return pick ? { speakerIdx: pick.i, cmd: pick.cmd } : null;
}

function pickBestFollowCommand(game, speakerIdx, ctx) {
  const c = game.characters[speakerIdx];
  const allowed = game.allowedCommandsFor(c).filter(x => x.phase==="day" && x.kind==="follow");

  // filter by context rules (implemented in game.canUseFollow)
  const possible = allowed.filter(x => game.canUseFollow(x, speakerIdx, ctx));

  if (possible.length === 0) return null;

  // score
  const scored = possible.map(cmd => {
    let w = 1;
    const p = c.personality;

    const root = ctx.rootCmdId;
    const target = ctx.rootTarget;

    // relation-based inclination
    if (target != null && target !== speakerIdx) {
      const favor = game.relations.favor[speakerIdx][target];
      const trust = game.relations.trust[speakerIdx][target];
      const susp = game.suspicion[target] ?? 50;

      if (["agree_sus","counter","join_counter","block_counter","loud"].includes(cmd.id)) {
        w *= 0.6 + (susp/100)*1.3 + ((60-trust)/60)*0.6;
      }
      if (["defend","join_def","join_cover","deny","sad"].includes(cmd.id)) {
        w *= 0.6 + (favor/100)*1.4 + (trust/100)*0.6 + p.kindness*0.6;
      }
      if (cmd.id === "ask_help" && speakerIdx === target) {
        w *= 1.2 + (p.cheer + p.social)*0.4;
      }
    }

    // personality
    const isLogic = ["counterattack","dont_fool","block_counter"].includes(cmd.id);
    if (isLogic) w *= 0.8 + p.logical*1.0;
    if (cmd.id === "sad") w *= 0.8 + (c.stats.charm/50)*1.2;
    if (cmd.id === "exaggerate") w *= 0.8 + (c.stats.acting/50)*1.2;
    if (cmd.id === "ask_agree") w *= 0.8 + (c.stats.charisma/50)*1.2;

    // if lies detected, increase dont_fool/counterattack against liar if relevant
    if (cmd.id === "dont_fool" && ctx.rootSpeaker != null) {
      const liars = game.memory.lieDetectedBy[speakerIdx];
      if (liars && liars.has(ctx.rootSpeaker)) w *= 1.8;
    }

    // high aggro discourages extra speaking unless defensive
    const ag = game.aggro[speakerIdx] ?? 0;
    if (!["deny","ask_help","sad","evade"].includes(cmd.id)) {
      w *= 1 - Math.min(0.35, ag/180);
    }

    return { cmd, w: Math.max(0.01, w) };
  });

  const pick = wRand(scored);
  return pick?.cmd ?? possible[Math.floor(Math.random()*possible.length)];
}

// ---- night free actions ----
export function pickNightFreeAction(game, actorIdx) {
  const c = game.characters[actorIdx];
  const p = c.personality;
  const allowedNight = game.allowedCommandsFor(c).filter(x => x.phase==="night");

  // options: alone, spend time with someone, request coop if allowed
  const candidates = [];

  // alone
  candidates.push({ type:"alone", w: 0.6 + (1 - p.social)*0.8 });

  // spend time with someone
  const others = game.aliveIdx().filter(i => i !== actorIdx);
  if (others.length > 0) {
    const tPick = pickByFavor(game, actorIdx, others);
    candidates.push({ type:"hang", target:tPick, w: 0.8 + p.social*1.2 + p.cheer*0.6 });
  }

  // night coop request (new command)
  const hasNightCoop = allowedNight.some(x => x.id === "night_coop");
  if (hasNightCoop) {
    const tPick = pickByFavor(game, actorIdx, others);
    candidates.push({ type:"night_coop", target:tPick, w: 0.6 + p.social*1.0 + (1 - p.desire)*0.4 });
  }

  const pick = wRand(candidates);
  return pick || { type:"alone" };
}

function pickByFavor(game, actorIdx, others) {
  const scored = others.map(t => {
    const f = game.relations.favor[actorIdx][t];
    return { t, w: 0.2 + f/100 };
  });
  const pick = wRand(scored);
  return pick?.t ?? others[Math.floor(Math.random()*others.length)];
}

