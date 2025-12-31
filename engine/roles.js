// role assignment + night actions

export const ROLES = {
  CREW: "선원",
  GNOSIA: "그노시아",
  ENGINEER: "엔지니어",
  DOCTOR: "닥터",
  GUARDIAN: "수호천사",
  WAIT: "선내대기인",
  AC: "AC주의자",
  BUG: "버그",
};

export function assignRoles(chars, settings) {
  const n = chars.length;
  const roles = Array(n).fill(ROLES.CREW);

  // place gnosia
  const g = settings.gnosiaCount;
  pickN(n, g).forEach(i => roles[i] = ROLES.GNOSIA);

  // waiters must be 2 and cannot be gnosia/ac/bug
  if (settings.enabled.wait) {
    const eligible = idxs(n).filter(i => roles[i] === ROLES.CREW);
    const picked = pickFromList(eligible, 2);
    if (picked.length === 2) {
      roles[picked[0]] = ROLES.WAIT;
      roles[picked[1]] = ROLES.WAIT;
    }
  }

  // bug (cannot be gnosia)
  if (settings.enabled.bug) {
    const eligible = idxs(n).filter(i => roles[i] === ROLES.CREW);
    if (eligible.length) roles[pickOne(eligible)] = ROLES.BUG;
  }

  // ac (cannot be gnosia; can be crew-ish)
  if (settings.enabled.ac) {
    const eligible = idxs(n).filter(i => roles[i] === ROLES.CREW);
    if (eligible.length) roles[pickOne(eligible)] = ROLES.AC;
  }

  // engineer/doctor/guardian each 1 if enabled; cannot be gnosia/bug; can be AC? 기획상 AC는 사칭 가능이므로 실제 역할로는 엔/닥이 아니어야 안정적이라 여기서는 "AC는 별도" 유지
  if (settings.enabled.engineer) setUniqueRole(roles, ROLES.ENGINEER);
  if (settings.enabled.doctor) setUniqueRole(roles, ROLES.DOCTOR);
  if (settings.enabled.guardian) setUniqueRole(roles, ROLES.GUARDIAN);

  // apply to characters
  for (let i=0;i<n;i++) chars[i].role = roles[i];

  return roles;
}

function setUniqueRole(roles, roleName){
  const eligible = roles.map((r,i)=>({r,i})).filter(x => x.r === ROLES.CREW).map(x=>x.i);
  if (!eligible.length) return;
  roles[pickOne(eligible)] = roleName;
}

function idxs(n){ return Array.from({length:n},(_,i)=>i); }

function pickOne(list){ return list[Math.floor(Math.random()*list.length)]; }

function pickFromList(list, k){
  const arr = list.slice();
  const out = [];
  while(arr.length && out.length<k){
    const i = Math.floor(Math.random()*arr.length);
    out.push(arr.splice(i,1)[0]);
  }
  return out;
}
function pickN(n,k){
  return pickFromList(idxs(n), k);
}

// ---- night decision helpers ----
export function pickEngineerTarget(game, engIdx){
  const alive = game.aliveIdx().filter(i => i !== engIdx);
  // bias to suspicious
  let best = null;
  for (const t of alive){
    const w = (game.suspicion[t] ?? 50) + (game.aggro[t] ?? 0);
    if (!best || w > best.w) best = {t,w};
  }
  return best?.t ?? alive[Math.floor(Math.random()*alive.length)];
}

export function pickGuardianTarget(game, gIdx){
  const alive = game.aliveIdx().filter(i => i !== gIdx);
  // protect liked/trusted
  let best = null;
  for (const t of alive){
    const w = game.relations.favor[gIdx][t] + game.relations.trust[gIdx][t];
    if (!best || w > best.w) best = {t,w};
  }
  return best?.t ?? alive[Math.floor(Math.random()*alive.length)];
}

export function pickGnosiaTarget(game, gnosiaIdxs){
  const alive = game.aliveIdx();
  const victims = alive.filter(i => !gnosiaIdxs.includes(i)); // cannot kill gnosia
  if (!victims.length) return null;

  // pick by dislike/suspicion/aggro (their personality influences target: desire/kindness etc via their own stats handled in game)
  // Here, combine all gnosia opinions.
  const scores = victims.map(v => {
    let w = 0;
    for (const g of gnosiaIdxs){
      const favor = game.relations.favor[g][v];
      const trust = game.relations.trust[g][v];
      const susp = game.suspicion[v] ?? 50;
      const ag = game.aggro[v] ?? 0;
      // gnosia prefer: disliked + suspicious + loud
      w += (60 - favor) + (60 - trust) + susp*0.7 + ag*0.4;
    }
    return { v, w: Math.max(1, w) };
  });

  // weighted random
  const total = scores.reduce((s,x)=>s+x.w,0);
  let r = Math.random()*total;
  for (const s of scores){
    r -= s.w;
    if (r<=0) return s.v;
  }
  return scores.at(-1).v;
}

