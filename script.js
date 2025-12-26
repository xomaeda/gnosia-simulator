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
    runTurn();
  }

  logLine("토론이 종료되었습니다.");
}

function runTurn() {
  const speaker = randomCharacter();
  let target = randomCharacter();

  while (target === speaker) {
    target = randomCharacter();
  }

  const actions = ["의심한다", "동조한다", "변호한다"];
  const action = actions[Math.floor(Math.random() * actions.length)];

applyRelationEffect(speaker, target, action);
logLine(`${speaker.name}가 ${target.name}를 ${action}.`);

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
