// Builds a file for the admin portal's import screen from an "Add an application"
// issue. .github/workflows/import-file.yml posts the result as a comment.
// Self-check: node .github/scripts/issue-to-import.cjs

const MARKER = "<!-- import-file -->";
const PLATFORMS = { windows: "Windows log paths", macos: "macOS log paths", linux: "Linux log paths" };
/** The installer types each platform ships. Architectures go on every platform's paths. */
const INSTALLERS = {
  windows: ["msi", "exe", "msix", "appx"],
  macos: ["pkg", "dmg", "mas"],
  linux: ["deb", "rpm", "snap", "flatpak", "appimage"],
};

/** The form's answers by label. GitHub renders each one as "### Label", then the answer. */
function answers(body) {
  const out = {};
  for (const part of body.replace(/\r\n/g, "\n").split(/^### /m).slice(1)) {
    const [label, ...rest] = part.split("\n");
    const value = rest.join("\n").trim().replace(/^```\w*\n?([\s\S]*?)\n?```$/, "$1");
    out[label.trim()] = value === "_No response_" ? "" : value;
  }
  return out;
}

/** `{ file }` ready to import, or `{ missing }` naming what the issue still needs. */
function build(body) {
  const a = answers(body);
  const one = (label) => (a[label] ?? "").trim();
  const sure = (x) => x && x !== "Not sure";

  const installers = one("Installer type").split(",").map((t) => t.trim().toLowerCase());
  const architectures = [...one("Architecture").matchAll(/^- \[x\] (.+)$/gim)].map((m) => m[1].trim()).filter(sure);
  const scope = sure(one("Scope")) ? one("Scope") : undefined;
  const variant = one("Variant") || undefined;

  const logs = [];
  for (const [os, label] of Object.entries(PLATFORMS)) {
    const types = [...installers.filter((t) => INSTALLERS[os].includes(t)), ...architectures];
    for (const line of one(label).split("\n")) {
      // The last " | " - a path can hold a bare "|", as in com.microsoft.<Word|Excel>.
      const cut = line.lastIndexOf(" | ");
      const path = (cut < 0 ? line : line.slice(0, cut)).trim();
      const what = cut < 0 ? undefined : line.slice(cut + 3).trim() || undefined;
      if (path) logs.push({ os, path, what, variant, types: types.length ? types : undefined, scope });
    }
  }

  const missing = [
    !one("Application") && "the application name",
    !one("Vendor") && "the vendor",
    !logs.length && "at least one log path",
  ].filter(Boolean);
  if (missing.length) return { missing };

  const aliases = one("Also known as").split(",").map((x) => x.trim()).filter(Boolean);
  const documentation = one("How did you verify this?").match(/https?:\/\/[^\s<>()\]]+/)?.[0].replace(/[.,;:!?]+$/, "");
  const notes = one("Anything else");
  const app = {
    name: one("Application"),
    aliases: aliases.length ? aliases : undefined,
    documentation,
    logs,
    notes: notes ? [notes] : undefined,
  };
  // Round-tripped so the undefined keys are gone and the object is exactly what gets posted.
  return { file: JSON.parse(JSON.stringify({ vendors: [{ name: one("Vendor"), apps: [app] }] })) };
}

/** The comment body, marked so the workflow can find and update it on an edit. */
function comment(body) {
  const { file, missing } = build(body);
  if (missing) {
    return `${MARKER}\nNot enough here to build an import file yet. Missing: ${missing.join(", ")}.\n\nEdit the issue to add it and this comment updates.`;
  }
  const json = JSON.stringify(file, null, 2);
  const fence = "`".repeat(Math.max(3, ...(json.match(/`+/g) ?? []).map((run) => run.length + 1)));
  return [
    MARKER,
    "Import file for https://wherethemlogs.app/admin/import - save it as a `.json` file and preview it before applying.",
    "",
    "- If the app is already in the index, `logs` replaces its whole list. The preview shows any stored paths that would be removed.",
    "- The vendor matches by name. A different spelling (\"Microsoft Corporation\" for \"Microsoft\") creates a new vendor and moves the app to it.",
    "",
    `${fence}json`,
    json,
    fence,
  ].join("\n");
}

module.exports = { build, comment, MARKER };

if (require.main === module) {
  const assert = require("node:assert");
  const body = [
    "### Application", "", "Visual Studio Code", "",
    "### Vendor", "", "Microsoft", "",
    "### Also known as", "", "vscode, code", "",
    "### Variant", "", "_No response_", "",
    "### Windows log paths", "", "```text", "%APPDATA%\\Code\\logs\\ | Session logs", "", "```", "",
    "### macOS log paths", "", "```text", "~/Library/Containers/com.microsoft.<Word|Excel>/Logs/", "```", "",
    "### Linux log paths", "", "_No response_", "",
    "### Installer type", "", "msi, dmg, Not sure", "",
    "### Architecture", "", "- [X] x64", "- [ ] arm64", "- [ ] Not sure", "",
    "### Scope", "", "per-user", "",
    "### How did you verify this?", "", "My machine, and https://code.visualstudio.com/docs.", "",
    "### Anything else", "", "_No response_", "",
    "### Before you submit", "", "- [X] I have redacted hostnames, usernames, tenant identifiers and customer names.",
  ].join("\r\n");

  assert.deepStrictEqual(build(body).file, {
    vendors: [{
      name: "Microsoft",
      apps: [{
        name: "Visual Studio Code",
        aliases: ["vscode", "code"],
        documentation: "https://code.visualstudio.com/docs",
        logs: [
          { os: "windows", path: "%APPDATA%\\Code\\logs\\", what: "Session logs", types: ["msi", "x64"], scope: "per-user" },
          { os: "macos", path: "~/Library/Containers/com.microsoft.<Word|Excel>/Logs/", types: ["dmg", "x64"], scope: "per-user" },
        ],
      }],
    }],
  });
  assert.deepStrictEqual(build(body.replace("\r\nMicrosoft\r\n", "\r\n_No response_\r\n")).missing, ["the vendor"]);
  assert.deepStrictEqual(
    build(body.replace(/```text[\s\S]*?```/g, "_No response_")).missing,
    ["at least one log path"],
  );
  assert.ok(comment(body).includes("```json\n{"));
  console.log("ok");
}
