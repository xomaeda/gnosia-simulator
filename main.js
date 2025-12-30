/************************
 * Gnosia Fan Simulator
 * Night Phase Ver.
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
    this.role = cfg.role; // "GNOSIA" | "CREW" | etc (비공개)

    this.commandHistory = {};
  }

  used(cmd) {
    this.commandHistory[cmd] = (this.commandHistory[cmd] || 0) + 1;
  }
}

/* ========= 게임 상태 ========= */

const GameState = {
  characters: [],
  phase: "DAY",          // DAY | NIGHT
  dayTurn: 0,            // 낮: 0~4 (5번 누르면 종료)
  nightStep: 0,          // 밤: 0=자유행동, 1=습격
  day: 1,
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

/* ========= 커맨드 (낮 전용, 구조 유지) ========= */

const Commands = {};
const C = Commands;

C["의심한다"] = {
  baseWeight: 10,
  canUse: () => true,
  apply: (s, a, t) => {
    addLog(`${a.name}:[의심한다] ${t.name}는 수상하다.`);
    a.aggro += 5;
  }
};

C["잡담한다"] = {
  baseWeight: 6,
  canUse: () => true,
  apply: (s, a) => {
    addLog(`${a.name}:[잡담한다] 별일 없네.`);
    a.aggro = Math.max(0, a.aggro - 3);
  }
};

C["얼버무린다"] = {
  baseWeight: 4,
  canUse: (s, a) => a.stats.stealth >= 25,
  apply: (s, a) => {
    addLog(`${a.name}:[얼버무린다] …다음으로.`);
  }
};

/* ========= AI 커맨드 선택 ========= */

function chooseCommandAI(actor, target) {
  let pool = [];

  for (let cmd of actor.commands) {
    const def = Commands[cmd];
    if (!def || !def.canUse(GameState, actor, target)) continue;

    let w = def.baseWeight || 5;

    if (cmd === "의심한다") w *= actor.personality.aggressive;
    if (cmd === "잡담한다") w *= actor.personality.cautious;

    const used = actor.commandHistory[cmd] || 0;
    w *= Math.max(0.2, 1 - used * 0.2);

    pool.push({ cmd, w });
  }

  if (pool.length === 0) return null;

  const total = pool.reduce((s, p) => s + p.w, 0);
  let r = Math.random() * total;

  for (let p of pool) {
    r -= p.w;
    if (r <= 0) return p.cmd;
  }
  return pool[0].cmd;
}

/* ========= 낮 처리 ========= */

function runDayTurn() {
  const alive = GameState.characters.filter(c => c.alive);
  if (alive.length < 2) return;

  const actor = alive[Math.floor(Math.random() * alive.length)];
  const target = alive.find(c => c !== actor);

  const cmd = chooseCommandAI(actor, target);
  if (!cmd) return;

  Commands[cmd].apply(GameState, actor, target);
  actor.used(cmd);

  GameState.dayTurn++;

  if (GameState.dayTurn >= 5) {
    GameState.phase = "NIGHT";
    GameState.nightStep = 0;
    GameState.dayTurn = 0;
    addLog(`--- 밤이 되었습니다 ---`);
  }
}

/* ========= 밤: 자유행동 ========= */

function runNightFreeAction() {
  addLog(`[밤 자유행동]`);

  const alive = GameState.characters.filter(c => c.alive);

  alive.forEach(c => {
    if (Math.random() < 0.5) {
      addLog(`${c.name}는 혼자 시간을 보냈다.`);
    } else {
      const other = alive.find(o => o !== c);
      if (other) {
        addLog(`${c.name}는 ${other.name}와 함께 시간을 보냈다.`);
      }
    }
  });

  GameState.nightStep = 1;
}

/* ========= 밤: 그노시아 습격 ========= */

function runNightAttack() {
  const gnosia = GameState.characters.filter(
    c => c.alive && c.role === "GNOSIA"
  );
  const victims = GameState.characters.filter(
    c => c.alive && c.role !== "GNOSIA"
  );

  if (gnosia.length === 0 || victims.length === 0) {
    addLog(`밤은 조용히 지나갔다.`);
  } else {
    const target = victims[Math.floor(Math.random() * victims.length)];
    target.alive = false;
    addLog(`${target.name}가 그노시아에게 습격당했습니다.`);
  }

  GameState.phase = "DAY";
  GameState.day++;
  addLog(`--- ${GameState.day}일째 낮이 되었습니다 ---`);
}

/* ========= 실행 버튼 ========= */

window.runSimulation = function () {
  if (GameState.phase === "DAY") {
    runDayTurn();
  } else {
    if (GameState.nightStep === 0) {
      runNightFreeAction();
    } else {
      runNightAttack();
    }
  }
};

/* ========= 테스트 캐릭터 ========= */

GameState.characters.push(
  new Character({
    name: "A",
    role: "GNOSIA",
    stats: { charisma: 30, logic: 30, acting: 30, charm: 30, stealth: 30, intuition: 30 },
    personality: { aggressive: 0.7, cautious: 0.3 },
    commands: Object.keys(Commands)
  }),
  new Character({
    name: "B",
    role: "CREW",
    stats: { charisma: 20, logic: 20, acting: 20, charm: 20, stealth: 20, intuition: 20 },
    personality: { aggressive: 0.3, cautious: 0.7 },
    commands: Object.keys(Commands)
  }),
  new Character({
    name: "C",
    role: "CREW",
    stats: { charisma: 25, logic: 25, acting: 25, charm: 25, stealth: 25, intuition: 25 },
    personality: { aggressive: 0.4, cautious: 0.6 },
    commands: Object.keys(Commands)
  })
);

addLog("--- 시뮬레이터 시작 ---");
addLog("실행 버튼을 눌러 진행하세요.");


