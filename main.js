import GameState from "./src/GameState.js";
import Character from "./src/Character.js";
import Logger from "./src/Logger.js";

window.onload = () => {
  const game = new GameState();
  const list = document.getElementById("charList");
  const runBtn = document.getElementById("runBtn");

  document.getElementById("addChar").onclick = () => {
    const data = {
      name: name.value,
      gender: gender.value,
      age: Number(age.value),

      charisma: Number(charisma.value),
      logic: Number(logic.value),
      acting: Number(acting.value),
      charm: Number(charm.value),
      stealth: Number(stealth.value),
      intuition: Number(intuition.value),

      cheer: Number(cheer.value),
      social: Number(social.value),
      logical: Number(logical.value),
      kindness: Number(kindness.value),
      desire: Number(desire.value),
      courage: Number(courage.value)
    };

    const char = new Character(data);
    game.addCharacter(char);

    const li = document.createElement("li");
    li.innerText = char.name;
    list.appendChild(li);

    Logger.write(`${char.name}이(가) 추가되었습니다.`);

    if (game.characters.length >= 5) {
      runBtn.disabled = false;
    }
  };

  runBtn.onclick = () => {
    game.execute();
  };
};
