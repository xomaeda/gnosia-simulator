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
// This file is designed to be used by:
// - UI: "이 캐릭터가 체크 가능한 커맨드" 목록 생성 (statEligible 필터)
// - Engine: "연계 가능 커맨드" 판정 및 1일 1회 제한 같은 룰 체크
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
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function statEligible(stats, req = {}) {
  // stats fields: charisma, logic, acting, charm, stealth, intuition
  // req fields can be subset
  for (const k of Object.keys(req)) {
    if ((Number(stats?.[k]) || 0) < req[k]) return false;
  }
  return true;
}

// 어떤 커맨드는 "기본 커맨드(누구나 가능)"이라서 유저 체크가 없어도 엔진이 사용 가능
// 다만 UI에서는 "체크 항목"으로 보여주지 않을 수도 있음(원하면 showOnChecklist로).
//
// userCheckRequired: true => 유저가 체크해줘야 그 캐릭터가 시도 가능
// alwaysAvailable: true => 체크 없어도 가능(기획서에서 누구나 가능한 것들)
// showOnChecklist: true => 캐릭터 생성에서 체크 UI로 표시할지
// visibleInUI: true => 커맨드 이름을 UI에 보여줄지 (internal은 false)
//
// chain: afterAnyOf / afterAllOf / notAfter / topicRequired 같은 연계 조건
// limits: perDay, perLoop, perChain (1턴 1회 같은 개념은 perChain)
export const COMMAND_META = {
  // =======================
  // 기본/핵심 (누구나)
  // =======================
  [COMMAND.SUSPECT]: {
    label: "의심한다",
    category: "DAY_MAIN",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false, // 누구나 가능이라 체크를 굳이 안 보여도 됨(원하면 true로)
    visibleInUI: true,
    req: {}, // none
    chain: { startsChain: true },
    limits: { perChain: 1 }, // 1턴에 시작 커맨드는 1개
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
      // 반론봉쇄(BLOCK_REBUT) 있으면 막힘(단 도움요청 성공으로 무효화 가능) => 엔진에서 처리
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
    chain: {
      afterAnyOf: [COMMAND.DEFEND],
      needsTargetFromChain: true,
    },
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
    chain: {
      afterAnyOf: [COMMAND.COVER],
      needsTargetFromChain: true,
    },
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
      // 엄밀히는: 감싸짐 직후 OR 반드시 인간이다 지목 직후
      afterAnyOf: [COMMAND.COVER, COMMAND.DEFEND, COMMAND.CERT_HUMAN],
      onlyIfSelfWasBenefited: true,
    },
    limits: { perChain: 1 },
    note: "답례. 어그로↓ + 호감↑(귀염성 성격/스탯과 시너지는 엔진에서).",
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
    chain: {
      afterAnyOf: [COMMAND.COUNTER],
      needsTargetFromChain: true,
    },
    limits: { perChain: 1 },
    note: "반론에 동조.",
  },

  [COMMAND.NOISY]: {
    label: "시끄러워",
    category: "DAY_SUB",
    alwaysAvailable: false,
    userCheckRequired: true,      // 성향상 안 쓰게 막으려면 체크형이 자연스러움
    showOnChecklist: true,
    visibleInUI: true,
    req: {}, // 기획서에 조건이 '상황'이라 스탯 조건 없음
    chain: {
      afterAnyOf: [COMMAND.SUSPECT, COMMAND.COVER],
      // '발언 너무 많은 사람' 조건은 엔진에서 판단
      needsTargetFromChain: true,
    },
    limits: { perChain: 1 },
    note: "말이 많은 사람을 지적. (상황부 커맨드)",
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
    limits: { perDay: 1, perRolePerDay: true }, // 같은 역할에 대해 1일 1회 (엔진에서 roleKey로 구현)
    note:
      "아직 CO 안한 인물을 확률로 커밍아웃하게 유도. (대상: 엔지니어/닥터/선내대기인만 CO 가능)",
  },

  [COMMAND.CO_ROLE]: {
    label: "역할을 밝힌다",
    category: "DAY_SUB",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false, // 유저 체크 대상 아님(엔진이 필요 시 사용)
    visibleInUI: true,
    req: {},
    chain: {
      afterAnyOf: [COMMAND.REQUEST_CO],
      // 실제 CO 가능자 규칙:
      // - 진짜로 엔지/닥/선내대기인 OR
      // - 거짓말 가능(그노시아/AC/버그)이고 엔지/닥 사칭만 가능
      // - AC/BUG/GNOSIA/CREW은 "CO 불가"(너가 규칙으로 확정) => 엔진에서 엄격 적용
    },
    limits: { perDay: 1, perRolePerDay: true },
    note: "자신의 역할을 선언(진실 or 사칭).",
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
    note: "동조 가능한 발언 뒤에 사용. 우호도(연기력) 쪽 위력 강화 + 어그로↑",
  },

  [COMMAND.ASK_AGREE]: {
    label: "동의를 구한다",
    category: "DAY_SUB",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { charisma: 25 },
    chain: {
      afterAnyOf: [COMMAND.SUSPECT, COMMAND.COVER],
      needsTargetFromChain: true,
    },
    limits: { perChain: 1 },
    note: "추가 동조를 유도. 아무도 동조 안 하면 어그로만 쌓일 수 있음.",
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
      notAfter: [COMMAND.COUNTER], // 반론 뒤에는 사용 불가
      needsTargetFromChain: true,
    },
    limits: { perChain: 1 },
    note:
      "동의+상대의 반론(옹호) 동조를 막음. 어그로 매우 큼. '도움을 요청한다' 성공 시 무효화 가능.",
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
    chain: {
      afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER],
      onlyIfSelfIsTarget: true,
    },
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
    chain: {
      afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER],
      onlyIfSelfIsTarget: true,
      targetsAttacker: true,
    },
    limits: { perChain: 1 },
    note: "공격자 신뢰/우호를 역공. 대신 본인 피해는 회복 안 되는 육참골단.",
  },

  [COMMAND.ASK_HELP]: {
    label: "도움을 요청한다",
    category: "DAY_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { acting: 30 },
    chain: {
      afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER],
      onlyIfSelfIsTarget: true,
    },
    limits: { perChain: 1 },
    note:
      "지정 대상에게 변호 요청. 연기력/카리스마/우호도 따라 성공. 반론 봉쇄가 있으면 성공 시 무효화.",
  },

  [COMMAND.SAD]: {
    label: "슬퍼한다",
    category: "DAY_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { charm: 25 },
    chain: {
      afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER],
      onlyIfSelfIsTarget: true,
    },
    limits: { perChain: 1 },
    note: "동정심 유발로 변호 유도. 방어용으로 강력.",
  },

  [COMMAND.DONT_TRUST]: {
    label: "속지마라",
    category: "DAY_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { intuition: 30 },
    chain: {
      afterAnyOf: [COMMAND.SUSPECT, COMMAND.AGREE_SUSPECT, COMMAND.COUNTER],
      // 원문: '거짓말을 한 사람, 또는 선원 편이 아닐 때 아무에게나 의심 등 공격당했을 때'
      onlyIfSelfIsTarget: true,
      marksAttacker: true,
      cooldownToSameTarget: true, // 다음날 보고 끝날 때까지 같은 사람에게 재사용 불가(엔진에서)
    },
    limits: { perDay: 1 },
    note:
      "상대가 거짓말했을 때 들킬 확률↑(직감). 선원편은 '거짓말을 알아챈 적' 있어야만 사용 가능(엔진이 판단).",
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
    note:
      "엔지니어가 그노시아라고 보고한 사람/반드시 적/확정 적이 있을 때 제안. 타인 투표확률↑",
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
    note:
      "인간 확정 대상에게만 사용 가능(중복 불가). 이후 논의에서 공격대상으로 거론되지 않게 됨.",
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
    note:
      "거짓말 확정/인간의 적 확정 대상에게 사용. 이후 논의에서 활동 제한(엔진에서 처리).",
  },

  [COMMAND.ALL_EXCLUDE_ROLE]: {
    label: "전원 배제해라",
    category: "DAY_MAIN",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { logic: 30 },
    chain: {
      startsChain: true,
      needsRoleGroup: true, // "지목한 역할군" 필요 (엔진에서 role pick)
      cannotTargetOwnClaimRole: true,
    },
    limits: { perLoop: 1 },
    note:
      "가짜가 섞일 수 있는 역할에 둘 이상 CO했을 때, 해당 역할 전원 투표 확률↑. 반대가 나오면 끊김.",
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
    note:
      "제안자의 어그로↓. 참여자(최대 3명)와 우호↑. 누군가 끊을 수 있음(끊는 사람과 우호↓).",
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
    note:
      "대상에게 협력 제안. 반드시 수락하진 않음(귀염성/우호 영향). 수락 시 우호 최고 단계로.",
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
    note:
      "전원에게 '나는 인간' 발언 유도. 누군가 끊을 수 있음(끊는 행위가 신뢰↓).",
  },

  [COMMAND.DOGEZA]: {
    label: "도게자한다",
    category: "DAY_VOTE_REACTIVE",
    alwaysAvailable: false,
    userCheckRequired: true,
    showOnChecklist: true,
    visibleInUI: true,
    req: { stealth: 35 }, // 기획서: 스텔스 35 이상
    chain: { onlyOnColdSleepResult: true },
    limits: { perLoop: 1 },
    note:
      "투표로 콜드슬립 될 때 발동. 연기력 기반으로 콜드슬립 회피 확률.",
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
    req: {}, // 스탯 조건 없음(너가 추가 요구)
    chain: { nightOnly: true },
    limits: { perNight: 1 },
    note:
      "밤 자유행동에서 협력 요청 로그 생성. 수락/거절 가능. 수락 시 상호 우호 크게 상승.",
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
    chain: {
      afterAnyOf: [COMMAND.VOTE_HIM, COMMAND.DONT_VOTE, COMMAND.ALL_EXCLUDE_ROLE],
    },
    limits: { perChain: 1 },
    note: "투표/전원배제 제안에 대한 찬성.",
  },

  [COMMAND._REJECT]: {
    label: "반대한다",
    category: "INTERNAL",
    alwaysAvailable: true,
    userCheckRequired: false,
    showOnChecklist: false,
    visibleInUI: false,
    req: {},
    chain: {
      afterAnyOf: [COMMAND.VOTE_HIM, COMMAND.DONT_VOTE, COMMAND.ALL_EXCLUDE_ROLE],
      endsChainImmediately: true,
    },
    limits: { perChain: 1 },
    note: "반대가 나오면 즉시 그 턴 종료.",
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
    note: "잡담 참여(누구나 가능, 체크 불필요).",
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
    note: "인간 선언(거짓말 가능 진영은 거짓 선언이 됨).",
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
 * - alwaysAvailable false인데 userCheckRequired true인 것들 중심
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

  // 보기 좋게 카테고리/이름순 정렬
  out.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.label.localeCompare(b.label, "ko");
  });

  return out;
}

