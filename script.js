function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampFloat(value, min, max) {
  return Number(clamp(parseFloat(value.toFixed(2)), min, max));
}


const characters = [];

function addCharacter() {
  const name = document.getElementById("charName").value;
  const gender = document.getElementById("charGender").value;
  const age = document.getElementById("charAge").value;

  if (!name) {
    alert("이름을 입력해줘");
    return;
  }

  const character = {
    name,
    gender,
    age,
    status: {
      charisma: getValue("charisma"),
      logic: getValue("logic"),
      acting: getValue("acting"),
      cute: getValue("cute"),
      stealth: getValue("stealth"),
      intuition: getValue("intuition")
    },
    personality: {
      cheerful: getValue("cheerful"),
      social: getValue("social"),
      logical: getValue("logical"),
      kindness: getValue("kindness"),
      desire: getValue("desire"),
      courage: getValue("courage")
    }
  };

  characters.push(character);
  renderCharacterList();
}

function getValue(id) {
  const el = document.getElementById(id);
  const value = Number(el.value);

  // 성격 (0.01 ~ 0.99)
  if (el.step === "0.01") {
    return clampFloat(value, 0.01, 0.99);
  }

  // 스테이터스 (0 ~ 50)
  return clamp(value, 0, 50);
}


function renderCharacterList() {
  const list = document.getElementById("characterList");
  list.innerHTML = "";

  characters.forEach((c, i) => {
    const div = document.createElement("div");
    div.innerText = `${i + 1}. ${c.name} (${c.gender}, ${c.age})`;
    list.appendChild(div);
  });
}
