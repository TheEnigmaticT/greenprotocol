const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "../add-on.js"),
  "utf8",
);
test("clipboard failure never opens GCai", async () => {
  const dom = new JSDOM("<body/>", {
      url: "https://sandbox.elabjournal.com/",
      runScripts: "outside-only",
    }),
    w = dom.window;
  let opens = 0;
  w.open = () => {
    opens++;
  };
  w.navigator.clipboard = {
    writeText: () => Promise.reject(new Error("denied")),
  };
  w.eval(source);
  w.greenchemistry_ai.init({});
  await assert.rejects(
    w.greenchemistry_ai.openGCaiAfterCopy("Text"),
    /denied|Clipboard/,
  );
  assert.equal(opens, 0);
  w.close();
});
