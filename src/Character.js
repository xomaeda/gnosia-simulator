export default class Character {
  constructor(data) {
    this.name = data.name;
    this.gender = data.gender;
    this.age = data.age;

    this.stats = {
      charisma: data.charisma,
      logic: data.logic,
      acting: data.acting,
      charm: data.charm,
      stealth: data.stealth,
      intuition: data.intuition
    };

    this.personality = {
      cheer: data.cheer,
      social: data.social,
      logical: data.logical,
      kindness: data.kindness,
      desire: data.desire,
      courage: data.courage
    };

    this.alive = true;
    this.role = null; // 게임 시작 시 배정
    this.aggro = 0;
  }
}

