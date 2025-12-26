/**********************
 * 전역 상태
 **********************/
let characters = [];
let gameStarted = false;
let gameOver = false;
let dayCount = 1;
let phaseCount = 0;

/**********************
 * 유틸
 **********************/
function log(text) {
  const logArea = document.getElementById("logArea");
  logArea.innerText += text + "\n";
  logArea.scrollTop = logArea.scrollHeight;
}

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**********************
 * 캐릭터 생성
 **********************/
function addCharacter() {
  const name = charName.value.trim();
  if (!name) return alert("이름을 입력해줘");

  const character = {
    name,
    gender: charGender.value,
    age: charAge.value,
    alive: true,

    status: {
      charisma: +charisma.value,
      logic: +logic.value,
      acting: +acting.value
    },

    personality: {
      courage: +courage.value,
      desire: +desire.value
    },

    role: null,
    claimedRole: null,

    suspicion: 0.5,
    trust: {}
  };

  characters.push(character);
  renderCharacterList();
}

/**********************
 * 렌더
 **********************/
function renderCharacterList() {
  const list = document.getElementById("characterList");
  list.innerHTML = "";
  characters.forEach((c, i) => {
    const d = document.createElement("div");
    d.innerText = `${i + 1}. ${c.name}${c.alive ? "" : " 💀"}`;
    list.appendChild(d);
  });

  updateRunAvailability();
}

function updateRunAvailability() {
  runButton.disabled = characters.length < 5;
  warningText.innerText =
    characters.length < 5 ? "캐릭터는 최소 5명 필요합니다." : "";
}

/**********************
 * 게임 시작
 **********************/
function startGame() {
  if (characters.length < 5) {
    log("❗ 캐릭터가 최소 5명 필요합니다.");
    return;
  }

  gameStarted = true;
  gameOver = false;
  dayCount = 1;
  phaseCount = 0;

  assignRoles();
  initTrust();

  log("================================");
  log("게임 시작");
  log("================================");
}

/**********************
 * 역할 배정
 **********************/
function assignRoles() {
  const gnosiaCount = 1;
  let roles = ["그노시아"];
  while (roles.length < characters.length) roles.push("선원");

  roles.sort(() => Math.random() - 0.5);
  characters.forEach((c, i) => (c.role = roles[i]));
}

/**********************
 * 관계 초기화
 **********************/
function initTrust() {
  characters.forEach(a => {
    characters.forEach(b => {
      if (a !== b) a.trust[b.name] = 0.5;
    });
  });
}

/**********************
 * 낮 토론
 **********************/
function runDiscussion() {
  if (!gameStarted) startGame();
  if (gameOver) return log("이미 종료됨");

  log(`\n☀️ Day ${dayCount} 토론`);

  // CO 시도
  characters.forEach(c => tryClaimRole(c));

  // 투표
  runVoting();

  phaseCount++;
  if (phaseCount >= 2 && checkWin()) return;

  dayCount++;
}

/**********************
 * 역할 CO
 **********************/
function tryClaimRole(c) {
  if (!c.alive || c.claimedRole) return;

  const chance = c.personality.courage + c.personality.desire * 0.5;
  if (Math.random() > chance) return;

  if (c.role === "그노시아") {
    c.claimedRole = "선원"; // 거짓 CO
    log(`🗣 ${c.name}: 나는 선원이다`);
  } else {
    c.claimedRole = c.role;
    log(`🗣 ${c.name}: 나는 ${c.role}다`);
  }
}

/**********************
 * 투표 (의심 기반)
 **********************/
function runVoting() {
  let votes = {};

  characters.forEach(voter => {
    if (!voter.alive) return;

    const targets = characters.filter(
      c => c.alive && c !== voter
    );

    let choice = weightedPick(targets.map(t => ({
      target: t,
      weight: t.suspicion
    })));

    votes[choice.name] = (votes[choice.name] || 0) + 1;
    log(`${voter.name} → ${choice.name}`);
  });

  resolveVote(votes);
}

function weightedPick(list) {
  const total = list.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (let o of list) {
    r -= o.weight;
    if (r <= 0) return o.target;
  }
  return list[0].target;
}

/**********************
 * 투표 처리
 **********************/
function resolveVote(votes) {
  let max = 0, victim = null;
  for (let name in votes) {
    if (votes[name] > max) {
      max = votes[name];
      victim = name;
    }
  }

  const target = characters.find(c => c.name === victim);
  target.alive = false;
  log(`🧊 ${target.name} 콜드슬립`);

  characters.forEach(c => {
    if (c.alive)
      c.suspicion += target.role === "그노시아" ? -0.05 : 0.05;
  });

  renderCharacterList();
}

/**********************
 * 밤
 **********************/
function runNight() {
  if (gameOver) return;

  log("\n🌙 밤");

  const gnosia = characters.filter(c => c.alive && c.role === "그노시아");
  const humans = characters.filter(c => c.alive && c.role !== "그노시아");

  if (gnosia.length === 0 || humans.length === 0) return;

  const victim = random(humans);
  victim.alive = false;
  log(`💀 ${victim.name} 습격당함`);

  renderCharacterList();
  phaseCount++;

  if (phaseCount >= 2) checkWin();
}

/**********************
 * 승리 판정
 **********************/
function checkWin() {
  const alive = characters.filter(c => c.alive);
  const g = alive.filter(c => c.role === "그노시아");
  const h = alive.filter(c => c.role !== "그노시아");

  if (g.length === 0) {
    log("🎉 인간 진영 승리");
    gameOver = true;
    return true;
  }

  if (g.length >= h.length) {
    log("☠️ 그노시아 승리");
    gameOver = true;
    return true;
  }

  return false;
}
