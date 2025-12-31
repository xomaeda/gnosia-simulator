import { COMMANDS, hasStats } from "./commands.js";
import { initRelations, addRel, clamp } from "./relations.js";
import { assignRoles, ROLES, pickEngineerTarget, pickGuardianTarget, pickGnosiaTarget } from "./roles.js";
import { pickRootSpeaker, pickRootCommand, pickTargetForRoot, pickFollowUp, pickNightFreeAction } from "./ai.js";

export class Game {
  constructor(characters, settings, logFn) {
    this.characters = characters.map(c => ({
      ...c,
      alive: true,
      role: null,
    }));
    this.settings = settings;
    this.log = logFn;

    this.started = false;

    // runtime
    this.day = 1;
    this.phase = "day";     // day | night
    this.dayTurn = 0;       // 0..4
    this.nightStep = 0;     // 0..1  (0: free, 1: roles+attack)

    this.relations = { trust: [], favor: [] };
    this.aggro = [];        // 0..?
    this.suspicion = [];    // 0..100 (higher=more suspicious)
    this.flags = {
      humanCertified: new Set(),
      enemyCertified: new Set(),
      blockedThisTurn: false,
    };
    this.memory = {
      lieDetectedBy: [], // array<Set<liarIdx>>
    };

    this.voteHints = {
      voteFor: new Map(),   // targetIdx -> weight
      voteNot: new Map(),   // targetIdx -> weight
      allElimRole: null,
    };

    this.lastColdSleep = null; // idx
  }

  start() {
    // roles
    assignRoles(this.characters, this.settings);

    // relations
    this.relations = initRelations(this.characters);

    // init arrays
    const n = this.characters.length;
    this.aggro = Array(n).fill(0);
    this.suspicion = Array(n).fill(50);
    this.memory.lieDetectedBy = Array.from({ length: n }, () => new Set());

    this.started = true;
    this.phase = "day";
    this.day = 1;
    this.dayTurn = 0;
    this.nightStep = 0;

    // set default gnosia count already validated by UI
  }

  aliveIdx() {
    return this.characters.map((c,i)=>c.alive?i:null).filter(x=>x!=null);
  }

  allowedCommandsFor(c) {
    // user-allowed AND stat satisfied
    return COMMANDS.filter(cmd => {
      if (cmd.hidden) return false;
      if (cmd.kind === "system") return false; // system is internal only
      if (!hasStats(c, cmd.reqStats)) return false;
      // user selection
      if (c.allowedCommands && c.allowedCommands[cmd.id] === false) return false;
      return true;
    });
  }

  step() {
    if (!this.started) return;

    // victory check before step
    if (this.checkVictory()) return;

    if (this.phase === "day") {
      this.runDayTurn();
      // after 5 turns -> vote -> night
      if (this.dayTurn >= 5) {
        this.runVoteAndColdSleep();
        if (this.checkVictory()) return;
        this.phase = "night";
        this.nightStep = 0;
        this.log(`\n[밤 ${this.day}] 시작`);
      }
    } else {
      // night
      if (this.nightStep === 0) {
        this.runNightFree();
        this.nightStep = 1;
      } else {
        this.runNightRolesAndAttack();
        if (this.checkVictory()) return;
        // next day
        this.day += 1;
        this.phase = "day";
        this.dayTurn = 0;
        this.nightStep = 0;
        this.log(`\n[낮 ${this.day}] 시작`);
      }
    }
  }

