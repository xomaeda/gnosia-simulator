export class Character {
  constructor(id, name, stats, personality) {
    this.id = id;
    this.name = name;

    this.stats = stats;
    this.personality = personality;

    this.role = "선원";
    this.alive = true;

    this.trust = {};
    this.favor = {};
    this.aggro = 0;

    this.commands = new Set();
  }
}