/**
 * 커맨드 메타를 반환
 */
export function getCommandMeta(id) {
  return COMMAND_META[id] || null;
}

/**
 * (엔진용) 어떤 커맨드를 "시도 가능"인지 1차 판정:
 * - alive, stat, userCheckRequired, phase(낮/밤) 같은 기본 조건
 * - chain 연계 조건은 ctx 기반으로 별도로 판정 (isChainEligible)
 */
export function isCommandEligibleBasic({ char, commandId, phase }) {
  const meta = COMMAND_META[commandId];
  if (!meta) return false;
  if (!char?.alive) return false;

  if (meta.chain?.nightOnly && phase !== "NIGHT_FREE" && phase !== "NIGHT_RESOLVE") return false;
  if (!meta.chain?.nightOnly && phase === "NIGHT_FREE") {
    // 밤 자유행동에서 쓸 수 있는 낮 커맨드는 없음(원하면 예외 추가)
    // 단 NIGHT_COOP는 nightOnly라 여기 안 걸림
  }

  // stat requirement
  if (!statEligible(char.stats, meta.req || {})) return false;

  // user check requirement
  if (meta.userCheckRequired && !(char.enabledCommands?.has?.(commandId) || char.enabledCommands?.includes?.(commandId))) {
    return false;
  }

  return true;
}

