class Logger {
  static header(text) {
    console.log("\n====================");
    console.log(text);
    console.log("====================");
  }

  static log(text) {
    console.log(text);
  }

  static revealRoles(characters) {
    console.log("\n=== 역할 공개 ===");
    characters.forEach(c => {
      console.log(`${c.name} : ${c.role}`);
    });
  }
}

module.exports = Logger;

