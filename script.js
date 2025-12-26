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
  return characters[Math.floor(Math.random() * characters.length)];
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
