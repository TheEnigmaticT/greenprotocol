/* LOCAL MOCKED FIXTURES ONLY. Real browser postMessage, no live SciSure/GCai writes. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const code = fs.readFileSync(path.join(__dirname, "../add-on.js"), "utf8");
async function scenario(browser, kind, readbackMismatch = false) {
  const context = await browser.newContext();
  try {
    await context.route("https://sandbox.scisure.test/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<!doctype html><body><h1>Local mocked SDK fixture, not live evidence</h1><div id="toolbar"></div></body>',
      }),
    );
    await context.route("https://greenchemistry.ai/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: "<!doctype html><body>Local mock popup</body>",
      }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("https://sandbox.scisure.test/");
    await page.evaluate(
      ({ readbackMismatch }) => {
        window.calls = [];
        window.copied = "";
        let protocolBody,
          expBody,
          next = 80;
        const sections = new Map();
        Object.defineProperty(navigator, "clipboard", {
          value: {
            writeText: async (s) => {
              window.copied = s;
            },
          },
        });
        const add = (b) => {
          const n = document.createElement("button");
          n.textContent = b.label;
          n.dataset.actionid = b.actionID;
          n.onclick = b.action;
          document.querySelector("#toolbar").append(n);
        };
        window.eLabSDK = {
          ready: (cb) => cb(),
          GUI: {
            Button: function (b) {
              return b;
            },
          },
          Page: {
            Experiment: function (o) {
              this.getExperimentID = () => 7;
              this.getExperimentData = () => ({
                headerinfo: { experimentName: "Fixture synthesis" },
                data: [
                  {
                    expJournalID: 55,
                    sectionType: "PARAGRAPH",
                    sectionHeader: "Reaction",
                    contents: "<p>Stir H<sub>2</sub>O for 30 minutes.</p>",
                  },
                ],
              });
              this.addButtonToExperimentTopToolbar = add;
              o.onReady.call(this);
            },
            Protocol: function (o) {
              this.addButtonToProtocolTopToolBar = add;
              this.addButtonToListView = () => {};
              o.onReady.call(this);
            },
          },
          API: {
            call: (r) => {
              calls.push({ method: r.method, path: r.path, body: r.body });
              let v;
              if (/supplies|catalog|orders/.test(r.path))
                throw Error("Forbidden order API");
              if (r.path === "auth/user")
                v = { user: { userID: 22, email: "mock@example.test" } };
              else if (r.path === "users/getCurrentUserInfo")
                v = { userID: 22, groupId: 2, isBlocked: false };
              else if (r.path === "protocols/5")
                v = {
                  protID: 5,
                  protVersionID: 10,
                  categoryID: 9,
                  name: "Fixture synthesis",
                  steps: [
                    {
                      protStepID: 1,
                      order: 1,
                      name: "Reaction",
                      contents: "<p>Stir H<sub>2</sub>O for 30 minutes.</p>",
                    },
                    {
                      protStepID: 2,
                      order: 2,
                      name: "Unselected",
                      contents: "Unselected body, do not copy.",
                    },
                  ],
                };
              else if (r.path === "protocols/categories")
                v = [
                  {
                    protCategoryID: 9,
                    groupID: 2,
                    archived: false,
                    name: "Mock private category",
                  },
                ];
              else if (r.path === "protocols/import") {
                protocolBody = r.body;
                v = 44;
              } else if (r.path === "protocols/44")
                v = {
                  protID: 44,
                  protVersionID: 11,
                  name: protocolBody.name,
                  categoryID: 9,
                  userID: 22,
                  groupID: 2,
                  isPublic: false,
                  groupShareCount: 0,
                  steps: protocolBody.steps.map((s, i) => ({
                    protStepID: 90 + i,
                    order: i,
                    name: s.header,
                    contents: readbackMismatch ? "MISMATCH" : s.contents,
                  })),
                };
              else if (r.path === "experiments" && r.method === "POST") {
                expBody = r.body;
                v = 44;
              } else if (r.path === "experiments/7")
                v = { experimentID: 7, studyID: 3, userID: 22, groupID: 2 };
              else if (r.path === "experiments/44")
                v = {
                  experimentID: 44,
                  name: expBody.name,
                  studyID: 3,
                  userID: 22,
                  groupID: 2,
                  experimentStatus: { status: "PENDING" },
                };
              else if (r.path === "experiments/7/sections")
                v = {
                  data: [
                    {
                      expJournalID: 55,
                      experimentID: 7,
                      sectionType: "PARAGRAPH",
                      sectionHeader: "Reaction",
                      order: 0,
                    },
                  ],
                  hasNextPage: false,
                };
              else if (r.path === "experiments/sections/55/content")
                v = {
                  contents: "<p>Stir H<sub>2</sub>O for 30 minutes.</p>",
                  meta: [],
                };
              else if (
                r.path === "experiments/44/sections" &&
                r.method === "POST"
              ) {
                v = next++;
                sections.set(v, {
                  ...r.body,
                  expJournalID: v,
                  experimentID: 44,
                });
              } else if (/^experiments\/sections\/\d+$/.test(r.path))
                v = sections.get(Number(r.path.split("/")[2]));
              else if (/^experiments\/sections\/\d+\/content$/.test(r.path)) {
                const s = sections.get(Number(r.path.split("/")[2]));
                if (r.method === "PUT") {
                  s.contents = r.body.contents;
                  v = null;
                } else v = { contents: s.contents, meta: [] };
              } else throw Error("Unknown mock path " + r.path);
              r.onSuccess(null, 200, v);
            },
          },
        };
      },
      { readbackMismatch },
    );
    await page.addScriptTag({ content: code });
    await page.evaluate(() =>
      greenchemistry_ai.init({ gcaiBridge: { enabled: true } }),
    );
    if (kind === "experiment") {
      await page
        .locator('[data-actionid="greenchemistry-ai-experiment"]')
        .click();
      await page.getByRole("checkbox").check();
      await page
        .getByRole("button", { name: "Copy reviewed text", exact: true })
        .click();
      assert.match(await page.evaluate(() => copied), /H₂O/);
    } else {
      await page
        .locator('[data-actionid="greenchemistry-ai-protocol"]')
        .click();
      await page.getByLabel("Protocol ID", { exact: true }).fill("5");
      await page
        .getByRole("button", { name: "Fetch protocol", exact: true })
        .click();
      await page.getByLabel("Protocol content to copy").selectOption("step:1");
      assert.doesNotMatch(
        await page.getByLabel("Reviewed protocol text").inputValue(),
        /Unselected/,
      );
    }
    const popupWait = page.waitForEvent("popup");
    await page
      .getByRole("button", {
        name: "Connect reviewed source to GCai",
        exact: true,
      })
      .click();
    const popup = await popupWait;
    popup.on("pageerror", (e) => errors.push(e.message));
    await popup.waitForLoadState();
    await popup.evaluate(() => {
      window.received = [];
      window.addEventListener("message", (e) => received.push(e.data));
      opener.postMessage(
        { version: 1, type: "gcai.scisure.loaded" },
        "https://sandbox.scisure.test",
      );
    });
    await popup.waitForFunction(() =>
      received.some((d) => d.type === "scisure.gcai.hello"),
    );
    await popup.evaluate(() => {
      window.nonce = received.find(
        (d) => d.type === "scisure.gcai.hello",
      ).nonce;
      opener.postMessage(
        {
          version: 1,
          type: "gcai.scisure.ready",
          nonce,
          bridgeSessionId: "browser-session",
        },
        "https://sandbox.scisure.test",
      );
    });
    await page
      .getByRole("button", { name: "Send reviewed source", exact: true })
      .click();
    await popup.waitForFunction(() =>
      received.some((d) => d.type === "scisure.gcai.admission"),
    );
    // Build fixture bundle from the REAL admission message. No internal bridge state access.
    await popup.evaluate(async () => {
      const s = received.find(
        (d) => d.type === "scisure.gcai.admission",
      ).source;
      const canonical = (x) =>
        Array.isArray(x)
          ? "[" + x.map(canonical).join(",") + "]"
          : x && typeof x === "object"
            ? "{" +
              Object.keys(x)
                .sort()
                .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
                .join(",") +
              "}"
            : JSON.stringify(x);
      const provenance = {
        kind: s.kind,
        externalId: s.externalId,
        externalVersionId: s.externalVersionId || null,
        selection: s.selection.map((x) => ({
          sectionId: x.sectionId || null,
          stepId: x.stepId || null,
          order: x.order,
          title: x.title || "",
          originalContent: x.originalContent,
          normalizedText: x.normalizedText,
        })),
      };
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(canonical(provenance)),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      window.writeback = {
        version: 2,
        type: "gcai.scisure.writeback",
        nonce,
        bridgeSessionId: "browser-session",
        requestId: "browser-request",
        mode: "create",
        snapshot: {
          externalId: s.externalId,
          externalVersionId: s.externalVersionId || null,
          selectionIds: s.selection.map((x) => x.sectionId || x.stepId),
        },
        bundle: {
          version: 2,
          snapshotId: "browser-snapshot",
          sourceHash: hash,
          runId: "browser-run",
          analysisRevision: 1,
          source: s,
          title: "Mock reviewed draft",
          draftText:
            'Reviewed selected content µL <img src=x onerror="window.pwned=1">',
          evidenceAppendixText:
            "Private warning acknowledged, not applied. <script>window.pwned=1</script>",
          appliedFindingIds: [],
          acknowledgedFindingIds: ["finding-1"],
          limitations: ["Selected-content copy only"],
          preparedAt: "2026-10-01T12:00:00.000Z",
          bundleHash: "b".repeat(64),
        },
      };
      opener.postMessage(writeback, "https://sandbox.scisure.test");
    });
    if (kind === "experiment") {
      await page.getByLabel("Destination study ID").fill("3");
      await page
        .getByRole("button", { name: "Use destination", exact: true })
        .click();
    }
    await popup.waitForFunction(() =>
      received.some((d) => d.type === "scisure.gcai.writeback-result"),
    );
    const receipt = await popup.evaluate(() =>
      received.filter((d) => d.type === "scisure.gcai.writeback-result").at(-1),
    );
    assert.equal(receipt.status, readbackMismatch ? "uncertain" : "saved");
    assert.equal(receipt.targetId, "44");
    assert.equal(
      receipt.targetKind,
      kind === "experiment" ? "experiment" : "protocol",
    );
    const before = await page.evaluate(
      () => calls.filter((c) => c.method !== "GET").length,
    );
    await popup.evaluate(() =>
      opener.postMessage(
        { ...writeback, requestId: "duplicate-request" },
        "https://sandbox.scisure.test",
      ),
    );
    await popup.waitForFunction(() =>
      received.some((d) => d.requestId === "duplicate-request"),
    );
    assert.equal(
      await page.evaluate(() => calls.filter((c) => c.method !== "GET").length),
      before,
    );
    await popup.evaluate(() =>
      opener.postMessage(
        { ...writeback, mode: "update", requestId: "update-request" },
        "https://sandbox.scisure.test",
      ),
    );
    await popup.waitForFunction(() =>
      received.some((d) => d.requestId === "update-request"),
    );
    assert.equal(
      await popup.evaluate(
        () => received.find((d) => d.requestId === "update-request").status,
      ),
      "unsupported",
    );
    assert.equal(
      await page.evaluate(() => calls.filter((c) => c.method !== "GET").length),
      before,
    );
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    assert.equal(
      await page.locator("[role=dialog] img,[role=dialog] script").count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", {
          name: /Supplies|Replace this|Save as a new|Copy updated/,
        })
        .count(),
      0,
    );
    const bodies = await page.evaluate(() =>
      JSON.stringify(calls.filter((c) => c.body)),
    );
    assert.match(bodies, /&lt;script&gt;/);
    assert.doesNotMatch(bodies, /<script>|<img|Unselected body/);
    const lock = await page.evaluate(() =>
      sessionStorage.getItem("greenchemistry-ai.scisure.writeback.v2"),
    );
    assert.doesNotMatch(
      lock,
      /browser-session|nonce|procedure|credential|window.pwned/,
    );
    assert.deepEqual(errors, []);
    return {
      kind,
      readbackMismatch,
      status: receipt.status,
      duplicateMutation: false,
      update: "unsupported",
      pageErrors: errors,
    };
  } finally {
    await context.close();
  }
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const outcomes = [];
    for (const [kind, fault] of [
      ["experiment", false],
      ["protocol-step", false],
      ["protocol-step", true],
    ])
      outcomes.push(await scenario(browser, kind, fault));
    const report = {
      environment:
        "LOCAL headless Chromium, mocked SDK/API and popup; NOT live write evidence",
      outcomes,
    };
    const out = path.join(__dirname, "../verification");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