/**
 * (엔진용) 부속 커맨드 연계 조건 판정.
 * ctx는 엔진이 쓰는 턴 컨텍스트(이전 커맨드들, 체인 타겟 등)를 의미.
 *
 * ctx 예시 필드(엔진 구현에 맞춰 확장 가능):
 * - chain: [{actorId, cmd, targetId, extra}, ...]
 * - targetId: 메인 커맨드 대상
 * - topic: 메인 커맨드 종류
 * - selfIsTarget: boolean (현재 char가 타겟인지)
 */
export function isChainEligible({ char, commandId, ctx }) {
  const meta = COMMAND_META[commandId];
  if (!meta) return false;
  const rule = meta.chain || {};
  const chain = Array.isArray(ctx?.chain) ? ctx.chain : [];
  const last = chain.length ? chain[chain.length - 1] : null;
  const main = chain.length ? chain[0] : null;

  // startsChain: 체인이 비어있어야 함
  if (rule.startsChain && chain.length > 0) return false;

  // afterAnyOf
  if (rule.afterAnyOf && rule.afterAnyOf.length) {
    const ok = chain.some((x) => rule.afterAnyOf.includes(x.cmd));
    if (!ok) return false;
  }

  // beforeAnyOf (즉, 아직 그 커맨드들이 나오기 전이어야)
  if (rule.beforeAnyOf && rule.beforeAnyOf.length) {
    const exists = chain.some((x) => rule.beforeAnyOf.includes(x.cmd));
    if (exists) return false;
  }

  // notAfter (마지막 커맨드가 notAfter에 해당하면 불가)
  if (rule.notAfter && rule.notAfter.length && last) {
    if (rule.notAfter.includes(last.cmd)) return false;
  }

  // needsTarget: 이 커맨드 자체가 타겟 필요(엔진에서 targetId를 꼭 줘야)
  if (rule.needsTarget && !ctx?.targetId) return false;

  // needsTargetFromChain: 체인의 target이 있어야
  if (rule.needsTargetFromChain && !ctx?.targetId) return false;

  // onlyIfSelfIsTarget
  if (rule.onlyIfSelfIsTarget) {
    if (!ctx?.targetId) return false;
    if (ctx.targetId !== char.id) return false;
  }

  // targetsAttacker: 엔진에서 "공격자=main.actorId" 같은 규칙으로 타겟을 잡아야 함
  // 여기서는 최소로 'main 존재'만 체크
  if (rule.targetsAttacker) {
    if (!main) return false;
  }

  // endsChainImmediately 같은 건 판정이 아니라 힌트(엔진이 처리)
  return true;
}