  runDayTurn() {
    this.dayTurn += 1;
    this.flags.blockedThisTurn = false;
    this.voteHints.voteFor.clear();
    this.voteHints.voteNot.clear();
    this.voteHints.allElimRole = null;

    this.log(`\n[낮 ${this.day} - 턴 ${this.dayTurn}/5]`);

    const speaker = pickRootSpeaker(this);
    const rootCmd = pickRootCommand(this, speaker);

    // determine target (some roots may have no target)
    let target = null;
    if (["suspect","cover","vote_for","vote_not","human_cert","enemy_cert","coop_day"].includes(rootCmd.id)) {
      target = pickTargetForRoot(this, speaker, rootCmd.id);
    }

    // context for follow-ups
    const ctx = {
      rootCmdId: rootCmd.id,
      rootSpeaker: speaker,
      rootTarget: target,
      participants: new Set([speaker]),
      ended: false,
      // special sub-modes
      proposal: (rootCmd.id === "vote_for" || rootCmd.id === "vote_not" || rootCmd.id === "all_elim") ? true : false,
      humanDeclare: (rootCmd.id === "human_say"),
      chat: (rootCmd.id === "chat"),
      blockCounter: false,
      blockedBy: null, // who used block_counter
      // for deny/defend: who is currently attacked
      attackedTarget: (rootCmd.id === "suspect") ? target : null,
      coveredTarget: (rootCmd.id === "cover") ? target : null,
    };

    // apply root effects and log
    this.applyCommand(rootCmd.id, speaker, target, ctx, true);

    // follow-up chain
    while (!ctx.ended) {
      const next = pickFollowUp(this, ctx);
      if (!next) break;
      ctx.participants.add(next.speakerIdx);
      this.applyCommand(next.cmd.id, next.speakerIdx, target, ctx, false);
      if (next.cmd.endTurn) ctx.ended = true;
    }

    // end of turn: natural decay
    this.decayAggro();

    // post-turn: detect lies events (role claims etc) – simplified: if someone claimed role not matching, others may detect
    this.processLieDetection();
  }

  canUseFollow(cmd, speakerIdx, ctx) {
    const id = cmd.id;

    // One-turn one-speak handled by ctx.participants in AI (still double-check)
    if (ctx.participants.has(speakerIdx)) return false;

    // basic context gates
    if (id === "agree_sus") return ctx.rootCmdId === "suspect" && !ctx.ended;
    if (id === "join_cover") return ctx.rootCmdId === "cover" && !ctx.ended;
    if (id === "deny") return (ctx.attackedTarget === speakerIdx) && !ctx.ended;
    if (id === "defend") return (ctx.rootCmdId === "suspect" || ctx.rootCmdId === "cover") && !ctx.ended && !ctx.blockCounter;
    if (id === "join_def") return (ctx.lastCmdId === "defend") && !ctx.ended && !ctx.blockCounter;
    if (id === "counter") return (ctx.rootCmdId === "cover" || ctx.rootCmdId === "vote_for" || ctx.rootCmdId === "vote_not" || ctx.rootCmdId === "all_elim") && !ctx.ended && !ctx.blockCounter;
    if (id === "join_counter") return (ctx.lastCmdId === "counter") && !ctx.ended && !ctx.blockCounter;
    if (id === "loud") return (ctx.rootCmdId === "suspect" || ctx.rootCmdId === "cover") && !ctx.ended;
    if (id === "self_reveal") return ctx.rootCmdId === "role_reveal" && !ctx.ended;
    if (id === "exaggerate") return !ctx.ended && (ctx.rootCmdId === "suspect" || ctx.rootCmdId === "cover" || ctx.lastCmdId === "defend");
    if (id === "ask_agree") return !ctx.ended && (ctx.rootCmdId === "suspect" || ctx.rootCmdId === "cover");
    if (id === "block_counter") return !ctx.ended && (ctx.rootCmdId === "suspect" || ctx.rootCmdId === "cover") && !ctx.blockCounter && ctx.lastCmdId !== "counter";
    if (id === "evade") return !ctx.ended && (ctx.attackedTarget === speakerIdx);
    if (id === "counterattack") return !ctx.ended && (ctx.attackedTarget === speakerIdx);
    if (id === "ask_help") return !ctx.ended && (ctx.attackedTarget === speakerIdx) && !ctx.helpRequested;
    if (id === "sad") return !ctx.ended && (ctx.attackedTarget === speakerIdx);
    if (id === "dont_fool") return !ctx.ended; // refined by AI weights
    if (id === "dogeza") return false; // only used on vote result; handled later

    return false;
  }

