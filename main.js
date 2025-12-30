/************************
 * Gnosia Fan Simulator
 * AI Personality Ver.
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

    this.commandHistory = {};
  }

  used(cmd) {
    this.commandHistory[cmd] = (this.commandHistory[cmd] || 0) + 1;
  }
}

/* ========= 게임 상태 ========= */

const GameState = {
  characters: [],
  phase: "DAY",
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
const C = Commands;

/* ---- 예시용 일부 (구조는 동일, 전부 이미 있음) ---- */

C["의심한다"] = {
  baseWeight: 10,
  canUse: () => true,
  apply: (s, a, t) => {
    addLog(`${a.name}:[의심한다] ${t.name}는 수상하다.`);
    a.aggro += 5;
    s.lastCommand = "의심한다";
    s.lastTarget = t;
  }
};

C["잡담한다"] = {
  baseWeight: 6,
  canUse: () => true,
  apply: (s, a) => {
    addLog(`${a.name}:[잡담한다] 별일 없네.`);
    a.aggro -= 3;
  }
};

C["얼버무린다"] = {
  baseWeight: 4,
  canUse: (s, a) => a.stats.stealth >= 25,
  apply: (s, a) => {
    addLog(`${a.name}:[얼버무린다] …다음으로.`);
    s.lastCommand = null;
    s.lastTarget = null;
  }
};

C["반론한다"] = {
  baseWeight: 8,
  canUse: () => true,
  apply: (s, a) => {
    addLog(`${a.name}:[반론한다] 그건 이상해.`);
    a.aggro += 4;
    s.lastCommand = "반론한다";
  }
};

/* ========= AI 선택 로직 ========= */

function chooseCommandAI(actor, target) {
  let pool = [];

  for (let cmd of actor.commands) {
    const def = Commands[cmd];
    if (!def) continue;
    if (!def.canUse(GameState, actor, target)) continue;

    let weight = def.baseWeight || 5;

    /* 성향 반영 */
    if (cmd === "의심한다" || cmd === "반론한다") {
      weight *= actor.personality.aggressive;
    }

    if (cmd === "잡담한다" || cmd === "얼버무린다") {
      weight *= actor.personality.cautious;
    }

    /* 어그로 보정 */
    if (actor.aggro > 20 && (cmd === "잡담한다" || cmd === "얼버무린다")) {
      weight *= 2;
    }

    /* 반복 사용 패널티 */
    const used = actor.commandHistory[cmd] || 0;
    weight *= Math.max(0.2, 1 - used * 0.2);

    if (weight > 0) {
      pool.push({ cmd, weight });
    }
  }

  if (pool.length === 0) return null;

  /* 가중치 랜덤 */
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * total;

  for (let p of pool) {
    roll -= p.weight;
    if (roll <= 0) return p.cmd;
  }

  return pool[0].cmd;
}

/* ========= 실행 ========= */

window.runSimulation = function () {
  const alive = GameState.characters.filter(c => c.alive);
  if (alive.length < 2) return;

  const actor = alive[Math.floor(Math.random() * alive.length)];
  const target = alive.find(c => c !== actor);

  const cmd = chooseCommandAI(actor, target);
  if (!cmd) return;

  Commands[cmd].apply(GameState, actor, target);
  actor.used(cmd);
};

/* ========= 테스트 캐릭터 ========= */

GameState.characters.push(
  new Character({
    name: "AI테스트",
    stats: {
      charisma: 40,
      logic: 30,
      acting: 30,
      charm: 30,
      stealth: 30,
      intuition: 30
    },
    personality: {
      aggressive: 0.7,
      cautious: 0.3,
      logical: 0.6,
      emotional: 0.4
    },
    commands: Object.keys(Commands)
  })
);

addLog("AI 성향 기반 커맨드 선택 로드 완료.");

