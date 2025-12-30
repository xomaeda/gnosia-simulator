// 게임 전체 상태를 관리

class GameState {
  constructor(characters) {
    this.characters = characters;

    this.phase = "DAY"; // DAY, NIGHT_FREE, NIGHT_ATTACK
    this.dayTurn = 1;

    const n = characters.length;

    // 관계도 행렬
    this.trust = Array.from({ length: n }, () => Array(n).fill(0));
    this.favor = Array.from({ length: n }, () => Array(n).fill(0));
  }

  livingCharacters() {
    return this.characters.filter(c => c.alive);
  }

  isGameOver() {
    const alive = this.livingCharacters();
    const gn = alive.filter(c => c.role === "GNOSIA").length;
    const crew = alive.length - gn;

    if (gn === 0) return "CREW";
    if (gn >= crew) return "GNOSIA";
    return null;
  }
}

module.exports = GameState;