  applyCommand(cmdId, speakerIdx, rootTarget, ctx, isRoot) {
    const S = this.characters[speakerIdx];
    const t = (rootTarget != null) ? rootTarget : null;

    const nameS = S.name;
    const nameT = (t != null) ? this.characters[t].name : "";

    // helper effects
    const charisma = S.stats.charisma / 50;
    const logic = S.stats.logic / 50;
    const acting = S.stats.acting / 50;
    const charm = S.stats.charm / 50;

    // aggro baseline: speaking raises
    const aggroGain = 6 * (1 - (S.stats.stealth/50));
    this.aggro[speakerIdx] += Math.max(1.5, aggroGain * 0.6);

    // log templates (user can replace later)
    const say = (cmdName, extra="") => {
      const x = extra ? ` ${extra}` : "";
      this.log(`${nameS}:[${cmdName}]${x}`);
    };

    ctx.lastCmdId = cmdId;

    // BLOCK COUNTER (one turn only)
    if (cmdId === "block_counter") {
      ctx.blockCounter = true;
      ctx.blockedBy = speakerIdx;
      say("반론을 막는다", `${nameT} 관련 반론을 봉쇄했다.`);
      return;
    }

    // HELP REQUEST: if success, cancels blockCounter this turn
    if (cmdId === "ask_help") {
      ctx.helpRequested = true;
      // pick a helper target: most favorable to target
      const helper = this.pickHelperFor(t);
      if (helper != null) {
        const chance = 0.35 + (acting*0.25) + (charisma*0.20) + (this.relations.favor[helper][t]/100)*0.25;
        if (Math.random() < chance) {
          // cancel block
          ctx.blockCounter = false;
          say("도움을 요청한다", `${this.characters[helper].name}에게 도움을 요청했고, 반론 봉쇄가 무효화됐다.`);
          // helper may defend automatically (still counts as their turn if they speak later; here we just apply small buff)
          addRel(this.relations, helper, t, +3, +6);
        } else {
          say("도움을 요청한다", `도움 요청이 거절되었다.`);
        }
      } else {
        say("도움을 요청한다", `도움을 요청했지만 응답할 인물이 없었다.`);
      }
      return;
    }

    // root: suspect
    if (cmdId === "suspect") {
      if (t == null) return;
      const dmgTrust = 8 + logic*18;
      const dmgFavor = 6 + acting*14;

      // defense by charm of target
      const def = (this.characters[t].stats.charm/50) * 0.35;
      addRel(this.relations, speakerIdx, t, -dmgTrust*(1-def), -dmgFavor*(1-def));

      // raise suspicion on target
      this.suspicion[t] = clamp(this.suspicion[t] + 6 + logic*10, 0, 100);

      say("의심한다", `${nameT}를 의심했다.`);
      ctx.attackedTarget = t;
      return;
    }

    // follow: agree_sus
    if (cmdId === "agree_sus") {
      if (t == null) return;
      const dmgTrust = 4 + logic*10;
      const dmgFavor = 3 + acting*8;
      addRel(this.relations, speakerIdx, t, -dmgTrust, -dmgFavor);
      this.suspicion[t] = clamp(this.suspicion[t] + 3 + logic*6, 0, 100);
      say("의심에 동의한다", `${nameT} 쪽으로 의견을 보탰다.`);
      return;
    }

    // root: cover
    if (cmdId === "cover") {
      if (t == null) return;
      const healTrust = 7 + logic*14;
      const healFavor = 7 + acting*14;
      addRel(this.relations, speakerIdx, t, +healTrust, +healFavor);
      this.suspicion[t] = clamp(this.suspicion[t] - 4, 0, 100);
      say("감싼다", `${nameT}를 옹호했다.`);
      ctx.coveredTarget = t;
      return;
    }

    // follow: join_cover
    if (cmdId === "join_cover") {
      if (t == null) return;
      addRel(this.relations, speakerIdx, t, +4, +6);
      this.suspicion[t] = clamp(this.suspicion[t] - 2, 0, 100);
      say("함께 감싼다", `${nameT}를 함께 옹호했다.`);
      return;
    }

    // follow: deny
    if (cmdId === "deny") {
      if (t == null) return;
      // target is speaker itself
      // recover via logic/acting, and reduce further follow-up likelihood by slightly lowering suspicion
      const healT = 6 + logic*12;
      const healF = 5 + acting*10;
      // everyone who attacked loses trust a bit (simplified: root speaker loses)
      addRel(this.relations, ctx.rootSpeaker, speakerIdx, -2, -1);
      this.suspicion[speakerIdx] = clamp(this.suspicion[speakerIdx] - 5 - logic*6, 0, 100);
      say("부정한다", `의심을 부정하고 분위기를 돌렸다.`);
      return;
    }

    // follow: defend (blocked by blockCounter)
    if (cmdId === "defend") {
      if (t == null) return;
      if (ctx.blockCounter) {
        // cannot defend
        say("변호한다", `봉쇄 때문에 변호에 실패했다.`);
        return;
      }
      addRel(this.relations, speakerIdx, t, +5 + logic*8, +5 + acting*8);
      this.suspicion[t] = clamp(this.suspicion[t] - 3, 0, 100);
      say("변호한다", `${nameT}를 변호했다.`);
      return;
    }

    if (cmdId === "join_def") {
      if (t == null) return;
      if (ctx.blockCounter) { say("변호에 가담한다", `봉쇄 때문에 가담에 실패했다.`); return; }
      addRel(this.relations, speakerIdx, t, +3, +5);
      this.suspicion[t] = clamp(this.suspicion[t] - 1.5, 0, 100);
      say("변호에 가담한다", `${nameT}를 함께 변호했다.`);
      return;
    }

    if (cmdId === "counter") {
      if (t == null) return;
      if (ctx.blockCounter) { say("반론한다", `봉쇄 때문에 반론에 실패했다.`); return; }
      addRel(this.relations, speakerIdx, t, -5 - logic*9, -4 - acting*7);
      this.suspicion[t] = clamp(this.suspicion[t] + 2 + logic*5, 0, 100);
      say("반론한다", `${nameT} 쪽 주장에 반론했다.`);
      return;
    }

    if (cmdId === "join_counter") {
      if (t == null) return;
      if (ctx.blockCounter) { say("반론에 가담한다", `봉쇄 때문에 가담에 실패했다.`); return; }
      addRel(this.relations, speakerIdx, t, -3, -3);
      this.suspicion[t] = clamp(this.suspicion[t] + 1, 0, 100);
      say("반론에 가담한다", `${nameT} 쪽 반론에 가담했다.`);
      return;
    }

    if (cmdId === "loud") {
      const who = ctx.rootSpeaker;
      if (who == null) return;
      this.aggro[who] += 6;
      say("시끄러워", `${this.characters[who].name}의 발언이 과하다고 지적했다.`);
      return;
    }

    if (cmdId === "exaggerate") {
      // amplify last effect by slightly shifting suspicion/relations
      if (t != null) {
        const boost = 2 + acting*6;
        // if root was cover-like => boost favor; if suspect-like => lower favor/trust
        if (ctx.rootCmdId === "cover") addRel(this.relations, ctx.rootSpeaker, t, +1, +boost);
        if (ctx.rootCmdId === "suspect") addRel(this.relations, ctx.rootSpeaker, t, -1, -boost);
      }
      this.aggro[speakerIdx] += 4;
      say("과장해서 말한다", `주장을 과장해 분위기를 흔들었다.`);
      return;
    }

    if (cmdId === "ask_agree") {
      // increases chance of more follow-ups
      ctx.extraFollow = (ctx.extraFollow ?? 0) + 1;
      this.aggro[speakerIdx] += 4;
      say("동의를 구한다", `주변의 동조를 더 끌어냈다.`);
      return;
    }

    if (cmdId === "evade") {
      say("얼버무린다", `논의를 종료했다.`);
      ctx.ended = true;
      return;
    }

    if (cmdId === "counterattack") {
      const attacker = ctx.rootSpeaker;
      if (attacker == null) return;
      addRel(this.relations, speakerIdx, attacker, -6 - logic*10, -5 - acting*8);
      this.suspicion[attacker] = clamp(this.suspicion[attacker] + 3, 0, 100);
      say("반격한다", `${this.characters[attacker].name}에게 반격했다.`);
      return;
    }

    if (cmdId === "sad") {
      // increases sympathy: others favor rises a bit
      const alive = this.aliveIdx().filter(i => i !== speakerIdx);
      for (const i of alive) addRel(this.relations, i, speakerIdx, +0.6, +2.0 + charm*2);
      this.suspicion[speakerIdx] = clamp(this.suspicion[speakerIdx] - 3, 0, 100);
      say("슬퍼한다", `동정심을 유발했다.`);
      return;
    }

    if (cmdId === "dont_fool") {
      // mark in ctx that liar-detection weight is increased (simplified: immediate small suspicion on root speaker)
      if (ctx.rootSpeaker != null && ctx.rootSpeaker !== speakerIdx) {
        this.suspicion[ctx.rootSpeaker] = clamp(this.suspicion[ctx.rootSpeaker] + 2.5, 0, 100);
      }
      say("속지마라", `거짓말을 경계하자고 말했다.`);
      return;
    }

    // role reveal / ask / self reveal chain
    if (cmdId === "role_reveal") {
      say("역할을 밝힌다", `자신의 역할을 주장했다.`);
      // store claim
      this.characters[speakerIdx].claim = this.characters[speakerIdx].claim || {};
      this.characters[speakerIdx].claim.role = this.pickClaimRole(speakerIdx);
      return;
    }
    if (cmdId === "self_reveal") {
      say("자신도 밝힌다", `자신의 역할을 덧붙여 주장했다.`);
      this.characters[speakerIdx].claim = this.characters[speakerIdx].claim || {};
      this.characters[speakerIdx].claim.role = this.pickClaimRole(speakerIdx);
      return;
    }
    if (cmdId === "role_ask") {
      say("역할을 밝혀라", `누군가 역할을 밝히도록 압박했다.`);
      // maybe someone will role_reveal later as follow-up (handled by AI weights)
      return;
    }

    // proposals: vote_for / vote_not / all_elim
    if (cmdId === "vote_for") {
      if (t == null) return;
      say("투표해라", `${nameT}에게 투표하자고 제안했다.`);
      // mark hint
      this.voteHints.voteFor.set(t, (this.voteHints.voteFor.get(t) ?? 0) + 1.0);
      // allow system yes/no as follow-ups implicitly by ctx.proposal
      return;
    }
    if (cmdId === "vote_not") {
      if (t == null) return;
      say("투표하지 마라", `${nameT}에게 투표하지 말자고 제안했다.`);
      this.voteHints.voteNot.set(t, (this.voteHints.voteNot.get(t) ?? 0) + 1.0);
      return;
    }
    if (cmdId === "all_elim") {
      say("전원 배제해라", `특정 역할 후보들을 전원 배제하자고 제안했다.`);
      this.voteHints.allElimRole = this.randomRoleGroupName();
      return;
    }

    if (cmdId === "human_cert") {
      if (t == null) return;
      if (this.flags.humanCertified.has(t)) { say("반드시 인간이다", `이미 확정된 대상이다.`); return; }
      this.flags.humanCertified.add(t);
      addRel(this.relations, t, speakerIdx, +2, +6); // target likes certifier
      say("반드시 인간이다", `${nameT}를 인간으로 확정했다.`);
      return;
    }
    if (cmdId === "enemy_cert") {
      if (t == null) return;
      if (this.flags.enemyCertified.has(t)) { say("반드시 적이다", `이미 확정된 대상이다.`); return; }
      this.flags.enemyCertified.add(t);
      // silence effect: push suspicion high
      this.suspicion[t] = clamp(this.suspicion[t] + 20, 0, 100);
      say("반드시 적이다", `${nameT}를 적으로 확정했다.`);
      return;
    }

    // human_say: everyone may declare or stop (system). We'll simulate by follow-ups using ai rules later; here root opens.
    if (cmdId === "human_say") {
      say("인간이라고 말해", `전원에게 ‘나는 인간’ 선언을 요구했다.`);
      return;
    }

    // chat: participants system join/stop handled by follow-ups as normal follow commands aren't used; we will simulate by night free action instead; for day turn we'll just create favor boosts via follow-ups: using follow cmd "sys_chat_join/stop" not exposed; simplified: follow-ups not chosen from allowed; so handle here:
    if (cmdId === "chat") {
      say("잡담한다", `잡담을 시작했다.`);
      // immediate: a few others may join automatically (not counting as their "speak" in this model; but requirement says participation is part of chain.
      // We'll keep strict: participation must be a "follow-up speak". Since system commands not in allowedCommandsFor, we simulate internally:
      const joiners = this.aliveIdx().filter(i => i !== speakerIdx).sort(()=>Math.random()-0.5).slice(0, 3);
      for (const j of joiners) {
        if (ctx.participants.has(j)) continue;
        ctx.participants.add(j);
        addRel(this.relations, speakerIdx, j, 0, +3);
        addRel(this.relations, j, speakerIdx, 0, +3);
        this.log(`${this.characters[j].name}:[잡담에 참여한다] 함께 시간을 보냈다.`);
      }
      // someone may stop
      if (joiners.length && Math.random() < 0.25) {
        const stopper = joiners[Math.floor(Math.random()*joiners.length)];
        this.log(`${this.characters[stopper].name}:[잡담을 중단시킨다] 잡담을 끊었다.`);
        // penalty between stopper and speaker
        addRel(this.relations, stopper, speakerIdx, -1, -4);
        ctx.ended = true;
      }
      return;
    }

    if (cmdId === "coop_day") {
      if (t == null) return;
      const chance = 0.45 + (this.relations.favor[t][speakerIdx]/100)*0.35 + (this.characters[t].personality.social)*0.15;
      if (Math.random() < chance) {
        this.setCoop(speakerIdx, t);
        say("협력하자", `${nameT}와 협력에 성공했다.`);
      } else {
        say("협력하자", `${nameT}에게 거절당했다.`);
        addRel(this.relations, speakerIdx, t, -1, -3);
      }
      return;
    }
  }

