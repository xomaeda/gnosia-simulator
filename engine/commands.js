// engine/commands.js
// ============================================================================
// Canonical command catalog exports (stable)
// - Fixes: COMMAND_DEFS iterable, no duplicate exports, no compatibility junk
// ============================================================================

export const COMMAND = {
  // --- Day: main / common ---
  SUSPECT: "의심한다",
  AGREE_SUSPECT: "의심에 동의한다",
  DENY: "부정한다",
  DEFEND: "변호한다",
  AGREE_DEFEND: "변호에 가담한다",
  COVER: "감싼다",
  AGREE_COVER: "함께 감싼다",
  THANK: "감사한다",
  COUNTER: "반론한다",
  AGREE_COUNTER: "반론에 가담한다",
  NOISY: "시끄러워",

  // --- Role talk (chain) ---
  CO_ROLE: "역할을 밝힌다",
  CO_SELF_TOO: "자신도 밝힌다",
  REQUEST_CO: "역할을 밝혀라",

  // --- Enhancers / control ---
  EXAGGERATE: "과장해서 말한다",
  ASK_AGREE: "동의를 구한다",
  BLOCK_REBUT: "반론을 막는다",

  // --- Defensive / reactive ---
  DODGE: "얼버무린다",
  COUNTERATTACK: "반격한다",
  ASK_HELP: "도움을 요청한다",
  SAD: "슬퍼한다",
  DONT_TRUST: "속지마라",

  // --- Vote ---
  VOTE_HIM: "투표해라",
  DONT_VOTE: "투표하지 마라",
  ALL_EXCLUDE_ROLE: "전원 배제해라",

  // --- Certifications / talk ---
  CERT_HUMAN: "반드시 인간이다",
  CERT_ENEMY: "반드시 적이다",
  SAY_HUMAN: "인간이라고 말해",
  DOGEZA: "도게자한다",
  CHAT: "잡담한다",

  // --- Cooperation (day / night) ---
  COOP: "협력한다",
  NIGHT_COOP: "밤에 협력을 제안",
};

// 최소 요구 스탯 키(네 UI 입력과 매칭)
const STAT_KEYS = ["charisma", "logic", "acting", "charm", "stealth", "intuition"];

