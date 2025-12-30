// 캐릭터 하나를 표현하는 구조체 역할

class Character {
  constructor(name, gender, age, personality, stats, role) {
    this.name = name;
    this.gender = gender;
    this.age = age;
    this.personality = personality; // "적극", "소극", "중립" 등
    this.stats = stats; // { charisma, logic, acting, intuition, stealth }
    this.role = role; // "CREW" or "GNOSIA" (유저에게는 숨겨짐)

    this.alive = true;

    // 행동 누적에 따른 위험도
    this.aggro = 0;

    // 관계도는 GameState에서 2차원 배열로 관리
  }

  // 턴마다 행동할지 말지 결정
  decideToAct() {
    if (this.personality === "적극") return true;
    if (this.personality === "소극") return Math.random() < 0.4;
    return Math.random() < 0.7;
  }
}

module.exports = Character;