  decayAggro(){
    for (let i=0;i<this.aggro.length;i++){
      this.aggro[i] = Math.max(0, this.aggro[i] - 2.5);
    }
  }

  pickHelperFor(targetIdx){
    const alive = this.aliveIdx().filter(i => i !== targetIdx);
    if (!alive.length) return null;
    // pick highest favor toward target
    let best = null;
    for (const i of alive){
      const w = this.relations.favor[i][targetIdx] + this.relations.trust[i][targetIdx];
      if (!best || w > best.w) best = {i,w};
    }
    return best?.i ?? alive[Math.floor(Math.random()*alive.length)];
  }

  setCoop(a,b){
    this.flags.coop = this.flags.coop || new Map(); // idx -> idx
    this.flags.coop.set(a,b);
    this.flags.coop.set(b,a);
    // strong favor both ways
    addRel(this.relations, a, b, +2, +18);
    addRel(this.relations, b, a, +2, +18);
  }

  randomRoleGroupName(){
    const groups = ["엔지니어", "닥터", "수호천사", "그노시아"];
    return groups[Math.floor(Math.random()*groups.length)];
  }

  pickClaimRole(idx){
    // courage higher => more likely to claim even if false
    const c = this.characters[idx];
    const p = c.personality.courage;
    const real = c.role;
    // 70% tell truth, else lie (AC/gnosia more likely lie)
    let truth = 0.7 + p*0.1;
    if ([ROLES.GNOSIA, ROLES.AC].includes(real)) truth -= 0.25;
    if (Math.random() < truth) return real;
    // lie: choose a claimable role (not guardian; guardian can't CO in original, but simulator can still claim; we'll keep: guardian can't claim, but others can lie about eng/doctor mostly)
    const opts = [ROLES.ENGINEER, ROLES.DOCTOR];
    return opts[Math.floor(Math.random()*opts.length)];
  }

