/***********************
 * Gnosia Fan Simulator
 * main.js
 ***********************/

/* =====================
   기본 데이터 구조
===================== */

class Character {
  constructor(config) {
    this.name = config.name;
    this.gender = config.gender;
    this.age = config.age;

    this.stats = {
      charisma: config.stats.charisma,
      logic: config.stats.logic,
      acting: config.stats.acting,
      charm: config.stats.charm,
      stealth: config.stats.stealth,
      intuition: config.stats.intuition,
    };

    this.personality = { ...config.personality };
    this.commands = new Set(config.commands);

    this.trust = {};     // 대상별 신뢰도
    this.like = {};      // 대상별 우호도
    this.aggro = 0;

    this.role = null;    // 시작 시 할당, 비공개
    this.alive = true;
  }
}

/* =====================
   게임 상태
===================== */

const GameState = {
  characters: [],
  phase: "DAY",          // DAY / NIGHT
  turn: 0,               // 낮: 1~5
  dayCount: 1,
  log: [],
  lastCommand: null,
  lastTarget: null,
};

/* =====================
   로그 출력
===================== */

function addLog(text) {
  GameState.log.push(text);
  const logBox = document.getElementById("log");
  if (logBox) {
    logBox.value += text + "\n";
    logBox.scrollTop = logBox.scrollHeight;
  }
}

/* =====================
   커맨드 시스템
===================== */

const Commands = {};

/* ---- 2-2-1 커맨드 정의 ---- */

Commands["의심한다"] = {
  canUse(state, actor, target) {
    return state.phase === "DAY" && state.turn >= 1;
  },
  apply(state, actor, target) {
    addLog(`${actor.name}:[의심한다] ${target.name}는 수상하다.`);
    target.trust[actor.name] = (target.trust[actor.name] || 0) - actor.stats.logic * 0.2;
    target.like[actor.name] = (target.like[actor.name] || 0) - actor.stats.acting * 0.2;
    actor.aggro += 5;
    state.lastCommand = "의심한다";
    state.lastTarget = target;
  }
};

Commands["의심에 동의한다"] = {
  canUse(state, actor, target) {
    return state.lastCommand === "의심한다";
  },
  apply(state, actor, target) {
    addLog(`${actor.name}:[의심에 동의한다] ${target.name}의 말에 동의한다.`);
    actor.aggro += 2;
  }
};

Commands["부정한다"] = {
  canUse(state, actor) {
    return state.lastTarget === actor;
  },
  apply(state, actor) {
    addLog(`${actor.name}:[부정한다] 나는 의심받을 이유가 없다.`);
    actor.aggro -= 3;
    GameState.lastCommand = "부정한다";
  }
};

Commands["변호한다"] = {
  canUse(state) {
    return ["의심한다", "의심에 동의한다", "부정한다"].includes(state.lastCommand);
  },
  apply(state, actor, target) {
    addLog(`${actor.name}:[변호한다] ${target.name}는 괜찮아 보여.`);
    actor.aggro += 3;
  }
};

Commands["감싼다"] = {
  canUse(state) {
    return state.phase === "DAY" && state.turn >= 1;
  },
  apply(state, actor, target) {
    addLog(`${actor.name}:[감싼다] ${target.name}를 믿고 싶다.`);
    actor.aggro += 2;
  }
};

Commands["감사한다"] = {
  canUse(state, actor) {
    return true;
  },
  apply(state, actor, target) {
    addLog(`${actor.name}:[감사한다] 고마워.`);
    actor.aggro = Math.max(0, actor.aggro - actor.stats.charm * 0.2);
  }
};

Commands["반론을 막는다"] = {
  canUse(state, actor) {
    return actor.stats.charisma >= 40;
  },
  apply(state, actor, target) {
    addLog(`${actor.name}:[반론을 막는다] 더 이상 반박하지 마.`);
    actor.aggro += 15;
  }
};

Commands["얼버무린다"] = {
  canUse(state, actor) {
    return actor.stats.stealth >= 25;
  },
  apply(state, actor) {
    addLog(`${actor.name}:[얼버무린다] …아무튼 다음으로 넘어가자.`);
    state.lastCommand = null;
    state.lastTarget = null;
  }
};

Commands["반격한다"] = {
  canUse(state, actor) {
    return actor.stats.logic >= 25 && actor.stats.acting >= 25;
  },
  apply(state, actor, target) {
    addLog(`${actor.name}:[반격한다] 오히려 네가 수상해.`);
    actor.aggro += 8;
  }
};

Commands["도게자한다"] = {
  canUse(state, actor) {
    return actor.stats.stealth >= 35;
  },
  apply(state, actor) {
    addLog(`${actor.name}:[도게자한다] 살려줘!`);
    actor.aggro -= 10;
  }
};

/* =====================
   턴 진행
===================== */

function advanceDayTurn() {
  if (GameState.turn >= 5) {
    addLog("낮 시간이 종료되었습니다.");
    GameState.phase = "NIGHT";
    GameState.turn = 0;
    return;
  }

  GameState.turn += 1;
  addLog(`--- 낮 ${GameState.dayCount}일차 / 턴 ${GameState.turn} ---`);

  // 임시 자동 행동
  const alive = GameState.characters.filter(c => c.alive);
  if (alive.length >= 2) {
    const actor = alive[Math.floor(Math.random() * alive.length)];
    const target = alive.filter(c => c !== actor)[0];

    if (actor.commands.has("의심한다")) {
      Commands["의심한다"].apply(GameState, actor, target);
    }
  }
}

function advanceNight() {
  addLog("--- 밤 시간 ---");
  addLog("각 캐릭터가 자유 행동을 했다.");
  addLog("그노시아의 습격 결과가 발생했다.");
  GameState.phase = "DAY";
  GameState.dayCount += 1;
}

/* =====================
   버튼 연결
===================== */

window.runSimulation = function () {
  if (GameState.phase === "DAY") {
    advanceDayTurn();
  } else {
    advanceNight();
  }
};

/* =====================
   초기 테스트용 캐릭터
===================== */

GameState.characters.push(
  new Character({
    name: "A",
    gender: "여성",
    age: 22,
    stats: {
      charisma: 30,
      logic: 20,
      acting: 15,
      charm: 10,
      stealth: 12,
      intuition: 8
    },
    personality: {
      cheerful: 10,
      social: 10,
      logical: 5,
      kind: 8,
      desire: 4,
      brave: 6
    },
    commands: [
      "의심한다",
      "의심에 동의한다",
      "부정한다",
      "변호한다",
      "감싼다"
    ]
  })
);

addLog("시뮬레이터 준비 완료.");
