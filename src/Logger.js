export default class Logger {
  static logArea = document.getElementById("log");

  static write(text) {
    Logger.logArea.innerText += text + "\n";
    Logger.logArea.scrollTop = Logger.logArea.scrollHeight;
  }

  static separator(title) {
    Logger.write("\n====================");
    Logger.write(title);
    Logger.write("====================");
  }
}