  processLieDetection(){
    // if any claims exist and mismatched, others may detect based on intuition vs acting
    const alive = this.aliveIdx();
    const claimers = alive.filter(i => this.characters[i].claim?.role);
    if (!claimers.length) return;

    for (const observer of alive){
      const obsC = this.characters[observer];
      for (const liar of claimers){
        if (observer === liar) continue;
        const claimed = this.characters[liar].claim.role;
        const real = this.characters[liar].role;
        if (claimed === real) continue; // not a lie

        // detection chance
        const intu = obsC.stats.intuition / 50;
        const liarAct = this.characters[liar].stats.acting / 50;
        const relTrust = this.relations.trust[observer][liar] / 100;

        let chance = 0.06 + intu*0.22 - liarAct*0.16 - relTrust*0.08;
        // if already suspected, easier to notice
        chance += ((this.suspicion[liar] ?? 50) / 100) * 0.06;

        if (Math.random() < chance) {
          // memorize and log (Q1)
          this.memory.lieDetectedBy[observer].add(liar);
          this.log(`[감지] ${obsC.name}가 ${this.characters[liar].name}의 거짓말을 눈치챘다.`);
          // reaction: suspicion up
          this.suspicion[liar] = clamp(this.suspicion[liar] + 8, 0, 100);
        }
      }
    }
  }

