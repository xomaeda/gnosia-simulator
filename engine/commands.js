// engine/commands.js
// ============================================================================
// Command catalog (FULL) for Gnosia-like simulator
// - Contains ALL commands from your spec (+ night extra "밤에 협력을 제안")
// - Defines:
//   1) public visibility (UI에 체크/표시할지)
//   2) user-check required 여부 (캐릭터 생성에서 유저가 "이 캐릭터가 사용할 수 있음" 체크)
//   3) stat requirements (스테이터스 충족 여부)
//   4) chain requirements (부속 커맨드: 어떤 커맨드 뒤에만 가능한지)
//   5) limits (1일 1회 / 루프 1회 / etc)
//   6) notes / category
//
// IMPORTANT (your clarified rules):
// - "스테이터스 조건을 충족하지 못하면 유저가 체크해도 사용 불가"
// - BUT 유저는 "스테이터스는 되지만 성향상 절대 사용 안함" 같은 걸 위해 체크로 제한 가능
//
// Internal commands (찬성/반대/잡담참여/중단/인간선언 등)은 UI에 공개하지 않음.
//
// Exports (main.js / game.js 호환):
// - COMMAND
// - COMMAND_META (aka COMMAND_DEFS)
// - COMMAND_DEFS
// - getAllCommandIds
// - getChecklistCommandsForCharacter
// - groupChecklistCommands
// - getCommandMeta
// - statEligible
// - isCommandEligibleBasic
// - isChainEligible
// - getSuggestedDefaultChecks
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

  // --- Role talk ---
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

  // --- Vote / declare ---
  VOTE_HIM: "투표해라",
  DONT_VOTE: "투표하지 마라",
  CERT_HUMAN: "반드시 인간이다",
  CERT_ENEMY: "반드시 적이다",
  ALL_EXCLUDE_ROLE: "전원 배제해라",

  // --- Social ---
  CHAT: "잡담한다",
  COOP: "협력하자",
  SAY_HUMAN: "인간이라고 말해",
  DOGEZA: "도게자한다",

  // --- Night extra (your added) ---
  NIGHT_COOP: "밤에 협력을 제안",

  // --- Internal (NOT exposed on UI) ---
  _APPROVE: "찬성한다",
  _REJECT: "반대한다",
  _CHAT_JOIN: "잡담에 참여한다",
  _CHAT_STOP: "잡담을 중단시킨다",
  _SAY_HUMAN_DECL: "나는 인간이야",
  _SAY_HUMAN_SKIP: "아무 말도 하지 않는다",
  _SAY_HUMAN_STOP: "선언을 중단시킨다",
};

// --------- helpers ---------
export function statEligible(stats, req = {}) {
  // stats fields: charisma, logic, acting, charm, stealth, intuition
  // req fields can be subset
  for (const k of Object.keys(req)) {
    if ((Number(stats?.[k]) || 0) < req[k]) return false;
  }
  return true;
}

