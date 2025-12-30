// ==============================
// 전역 데이터
// ==============================

const characters = [];
const MIN_CHARACTERS = 5;

let phase = "setup";   // setup | day | vote | night
let dayCount = 1;
let turnCount = 0;
const MAX_TURNS = 5;

let nightStep = 0;

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

function aliveChars() {
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
    li.textContent = `${i + 1}. ${c.name} ${c.alive ? "" : "(사망)"}`;
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
    return;
  }

  if (phase === "day") {
    runDayTurn();
    return;
  }

  if (phase === "vote") {
    runVote();
    return;
  }

  if (phase === "night") {
    runNight();
    return;
  }
};

// ==============================
// 낮 턴
// ==============================

function runDayTurn() {
  turnCount++;
  log(`\n[낮 ${dayCount}일차 - ${turnCount}턴]`);

  const speaker = randomFrom(aliveChars());
  const command = chooseCommand(speaker);

  executeCommand(speaker, command);

  if (turnCount >= MAX_TURNS) {
    phase = "vote";
    log(`\n=== 투표 시간 ===`);
  }
}

// ==============================
// 커맨드 (임시)
// ==============================

function chooseCommand(speaker) {
  const cmds = ["의심", "감싸기"];

  if (speaker.personality.logical > 25) cmds.push("논리정리");
  if (speaker.personality.cheer > 25) cmds.push("분위기메이커");

  return randomFrom(cmds);
}

function executeCommand(speaker, command) {
  const targets = aliveChars().filter(c => c !== speaker);
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
      log(`${speaker.name} 가 논리적인 발언을 했다.`);
      speaker.aggro += 1;
      break;

    case "분위기메이커":
      log(`${speaker.name} 가 분위기를 누그러뜨렸다.`);
      speaker.aggro = Math.max(0, speaker.aggro - 1);
      break;
  }
}

// ==============================
// 🗳 투표 시스템
// ==============================

function runVote() {
  const votes = {};

  aliveChars().forEach(voter => {
    const targets = aliveChars().filter(c => c !== voter);

    let bestScore = -Infinity;
    let chosen = null;

    targets.forEach(t => {
      let score = 0;
      score += t.suspicion * 2;
      score += t.aggro;
      score -= voter.favor[t.name] || 0;
      score -= voter.trust[t.name] || 0;
      score += Math.random() * 3; // 랜덤성

      if (score > bestScore) {
        bestScore = score;
        chosen = t;
      }
    });

    if (chosen) {
      votes[chosen.name] = (votes[chosen.name] || 0) + 1;
      log(`${voter.name} → ${chosen.name} 에 투표`);
    }
  });

  let max = 0;
  let candidates = [];

  for (const name in votes) {
    if (votes[name] > max) {
      max = votes[name];
      candidates = [name];
    } else if (votes[name] === max) {
      candidates.push(name);
    }
  }

  const eliminatedName = randomFrom(candidates);
  const eliminated = characters.find(c => c.name === eliminatedName);
  eliminated.alive = false;

  log(`\n🧊 ${eliminated.name} 가 콜드슬립 되었다.`);

  updateCharacterList();

  phase = "night";
  nightStep = 0;
  log(`\n=== 밤이 되었습니다 ===`);
}

// ==============================
// 🌙 밤 시스템
// ==============================

function runNight() {

  if (nightStep === 0) {
    log(`\n[밤 ${dayCount}일차 – 자유행동]`);
    aliveChars().forEach(c => {
      log(`${c.name} 는 조용히 밤을 보냈다.`);
    });
    nightStep = 1;
    log(`\n(버튼을 다시 누르면 밤이 끝납니다)`);
    return;
  }

  if (nightStep === 1) {
    log(`\n[밤 ${dayCount}일차 – 습격 발생]`);

    const victims = aliveChars();
    if (victims.length > 0) {
      const victim = randomFrom(victims);
      victim.alive = false;
      log(`${victim.name} 가 밤 사이에 사망했다.`);
    }

    updateCharacterList();

    dayCount++;
    phase = "day";
    turnCount = 0;
    nightStep = 0;

    log(`\n=== ${dayCount}일차 낮 시작 ===`);
  }
}
