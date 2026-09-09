import { readFileSync } from "node:fs";

const expectedNode = readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const expectedPnpm = packageJson.packageManager?.replace(/^pnpm@/, "");
const userAgent = process.env.npm_config_user_agent ?? "";
const actualPnpm = /(?:^|\s)pnpm\/([^\s]+)/.exec(userAgent)?.[1];
const failures = [];

if (process.versions.node !== expectedNode) {
  failures.push(`Node.js 必须为 ${expectedNode}，当前为 ${process.versions.node}`);
}
if (!expectedPnpm) {
  failures.push("package.json 缺少 packageManager 字段");
} else if (actualPnpm !== expectedPnpm) {
  failures.push(
    actualPnpm
      ? `pnpm 必须为 ${expectedPnpm}，当前为 ${actualPnpm}`
      : `无法确认 pnpm 版本；请使用 pnpm ${expectedPnpm} 运行此命令`
  );
}

if (failures.length) {
  console.error(["环境门禁失败：", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}

console.log(`Environment gate passed (Node.js ${expectedNode}, pnpm ${expectedPnpm}).`);
