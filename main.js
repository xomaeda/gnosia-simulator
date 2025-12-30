/***********************
 * 기본 데이터
 ***********************/
const characters = [];
let phase = "day";
let turnCount = 0;

/***********************
 * 토론 상태
 ***********************/
let discussionState = {
  type: null,          // "의심" | "변호" | null
  target: null,
  supporters: [],
  attackers: []
};

/***********************
 * 로그
 ***********************/
const logBox = document.getElementById("log");
function addLog(text) {
  const div = document.createElement("div");
  div.textContent = text;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

/***********************
 * 캐릭터 생성
 ***********************/
document.getElementById("addChar").onclick = () => {
  const c = {
    name: name.value,
    gender: gender.value,
    age: Number(age.value),
    status: {
      charisma: Number(charisma.value),
      logic: Number(logic.value),
      acting: Number(acting.value),
      charm: Number(charm.value),
      stealth: Number(stealth.value),
      intuition: Number(intuition.value)
    },
    personality: {
      cheer: Number(cheer.value),
      social: Number(social.value),
      logical: Number(logical.value),
      kindness: Number(kindness.value),
      desire: Number(desire.value),
      courage: Number(courage.value)
    },
    trust: {},
    favor: {},
    aggro: 0
  };

  characters.forEach(o => {
    c.trust[o.name] = 0;
    c.favor[o.name] = 0;
    o.trust[c.name] = 0;
    o.favor[c.name] = 0;
  });

  characters.push(c);
  updateCharList();

  if (characters.length >= 5) {
    runBtn.disabled = false;
  }
};

/***********************
 * 캐릭터 목록
 ***********************/
function updateCharList() {
  charList.innerHTML = "";
  characters.forEach(c => {
    const li = document.createElement("li");
    li.textContent = c.name;
    charList.appendChild(li);
  });
}

/***********************
 * 커맨드 정의
 ***********************/
const COMMANDS = {

  "의심한다": {
    canUse: () => discussionState.type === null,
    effect: (user, target) => {
      discussionState = {
        type: "의심",
        target,
        supporters: [],
        attackers: [user]
      };
      user.aggro += 2;
      addLog(`${user.name}: ${target.name}는 수상해.`);
    }
  },

  "의심에 동의한다": {
    canUse: () => discussionState.type === "의심",
    effect: (user) => {
      discussionState.attackers.push(user);
      user.aggro += 1;
      addLog(`${user.name}: 나도 의심돼.`);
    }
  },

  "부정한다": {
    canUse: (user) => discussionState.type === "의심" && discussionState.target === user,
    effect: (user) => {
      discussionState = { type: null, target: null, supporters: [], attackers: [] };
      user.aggro -= 1;
      addLog(`${user.name}: 그건 오해야.`);
    }
  },

  /* ===== 변호 계열 ===== */

  "변호한다": {
    canUse: () => discussionState.type === "의심",
    effect: (user) => {
      discussionState.type = "변호";
      discussionState.supporters.push(user);
      user.aggro += 2;
      addLog(`${user.name}: ${discussionState.target.name}는 아니야.`);
    }
  },

  "변호에 가담한다": {
    canUse: () => discussionState.type === "변호",
    effect: (user) => {
      discussionState.supporters.push(user);
      user.aggro += 1;
      addLog(`${user.name}: 나도 그렇게 생각해.`);
    }
  },

  "반론한다": {
    canUse: () => discussionState.type === "변호",
    effect: (user) => {
      discussionState.type = "의심";
      discussionState.attackers.push(user);
      user.aggro += 2;
      addLog(`${user.name}: 그래도 수상한 건 사실이야.`);
    }
  }
};

/***********************
 * 커맨드 실행
 ***********************/
function executeCommand(user, command, target = null) {
  if (!COMMANDS[command]) return;
  if (!COMMANDS[command].canUse(user)) return;
  COMMANDS[command].effect(user, target);
}

/***********************
 * 턴 진행
 ***********************/
function runTurn() {
  addLog(`--- 낮 / 턴 ${turnCount + 1} ---`);
  turnCount++;

  const user = characters[Math.floor(Math.random() * characters.length)];
  const others = characters.filter(c => c !== user);
  const target = others[Math.floor(Math.random() * others.length)];

  if (!discussionState.type) {
    executeCommand(user, "의심한다", target);
  } else if (discussionState.type === "의심") {
    Math.random() < 0.4
      ? executeCommand(user, "의심에 동의한다")
      : executeCommand(user, "변호한다");
  } else if (discussionState.type === "변호") {
    Math.random() < 0.5
      ? executeCommand(user, "변호에 가담한다")
      : executeCommand(user, "반론한다");
  }

  if (turnCount >= 5) {
    addLog("=== 낮 종료 ===");
    turnCount = 0;
  }
}

/***********************
 * 버튼 연결
 ***********************/
runBtn.onclick = runTurn;
