// ==============================
// 전역 데이터
// ==============================

const characters = [];
const MIN_CHARACTERS = 5;

let phase = "setup";     // setup | day | night
let dayCount = 1;
let turnCount = 0;
const MAX_TURNS = 5;

// ==============================
// DOM
// ==============================

const addCharBtn = document.getElementById("addChar");
const runBtn = document.getElementById("runBtn");
const charList = document.getElementById("charList");
const logBox = document.getElementById("log");

// ==============================
// 유틸
// ==============================

function log(text) {
  logBox.innerText += text + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

function getValue(id) {
  return Number(document.getElementById(id).value) || 0;
}

function randomAlive() {
  return characters.filter(c => c.alive);
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ==============================
// 캐릭터 생성
// ==============================

addCharBtn.addEventListener("click", () => {
  const name = document.getElementById("name").value.trim();
  if (!name) return alert("이름을 입력하세요");

  const c = {
    name,
    gender: document.getElementById("gender").value,
    age: getValue("age"),

    status: {
      charisma: getValue("charisma"),
      logic: getValue("logic"),
      acting: getValue("acting"),
      charm: getValue("charm"),
      stealth: getValue("stealth"),
      intuition: getValue("intuition")
    },

    personality: {
      cheer: getValue("cheer"),
      social: getValue("social"),
      logical: getValue("logical"),
      kindness: getValue("kindness"),
      desire: getValue("desire"),
      courage: getValue("courage")
    },

    trust: {},
    favor: {},
    suspicion: 0,
    aggro: 0,
    alive: true,
    role: null
  };

  characters.forEach(o => {
    c.trust[o.name] = 0;
    c.favor[o.name] = 0;
    o.trust[c.name] = 0;
    o.favor[c.name] = 0;
  });

  characters.push(c);
  updateCharacterList();
  log(`캐릭터 추가: ${c.name}`);

  if (characters.length >= MIN_CHARACTERS) {
    runBtn.disabled = false;
  }
});

// ==============================
// 목록
// ==============================

function updateCharacterList() {
  charList.innerHTML = "";
  characters.forEach((c, i) => {
    const li = document.createElement("li");
    li.textContent = `${i + 1}. ${c.name}`;
    charList.appendChild(li);
  });
}

// ==============================
// 실행 버튼
// ==============================

window.runSimulation = function () {

  if (phase === "setup") {
    phase = "day";
    turnCount = 0;
    log(`\n=== ${dayCount}일차 낮 시작 ===`);
  }

  if (phase === "day") {
    runDayTurn();
  }
};

// ==============================
// 낮 턴
// ==============================

function runDayTurn() {
  turnCount++;
  log(`\n[낮 ${dayCount}일차 - ${turnCount}턴]`);

  const speaker = randomFrom(randomAlive());
  const command = chooseCommand(speaker);

  executeCommand(speaker, command);

  if (turnCount >= MAX_TURNS) {
    phase = "night";
    turnCount = 0;
    log(`\n=== 낮 종료 → 밤이 되었습니다 ===`);
  }
}

// ==============================
// 커맨드 선택 (성향 기반)
// ==============================

function chooseCommand(speaker) {
  const cmds = [];

  cmds.push("의심");
  cmds.push("감싸기");

  if (speaker.personality.cheer > 25) cmds.push("분위기메이커");
  if (speaker.personality.logical > 25) cmds.push("논리정리");

  return randomFrom(cmds);
}

// ==============================
// 커맨드 실행
// ==============================

function executeCommand(speaker, command) {

  const targets = randomAlive().filter(c => c !== speaker);
  if (targets.length === 0) return;

  const target = randomFrom(targets);

  switch (command) {

    case "의심":
      log(`${speaker.name} → ${target.name} 를 의심했다.`);
      target.suspicion += 2;
      speaker.aggro += 2;
      break;

    case "감싸기":
      log(`${speaker.name} → ${target.name} 를 감쌌다.`);
      speaker.favor[target.name] += 2;
      speaker.aggro += 1;
      break;

    case "논리정리":
      log(`${speaker.name} 가 논리적으로 상황을 정리했다.`);
      speaker.aggro += 1;
      break;

    case "분위기메이커":
      log(`${speaker.name} 가 분위기를 부드럽게 만들었다.`);
      speaker.aggro -= 1;
      break;

    default:
      log(`${speaker.name} 가 아무 말도 하지 않았다.`);
      speaker.aggro += 1;
  }
}
