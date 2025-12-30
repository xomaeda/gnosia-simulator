// main.js - 모든 기획서 커맨드 적용
let characters = [];
let dayTurn = 0;
let isNight = false;

const charListEl = document.getElementById('charList');
const logEl = document.getElementById('log');
const runBtn = document.getElementById('runBtn');

document.getElementById('addChar').addEventListener('click', () => {
  const name = document.getElementById('name').value.trim();
  if (!name) return alert("이름을 입력하세요.");
  
  const character = {
    name,
    gender: document.getElementById('gender').value,
    age: Number(document.getElementById('age').value),
    status: {
      charisma: Number(document.getElementById('charisma').value),
      logic: Number(document.getElementById('logic').value),
      acting: Number(document.getElementById('acting').value),
      charm: Number(document.getElementById('charm').value),
      stealth: Number(document.getElementById('stealth').value),
      intuition: Number(document.getElementById('intuition').value)
    },
    personality: {
      cheer: Number(document.getElementById('cheer').value),
      social: Number(document.getElementById('social').value),
      logical: Number(document.getElementById('logical').value),
      kindness: Number(document.getElementById('kindness').value),
      desire: Number(document.getElementById('desire').value),
      courage: Number(document.getElementById('courage').value)
    },
    aggro: 0,
    friendship: 0,
    commandsUsed: {},
  };
  
  characters.push(character);
  updateCharList();
  
  if (characters.length >= 5) runBtn.disabled = false;
});

function updateCharList() {
  charListEl.innerHTML = '';
  characters.forEach((char) => {
    const li = document.createElement('li');
    li.textContent = `${char.name} (${char.gender}, ${char.age}세) Aggro:${char.aggro} Friend:${char.friendship}`;
    charListEl.appendChild(li);
  });
}

runBtn.addEventListener('click', () => {
  if (!isNight) runDayTurn();
  else runNightPhase();
});

function log(message) {
  const p = document.createElement('p');
  p.textContent = message;
  logEl.appendChild(p);
  logEl.scrollTop = logEl.scrollHeight;
}

