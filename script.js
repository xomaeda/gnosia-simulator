let gameOver = false;

/* =========================
   유틸
========================= */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampFloat(value, min, max) {
  return Number(clamp(parseFloat(value.toFixed(2)), min, max));
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

/* =========================
   캐릭터 관리
========================= */
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
    },
    trust: {},
    affinity: {},
    role: null,
    claimedRole: null,
    alive: true
  };

  characters.push(character);
  initializeRelations();
  renderCharacterList();
}

function getValue(id) {
  const el = document.getElementById(id);
  const value = Number(el.value);

  if (el.step === "0.01") {
    return clampFloat(value, 0.01, 0.99);
  }
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

  updateRunAvailability();
}

/* =========================
   관계도
========================= */
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

function clampRelations(character, targetName) {
  character.trust[targetName] = clamp(character.trust[targetName], 0, 1);
  character.affinity[targetName] = clamp(character.affinity[targetName], 0, 1);
}

/* =========================
   로그
========================= */
function logLine(text) {
  const log = document.getElementById("logArea");
  log.innerText += text + "\n";
  log.scrollTop = log.scrollHeight;
}

/* =========================
   게임 설정
========================= */
function getGameSettings() {
  return {
    gnosiaCount: 1,
    engineer: document.getElementById("roleEngineer")?.checked ?? true,
    doctor: document.getElementById("roleDoctor")?.checked ?? true,
    guardian: document.getElementById("roleGuardian")?.checked ?? false,
    acFollower: document.getElementById("roleAC")?.checked ?? false,
    bug: false
  };
}

/* =========================
   역할 배정
========================= */
function assignRoles(settings) {
  let roles = [];

  for (let i = 0; i < settings.gnosiaCount; i++) {
    roles.push("그노시아");
  }

  if (settings.engineer) roles.push("엔지니어");
  if (settings.doctor) roles.push("닥터");
  if (settings.guardian) roles.push("수호천사");
  if (settings.acFollower) roles.push("AC주의자");
  if (settings.bug) roles.push("버그");

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

/* =========================
   낮 토론
========================= */
function runDiscussion() {
  if (gameOver) {
    logLine("이미 게임이 종료되었습니다.");
    return;
  }

  if (characters.length < 5) {
    logLine("캐릭터가 5명 이상 필요합니다.");
    return;
  }

  gameOver = false;
  document.getElementById("logArea").innerText = "";

  assignRoles(getGameSettings());

  logLine("☀️ 낮 토론을 시작합니다.");

  for (let turn = 1; turn <= 5; turn++) {
    logLine(`--- ${turn}턴 ---`);
    runTurn();
  }

  logLine("토론이 종료되었습니다.");
  runVoting();
  checkWinCondition();
}

function runTurn() {
  const speaker = randomCharacter();
  if (!speaker) return;

  const target = randomCharacter(speaker);
  const action = decideAction(speaker);

  applyRelationEffect(speaker, target, action);

  logLine(`${speaker.name}가 ${target.name}를 ${action}`);
}

function randomCharacter(except = null) {
  const alive = characters.filter(c => c.alive && c !== except);
  if (alive.length === 0) return null;
  return alive[Math.floor(Math.random() * alive.length)];
}

/* =========================
   행동 결정
========================= */
function decideAction(speaker) {
  const p = speaker.personality;

  const weights = {
    "의심한다": 1 + p.logical * 2 + p.desire,
    "동조한다": 1 + p.social * 2 + p.cheerful,
    "변호한다": 1 + p.kindness * 3
  };

  return weightedRandom(weights);
}

function weightedRandom(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;

  for (let k in weights) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
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

/* =========================
   투표
========================= */
function runVoting() {
  logLine("🗳️ 투표를 시작합니다.");

  const votes = {};

  characters.forEach(c => {
    if (!c.alive) return;
    const target = randomCharacter(c);
    if (!target) return;

    votes[target.name] = (votes[target.name] || 0) + 1;
    logLine(`${c.name} → ${target.name}`);
  });

  resolveVoting(votes);
}

function resolveVoting(votes) {
  let max = 0;
  let executed = null;

  for (let name in votes) {
    if (votes[name] > max) {
      max = votes[name];
      executed = name;
    }
  }

  if (!executed) return;

  const target = characters.find(c => c.name === executed);
  target.alive = false;

  logLine(`🧊 ${target.name}가 콜드슬립되었다.`);

  if (target.role === "그노시아") {
    logLine(`⚠️ ${target.name}는 그노시아였다.`);
  } else {
    logLine(`${target.name}는 인간이었다.`);
  }
}

/* =========================
   밤
========================= */
function runNight() {
  if (gameOver) return;

  logLine("🌙 밤이 되었습니다.");

  const gnosias = characters.filter(c => c.alive && c.role === "그노시아");
  const targets = characters.filter(c => c.alive && c.role !== "그노시아");

  if (gnosias.length && targets.length) {
    const victim = targets[Math.floor(Math.random() * targets.length)];
    victim.alive = false;
    logLine(`💀 ${victim.name}가 밤에 사라졌다.`);
  }

  checkWinCondition();
}

/* =========================
   승리 조건
========================= */
function checkWinCondition() {
  const alive = characters.filter(c => c.alive);
  const g = alive.filter(c => c.role === "그노시아");
  const h = alive.filter(c => c.role !== "그노시아");

  if (g.length === 0) {
    logLine("🎉 인간 진영의 승리!");
    gameOver = true;
  } else if (g.length >= h.length) {
    logLine("☠️ 그노시아 진영의 승리!");
    gameOver = true;
  }
}

/* =========================
   버튼 상태
========================= */
function updateRunAvailability() {
  const btn = document.getElementById("runButton");
  const warn = document.getElementById("warningText");

  if (characters.length < 5) {
    btn.disabled = true;
    warn.innerText = "캐릭터가 5명 이상 필요합니다.";
  } else {
    btn.disabled = false;
    warn.innerText = "";
  }
}
