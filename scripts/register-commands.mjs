import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const applicationId = process.env.DISCORD_APPLICATION_ID;
if (!applicationId || !/^\d+$/.test(applicationId)) {
  throw new Error("Set DISCORD_APPLICATION_ID in .dev.vars first.");
}

const commands = [
  { name: "makeitquote", type: 3, integration_types: [1], contexts: [0, 1, 2] }
];

const terminal = createInterface({ input: stdin, output: stdout });
let token = process.env.DISCORD_BOT_TOKEN;
try {
  if (!token) {
    if (!stdin.isTTY) throw new Error("Supply DISCORD_BOT_TOKEN through the environment.");
    stdout.write("Bot token (input hidden): ");
    terminal._writeToOutput = () => {};
    token = await terminal.question("");
    stdout.write("\n");
  }
} finally {
  terminal.close();
}

const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token.trim()}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands)
});
if (!response.ok) throw new Error(`Command registration failed (${response.status}). Check the application settings/token.`);
console.log("Registered makeitquote (message context menu, user install only).");
console.log(`Install: https://discord.com/oauth2/authorize?client_id=${applicationId}&integration_type=1&scope=applications.commands`);
