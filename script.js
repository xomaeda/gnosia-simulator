/***********************
 * 유틸
 ***********************/
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampFloat(value, min, max) {
  return Number(clamp(parseFloat(value), min, max).toFixed(2));
}

function getValue(id, min = 0, max = 50) {
  const el = document.getElementById(id);
  if (!el) return min;
  return clamp(parseInt(el.value || 0), min, max);
}

function getFloatValue(id, min = 0.01, max = 0.99) {
  const el = document.getElementById(id);
  if (!el) return 0.5;
  return clampFloat(el.value, min, max);
}

/***********************
 * 전역 상태
 ***********************/
let characters = [];
let dayCount = 1;

let gameStarted = false;
let gameOver = false;

/***********************
 * 로그
 ***********************/
function log(text) {
  const area = document.getElementById("logArea");
  area.innerText += text + "\n";
  area.scrollTop = area.scrollHeight;
}

/***********************
 * 캐릭터 추가
 ***********************/
function addCharacter() {
  const name = document.getElementById("charName").value.trim();
  const gender = document.getElementById("charGender").value;
  const age = document.getElementById("charAge").value;

  if (!name) {
    alert("이름을 입력해줘!");
    return;
  }

  const character = {
    name,
    gender,
    age,
    alive: true,
    role: "미정",
    status: {
      charisma: getValue("charisma"),
      logic: getValue("logic"),
      acting: getValue("acting"),
      cute: getValue("cute"),
      stealth: getValue("stealth"),
      intuition: getValue("intuition"),
    },
    personality: {
      cheerful: getFloatValue("cheerful"),
      social: getFloatValue("social"),
      logical: getFloatValue("logical"),
      kindness: getFloatValue("kindness"),
      desire: getFloatValue("desire"),
      courage: getFloatValue("courage"),
    }
  };

  characters.push(character);
  updateCharacterList();

  document.getElementById("charName").value = "";
  document.getElementById("charAge").value = "";
}

/***********************
 * 캐릭터 목록 표시
 ***********************/
function updateCharacterList() {
  const list = document.getElementById("characterList");
  list.innerHTML = "";

  characters.forEach((c, i) => {
    const div = document.createElement("div");
    div.innerText = `${i + 1}. ${c.name} (${c.alive ? "생존" : "사망"})`;
    list.appendChild(div);
  });
}

/***********************
 * 게임 시작
 ***********************/
function startGame() {
  if (characters.length < 5) {
    log("캐릭터가 최소 5명은 필요합니다.");
    return;
  }

  gameStarted = true;
  gameOver = false;
  dayCount = 1;

  assignRoles();

  log("================================");
  log("게임을 시작합니다.");
  log(`참가자 수: ${characters.length}`);
  log("================================");
}

/***********************
 * 역할 배정
 ***********************/
function assignRoles() {
  const alive = characters.filter(c => c.alive);

  // 기본 전원 인간
  alive.forEach(c => c.role = "인간");

  // 그노시아 수
  const gnosiaCount = parseInt(document.getElementById("gnosiaCount")?.value || 1);

  let pool = [...alive].sort(() => Math.random() - 0.5);
  pool.slice(0, gnosiaCount).forEach(c => c.role = "그노시아");

  log(`그노시아 ${gnosiaCount}명 배정 완료`);
}

/***********************
 * 승패 판정
 ***********************/
function checkWinCondition() {
  const alive = characters.filter(c => c.alive);
  const gnosia = alive.filter(c => c.role === "그노시아");
  const humans = alive.filter(c => c.role !== "그노시아");

  if (gnosia.length === 0) {
    log("✨ 인간 진영의 승리!");
    gameOver = true;
    return true;
  }

  if (gnosia.length >= humans.length) {
    log("💀 그노시아 진영의 승리!");
    gameOver = true;
    return true;
  }

  return false;
}

/***********************
 * 낮 토론
 ***********************/
function runDiscussion() {
  if (!gameStarted) {
    startGame();
  }

  if (gameOver) {
    log("이미 게임이 종료되었습니다.");
    return;
  }

  log(`\n☀️ Day ${dayCount} 토론 시작`);

  // 랜덤 투표
  const alive = characters.filter(c => c.alive);
  if (alive.length === 0) return;

  const victim = alive[Math.floor(Math.random() * alive.length)];
  victim.alive = false;

  log(`👉 ${victim.name} 이(가) 투표로 콜드슬립되었습니다.`);
  updateCharacterList();

  if (!checkWinCondition()) {
    dayCount++;
  }
}

/***********************
 * 밤 행동
 ***********************/
function runNight() {
  if (!gameStarted || gameOver) return;

  log("🌙 밤이 되었습니다.");

  const alive = characters.filter(c => c.alive);
  const gnosia = alive.filter(c => c.role === "그노시아");
  const humans = alive.filter(c => c.role !== "그노시아");

  if (gnosia.length === 0 || humans.length === 0) return;

  const target = humans[Math.floor(Math.random() * humans.length)];
  target.alive = false;

  log(`💀 ${target.name} 이(가) 그노시아에게 습격당했습니다.`);
  updateCharacterList();

  checkWinCondition();
}
