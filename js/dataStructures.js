// js/dataStructures.js
// 데이터 구조(캐릭터/역할/관계/게임상태) + 유틸

export const GENDER = Object.freeze({
  MALE: "남성",
  FEMALE: "여성",
  NB: "범성",
});

export const ROLE = Object.freeze({
  CREWMATE: "선원",
  GNOSIA: "그노시아",
  ENGINEER: "엔지니어",
  DOCTOR: "닥터",
  GUARDIAN: "수호천사",
  CREW: "선내대기인",
  AC: "AC주의자",
  BUG: "버그",
});

// 기획서: 스테이터스(0~50, 소수 1자리 가능)
// 성격(0.00~1.00)
export const STAT_KEYS = Object.freeze([
  "charisma",  // 카리스마
  "logic",     // 논리력
  "acting",    // 연기력
  "charm",     // 귀염성
  "stealth",   // 스텔스
  "intuition", // 직감
]);

export const STAT_LABEL = Object.freeze({
  charisma: "카리스마",
  logic: "논리력",
  acting: "연기력",
  charm: "귀염성",
  stealth: "스텔스",
  intuition: "직감",
});

export const PERS_KEYS = Object.freeze([
  "cheer",    // 쾌활함
  "social",   // 사회성
  "logical",  // 논리성향
  "kind",     // 상냥함
  "desire",   // 욕망
  "courage",  // 용기
]);

export const PERS_LABEL = Object.freeze({
  cheer: "쾌활함",
  social: "사회성",
  logical: "논리성향",
  kind: "상냥함",
  desire: "욕망",
  courage: "용기",
});

// ===== 숫자 유틸 =====
export function clamp(n, min, max) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

export function round1(n) {
  // 스테이터스 소수 1자리 허용
  return Math.round(Number(n) * 10) / 10;
}

export function round2(n) {
  // 성격 소수 2자리 정도
  return Math.round(Number(n) * 100) / 100;
}

export function randInt(min, max) {
  // 포함
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function weightedChoice(items) {
  // items: [{item, w}]
  const total = items.reduce((s, x) => s + Math.max(0, x.w), 0);
  if (total <= 0) return items[0]?.item;
  let r = Math.random() * total;
  for (const x of items) {
    r -= Math.max(0, x.w);
    if (r <= 0) return x.item;
  }
  return items[items.length - 1]?.item;
}

export function uid() {
  // 짧은 id
  return Math.random().toString(36).slice(2, 10);
}

// ===== 관계도 구조 =====
// 관계는 "관계를 느끼는 주체 -> 대상" 방향성이 있음
// trust[a][b], like[a][b] 형태
export function createEmptyRelations(charIds) {
  const trust = {};
  const like = {};
  for (const a of charIds) {
    trust[a] = {};
    like[a] = {};
    for (const b of charIds) {
      if (a === b) continue;
      trust[a][b] = 0; // 시작은 0(중립)
      like[a][b] = 0;
    }
  }
  return { trust, like };
}

export function ensureRelations(rel, charIds) {
  // 캐릭터 추가/삭제 후 관계 배열 보정
  if (!rel || !rel.trust || !rel.like) return createEmptyRelations(charIds);
  for (const a of charIds) {
    rel.trust[a] ??= {};
    rel.like[a] ??= {};
    for (const b of charIds) {
      if (a === b) continue;
      if (typeof rel.trust[a][b] !== "number") rel.trust[a][b] = 0;
      if (typeof rel.like[a][b] !== "number") rel.like[a][b] = 0;
    }
  }
  // 존재하지 않는 id 정리
  for (const a of Object.keys(rel.trust)) {
    if (!charIds.includes(a)) delete rel.trust[a];
  }
  for (const a of Object.keys(rel.like)) {
    if (!charIds.includes(a)) delete rel.like[a];
  }
  for (const a of charIds) {
    for (const b of Object.keys(rel.trust[a] || {})) {
      if (!charIds.includes(b) || b === a) delete rel.trust[a][b];
    }
    for (const b of Object.keys(rel.like[a] || {})) {
      if (!charIds.includes(b) || b === a) delete rel.like[a][b];
    }
  }
  return rel;
}

// ===== 캐릭터 =====
export function createCharacter(input) {
  // input: {name, gender, age, stats, pers, allowedCommands:Set|Array}
  const id = uid();

  const stats = {};
  for (const k of STAT_KEYS) {
    stats[k] = round1(clamp(input.stats?.[k] ?? 0, 0, 50));
  }
  const pers = {};
  for (const k of PERS_KEYS) {
    pers[k] = round2(clamp(input.pers?.[k] ?? 0, 0, 1));
  }

  const allowedCommands = new Set(
    Array.isArray(input.allowedCommands) ? input.allowedCommands : []
  );

  return {
    id,
    name: String(input.name ?? "").trim(),
    gender: input.gender ?? GENDER.NB,
    age: clamp(input.age ?? 0, 0, 999),

    stats,
    pers,

    allowedCommands, // 유저가 체크한 "사용 의지" 목록(스테이터스 조건과 별개)

    // 게임 중 변하는 값
    alive: true,
    role: null,         // ROLE.*
    claimedRole: null,  // 커밍아웃/사칭
    hate: 0,            // 어그로(발언 많을수록 증가)
    coop: null,         // 협력 대상 id (없으면 null)

    // 일일 제한(커맨드/행동) 리셋용
    dailyFlags: {},

    // 기록
    lastTarget: null,
    lastCommand: null,
  };
}

export function sanitizeCharacterForSave(ch) {
  return {
    id: ch.id,
    name: ch.name,
    gender: ch.gender,
    age: ch.age,
    stats: ch.stats,
    pers: ch.pers,
    allowedCommands: Array.from(ch.allowedCommands || []),
  };
}

export function restoreCharacterFromSave(obj) {
  const c = createCharacter({
    name: obj.name,
    gender: obj.gender,
    age: obj.age,
    stats: obj.stats,
    pers: obj.pers,
    allowedCommands: obj.allowedCommands || [],
  });
  // id 보존
  c.id = obj.id || c.id;
  return c;
}

// ===== 게임 설정 =====
export function computeMaxGnosiaCount(n) {
  // 기획서 규칙
  if (n <= 6) return 1;
  if (n <= 8) return 2;
  if (n <= 10) return 3;
  if (n <= 12) return 4;
  if (n <= 14) return 5;
  return 6;
}

export function createDefaultSettings() {
  return {
    rolesEnabled: {
      engineer: false,
      doctor: false,
      guardian: false,
      crew: false, // 선내대기인(2명)
      ac: false,
      bug: false,
    },
    gnosiaCount: 1,
  };
}

// ===== 게임 상태 =====
export function createNewGameState() {
  return {
    phase: "setup",     // setup | day | night_free | night_attack | ended
    day: 1,
    dayTurn: 0,         // 낮 1~5
    log: [],
    winner: null,       // "human" | "gnosia" | "bug"
    revealOnEnd: false, // 종료 시 역할 공개

    // 진행 중 목록
    chars: [],          // Character[]
    relations: null,    // {trust, like}

    settings: createDefaultSettings(),

    // 밤 처리용
    lastKilledId: null,
    lastColdSleepId: null,
  };
}

export function aliveChars(state) {
  return state.chars.filter(c => c.alive);
}

export function getChar(state, id) {
  return state.chars.find(c => c.id === id) || null;
}

export function isAlive(state, id) {
  const c = getChar(state, id);
  return !!c && c.alive;
}

export function addLog(state, text) {
  state.log.push(text);
}