// 어떤 커맨드는 "기본 커맨드(누구나 가능)"이라서 유저 체크가 없어도 엔진이 사용 가능
// alwaysAvailable: 체크 없어도 가능(기획서에서 누구나 가능)
// userCheckRequired: true => 유저가 체크해줘야 그 캐릭터가 시도 가능
// showOnChecklist: 캐릭터 생성에서 체크 UI로 표시할지
// visibleInUI: UI에 커맨드 이름을 보여줄지 (internal은 false)
//
// chain: afterAnyOf / beforeAnyOf / notAfter / startsChain 등 연계 조건
// limits: perDay, perLoop, perNight, perChain 등
export const COMMAND_META = {
  // =======================
  // 기본/핵심 (누구나)
  // =======================
  [COMMAND.SUSPECT]: {
    label: "의심한다",
    category: "DAY_MAIN",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: { startsChain: true },
    limits: { perChain: 1 },
    note: "대상을 의심. 신뢰/우호 하락 + 동조 유도(카리스마).",
  },

  [COMMAND.COVER]: {
    label: "감싼다",
    category: "DAY_MAIN",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: { startsChain: true },
    limits: { perChain: 1 },
    note: "대상을 옹호. 신뢰/우호 상승 + 동조 유도(카리스마).",
  },

  [COMMAND.DENY]: {
    label: "부정한다",
    category: "DAY_REACTIVE",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: {
      afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER],
      onlyIfSelfIsTarget: true,
    },
    limits: { perChain: 1 },
    note: "자신이 의심당했을 때 반박(신뢰/우호 일부 회복). 타이밍 따라 역효과 가능.",
  },

  [COMMAND.DEFEND]: {
    label: "변호한다",
    category: "DAY_SUB",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: {
      afterAnyOf: [
        COMMAND.SUSPECT,
        COMMAND.AGREE_SUSPECT,
        COMMAND.DENY,
        COMMAND.COUNTER,
        COMMAND.AGREE_COUNTER,
      ],
      needsTarget: true,
    },
    limits: { perChain: 1 },
    note: "의심받는 대상을 변호하여 신뢰/우호 회복 + 동조 유도(카리스마).",
  },

  [COMMAND.AGREE_SUSPECT]: {
    label: "의심에 동의한다",
    category: "DAY_SUB",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: {
      afterAnyOf: [COMMAND.SUSPECT],
      beforeAnyOf: [COMMAND.DENY, COMMAND.DEFEND],
      needsTargetFromChain: true,
    },
    limits: { perChain: 1 },
    note: "의심 발언에 동조(효과 낮지만 어그로 적음).",
  },

  [COMMAND.AGREE_DEFEND]: {
    label: "변호에 가담한다",
    category: "DAY_SUB",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: { afterAnyOf: [COMMAND.DEFEND], needsTargetFromChain: true },
    limits: { perChain: 1 },
    note: "변호에 동조(의심동의의 변호 버전).",
  },

  [COMMAND.AGREE_COVER]: {
    label: "함께 감싼다",
    category: "DAY_SUB",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: { afterAnyOf: [COMMAND.COVER], needsTargetFromChain: true },
    limits: { perChain: 1 },
    note: "감싼다에 동조(의심동의의 감싼다 버전).",
  },

  [COMMAND.THANK]: {
    label: "감사한다",
    category: "DAY_REACTIVE",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: {
      afterAnyOf: [COMMAND.COVER, COMMAND.DEFEND, COMMAND.CERT_HUMAN],
      onlyIfSelfWasBenefited: true,
    },
    limits: { perChain: 1 },
    note: "답례. 어그로↓ + 호감↑(귀염성).",
  },

  [COMMAND.COUNTER]: {
    label: "반론한다",
    category: "DAY_SUB",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: {
      afterAnyOf: [COMMAND.COVER, COMMAND.VOTE_HIM, COMMAND.DONT_VOTE],
      needsTargetFromChain: true,
    },
    limits: { perChain: 1 },
    note: "옹호/제안에 반박. 대상 신뢰/우호↓ + 동조 유도(카리스마).",
  },

  [COMMAND.AGREE_COUNTER]: {
    label: "반론에 가담한다",
    category: "DAY_SUB",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: { afterAnyOf: [COMMAND.COUNTER], needsTargetFromChain: true },
    limits: { perChain: 1 },
    note: "반론에 동조.",
  },

  [COMMAND.NOISY]: {
    label: "시끄러워",
    category: "DAY_SUB",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: {},
    chain: { afterAnyOf: [COMMAND.SUSPECT, COMMAND.COVER], needsTargetFromChain: true },
    limits: { perChain: 1 },
    note: "말이 많은 사람을 지적(상황부 커맨드).",
  },

  // =======================
  // 역할 관련
  // =======================
  [COMMAND.REQUEST_CO]: {
    label: "역할을 밝혀라",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { charisma: 10 },
    chain: { startsChain: true, needsTarget: true },
    limits: { perDay: 1, perRolePerDay: true },
    note: "CO 유도(대상: 엔지/닥/선내대기인만 CO 가능).",
  },

  [COMMAND.CO_ROLE]: {
    label: "역할을 밝힌다",
    category: "DAY_SUB",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: { afterAnyOf: [COMMAND.REQUEST_CO] },
    limits: { perDay: 1, perRolePerDay: true },
    note: "자신의 역할을 선언(진실/사칭은 엔진에서 판정).",
  },

  [COMMAND.CO_SELF_TOO]: {
    label: "자신도 밝힌다",
    category: "DAY_SUB",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: true,
    req: {},
    chain: { afterAnyOf: [COMMAND.CO_ROLE] },
    limits: { perDay: 1, perRolePerDay: true },
    note: "다른 인물이 CO한 뒤 같은 역할로 자신도 CO.",
  },

  // =======================
  // 강화/확장
  // =======================
  [COMMAND.EXAGGERATE]: {
    label: "과장해서 말한다",
    category: "DAY_SUB",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { acting: 15 },
    chain: {
      afterAnyOf: [
        COMMAND.SUSPECT,
        COMMAND.COVER,
        COMMAND.DEFEND,
        COMMAND.COUNTER,
        COMMAND.AGREE_SUSPECT,
        COMMAND.AGREE_COVER,
        COMMAND.AGREE_DEFEND,
        COMMAND.AGREE_COUNTER,
      ],
      needsTargetFromChain: true,
    },
    limits: { perChain: 1 },
    note: "동조 가능한 발언 뒤. 우호(연기력) 강화 + 어그로↑",
  },

  [COMMAND.ASK_AGREE]: {
    label: "동의를 구한다",
    category: "DAY_SUB",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { charisma: 25 },
    chain: { afterAnyOf: [COMMAND.SUSPECT, COMMAND.COVER], needsTargetFromChain: true },
    limits: { perChain: 1 },
    note: "추가 동조 유도. 아무도 동조 안 하면 어그로만 쌓일 수 있음.",
  },

  [COMMAND.BLOCK_REBUT]: {
    label: "반론을 막는다",
    category: "DAY_SUB",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { charisma: 40 },
    chain: {
      afterAnyOf: [COMMAND.SUSPECT, COMMAND.COVER],
      notAfter: [COMMAND.COUNTER],
      needsTargetFromChain: true,
    },
    limits: { perChain: 1 },
    note: "반론(옹호) 동조를 봉쇄. 도움요청 성공 시 무효화 가능(엔진 처리).",
  },

  // =======================
  // 방어/반응형
  // =======================
  [COMMAND.DODGE]: {
    label: "얼버무린다",
    category: "DAY_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { stealth: 25 },
    chain: { afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER], onlyIfSelfIsTarget: true },
    limits: { perChain: 1 },
    note: "논의를 즉시 종료하고 다음 라운드로. 대신 아무도 자신을 옹호 못함.",
  },

  [COMMAND.COUNTERATTACK]: {
    label: "반격한다",
    category: "DAY_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { logic: 25, acting: 25 },
    chain: { afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER], onlyIfSelfIsTarget: true, targetsAttacker: true },
    limits: { perChain: 1 },
    note: "공격자 신뢰/우호를 역공. 대신 본인 피해는 회복 안 됨.",
  },

  [COMMAND.ASK_HELP]: {
    label: "도움을 요청한다",
    category: "DAY_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { acting: 30 },
    chain: { afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER], onlyIfSelfIsTarget: true },
    limits: { perChain: 1 },
    note: "지정 대상에게 변호 요청. 성공 시 반론 봉쇄 무효화 가능(엔진 처리).",
  },

  [COMMAND.SAD]: {
    label: "슬퍼한다",
    category: "DAY_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { charm: 25 },
    chain: { afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER], onlyIfSelfIsTarget: true },
    limits: { perChain: 1 },
    note: "동정심 유발로 변호 유도.",
  },

  [COMMAND.DONT_TRUST]: {
    label: "속지마라",
    category: "DAY_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { intuition: 30 },
    chain: { afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER], onlyIfSelfIsTarget: true, marksAttacker: true, cooldownToSameTarget: true },
    limits: { perDay: 1 },
    note: "상대 거짓말 노출 확률↑(직감). 같은 상대 연속 사용 제한(엔진 처리).",
  },

  // =======================
  // 투표/확정/전원배제
  // =======================
  [COMMAND.VOTE_HIM]: {
    label: "투표해라",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { logic: 10 },
    chain: { startsChain: true, needsTarget: true },
    limits: { perDay: 1 },
    note: "투표 제안(타인 투표확률↑).",
  },

  [COMMAND.DONT_VOTE]: {
    label: "투표하지 마라",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { logic: 15 },
    chain: { startsChain: true, needsTarget: true, lastsOneDay: true },
    limits: { perDay: 1 },
    note: "특정 대상을 투표하지 말자 제안. 하루 지속.",
  },

  [COMMAND.CERT_HUMAN]: {
    label: "반드시 인간이다",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { logic: 20 },
    chain: { startsChain: true, needsTarget: true, noRepeatOnSameTarget: true },
    limits: { perDay: 1 },
    note: "인간 확정 대상에게만 사용(중복 불가).",
  },

  [COMMAND.CERT_ENEMY]: {
    label: "반드시 적이다",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { logic: 20 },
    chain: { startsChain: true, needsTarget: true },
    limits: { perDay: 1 },
    note: "적 확정 대상에게 사용. 이후 활동 제한(엔진 처리).",
  },

  [COMMAND.ALL_EXCLUDE_ROLE]: {
    label: "전원 배제해라",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { logic: 30 },
    chain: { startsChain: true, needsRoleGroup: true, cannotTargetOwnClaimRole: true },
    limits: { perLoop: 1 },
    note: "지목한 역할 전원에 투표 확률↑. 반대 나오면 끊김.",
  },

  // =======================
  // 잡담/협력/인간선언/도게자
  // =======================
  [COMMAND.CHAT]: {
    label: "잡담한다",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { stealth: 10 },
    chain: { startsChain: true },
    limits: { perDay: 1 },
    note: "어그로↓. 참여자들과 우호↑. 누군가 중단 가능.",
  },

  [COMMAND.COOP]: {
    label: "협력하자",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { charm: 15 },
    chain: { startsChain: true, needsTarget: true, onlyIfNotCooperating: true },
    limits: { perDay: 1 },
    note: "대상에게 협력 제안. 수락 시 우호 최고 단계로.",
  },

  [COMMAND.SAY_HUMAN]: {
    label: "인간이라고 말해",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { intuition: 20 },
    chain: { startsChain: true },
    limits: { perLoop: 1 },
    note: "전원에게 '나는 인간' 발언 유도. 누군가 중단 가능.",
  },

  [COMMAND.DOGEZA]: {
    label: "도게자한다",
    category: "DAY_VOTE_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { stealth: 35 },
    chain: { onlyOnColdSleepResult: true },
    limits: { perLoop: 1 },
    note: "콜드슬립 대상 시 회피 확률(연기력 기반, 엔진 처리).",
  },

  // =======================
  // Night extra: 협력 제안
  // =======================
  [COMMAND.NIGHT_COOP]: {
    label: "밤에 협력을 제안",
    category: "NIGHT",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: {},
    chain: { nightOnly: true },
    limits: { perNight: 1 },
    note: "밤 자유행동에서 협력 요청. 수락/거절. 수락 시 상호 우호↑(엔진 처리).",
  },

  // =======================
  // Internal (UI에 노출 X)
  // =======================
  [COMMAND._APPROVE]: {
    label: "찬성한다",
    category: "INTERNAL",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: false,
    req: {},
    chain: { afterAnyOf: [COMMAND.VOTE_HIM, COMMAND.DONT_VOTE, COMMAND.ALL_EXCLUDE_ROLE] },
    limits: { perChain: 1 },
    note: "제안에 찬성.",
  },

  [COMMAND._REJECT]: {
    label: "반대한다",
    category: "INTERNAL",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: false,
    req: {},
    chain: { afterAnyOf: [COMMAND.VOTE_HIM, COMMAND.DONT_VOTE, COMMAND.ALL_EXCLUDE_ROLE], endsChainImmediately: true },
    limits: { perChain: 1 },
    note: "반대가 나오면 즉시 턴 종료.",
  },

  [COMMAND._CHAT_JOIN]: {
    label: "잡담에 참여한다",
    category: "INTERNAL",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: false,
    req: {},
    chain: { afterAnyOf: [COMMAND.CHAT] },
    limits: { perChain: 1 },
    note: "잡담 참여(누구나 가능).",
  },

  [COMMAND._CHAT_STOP]: {
    label: "잡담을 중단시킨다",
    category: "INTERNAL",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: false,
    req: {},
    chain: { afterAnyOf: [COMMAND.CHAT], endsChainImmediately: true },
    limits: { perChain: 1 },
    note: "잡담 중단(누구나 가능).",
  },

  [COMMAND._SAY_HUMAN_DECL]: {
    label: "나는 인간이야",
    category: "INTERNAL",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: false,
    req: {},
    chain: { afterAnyOf: [COMMAND.SAY_HUMAN] },
    limits: { perChain: 1 },
    note: "인간 선언.",
  },

  [COMMAND._SAY_HUMAN_SKIP]: {
    label: "아무 말도 하지 않는다",
    category: "INTERNAL",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: false,
    req: {},
    chain: { afterAnyOf: [COMMAND.SAY_HUMAN] },
    limits: { perChain: 1 },
    note: "선언 안 함.",
  },

  [COMMAND._SAY_HUMAN_STOP]: {
    label: "선언을 중단시킨다",
    category: "INTERNAL",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: false,
    req: {},
    chain: { afterAnyOf: [COMMAND.SAY_HUMAN], endsChainImmediately: true },
    limits: { perChain: 1 },
    note: "선언을 끊음(매우 의심스러워짐).",
  },
};

