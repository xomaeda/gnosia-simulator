// NOTE: 로그 문구는 사용자가 나중에 교체 가능하도록 "기본 템플릿"만 둠.
// 'system' 커맨드들은 UI에 노출되지 않음(찬성/반대/참여/중단 등).

export const COMMANDS = [
  // ---- root: day ----
  cmd("suspect", "의심한다", "day", "root", {}, "대상을 의심해 신뢰/우호를 깎고 연쇄를 연다."),
  cmd("cover", "감싼다", "day", "root", {}, "대상을 옹호해 신뢰/우호를 올리고 연쇄를 연다."),
  cmd("role_reveal", "역할을 밝힌다", "day", "root", {}, "자신의 역할(또는 사칭)을 공개한다."),
  cmd("role_ask", "역할을 밝혀라", "day", "root", { charisma: 10 }, "누군가가 역할을 밝히도록 압박한다."),
  cmd("vote_for", "투표해라", "day", "root", { logic: 10 }, "투표 대상을 제안하고 찬반을 받는다."),
  cmd("vote_not", "투표하지 마라", "day", "root", { logic: 15 }, "특정 대상을 투표하지 말자고 제안한다."),
  cmd("human_cert", "반드시 인간이다", "day", "root", { logic: 20 }, "대상을 인간으로 확정(논의 제외)."),
  cmd("enemy_cert", "반드시 적이다", "day", "root", { logic: 20 }, "대상을 적으로 확정(발언 제한)."),
  cmd("all_elim", "전원 배제해라", "day", "root", { logic: 30 }, "특정 역할 후보들을 전원 배제하자 제안."),
  cmd("human_say", "인간이라고 말해", "day", "root", { intuition: 20 }, "전원에게 ‘나는 인간’ 선언을 요구한다."),
  cmd("chat", "잡담한다", "day", "root", { stealth: 10 }, "잡담을 열어 참여자들과 우호 상승."),
  cmd("coop_day", "협력하자", "day", "root", { charm: 15 }, "대상에게 협력을 제안(강한 우호/협력)."),

  // ---- follow: day ----
  cmd("agree_sus", "의심에 동의한다", "day", "follow", {}, "의심에 동조(약하게 공격, 어그로 덜)."),
  cmd("join_cover", "함께 감싼다", "day", "follow", {}, "감싸기에 동조."),
  cmd("deny", "부정한다", "day", "follow", {}, "공격받은 대상이 반박하여 회복/연쇄 차단 시도."),
  cmd("defend", "변호한다", "day", "follow", {}, "대상을 변호하여 회복, 연쇄 유도."),
  cmd("join_def", "변호에 가담한다", "day", "follow", {}, "변호에 동조."),
  cmd("counter", "반론한다", "day", "follow", {}, "옹호/제안에 반론하여 타격, 연쇄 유도."),
  cmd("join_counter", "반론에 가담한다", "day", "follow", {}, "반론에 동조."),
  cmd("loud", "시끄러워", "day", "follow", {}, "말이 많은 사람을 비난(상대 어그로↑)."),
  cmd("self_reveal", "자신도 밝힌다", "day", "follow", {}, "역할 공개 연쇄에서 자신도 공개한다."),
  cmd("exaggerate", "과장해서 말한다", "day", "follow", { acting: 15 }, "발언의 우호/감정쪽 위력 강화."),
  cmd("ask_agree", "동의를 구한다", "day", "follow", { charisma: 25 }, "더 많은 동조를 유도."),
  cmd("block_counter", "반론을 막는다", "day", "follow", { charisma: 40 }, "그 턴 동안 반론(변호 포함)을 봉쇄."),
  cmd("evade", "얼버무린다", "day", "follow", { stealth: 25 }, "논의를 강제 종료(턴 종료).", { endTurn: true }),
  cmd("counterattack", "반격한다", "day", "follow", { logic: 25, acting: 25 }, "공격자를 역으로 공격."),
  cmd("ask_help", "도움을 요청한다", "day", "follow", { acting: 30 }, "지정 대상에게 변호 요청(봉쇄 무효화 가능)."),
  cmd("sad", "슬퍼한다", "day", "follow", { charm: 25 }, "동정심을 유발해 변호를 유도."),
  cmd("dont_fool", "속지마라", "day", "follow", { intuition: 30 }, "상대의 거짓말 감지 확률↑(기간성 단순화)."),
  cmd("dogeza", "도게자한다", "day", "follow", { stealth: 35 }, "투표로 소멸될 때 확률로 회피 시도(특수)."),

  // ---- system (UI 비노출) ----
  cmd("sys_yes", "찬성한다", "day", "system", {}, "찬성(제안 턴에서만).", { endTurn: false, hidden: true }),
  cmd("sys_no", "반대한다", "day", "system", {}, "반대(즉시 턴 종료).", { endTurn: true, hidden: true }),
  cmd("sys_human_yes", "나는 인간이야", "day", "system", {}, "인간 선언(인간이라고 말해 진행).", { hidden: true }),
  cmd("sys_human_stop", "선언을 중단시킨다", "day", "system", {}, "인간 선언 중단(즉시 종료).", { endTurn: true, hidden: true }),
  cmd("sys_chat_join", "잡담에 참여한다", "day", "system", {}, "잡담 참여(우호 상승).", { hidden: true }),
  cmd("sys_chat_stop", "잡담을 중단시킨다", "day", "system", {}, "잡담 중단(즉시 종료).", { endTurn: true, hidden: true }),

  // ---- night (user-checkable) ----
  cmd("night_coop", "밤에 협력 요청", "night", "root", {}, "밤 자유행동에서 협력 요청(성공/거절)."),
];

function cmd(id, name, phase, kind, reqStats, uiHint, opt = {}) {
  return {
    id, name, phase, kind,
    reqStats: reqStats || {},
    uiHint: uiHint || "",
    endTurn: !!opt.endTurn,
    hidden: !!opt.hidden,
  };
}

export function hasStats(c, reqStats) {
  for (const [k, v] of Object.entries(reqStats)) {
    if ((c.stats?.[k] ?? 0) < v) return false;
  }
  return true;
}

// user-visible: checkable in character editor.
// rule: day/night root+follow that are NOT system/hidden.
// (잡담 참여/중단, 찬성/반대, 인간 선언 등은 숨김)
export function getUserVisibleCommandsForCharacter(c, all) {
  return all.filter(x =>
    !x.hidden &&
    x.kind !== "system" &&
    hasStats(c, x.reqStats) &&
    // allow user to decide personality-based usage; but stat-gated commands don't show if insufficient
    true
  );
}

