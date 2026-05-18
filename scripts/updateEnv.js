// scripts/updateEnv.js
// Called automatically by deploy.js to write contract addresses into .env
// Usage: node scripts/updateEnv.js KEY=value KEY2=value2 ...

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../.env");

const updates = {};
process.argv.slice(2).forEach(arg => {
  const [k, ...v] = arg.split("=");
  if (k && v.length) updates[k.trim()] = v.join("=").trim();
});

if (!Object.keys(updates).length) {
  console.error("Usage: node scripts/updateEnv.js KEY=value ...");
  process.exit(1);
}

let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";

for (const [key, value] of Object.entries(updates)) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
}

fs.writeFileSync(ENV_PATH, content);
console.log("✅ .env updated:", Object.keys(updates).join(", "));