// ----------------------------------------------------------------------------
// Public API for UI + engine
// ----------------------------------------------------------------------------

/**
 * UI에서 "체크 리스트로 보여줄 커맨드 목록"을 가져온다.
 * - 스탯 조건을 충족하는 것만 반환(충족 못하면 '처음부터 선택 불가' 요구 반영)
 */
export function getChecklistCommandsForCharacter(char) {
  const out = [];
  for (const id of Object.keys(COMMAND_META)) {
    const m = COMMAND_META[id];
    if (!m.visibleInUI) continue;
    if (!m.showOnChecklist) continue;

    // stat gate: 스탯이 안 되면 체크 자체를 못 하게
    if (!statEligible(char?.stats, m.req || {})) continue;

    out.push({ id, label: m.label, category: m.category, note: m.note });
  }

  out.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.label.localeCompare(b.label, "ko");
  });

  return out;
}

export function groupChecklistCommands(list) {
  const groups = new Map();
  for (const item of list) {
    const g = item.category || "OTHER";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(item);
  }
  return groups;
}

export function getCommandMeta(id) {
  return COMMAND_META[id] || null;
}

/**
 * (엔진용) 기본 사용 가능 판정(생존, 스탯, 유저체크, 페이즈)
 */
export function isCommandEligibleBasic({ char, commandId, phase }) {
  const meta = COMMAND_META[commandId];
  if (!meta) return false;
  if (!char?.alive) return false;

  if (meta.chain?.nightOnly) {
    if (phase !== "NIGHT_FREE" && phase !== "NIGHT_RESOLVE") return false;
  } else {
    // nightOnly 아닌 커맨드는 밤자유행동에서 기본적으로 사용하지 않음(엔진에서 예외 처리 가능)
    if (phase === "NIGHT_FREE") return false;
  }

  if (!statEligible(char.stats, meta.req || {})) return false;

  if (meta.userCheckRequired) {
    const enabled =
      (char.enabledCommands?.has?.(commandId)) ||
      (Array.isArray(char.enabledCommands) && char.enabledCommands.includes(commandId));
    if (!enabled) return false;
  }

  return true;
}

