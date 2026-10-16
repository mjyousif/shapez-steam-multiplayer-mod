const { spawn } = require("child_process");

const EXE_PATH = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\shapez.io\\shapezio.exe";

const child = spawn(EXE_PATH, ["--multi-instance", "--instance-id=2", "--dev"], {
    detached: true,
    stdio: "ignore",
});

child.unref();
console.log("Launched second shapez.io Co-op test instance (PID: " + child.pid + ")!");
console.log("In the second window, click 'Steam Multiplayer' -> Connect to 127.0.0.1:27080.");
