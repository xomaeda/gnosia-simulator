/************************
 * Gnosia Fan Simulator
 * Command Complete Ver.
 ************************/

/* ========= 캐릭터 ========= */

class Character {
  constructor(cfg) {
    this.name = cfg.name;
    this.stats = cfg.stats;
    this.personality = cfg.personality;
    this.commands = new Set(cfg.commands);
    this.trust = {};
    this.like = {};
    this.aggro = 0;
    this.alive = true;
    this.role = null;
  }
}

/* ========= 게임 상태 ========= */

const GameState = {
  characters: [],
  phase: "DAY",     // DAY / NIGHT
  turn: 0,
  day: 1,
  lastCommand: null,
  lastTarget: null,
  log: []
};

/* ========= 로그 ========= */

function addLog(text) {
  GameState.log.push(text);
  const box = document.getElementById("log");
  if (box) {
    box.value += text + "\n";
    box.scrollTop = box.scrollHeight;
  }
}

/* ========= 커맨드 ========= */

const Commands = {};
const C = Commands; // 줄여쓰기

/* ---- 기본 계열 ---- */

C["의심한다"] = {
  canUse: () => true,
  apply: (s, a, t) => {
    addLog(`${a.name}:[의심한다] ${t.name}는 수상하다.`);
    a.aggro += 5;
    s.lastCommand = "의심한다";
    s.lastTarget = t;
  }
};

C["의심에 동의한다"] = {
  canUse: s => s.lastCommand === "의심한다",
  apply: (s, a, t) => {
    addLog(`${a.name}:[의심에 동의한다] ${t.name}의 말에 동의한다.`);
    a.aggro += 2;
  }
};

C["부정한다"] = {
  canUse: (s, a) => s.lastTarget === a,
  apply: (s, a) => {
    addLog(`${a.name}:[부정한다] 나는 의심받을 이유가 없다.`);
    a.aggro -= 3;
    s.lastCommand = "부정한다";
  }
};

C["변호한다"] = {
  canUse: s => ["의심한다", "의심에 동의한다", "부정한다"].includes(s.lastCommand),
  apply: (s, a, t) => {
    addLog(`${a.name}:[변호한다] ${t.name}는 문제없어 보여.`);
    a.aggro += 3;
  }
};

C["변호에 가담한다"] = {
  canUse: s => s.lastCommand === "변호한다",
  apply: (s, a, t) => {
    addLog(`${a.name}:[변호에 가담한다] 나도 같은 생각이야.`);
    a.aggro += 1;
  }
};

C["감싼다"] = {
  canUse: () => true,
  apply: (s, a, t) => {
    addLog(`${a.name}:[감싼다] ${t.name}를 믿고 싶다.`);
    a.aggro += 2;
    s.lastCommand = "감싼다";
  }
};

C["함께 감싼다"] = {
  canUse: s => s.lastCommand === "감싼다",
  apply: (s, a, t) => {
    addLog(`${a.name}:[함께 감싼다] 나도 동의해.`);
    a.aggro += 1;
  }
};

C["감사한다"] = {
  canUse: () => true,
  apply: (s, a, t) => {
    addLog(`${a.name}:[감사한다] 고마워.`);
    a.aggro -= a.stats.charm * 0.2;
  }
};

C["반론한다"] = {
  canUse: () => true,
  apply: (s, a, t) => {
    addLog(`${a.name}:[반론한다] 그건 좀 아니지 않아?`);
    a.aggro += 4;
    s.lastCommand = "반론한다";
  }
};

C["반론에 가담한다"] = {
  canUse: s => s.lastCommand === "반론한다",
  apply: (s, a, t) => {
    addLog(`${a.name}:[반론에 가담한다] 나도 반대야.`);
    a.aggro += 2;
  }
};

C["시끄러워"] = {
  canUse: () => true,
  apply: (s, a, t) => {
    addLog(`${a.name}:[시끄러워] 말이 너무 많아.`);
    a.aggro += 3;
  }
};

/* ---- 고급 조건 ---- */

C["역할을 밝힌다"] = {
  canUse: () => true,
  apply: (s, a) => {
    addLog(`${a.name}:[역할을 밝힌다] 나는 내 역할을 공개한다.`);
  }
};

C["자신도 밝힌다"] = {
  canUse: s => s.lastCommand === "역할을 밝힌다",
  apply: (s, a) => {
    addLog(`${a.name}:[자신도 밝힌다] 나 역시 같은 역할이다.`);
  }
};

C["역할을 밝혀라"] = {
  canUse: (s, a) => a.stats.charisma >= 10,
  apply: (s, a, t) => {
    addLog(`${a.name}:[역할을 밝혀라] ${t.name}, 정체를 밝혀.`);
    a.aggro += 4;
  }
};

C["과장해서 말한다"] = {
  canUse: (s, a) => a.stats.acting >= 15,
  apply: (s, a) => {
    addLog(`${a.name}:[과장해서 말한다] 이건 정말 중요해!`);
    a.aggro += 3;
  }
};

