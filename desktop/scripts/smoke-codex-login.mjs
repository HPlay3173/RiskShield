import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const codexBinary = join(
  scriptDirectory,
  "../src-tauri/resources/codex/bin/codex.exe",
);
const child = spawn(codexBinary, ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
let stderr = "";

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof message.id !== "number") return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) {
    request.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
  } else {
    request.resolve(message.result);
  }
});

function send(value) {
  child.stdin.write(`${JSON.stringify(value)}\n`);
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out. ${stderr}`));
    }, 30_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    send({ id, method, params });
  });
}

try {
  await request("initialize", {
    clientInfo: {
      name: "riskshield_ci",
      title: "RiskShield CI",
      version: "0.7.0",
    },
  });
  send({ method: "initialized", params: {} });
  const challenge = await request("account/login/start", {
    type: "chatgptDeviceCode",
  });
  if (
    typeof challenge?.loginId !== "string"
    || typeof challenge?.verificationUrl !== "string"
    || !challenge.verificationUrl.startsWith("https://")
    || typeof challenge?.userCode !== "string"
    || challenge.userCode.length === 0
  ) {
    throw new Error(`Invalid login challenge: ${JSON.stringify(challenge)}`);
  }
  console.log("Codex device login challenge received.");
} finally {
  child.kill();
  lines.close();
}
