const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "../add-on.js"),
  "utf8",
);
function boot(t, sdk = {}, config = {}) {
  const dom = new JSDOM("<body/>", {
    url: "https://sandbox.elabjournal.com/",
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.eLabSDK = sdk;
  let copied = "";
  w.navigator.clipboard = {
    writeText: async (s) => {
      copied = s;
    },
  };
  const opened = [];
  w.open = (...args) => opened.push(args);
  w.eval(source);
  w.greenchemistry_ai.init(config);
  return { w, copied: () => copied, opened };
}
const tick = () => new Promise((r) => setImmediate(r));
test("required standalone global and version remain available", (t) => {
  const { w } = boot(t);
  assert.equal(typeof w.greenchemistry_ai.init, "function");
  assert.equal(w.greenchemistry_ai.version, "0.4.0");
});
test("manual GCai handoff copies first and opens only fixed HTTPS destination", async (t) => {
  const x = boot(t);
  await x.w.greenchemistry_ai.openGCaiAfterCopy("Reviewed µL");
  assert.equal(x.copied(), "Reviewed µL");
  assert.deepEqual(x.opened[0], [
    "https://greenchemistry.ai/analyze?new=1",
    "_blank",
    "noopener,noreferrer",
  ]);
  assert.throws(
    () =>
      x.w.greenchemistry_ai.init({
        gcaiBaseUrl: "https://greenchemistry.ai/path?x=1",
      }),
    /fixed HTTPS origin/,
  );
});
test("experiment text remains explicitly selected and never opens GCai automatically", async (t) => {
  let toolbar;
  const x = boot(t, {
    ready: (cb) => cb(),
    GUI: {
      Button: function (b) {
        toolbar = b;
        return b;
      },
    },
    Page: {
      Experiment: function (o) {
        this.getExperimentID = () => 7;
        this.getExperimentData = () => ({
          headerinfo: { experimentName: "Run" },
          data: [
            { sectionType: "TEXT", header: "Reaction", text: "Use ethanol." },
            { sectionType: "TABLE", rows: ["hidden"] },
          ],
        });
        o.onReady.call(this);
      },
    },
  });
  toolbar.action();
  const check = x.w.document.querySelector("input[type=checkbox]");
  assert.equal(check.checked, false);
  check.checked = true;
  [...x.w.document.querySelectorAll("button")]
    .find((b) => b.textContent === "Copy reviewed text")
    .click();
  await tick();
  assert.match(x.copied(), /Use ethanol/);
  assert.doesNotMatch(x.copied(), /hidden/);
  assert.equal(x.opened.length, 0);
});