// 커맨드 메타(여기서 UI 분류/조건/연계 조건을 준다)
export const COMMAND_META = {
  [COMMAND.SUSPECT]: {
    id: COMMAND.SUSPECT,
    label: "의심한다",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},               // 스테이터스 조건 없음
    chain: {},             // 선행 조건 없음
  },
  [COMMAND.AGREE_SUSPECT]: {
    id: COMMAND.AGREE_SUSPECT,
    label: "의심에 동의한다",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},               // 필요하면 네 기획서 스펙대로 넣어도 됨
    chain: { after: [COMMAND.SUSPECT, COMMAND.ASK_AGREE] }, // 예: 의심/동의요청 뒤
  },
  [COMMAND.DENY]: {
    id: COMMAND.DENY,
    label: "부정한다",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.SUSPECT, COMMAND.DEFEND, COMMAND.COVER, COMMAND.COUNTER] },
  },
  [COMMAND.DEFEND]: {
    id: COMMAND.DEFEND,
    label: "변호한다",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.SUSPECT] },
  },
  [COMMAND.AGREE_DEFEND]: {
    id: COMMAND.AGREE_DEFEND,
    label: "변호에 가담한다",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.DEFEND, COMMAND.ASK_AGREE] },
  },
  [COMMAND.COVER]: {
    id: COMMAND.COVER,
    label: "감싼다",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.SUSPECT] },
  },
  [COMMAND.AGREE_COVER]: {
    id: COMMAND.AGREE_COVER,
    label: "함께 감싼다",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.COVER, COMMAND.ASK_AGREE] },
  },
  [COMMAND.COUNTER]: {
    id: COMMAND.COUNTER,
    label: "반론한다",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.SUSPECT, COMMAND.DEFEND, COMMAND.COVER] },
  },
  [COMMAND.AGREE_COUNTER]: {
    id: COMMAND.AGREE_COUNTER,
    label: "반론에 가담한다",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.COUNTER, COMMAND.ASK_AGREE] },
  },
  [COMMAND.NOISY]: {
    id: COMMAND.NOISY,
    label: "시끄러워",
    category: "DAY",
    public: true,
    needsCheck: true,
    req: {},
    chain: {},
  },
  [COMMAND.EXAGGERATE]: {
    id: COMMAND.EXAGGERATE,
    label: "과장해서 말한다",
    category: "MOD",
    public: true,
    needsCheck: true,
    req: { acting: 15 },    // 예시(원하면 조정)
    chain: { after: [COMMAND.DEFEND, COMMAND.COUNTER, COMMAND.COVER, COMMAND.SUSPECT] },
  },
  [COMMAND.ASK_AGREE]: {
    id: COMMAND.ASK_AGREE,
    label: "동의를 구한다",
    category: "MOD",
    public: true,
    needsCheck: true,
    req: { charisma: 10 },  // 예시
    chain: { after: [COMMAND.SUSPECT, COMMAND.DEFEND, COMMAND.COVER, COMMAND.COUNTER] },
  },
  [COMMAND.BLOCK_REBUT]: {
    id: COMMAND.BLOCK_REBUT,
    label: "반론을 막는다",
    category: "CTRL",
    public: true,
    needsCheck: true,
    req: { logic: 10 },     // 예시
    chain: { after: [COMMAND.SUSPECT, COMMAND.DEFEND, COMMAND.COVER, COMMAND.COUNTER] },
  },
  [COMMAND.DODGE]: {
    id: COMMAND.DODGE,
    label: "얼버무린다",
    category: "REACT",
    public: true,
    needsCheck: true,
    req: { stealth: 25 },   // 예시
    chain: { after: [COMMAND.SUSPECT, COMMAND.COUNTER, COMMAND.DEFEND, COMMAND.COVER] },
  },
  [COMMAND.COUNTERATTACK]: {
    id: COMMAND.COUNTERATTACK,
    label: "반격한다",
    category: "REACT",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.SUSPECT, COMMAND.COUNTER] },
  },
  [COMMAND.ASK_HELP]: {
    id: COMMAND.ASK_HELP,
    label: "도움을 요청한다",
    category: "REACT",
    public: true,
    needsCheck: true,
    req: { acting: 25 },    // 예시
    chain: { after: [COMMAND.SUSPECT, COMMAND.COUNTER, COMMAND.DEFEND, COMMAND.COVER] },
  },
  [COMMAND.SAD]: {
    id: COMMAND.SAD,
    label: "슬퍼한다",
    category: "REACT",
    public: true,
    needsCheck: true,
    req: { charm: 25 },     // 예시
    chain: { after: [COMMAND.SUSPECT, COMMAND.COUNTER, COMMAND.DEFEND, COMMAND.COVER] },
  },
  [COMMAND.DONT_TRUST]: {
    id: COMMAND.DONT_TRUST,
    label: "속지마라",
    category: "REACT",
    public: true,
    needsCheck: true,
    req: { intuition: 30 }, // 예시
    chain: { after: [COMMAND.SUSPECT, COMMAND.COUNTER, COMMAND.DEFEND, COMMAND.COVER] },
  },
  [COMMAND.REQUEST_CO]: {
    id: COMMAND.REQUEST_CO,
    label: "역할을 밝혀라",
    category: "ROLE",
    public: true,
    needsCheck: true,
    req: {},
    chain: {}, // 단독 시작 커맨드
  },
  [COMMAND.CO_ROLE]: {
    id: COMMAND.CO_ROLE,
    label: "역할을 밝힌다",
    category: "ROLE",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.REQUEST_CO] },
  },
  [COMMAND.CO_SELF_TOO]: {
    id: COMMAND.CO_SELF_TOO,
    label: "자신도 밝힌다",
    category: "ROLE",
    public: true,
    needsCheck: true,
    req: {},
    chain: { after: [COMMAND.CO_ROLE] },
  },
  [COMMAND.ALL_EXCLUDE_ROLE]: {
    id: COMMAND.ALL_EXCLUDE_ROLE,
    label: "전원 배제해라",
    category: "VOTE",
    public: true,
    needsCheck: true,
    req: { logic: 30 }, // 예시
    chain: {},
  },
  [COMMAND.VOTE_HIM]: {
    id: COMMAND.VOTE_HIM,
    label: "투표해라",
    category: "VOTE",
    public: true,
    needsCheck: true,
    req: { logic: 10 }, // 예시
    chain: {},
  },
  [COMMAND.DONT_VOTE]: {
    id: COMMAND.DONT_VOTE,
    label: "투표하지 마라",
    category: "VOTE",
    public: true,
    needsCheck: true,
    req: { logic: 15 }, // 예시
    chain: {},
  },
  [COMMAND.CERT_HUMAN]: {
    id: COMMAND.CERT_HUMAN,
    label: "반드시 인간이다",
    category: "CERT",
    public: true,
    needsCheck: true,
    req: {},
    chain: {},
  },
  [COMMAND.CERT_ENEMY]: {
    id: COMMAND.CERT_ENEMY,
    label: "반드시 적이다",
    category: "CERT",
    public: true,
    needsCheck: true,
    req: {},
    chain: {},
  },
  [COMMAND.SAY_HUMAN]: {
    id: COMMAND.SAY_HUMAN,
    label: "인간이라고 말해",
    category: "TALK",
    public: true,
    needsCheck: true,
    req: {},
    chain: {},
  },
  [COMMAND.CHAT]: {
    id: COMMAND.CHAT,
    label: "잡담한다",
    category: "TALK",
    public: true,
    needsCheck: true,
    req: {},
    chain: {},
  },
  [COMMAND.DOGEZA]: {
    id: COMMAND.DOGEZA,
    label: "도게자한다",
    category: "TALK",
    public: true,
    needsCheck: true,
    req: {},
    chain: {},
  },
  [COMMAND.COOP]: {
    id: COMMAND.COOP,
    label: "협력한다",
    category: "COOP",
    public: true,
    needsCheck: true,
    req: {},
    chain: {},
  },
  [COMMAND.NIGHT_COOP]: {
    id: COMMAND.NIGHT_COOP,
    label: "밤에 협력을 제안",
    category: "NIGHT",
    public: true,
    needsCheck: true,
    req: {},
    chain: {},
  },
};