C["동의를 구한다"] = {
  canUse: (s, a) => a.stats.charisma >= 25,
  apply: (s, a) => {
    addLog(`${a.name}:[동의를 구한다] 다들 그렇게 생각하지?`);
    a.aggro += 4;
  }
};

C["반론을 막는다"] = {
  canUse: (s, a) => a.stats.charisma >= 40,
  apply: (s, a) => {
    addLog(`${a.name}:[반론을 막는다] 더 이상 말하지 마.`);
    a.aggro += 12;
  }
};

C["얼버무린다"] = {
  canUse: (s, a) => a.stats.stealth >= 25,
  apply: (s, a) => {
    addLog(`${a.name}:[얼버무린다] …다음으로 넘어가자.`);
    s.lastCommand = null;
    s.lastTarget = null;
  }
};

C["반격한다"] = {
  canUse: (s, a) => a.stats.logic >= 25 && a.stats.acting >= 25,
  apply: (s, a, t) => {
    addLog(`${a.name}:[반격한다] 오히려 네가 수상해.`);
    a.aggro += 6;
  }
};

C["도움을 요청한다"] = {
  canUse: (s, a) => a.stats.acting >= 30,
  apply: (s, a, t) => {
    addLog(`${a.name}:[도움을 요청한다] ${t.name}, 날 도와줘.`);
  }
};

C["슬퍼한다"] = {
  canUse: (s, a) => a.stats.charm >= 25,
  apply: (s, a) => {
    addLog(`${a.name}:[슬퍼한다] 너무해…`);
    a.aggro -= 5;
  }
};

C["속지마라"] = {
  canUse: (s, a) => a.stats.intuition >= 30,
  apply: (s, a, t) => {
    addLog(`${a.name}:[속지마라] ${t.name}는 거짓말을 하고 있어.`);
  }
};

C["투표해라"] = {
  canUse: (s, a) => a.stats.logic >= 10,
  apply: (s, a, t) => {
    addLog(`${a.name}:[투표해라] ${t.name}에게 투표하자.`);
  }
};

C["투표하지 마라"] = {
  canUse: (s, a) => a.stats.logic >= 15,
  apply: (s, a, t) => {
    addLog(`${a.name}:[투표하지 마라] ${t.name}는 아니다.`);
  }
};

C["반드시 인간이다"] = {
  canUse: (s, a) => a.stats.logic >= 20,
  apply: (s, a, t) => {
    addLog(`${a.name}:[반드시 인간이다] ${t.name}는 인간이다.`);
  }
};

C["반드시 적이다"] = {
  canUse: (s, a) => a.stats.logic >= 20,
  apply: (s, a, t) => {
    addLog(`${a.name}:[반드시 적이다] ${t.name}는 적이다.`);
  }
};

C["전원 배제해라"] = {
  canUse: (s, a) => a.stats.logic >= 30,
  apply: (s, a) => {
    addLog(`${a.name}:[전원 배제해라] 전부 정리하자.`);
    a.aggro += 8;
  }
};

C["잡담한다"] = {
  canUse: (s, a) => a.stats.stealth >= 10,
  apply: (s, a) => {
    addLog(`${a.name}:[잡담한다] 잠깐 쉬자.`);
    a.aggro -= 3;
  }
};

C["협력하자"] = {
  canUse: (s, a) => a.stats.charm >= 15,
  apply: (s, a, t) => {
    addLog(`${a.name}:[협력하자] ${t.name}, 같이 가자.`);
  }
};

C["인간이라고 말해"] = {
  canUse: (s, a) => a.stats.intuition >= 20,
  apply: (s, a) => {
    addLog(`${a.name}:[인간이라고 말해] 나는 인간이다.`);
    a.aggro += 5;
  }
};

C["도게자한다"] = {
  canUse: (s, a) => a.stats.stealth >= 35,
  apply: (s, a) => {
    addLog(`${a.name}:[도게자한다] 제발 살려줘!`);
    a.aggro -= 10;
  }
};

/* ========= 실행 버튼 ========= */

window.runSimulation = function () {
  const alive = GameState.characters.filter(c => c.alive);
  if (alive.length < 2) return;

  const actor = alive[Math.floor(Math.random() * alive.length)];
  const target = alive.find(c => c !== actor);

  for (let cmd of actor.commands) {
    const def = Commands[cmd];
    if (def && def.canUse(GameState, actor, target)) {
      def.apply(GameState, actor, target);
      break;
    }
  }
};

/* ========= 테스트 캐릭터 ========= */

GameState.characters.push(
  new Character({
    name: "테스트",
    stats: {
      charisma: 40,
      logic: 30,
      acting: 30,
      charm: 30,
      stealth: 30,
      intuition: 30
    },
    personality: {},
    commands: Object.keys(Commands)
  })
);

addLog("커맨드 시스템 로드 완료.");