/**
 * (엔진용) 부속 커맨드 연계 조건 판정
 */
export function isChainEligible({ char, commandId, ctx }) {
  const meta = COMMAND_META[commandId];
  if (!meta) return false;
  const rule = meta.chain || {};
  const chain = Array.isArray(ctx?.chain) ? ctx.chain : [];
  const last = chain.length ? chain[chain.length - 1] : null;
  const main = chain.length ? chain[0] : null;

  if (rule.startsChain && chain.length > 0) return false;

  if (rule.afterAnyOf && rule.afterAnyOf.length) {
    const ok = chain.some((x) => rule.afterAnyOf.includes(x.cmd));
    if (!ok) return false;
  }

  if (rule.beforeAnyOf && rule.beforeAnyOf.length) {
    const exists = chain.some((x) => rule.beforeAnyOf.includes(x.cmd));
    if (exists) return false;
  }

  if (rule.notAfter && rule.notAfter.length && last) {
    if (rule.notAfter.includes(last.cmd)) return false;
  }

  if (rule.needsTarget && !ctx?.targetId) return false;
  if (rule.needsTargetFromChain && !ctx?.targetId) return false;

  if (rule.onlyIfSelfIsTarget) {
    if (!ctx?.targetId) return false;
    if (ctx.targetId !== char.id) return false;
  }

  if (rule.targetsAttacker) {
    if (!main) return false;
  }

  return true;
}