// ---- exports for UI convenience ----
// main.js가 체크박스를 만들 때 "반복 가능한 배열"이 필요하므로, 항상 배열로 제공
export const COMMAND_DEFS = Object.values(COMMAND_META);

// game.js 등에서 전체 ID가 필요할 때
export function getAllCommandIds() {
  return Object.keys(COMMAND_META);
}

// ---- eligibility helpers ----
function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export function statEligible(char, cmdId) {
  const def = COMMAND_META[cmdId];
  if (!def) return false;
  const req = def.req || {};
  const st = char?.stats || {};
  for (const k of Object.keys(req)) {
    if (STAT_KEYS.includes(k) && num(st[k]) < num(req[k])) return false;
  }
  return true;
}

// "기본 사용 가능" (체크 + 스탯)만 보는 함수
export function isCommandEligibleBasic(char, cmdId, ctx = null) {
  if (!COMMAND_META[cmdId]) return false;

  // 유저 체크 기반: enabledCommands(Set) 기준
  // (engine이 enabledCommands를 Set으로 유지한다고 가정)
  const enabled = char?.enabledCommands;
  if (enabled instanceof Set) {
    if (!enabled.has(cmdId)) return false;
  } else if (Array.isArray(enabled)) {
    if (!enabled.includes(cmdId)) return false;
  }
  return statEligible(char, cmdId);
}

// "연계(부속 커맨드) 조건"까지 포함해서 판정
// ctx: { chain: [{cmd,...}], ... } 형태를 가정
export function isChainEligible(char, cmdId, ctx = null) {
  const def = COMMAND_META[cmdId];
  if (!def) return false;

  if (!isCommandEligibleBasic(char, cmdId, ctx)) return false;

  const after = def.chain?.after;
  if (!after || !after.length) return true;

  const last = ctx?.chain?.length ? ctx.chain[ctx.chain.length - 1] : null;
  if (!last) return false;

  return after.includes(last.cmd);
}