  runVoteAndColdSleep(){
    // Simple vote: each alive picks target by suspicion, adjusted by vote hints
    this.log(`\n[투표] 콜드슬립 대상을 결정한다.`);
    const alive = this.aliveIdx();
    const votes = new Map(); // target -> count

    for (const voter of alive){
      const target = this.pickVoteTarget(voter);
      if (target == null) continue;
      votes.set(target, (votes.get(target) ?? 0) + 1);
    }

    // find max
    let best = null;
    for (const [t,cnt] of votes.entries()){
      if (!best || cnt > best.cnt) best = {t, cnt};
    }

    if (!best) {
      this.log(`[투표] 투표가 성립되지 않았다.`);
      return;
    }

    const victim = best.t;

    // 도게자(투표 회피) 처리: victim이 도게자 커맨드를 허용하고 스탯 충족 시 확률로 회피
    const V = this.characters[victim];
    const canDogeza = (V.allowedCommands?.dogeza !== false) && (V.stats.stealth >= 35);
    if (canDogeza && Math.random() < (0.12 + (V.stats.acting/50)*0.10)) {
      this.log(`${V.name}:[도게자한다] 콜드슬립을 간신히 피했다.`);
      return;
    }

    // cold sleep
    V.alive = false;
    this.lastColdSleep = victim;
    this.log(`[결과] ${V.name}가 콜드슬립 되었다.`);

    // doctor result later
  }