/**
 * 추천 기본 체크(옵션)
 */
export function getSuggestedDefaultChecks(char) {
  const all = getChecklistCommandsForCharacter(char);
  const prefer = new Set([
    COMMAND.NOISY,
    COMMAND.EXAGGERATE,
    COMMAND.ASK_AGREE,
    COMMAND.BLOCK_REBUT,
    COMMAND.DODGE,
    COMMAND.COUNTERATTACK,
    COMMAND.ASK_HELP,
    COMMAND.SAD,
    COMMAND.DONT_TRUST,
    COMMAND.REQUEST_CO,
    COMMAND.VOTE_HIM,
    COMMAND.DONT_VOTE,
    COMMAND.CERT_HUMAN,
    COMMAND.CERT_ENEMY,
    COMMAND.ALL_EXCLUDE_ROLE,
    COMMAND.CHAT,
    COMMAND.COOP,
    COMMAND.SAY_HUMAN,
    COMMAND.DOGEZA,
    COMMAND.NIGHT_COOP,
  ]);
  return all.filter((x) => prefer.has(x.id)).map((x) => x.id);
}

// ----------------------------------------------------------------------------
// Compatibility exports for main.js / game.js
// ----------------------------------------------------------------------------
export const COMMAND_DEFS = COMMAND_META;

/** 전체 커맨드 ID 목록(중복 선언 금지: 이 함수는 여기 1개만 존재해야 함) */
export function getAllCommandIds() {
  return Object.keys(COMMAND_META);
}