// -----------------------------
// 커맨드 정의 (기획서 모든 커맨드 적용)
// -----------------------------
const commands = {
  // 기본 공격/옹호
  '의심한다': { available: c => true, aggro: 2, friendship: -1, maxPerDay: null, execute: (from, target) => log(`${from.name} 의심한다 ${target.name}`)},
  '의심에 동의한다': { available: c => true, aggro: 1, friendship: -1, maxPerDay: null, execute: (from, target) => log(`${from.name} 의심에 동의한다 ${target.name}`)},
  '부정한다': { available: c => true, aggro: -1, friendship: 2, maxPerDay: null, execute: (from, target) => log(`${from.name} 부정한다 ${target.name}`)},
  '변호한다': { available: c => true, aggro: -1, friendship: 2, maxPerDay: null, execute: (from, target) => log(`${from.name} 변호한다 ${target.name}`)},
  '변호에 가담한다': { available: c => true, aggro: -1, friendship: 1, maxPerDay: null, execute: (from, target) => log(`${from.name} 변호에 가담한다 ${target.name}`)},
  '감싼다': { available: c => true, aggro: -1, friendship: 2, maxPerDay: null, execute: (from, target) => log(`${from.name} 감싼다 ${target.name}`)},
  '함께 감싼다': { available: c => true, aggro: -1, friendship: 1, maxPerDay: null, execute: (from, target) => log(`${from.name} 함께 감싼다 ${target.name}`)},
  '감사한다': { available: c => true, aggro: -1, friendship: 2, maxPerDay: null, execute: (from, target) => log(`${from.name} 감사한다 ${target.name}`)},
  '반론한다': { available: c => true, aggro: 2, friendship: -1, maxPerDay: null, execute: (from, target) => log(`${from.name} 반론한다 ${target.name}`)},
  '반론에 가담한다': { available: c => true, aggro: 1, friendship: -1, maxPerDay: null, execute: (from, target) => log(`${from.name} 반론에 가담한다 ${target.name}`)},
  '시끄러워': { available: c => true, aggro: 1, friendship: -1, maxPerDay: null, execute: (from, target) => log(`${from.name} 시끄러워 ${target.name}`)},
  '역할을 밝힌다': { available: c => true, aggro: 0, friendship: 0, maxPerDay: 1, execute: (from, target) => log(`${from.name} 역할을 밝힌다`)},
  '자신도 밝힌다': { available: c => true, aggro: 0, friendship: 0, maxPerDay: 1, execute: (from, target) => log(`${from.name} 자신도 밝힌다`)},
  '역할을 밝혀라': { available: c => c.status.charisma >= 10, aggro: 0, friendship: 0, maxPerDay: 1, execute: (from, target) => log(`${from.name} 역할을 밝혀라 ${target.name}`)},
  '과장해서 말한다': { available: c => c.status.acting >= 15, aggro: 3, friendship: 1, maxPerDay: null, execute: (from, target) => log(`${from.name} 과장해서 말한다 ${target.name}`)},
  '동의를 구한다': { available: c => c.status.charisma >= 25, aggro: 1, friendship: 2, maxPerDay: null, execute: (from, target) => log(`${from.name} 동의를 구한다 ${target.name}`)},
  '반론을 막는다': { available: c => c.status.charisma >= 40, aggro: 5, friendship: 0, maxPerDay: null, execute: (from, target) => log(`${from.name} 반론을 막는다 ${target.name}`)},
  '얼버무린다': { available: c => c.status.stealth >= 25, aggro: -1, friendship: 0, maxPerDay: null, execute: (from, target) => log(`${from.name} 얼버무린다`)},
  '반격한다': { available: c => c.status.logic >= 25 && c.status.acting >= 25, aggro: 2, friendship: -1, maxPerDay: null, execute: (from, target) => log(`${from.name} 반격한다 ${target.name}`)},
  '도움 요청한다': { available: c => c.status.acting >= 30, aggro: 0, friendship: 1, maxPerDay: null, execute: (from, target) => log(`${from.name} 도움 요청한다 ${target.name}`)},
  '슬퍼한다': { available: c => c.status.charm >= 25, aggro: 0, friendship: 2, maxPerDay: null, execute: (from, target) => log(`${from.name} 슬퍼한다 ${target.name}`)},
  '속지마라': { available: c => c.status.intuition >= 30, aggro: 0, friendship: 0, maxPerDay: 1, execute: (from, target) => log(`${from.name} 속지마라 ${target.name}`)},
  '투표해라': { available: c => c.status.logic >= 10, aggro: 0, friendship: 0, maxPerDay: 1, execute: (from, target) => log(`${from.name} 투표해라 ${target.name}`)},
  '투표하지 마라': { available: c => c.status.logic >= 15, aggro: 0, friendship: 0, maxPerDay: 1, execute: (from, target) => log(`${from.name} 투표하지 마라 ${target.name}`)},
  '반드시 인간이다': { available: c => c.status.logic >= 20, aggro: 0, friendship: 2, maxPerDay: 1, execute: (from, target) => log(`${from.name} 반드시 인간이다 ${target.name}`)},
  '반드시 적이다': { available: c => c.status.logic >= 20, aggro: 0, friendship: -2, maxPerDay: 1, execute: (from, target) => log(`${from.name} 반드시 적이다 ${target.name}`)},
  '전원 배제해라': { available: c => c.status.logic >= 30, aggro: 0, friendship: 0, maxPerDay: 1, execute: (from, target) => log(`${from.name} 전원 배제해라 ${target.name}`)},
  '잡담한다': { available: c => c.status.stealth >= 10, aggro: -1, friendship: 1, maxPerDay: 1, execute: (from, target) => log(`${from.name} 잡담한다 ${target.name}`)},
  '협력하자': { available: c => c.status.charm >= 15, aggro: 0, friendship: 3, maxPerDay: 1, execute: (from, target) => log(`${from.name} 협력하자 ${target.name}`)},
  '인간이라고 말해': { available: c => c.status.intuition >= 20, aggro: 0, friendship: 1, maxPerDay: 1, execute: (from, target) => log(`${from.name} 인간이라고 말해`)},
  '도게자한다': { available: c => c.status.stealth >= 35, aggro: -1, friendship: 0, maxPerDay: 1, execute: (from, target) => log(`${from.name} 도게자한다`)},
  '침묵': { available: c => true, aggro: 0, friendship: 0, maxPerDay: null, execute: (from, target) => log(`${from.name} 침묵`)}
};

// -----------------------------
// 낮 라운드
// -----------------------------
function runDayTurn() {
  dayTurn++;
  log(`--- 낮 턴 ${dayTurn} ---`);
  
  characters.forEach(char => {
    const availableCmds = Object.keys(commands).filter(c => {
      const cmd = commands[c];
      const used = char.commandsUsed[c] || 0;
      return cmd.available(char) && (cmd.maxPerDay === null || used < cmd.maxPerDay);
    });
    if (availableCmds.length === 0) return;
    
    const cmdKey = availableCmds[Math.floor(Math.random() * availableCmds.length)];
    const target = characters[Math.floor(Math.random() * characters.length)];
    
    commands[cmdKey].execute(char, target);
    char.commandsUsed[cmdKey] = (char.commandsUsed[cmdKey] || 0) + 1;
  });
  
  updateCharList();
  
  if (dayTurn >= 5) {
    log('--- 낮 종료 ---');
    dayTurn = 0;
    isNight = true;
  }
}

// -----------------------------
// 밤 라운드
// -----------------------------
let nightStep = 0;

function runNightPhase() {
  nightStep++;
  if (nightStep === 1) {
    log('--- 밤 자유행동 ---');
    characters.forEach(char => {
      const partner = characters[Math.floor(Math.random() * characters.length)];
      if (partner !== char) log(`${char.name}는 ${partner.name}와 함께 시간을 보냈다.`);
    });
  } else if (nightStep === 2) {
    log('--- 그노시아 습격 결과 ---');
    const victim = characters[Math.floor(Math.random() * characters.length)];
    log(`${victim.name}가 그노시아에 의해 습격당했습니다.`);
    nightStep = 0;
    isNight = false;
  }
}