  pickVoteTarget(voterIdx){
    const alive = this.aliveIdx().filter(i => i !== voterIdx);

    // cannot vote certified human? (not "cannot", but reduced)
    const scored = alive.map(t => {
      let w = 1;

      // base suspicion
      w += (this.suspicion[t] ?? 50) / 35;

      // aggro: loud targets get more votes
      w += (this.aggro[t] ?? 0) / 80;

      // relationship: if voter dislikes target => more likely vote
      const favor = this.relations.favor[voterIdx][t] / 100;
      const trust = this.relations.trust[voterIdx][t] / 100;
      w += (1 - favor) * 0.8 + (1 - trust) * 0.6;

      // hints
      if (this.voteHints.voteFor.has(t)) w *= 1.15 + 0.15*this.voteHints.voteFor.get(t);
      if (this.voteHints.voteNot.has(t)) w *= Math.max(0.15, 0.75 - 0.15*this.voteHints.voteNot.get(t));

      // certified
      if (this.flags.humanCertified.has(t)) w *= 0.18;
      if (this.flags.enemyCertified.has(t)) w *= 1.6;

      // cooperation: less likely to vote ally
      const coop = this.flags.coop?.get(voterIdx);
      if (coop === t) w *= 0.18;

      // if voter detected lie from t, much more vote
      if (this.memory.lieDetectedBy[voterIdx].has(t)) w *= 1.8;

      return { t, w: Math.max(0.01, w) };
    });

    // weighted random
    const total = scored.reduce((s,x)=>s+x.w,0);
    if (total <= 0) return scored[Math.floor(Math.random()*scored.length)]?.t ?? null;
    let r = Math.random()*total;
    for (const s of scored){
      r -= s.w;
      if (r<=0) return s.t;
    }
    return scored.at(-1).t;
  }

  runNightFree(){
    this.log(`\n[밤 ${this.day} - 자유행동]`);

    const alive = this.aliveIdx();
    const used = new Set();

    for (const i of alive){
      if (used.has(i)) continue;
      const act = pickNightFreeAction(this, i);

      if (act.type === "alone") {
        this.log(`${this.characters[i].name}는 혼자 시간을 보냈다.`);
        continue;
      }

      if (act.type === "hang") {
        const t = act.target;
        if (t == null || !this.characters[t].alive) { this.log(`${this.characters[i].name}는 혼자 시간을 보냈다.`); continue; }
        // mutual time
        addRel(this.relations, i, t, 0, +4);
        addRel(this.relations, t, i, 0, +4);
        this.log(`${this.characters[i].name}는 ${this.characters[t].name}와 함께 시간을 보내어 상호 우호도가 올라갔다.`);
        used.add(t);
        continue;
      }

      if (act.type === "night_coop") {
        const t = act.target;
        if (t == null || !this.characters[t].alive) { this.log(`${this.characters[i].name}는 혼자 시간을 보냈다.`); continue; }
        const chance = 0.42 + (this.relations.favor[t][i]/100)*0.35 + this.characters[t].personality.social*0.15;
        if (Math.random() < chance) {
          this.setCoop(i, t);
          this.log(`${this.characters[i].name}는 ${this.characters[t].name}에게 협력 요청을 했고, 협력에 성공했다.`);
        } else {
          this.log(`${this.characters[i].name}는 ${this.characters[t].name}에게 협력 요청을 했지만, 거절당했다.`);
          addRel(this.relations, i, t, -1, -3);
        }
        continue;
      }
    }
  }

