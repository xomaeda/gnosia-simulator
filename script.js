let gameOver = false;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampFloat(value, min, max) {
  return Number(clamp(parseFloat(value.toFixed(2)), min, max));
}


const characters = [];

function addCharacter() {
  const name = document.getElementById("charName").value;
  const gender = document.getElementById("charGender").value;
  const age = document.getElementById("charAge").value;

  if (!name) {
    alert("이름을 입력해줘");
    return;
  }

  const character = {
    name,
    gender,
    age,
    status: {
      charisma: getValue("charisma"),
      logic: getValue("logic"),
      acting: getValue("acting"),
      cute: getValue("cute"),
      stealth: getValue("stealth"),
      intuition: getValue("intuition")
    },
    personality: {
      cheerful: getValue("cheerful"),
      social: getValue("social"),
      logical: getValue("logical"),
      kindness: getValue("kindness"),
      desire: getValue("desire"),
      courage: getValue("courage")
    }
    trust: {},
    affinity: {}
    role: null,
    claimedRole: null
    alive: true


  };

  characters.push(character);
  initializeRelations();
  renderCharacterList();
}

function getValue(id) {
  const el = document.getElementById(id);
  const value = Number(el.value);

  // 성격 (0.01 ~ 0.99)
  if (el.step === "0.01") {
    return clampFloat(value, 0.01, 0.99);
  }

  // 스테이터스 (0 ~ 50)
  return clamp(value, 0, 50);
}


function renderCharacterList() {
  const list = document.getElementById("characterList");
  list.innerHTML = "";

  characters.forEach((c, i) => {
    const div = document.createElement("div");
    div.innerText = `${i + 1}. ${c.name} (${c.gender}, ${c.age})`;
    list.appendChild(div);
  });

  updateGnosiaSetting();
  updateRunAvailability();
}


function getMaxGnosiaCount() {
  const count = characters.length;

  if (count <= 6) return 1;
  if (count <= 8) return 2;
  if (count <= 10) return 3;
  if (count <= 12) return 4;
  if (count <= 14) return 5;
  return 6;
}

function updateGnosiaSetting() {
  const max = getMaxGnosiaCount();
  const input = document.getElementById("gnosiaCount");
  const info = document.getElementById("gnosiaInfo");

  input.max = max;

  if (Number(input.value) > max) {
    input.value = max;
  }

  info.innerText = `현재 인원 수: ${characters.length}명 / 그노시아 최대 ${max}명`;
}

assignRoles(getGameSettings());

function runDiscussion() {
  if (gameOver) {
  logLine("이미 게임이 종료되었습니다.");
  return;
}

  const log = document.getElementById("logArea");

  if (characters.length < 5) {
    log.innerText = "캐릭터가 5명 이상 필요합니다.";
    return;
  }

  log.innerText = "";
  logLine("낮 토론을 시작합니다.");

  for (let turn = 1; turn <= 5; turn++) {
    logLine(`--- ${turn}턴 ---`);
    runTurn(maybeClaimRole(speaker);
);
  }

  logLine("토론이 종료되었습니다.");
runVoting();

}

function runTurn() {
  const speaker = randomCharacter();

  if (!speaker.alive) return;

  let target = randomCharacter();

  while (target === speaker) {
    target = randomCharacter();
  }

const action = decideAction(speaker, target);

applyRelationEffect(speaker, target, action);
logLine(
  `${speaker.name}가 ${target.name}를 ${action}. ` +
  `(신뢰 ${speaker.trust[target.name].toFixed(2)}, ` +
  `우호 ${speaker.affinity[target.name].toFixed(2)})`
);


}

function randomCharacter() {
  const aliveChars = characters.filter(c => c.alive);
  return aliveChars[Math.floor(Math.random() * aliveChars.length)];
}


function logLine(text) {
  const log = document.getElementById("logArea");
  log.innerText += text + "\n";
  log.scrollTop = log.scrollHeight;
}