/**
 * UI 용: 커맨드를 "표시용 그룹"으로 묶어준다.
 */
export function groupChecklistCommands(list) {
  const groups = new Map();
  for (const item of list) {
    const g = item.category || "OTHER";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(item);
  }
  return groups;
}

/**
 * (선택) 기본 체크 추천:
 * - 유저가 체크 안 해도 되지만, "성향 체크" 편의를 위해 추천 세트를 제공할 수 있음.
 * - 필요없으면 UI에서 안 써도 됨.
 */
export function getSuggestedDefaultChecks(char) {
  const all = getChecklistCommandsForCharacter(char);
  // 기본 추천: 범용/자주 쓰는 것들 몇 개
  const prefer = new Set([
    COMMAND.NOISY,
    COMMAND.EXAGGERATE,
    COMMAND.ASK_AGREE,
    COMMAND.DODGE,
    COMMAND.COUNTERATTACK,
    COMMAND.ASK_HELP,
    COMMAND.SAD,
    COMMAND.DONT_TRUST,
    COMMAND.VOTE_HIM,
    COMMAND.DONT_VOTE,
    COMMAND.CERT_HUMAN,
    COMMAND.CERT_ENEMY,
    COMMAND.CHAT,
    COMMAND.COOP,
    COMMAND.SAY_HUMAN,
    COMMAND.DOGEZA,
    COMMAND.NIGHT_COOP,
    COMMAND.REQUEST_CO,
    COMMAND.BLOCK_REBUT,
    COMMAND.ALL_EXCLUDE_ROLE,
  ]);

  return all.filter((x) => prefer.has(x.id)).map((x) => x.id);
}

// =========================
// export helper (FIX)
// =========================

  // COMMAND가 배열이면 그대로
  if (Array.isArray(COMMAND)) return [...COMMAND];

  // 혹시 다른 구조면 빈 배열
  return [];
}

// =========================
// ----------------------------------------------------------------------------
// Compatibility exports for main.js / game.js
// ----------------------------------------------------------------------------

// main.js에서 COMMAND_DEFS를 import하는 경우를 위해
// 실제로 쓰는 메타 테이블(COMMAND_META)을 그대로 노출한다.
export const COMMAND_DEFS = COMMAND_META;

// game.js나 기타 코드에서 전체 커맨드 id 목록이 필요할 때 사용
export function getAllCommandIds() {
  return Object.keys(COMMAND_META);
}
