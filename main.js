// ==============================
// 전역 데이터
// ==============================

const characters = [];
const MIN_CHARACTERS = 5;

// ==============================
// DOM 요소
// ==============================

const addCharBtn = document.getElementById("addChar");
const runBtn = document.getElementById("runBtn");
const charList = document.getElementById("charList");
const logBox = document.getElementById("log");

// ==============================
// 유틸
// ==============================

function log(text) {
  logBox.value += text + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

function getValue(id) {
  return Number(document.getElementById(id).value) || 0;
}

// ==============================
// 캐릭터 생성
// ==============================

addCharBtn.addEventListener("click", () => {
  if (characters.length >= 15) {
    alert("캐릭터는 최대 15명까지 가능합니다.");
    return;
  }

  const name = document.getElementById("name").value.trim();
  if (!name) {
    alert("이름을 입력해주세요.");
    return;
  }

  const character = {
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

    // 관계도 (초기값)
    trust: {},
    favor: {},

    // 시스템용 값
    aggro: 0,
    alive: true,
    role: null
  };

  // 관계도 초기화
  characters.forEach(other => {
    character.trust[other.name] = 0;
    character.favor[other.name] = 0;

    other.trust[character.name] = 0;
    other.favor[character.name] = 0;
  });

  characters.push(character);
  updateCharacterList();

  log(`캐릭터 추가: ${character.name}`);

  if (characters.length >= MIN_CHARACTERS) {
    runBtn.disabled = false;
  }
});

// ==============================
// 캐릭터 목록 표시
// ==============================

function updateCharacterList() {
  charList.innerHTML = "";

  characters.forEach((c, index) => {
    const li = document.createElement("li");
    li.textContent =
      `${index + 1}. ${c.name} (${c.gender}, ${c.age}세)`;
    charList.appendChild(li);
  });
}

// ==============================
// 실행 (아직은 더미)
// ==============================

window.runSimulation = function () {
  log("=== 실행 버튼이 눌렸습니다 ===");
  log(`현재 캐릭터 수: ${characters.length}`);
};