  runNightRolesAndAttack(){
    this.log(`\n[밤 ${this.day} - 역할 집행]`);

    const alive = this.aliveIdx();
    const deaths = [];

    // engineer
    let bugKilledByEngineer = null;
    const engIdx = alive.find(i => this.characters[i].role === ROLES.ENGINEER);
    if (engIdx != null) {
      const t = pickEngineerTarget(this, engIdx);
      if (t != null) {
        const targetRole = this.characters[t].role;
        if (targetRole === ROLES.GNOSIA) {
          this.log(`[엔지니어] ${this.characters[engIdx].name}의 조사: ${this.characters[t].name} = 그노시아`);
          this.suspicion[t] = clamp(this.suspicion[t] + 18, 0, 100);
        } else {
          this.log(`[엔지니어] ${this.characters[engIdx].name}의 조사: ${this.characters[t].name} = 인간`);
          // bug special: inspected => dies immediately (even if guardian)
          if (targetRole === ROLES.BUG) {
            this.characters[t].alive = false;
            bugKilledByEngineer = t;
            deaths.push(t);
          }
        }
      }
    }

    // guardian
    let protectedIdx = null;
    const guardIdx = alive.find(i => this.characters[i].role === ROLES.GUARDIAN);
    if (guardIdx != null) {
      protectedIdx = pickGuardianTarget(this, guardIdx);
    }

    // gnosia attack
    const gnosiaIdxs = alive.filter(i => this.characters[i].role === ROLES.GNOSIA);
    let attackVictim = null;
    let attackSucceeded = false;

    if (gnosiaIdxs.length > 0) {
      attackVictim = pickGnosiaTarget(this, gnosiaIdxs);

      if (attackVictim != null) {
        const vRole = this.characters[attackVictim].role;

        // cannot kill bug (immune) => no death
        if (vRole === ROLES.BUG) {
          attackSucceeded = false;
        } else if (attackVictim === protectedIdx) {
          attackSucceeded = false;
        } else {
          // kill if alive and not already dead by engineer
          if (this.characters[attackVictim].alive) {
            this.characters[attackVictim].alive = false;
            deaths.push(attackVictim);
            attackSucceeded = true;
          }
        }
      }
    }

    // doctor (checks last cold sleep)
    const docIdx = alive.find(i => this.characters[i].role === ROLES.DOCTOR);
    if (docIdx != null && this.lastColdSleep != null) {
      const checked = this.lastColdSleep;
      const r = this.characters[checked].role;
      if (r === ROLES.GNOSIA) this.log(`[닥터] ${this.characters[docIdx].name}의 검사: 콜드슬립 ${this.characters[checked].name} = 그노시아`);
      else this.log(`[닥터] ${this.characters[docIdx].name}의 검사: 콜드슬립 ${this.characters[checked].name} = 인간`);
    }

    // Result log per your rule:
    // - if guardian success OR gnosia targeted bug => "no one died"
    // - BUT if engineer killed bug AND gnosia killed someone => "A와 B가 소멸"
    if (deaths.length === 0) {
      this.log(`[결과] 아무도 소멸하지 않았습니다.`);
    } else if (deaths.length === 1) {
      this.log(`[결과] ${this.characters[deaths[0]].name}가 소멸했습니다.`);
    } else {
      const names = deaths.map(i => this.characters[i].name);
      this.log(`[결과] ${names.join("와 ")}가 소멸했습니다.`);
    }

    // if protected success specifically:
    if (protectedIdx != null && attackVictim === protectedIdx && !attackSucceeded) {
      this.log(`[수호천사] 보호가 성공했다.`);
    }
    if (attackVictim != null && this.characters[attackVictim].role === ROLES.BUG && !attackSucceeded) {
      this.log(`[그노시아] 버그를 노렸지만 소멸하지 않았다.`);
    }
  }

  checkVictory(){
    // bug wins if alive at end when either side would win. We'll implement:
    // If bug alive and (gnosia==0 || humans<=gnosia) then bug overrides as long as bug alive.
    const alive = this.aliveIdx();
    const g = alive.filter(i => this.characters[i].role === ROLES.GNOSIA).length;
    const bugAlive = alive.some(i => this.characters[i].role === ROLES.BUG);
    const humans = alive.length - g;

    // gnosia win when g >= humans (same as werewolf-ish)
    const gnosiaWin = g > 0 && g >= humans;
    // crew win when g == 0
    const crewWin = g === 0;

    if (gnosiaWin || crewWin) {
      if (bugAlive) {
        this.log(`\n[종료] 버그가 살아남아 승리를 뒤엎었다. (버그 단독 승리)`);
      } else if (crewWin) {
        this.log(`\n[종료] 선원 진영 승리`);
      } else {
        // ac loses if gnosia all coldslipped; already covered by crewWin
        this.log(`\n[종료] 그노시아 진영 승리`);
      }

      // reveal roles again (already known, but keep)
      this.log(`\n[역할 공개]`);
      this.characters.forEach(c => this.log(`- ${c.name}: ${c.role}`));
      return true;
    }
    return false;
  }
}