function updateRunAvailability() {
  const warning = document.getElementById("warningText");
  const button = document.getElementById("runButton");

  if (characters.length < 5) {
    warning.innerText = "캐릭터가 5명 이상 있어야 실행할 수 있습니다.";
    button.disabled = true;
  } else {
    warning.innerText = "";
    button.disabled = false;
  }
}

updateRunAvailability();

function initializeRelations() {
  characters.forEach(a => {
    characters.forEach(b => {
      if (a !== b) {
        a.trust[b.name] = randomRange(0.4, 0.6);
        a.affinity[b.name] = randomRange(0.4, 0.6);
      }
    });
  });
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function applyRelationEffect(speaker, target, action) {
  if (!speaker.trust[target.name]) return;

  if (action === "의심한다") {
    speaker.trust[target.name] -= 0.05;
    speaker.affinity[target.name] -= 0.03;
  }

  if (action === "동조한다") {
    speaker.trust[target.name] += 0.03;
    speaker.affinity[target.name] += 0.04;
  }

  if (action === "변호한다") {
    speaker.trust[target.name] += 0.05;
    speaker.affinity[target.name] += 0.06;
  }

  clampRelations(speaker, target.name);
}

function clampRelations(character, targetName) {
  character.trust[targetName] = Math.max(0, Math.min(1, character.trust[targetName]));
  character.affinity[targetName] = Math.max(0, Math.min(1, character.affinity[targetName]));
}

function decideAction(speaker, target) {
  const p = speaker.personality;
  const s = speaker.status;

  let weights = {
    "의심한다": 1,
    "동조한다": 1,
    "변호한다": 1
  };

  // 성격 영향
  weights["의심한다"] += p.logical * 2;
  weights["의심한다"] += p.desire * 1.5;

  weights["동조한다"] += p.social * 2;
  weights["동조한다"] += p.cheerful * 1.5;

  weights["변호한다"] += p.kindness * 3;

  // 스테이터스 영향 (0~50 → 0~1로 환산)
  weights["의심한다"] += (s.logic / 50);
  weights["동조한다"] += (s.charisma / 50);
  weights["변호한다"] += (s.acting / 50);

  return weightedRandom(weights);
}

function weightedRandom(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);

  let r = Math.random() * total;

  for (let [action, weight] of entries) {
    r -= weight;
    if (r <= 0) return action;
  }

  return entries[0][0];
}

