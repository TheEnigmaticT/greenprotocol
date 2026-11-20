const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "../add-on.js"),
  "utf8",
);
function setup(config = {}, api = () => {}) {
  const dom = new JSDOM(
    '<body><button id="original">Original</button></body>',
    {
      url: "https://sandbox.elabjournal.com/members/",
      runScripts: "outside-only",
    },
  );
  const w = dom.window;
  let copied = "";
  const actions = {};
  w.navigator.clipboard = {
    writeText: async (text) => {
      copied = text;
    },
  };
  w.open = () => ({});
  w.eLabSDK = {
    ready: (cb) => cb(),
    GUI: {
      Button: function (o) {
        return o;
      },
    },
    Page: {
      Experiment: function (o) {
        this.getExperimentID = () => 7;
        this.getExperimentData = () => ({
          headerinfo: { experimentName: "Test" },
          data: [],
        });
        this.addButtonToExperimentTopToolbar = (b) => {
          actions[b.actionID] = b.action;
        };
        o.onReady.call(this);
      },
      Protocol: function (o) {
        this.addButtonToProtocolTopToolBar = (b) => {
          actions[b.actionID] = b.action;
        };
        this.addButtonToListView = () => {};
        o.onReady.call(this);
      },
    },
    API: { call: api },
  };
  w.eval(source);
  w.greenchemistry_ai.init(config);
  const click = (name) => {
    const b = [...w.document.querySelectorAll("button")].find(
      (x) => x.textContent === name,
    );
    assert.ok(b, "Missing button " + name);
    b.click();
  };
  return { w, actions, click, copied: () => copied };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("protocol review displays selected text and keeps rich content inert", async () => {
  const x = setup({}, (r) =>
    r.onSuccess(null, 200, {
      protID: 5,
      protVersionID: 10,
      name: "Workup",
      steps: [
        {
          protStepID: 1,
          order: 1,
          name: "Mix",
          contents: "<p>Use ethanol</p><script>window.pwned=true</script>",
        },
      ],
    }),
  );
  x.actions["greenchemistry-ai-protocol"]();
  x.w.document.querySelector("input").value = "5";
  x.click("Fetch protocol");
  await tick();
  const area = x.w.document.querySelector("textarea");
  assert.ok(area);
  assert.match(area.value, /Use ethanol/);
  x.click("Copy reviewed protocol");
  await tick();
  assert.doesNotMatch(x.copied(), /<p>|window.pwned/);
  assert.equal(x.w.pwned, undefined);
});
test("experiment missing inline content uses documented section content API", async () => {
  const calls = [];
  const x = setup({}, (r) => {
    calls.push(r);
    if (r.path === "experiments/7/sections")
      r.onSuccess(null, 200, {
        data: [
          {
            expJournalID: 99,
            sectionType: "TEXT",
            sectionHeader: "Reaction",
            position: 1,
          },
        ],
        hasNextPage: false,
      });
    else if (r.path === "experiments/sections/99/content")
      r.onSuccess(null, 200, {
        contents: "<p>Stir ethanol for ten minutes.</p>",
        meta: [],
      });
  });
  x.actions["greenchemistry-ai-experiment"]();
  await tick();
  assert.ok(calls.some((r) => r.path === "experiments/sections/99/content"));
  const c = x.w.document.querySelector("input[type=checkbox]");
  assert.ok(c);
  c.checked = true;
  x.click("Copy reviewed text");
  await tick();
  assert.match(x.copied(), /Stir ethanol/);
  assert.doesNotMatch(x.copied(), /<p>/);
});
test("modal has actual overlay styling and traps focus", () => {
  const x = setup();
  x.actions["greenchemistry-ai-protocol"]();
  const dialog = x.w.document.querySelector("[role=dialog]");
  assert.ok(dialog);
  assert.equal(dialog.parentNode.style.position, "fixed");
  const controls = [
    ...dialog.querySelectorAll("button,input,select,textarea,a[href]"),
  ];
  controls.at(-1).focus();
  controls
    .at(-1)
    .dispatchEvent(
      new x.w.KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
  assert.equal(x.w.document.activeElement, controls[0]);
});