function assignRoles(settings) {
  let roles = [];

  // 필수
  roles.push("그노시아");
  roles.push("선원");

  // 그노시아 수
  for (let i = 1; i < settings.gnosiaCount; i++) {
    roles.push("그노시아");
  }

  // 선택 직업
  if (settings.engineer) roles.push("엔지니어");
  if (settings.doctor) roles.push("닥터");
  if (settings.guardian) roles.push("수호천사");
  if (settings.acFollower) roles.push("AC주의자");
  if (settings.bug) roles.push("버그");

  // 나머지는 선원
  while (roles.length < characters.length) {
    roles.push("선원");
  }

  shuffleArray(roles);

  characters.forEach((c, i) => {
    c.role = roles[i];
    c.claimedRole = null;
  });
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function maybeClaimRole(character) {
  if (character.claimedRole) return;

  const p = character.personality;
  let chance = p.courage;

  if (character.role === "그노시아" || character.role === "AC주의자") {
    chance += p.desire;
  }

  if (Math.random() > chance) return;

  let claim;

  if (character.role === "그노시아") {
    const fakeRoles = ["엔지니어", "닥터"];
    claim = fakeRoles[Math.floor(Math.random() * fakeRoles.length)];
  } else {
    claim = character.role;
  }

  character.claimedRole = claim;
  logLine(`${character.name}가 자신의 역할이 '${claim}'라고 밝혔다.`);
}

function runVoting() {
  logLine("투표를 시작합니다.");

  const votes = {};

  characters.forEach(c => {
    if (!c.alive) return;

    const target = decideVoteTarget(c);
    if (!target) return;

    votes[target.name] = (votes[target.name] || 0) + 1;
    logLine(`${c.name} → ${target.name} 에게 투표`);
  });

  resolveVoting(votes);
}
function decideVoteTarget(voter) {
  let candidates = characters.filter(c => c.alive && c !== voter);

  if (candidates.length === 0) return null;

  let weights = [];

  candidates.forEach(target => {
    let trust = voter.trust[target.name] ?? 0.5;
    let affinity = voter.affinity[target.name] ?? 0.5;

    let suspicion = (1 - trust) + (1 - affinity);

    if (target.claimedRole) {
      suspicion += 0.3;
    }

    weights.push({
      target,
      weight: Math.max(0.01, suspicion)
    });
  });

  return weightedRandomTarget(weights);
}
function weightedRandomTarget(list) {
  const total = list.reduce((sum, o) => sum + o.weight, 0);
  let r = Math.random() * total;

  for (let o of list) {
    r -= o.weight;
    if (r <= 0) return o.target;
  }

  return list[0].target;
}
function resolveVoting(votes) {
  let maxVotes = 0;
  let executed = null;

  for (let name in votes) {
    if (votes[name] > maxVotes) {
      maxVotes = votes[name];
      executed = name;
    }
  }

  if (!executed) {
    logLine("아무도 콜드슬립되지 않았다.");
    return;
    checkWinCondition();

  }

  const target = characters.find(c => c.name === executed);
  target.alive = false;

  logLine(`🧊 ${target.name}가 콜드슬립되었다. (${maxVotes}표)`);

  if (target.role === "그노시아") {
    logLine(`⚠️ ${target.name}는 그노시아였다.`);
  } else {
    logLine(`${target.name}는 그노시아가 아니었다.`);
  }
}

function runNight() {
  if (gameOver) {
  logLine("이미 게임이 종료되었습니다.");
  return;
}

  logLine("🌙 밤이 되었습니다.");

  runEngineerCheck();
  runDoctorCheck();
  runGnosiaAttack();

  logLine("🌅 밤이 끝났습니다.");
}

function runEngineerCheck() {
  const engineers = characters.filter(
    c => c.alive && c.role === "엔지니어"
  );

  if (engineers.length === 0) return;

  const engineer = engineers[0];
  const targets = characters.filter(c => c.alive && c !== engineer);

  if (targets.length === 0) return;

  const target = targets[Math.floor(Math.random() * targets.length)];
  const result = target.role === "그노시아" ? "그노시아" : "인간";

  engineer.lastCheck = {
    target: target.name,
    result
  };

  logLine(`🔍 ${engineer.name}가 누군가를 검사했다.`);
}

function runDoctorCheck() {
  const doctors = characters.filter(
    c => c.alive && c.role === "닥터"
  );

  if (doctors.length === 0) return;

  const doctor = doctors[0];
  const corpses = characters.filter(
    c => !c.alive && !c.examined
  );

  if (corpses.length === 0) return;

  const target = corpses[0];
  target.examined = true;

  doctor.lastAutopsy = {
    target: target.name,
    role: target.role
  };

  logLine(`🧪 ${doctor.name}가 콜드슬립된 인물을 조사했다.`);
}

function runGnosiaAttack() {
  const gnosias = characters.filter(
    c => c.alive && c.role === "그노시아"
  );

  if (gnosias.length === 0) return;

  const targets = characters.filter(
    c => c.alive && c.role !== "그노시아"
  );

  if (targets.length === 0) return;

  const victim = targets[Math.floor(Math.random() * targets.length)];
  victim.alive = false;
  victim.killedAtNight = true;

  logLine(`💀 ${victim.name}가 밤 사이에 사라졌다.`);
}

function checkWinCondition() {
  if (gameOver) return;

  const alive = characters.filter(c => c.alive);
  const aliveGnosia = alive.filter(c => c.role === "그노시아");
  const aliveHumans = alive.filter(c => c.role !== "그노시아");

  // 인간 승리
  if (aliveGnosia.length === 0) {
    logLine("🎉 인간 진영의 승리!");
    gameOver = true;
    return;
  }

  // 그노시아 승리
  if (aliveGnosia.length >= aliveHumans.length) {
    logLine("☠️ 그노시아 진영의 승리!");
    gameOver = true;
    return;
  }
}
