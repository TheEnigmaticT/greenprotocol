/* Mocked SDK fixtures, never live tenant evidence. Tests drive the real message listener. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const { createHash, webcrypto } = require("node:crypto");
const code = fs.readFileSync(
  require("node:path").join(__dirname, "../add-on.js"),
  "utf8",
);
const tick = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 5));
};
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
function hashSource(s) {
  return createHash("sha256")
    .update(
      canonical({
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
      }),
    )
    .digest("hex");
}
function boot(
  t,
  { kind = "experiment", mutate = () => {}, storage, admit = true } = {},
) {
  const dom = new JSDOM("<body/>", {
    url: "https://sandbox.elabjournal.com/",
    runScripts: "outside-only",
  });
  const w = dom.window;
  t.after(() => w.close());
  Object.defineProperty(w, "crypto", { value: webcrypto });
  w.TextEncoder = TextEncoder;
  if (storage) Object.defineProperty(w, "sessionStorage", { value: storage });
  const errors = [];
  w.addEventListener("error", (event) => errors.push(event.message));
  t.after(() => assert.deepEqual(errors, [], "no uncaught listener errors"));
  const actions = {},
    calls = [],
    sent = [];
  const popup = { closed: false, postMessage: (d) => sent.push(d) };
  w.open = () => popup;
  let protocolBody, expBody;
  const sections = new Map();
  let next = 80;
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
          headerinfo: { experimentName: "Source" },
          data: [
            {
              sectionType: "PARAGRAPH",
              sectionHeader: "Selected",
              expJournalID: 55,
              text: "<p>Original µL</p>",
            },
          ],
        });
        this.addButtonToExperimentTopToolbar = (b) =>
          (actions[b.actionID] = b.action);
        o.onReady.call(this);
      },
      Protocol: function (o) {
        this.addButtonToProtocolTopToolBar = (b) =>
          (actions[b.actionID] = b.action);
        this.addButtonToListView = () => {};
        o.onReady.call(this);
      },
    },
    API: {
      call: (r) => {
        calls.push({
          method: r.method,
          path: r.path,
          body: r.body,
          params: r.params,
        });
        let response;
        if (r.path === "auth/user")
          response = { user: { userID: 22, email: "fixture@example.test" } };
        else if (r.path === "users/getCurrentUserInfo")
          response = { userID: 22, groupId: 2, isBlocked: false };
        else if (r.path === "protocols/5")
          response = {
            protID: 5,
            protVersionID: 10,
            name: "Source",
            categoryID: 9,
            steps: [
              {
                protStepID: 1,
                name: "Selected",
                order: 1,
                contents: "<p>Original µL</p>",
              },
              {
                protStepID: 2,
                name: "Unselected",
                order: 2,
                contents: "Do not copy",
              },
            ],
          };
        else if (r.path === "protocols/categories")
          response = [
            {
              protCategoryID: 9,
              groupID: 2,
              archived: false,
              name: "Private category",
            },
          ];
        else if (r.path === "protocols/import") {
          protocolBody = r.body;
          response = 44;
        } else if (r.path === "protocols/44")
          response = {
            protID: 44,
            protVersionID: 11,
            userID: 22,
            groupID: 2,
            isPublic: false,
            groupShareCount: 0,
            categoryID: 9,
            name: protocolBody.name,
            steps: protocolBody.steps.map((s, i) => ({
              protStepID: 90 + i,
              name: s.header,
              contents: s.contents,
              order: i,
            })),
          };
        else if (r.path === "experiments" && r.method === "POST") {
          expBody = r.body;
          response = 44;
        } else if (r.path === "experiments/7")
          response = {
            experimentID: 7,
            name: "Source",
            studyID: 3,
            userID: 22,
            groupID: 2,
          };
        else if (r.path === "experiments/44")
          response = {
            experimentID: 44,
            name: expBody.name,
            studyID: expBody.studyID,
            userID: 22,
            groupID: 2,
            experimentStatus: { status: "PENDING" },
          };
        else if (r.path === "experiments/7/sections")
          response = {
            data: [
              {
                expJournalID: 55,
                experimentID: 7,
                sectionType: "PARAGRAPH",
                sectionHeader: "Selected",
                order: 0,
              },
            ],
            hasNextPage: false,
          };
        else if (r.path === "experiments/sections/55/content")
          response = { contents: "<p>Original µL</p>", meta: [] };
        else if (r.path === "experiments/44/sections" && r.method === "POST") {
          response = next++;
          sections.set(response, {
            ...r.body,
            experimentID: 44,
            expJournalID: response,
          });
        } else if (/^experiments\/sections\/\d+$/.test(r.path))
          response = sections.get(Number(r.path.split("/")[2]));
        else if (/^experiments\/sections\/\d+\/content$/.test(r.path)) {
          const section = sections.get(Number(r.path.split("/")[2]));
          if (r.method === "PUT") {
            section.contents = r.body.contents;
            response = null;
          } else response = { contents: section.contents, meta: [] };
        } else throw Error("Unexpected SDK path " + r.path);
        const changed = mutate(r, response);
        if (changed === "ERROR") {
          r.onError(null, 0, "RAW SECRET provider error");
          return;
        }
        if (changed !== undefined) response = changed;
        r.onSuccess(null, 200, response);
      },
    },
  };
  w.eval(code);
  w.greenchemistry_ai.init({
    enableSuppliesOrders: true,
    gcaiBridge: { enabled: true },
  });
  const click = (label) => {
    const b = [...w.document.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    );
    assert.ok(b, "missing " + label);
    b.click();
  };
  const receive = (
    data,
    origin = "https://greenchemistry.ai",
    source = popup,
  ) => w.dispatchEvent(new w.MessageEvent("message", { data, origin, source }));
  return { w, actions, calls, sent, click, receive, kind, admit };
}
async function connect(x) {
  if (x.kind === "experiment") {
    x.actions["greenchemistry-ai-experiment"]();
    x.w.document.querySelector("input[type=checkbox]").checked = true;
  } else {
    x.actions["greenchemistry-ai-protocol"]();
    x.w.document.querySelector("input").value = "5";
    x.click("Fetch protocol");
    await tick();
    if (x.kind === "protocol-step")
      x.w.document.querySelector("select").value = "step:1";
  }
  x.click("Connect reviewed source to GCai");
  await tick();
  x.receive({ version: 1, type: "gcai.scisure.loaded" });
  const nonce = x.sent.at(-1).nonce;
  x.receive({
    version: 1,
    type: "gcai.scisure.ready",
    nonce,
    bridgeSessionId: "session-1",
  });
  if (x.admit) x.click("Send reviewed source");
  const s = x.w.greenchemistry_ai.debug().bridge.snapshot;
  const bundle = {
    version: 2,
    snapshotId: "snapshot-1",
    sourceHash: hashSource(s),
    runId: "run-1",
    analysisRevision: 1,
    source: JSON.parse(JSON.stringify(s)),
    title: "Reviewed",
    draftText: "Reviewed selected procedure µL <img src=x onerror=alert(1)>",
    evidenceAppendixText:
      "Private evidence <script>evil()</script> warning: unsupported finding acknowledged, not applied",
    appliedFindingIds: [],
    acknowledgedFindingIds: ["finding-1"],
    limitations: ["Selected-content copy only"],
    preparedAt: "2026-10-01T12:00:00.000Z",
    bundleHash: "b".repeat(64),
  };
  return {
    version: 2,
    type: "gcai.scisure.writeback",
    nonce,
    bridgeSessionId: "session-1",
    requestId: "request-1",
    mode: "create",
    snapshot: {
      externalId: s.externalId,
      externalVersionId: s.externalVersionId || null,
      selectionIds: s.selection.map((s) => s.sectionId || s.stepId),
    },
    bundle,
  };
}
async function destination(x) {
  await tick();
  const input = x.w.document.querySelector(
    'input[aria-label="Destination study ID"]',
  );
  if (input) {
    input.value = "3";
    x.click("Use destination");
    await tick();
  }
}
const result = (x) =>
  x.sent.filter((d) => d.type === "scisure.gcai.writeback-result").at(-1);
test("a create response pointing at the original experiment never writes original sections", async (t) => {
  let posted = false;
  const x = boot(t, {
    mutate: (r, v) => {
      if (r.path === "experiments" && r.method === "POST") {
        posted = true;
        return 7;
      }
      if (posted && r.path === "experiments/7")
        return {
          ...v,
          name: "Reviewed — selected-content copy",
          experimentStatus: { status: "PENDING" },
        };
    },
  });
  const m = await connect(x);
  x.receive(m);
  await destination(x);
  assert.equal(result(x)?.status, "uncertain");
  assert.equal(result(x).targetId, "7");
  assert.ok(
    !x.calls.some(
      (r) => r.method === "POST" && r.path === "experiments/7/sections",
    ),
  );
});
test("documented private analyze routes are accepted but never linked publicly", async (t) => {
  const x = boot(t, { kind: "protocol-step" });
  const m = await connect(x);
  m.bundle.privateAnalysisPath = "/analyze/analysis-1";
  m.bundle.privateEvidencePath = "/analyze/analysis-1/evidence";
  x.receive(m);
  await tick();
  assert.equal(result(x)?.status, "saved");
});
test("missing source category asks visibly for a verified private destination category", async (t) => {
  const x = boot(t, {
    kind: "protocol-step",
    mutate: (r, v) =>
      r.path === "protocols/5" ? { ...v, categoryID: 0 } : undefined,
  });
  const m = await connect(x);
  x.receive(m);
  await tick();
  assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
  const select = x.w.document.querySelector(
    'select[aria-label="Destination protocol category"]',
  );
  assert.ok(select);
  select.value = "9";
  x.click("Use destination");
  await tick();
  assert.equal(result(x)?.status, "saved");
});
for (const reason of [
  "blocked",
  "changed-user",
  "public-category",
  "bad-category-shape",
])
  test(reason + " cannot create", async (t) => {
    const x = boot(t, {
      kind: "protocol-step",
      mutate: (r, v) =>
        r.path === "users/getCurrentUserInfo" && reason === "blocked"
          ? { ...v, isBlocked: true }
          : r.path === "users/getCurrentUserInfo" && reason === "changed-user"
            ? { ...v, userID: 99 }
            : r.path === "protocols/categories" && reason === "public-category"
              ? [{ ...v[0], groupID: 0 }]
              : r.path === "protocols/categories" &&
                  reason === "bad-category-shape"
                ? { data: v }
                : undefined,
    });
    const m = await connect(x);
    x.receive(m);
    await tick();
    assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
    assert.notEqual(result(x)?.status, "saved");
  });
test("malformed bundle returns failed without uncaught errors and does not strand busy state", async (t) => {
  const x = boot(t, { kind: "protocol-step" });
  const m = await connect(x);
  x.receive({ ...m, bundle: {} });
  await tick();
  assert.equal(result(x)?.status, "failed");
  x.receive(m);
  await tick();
  assert.equal(result(x)?.status, "saved");
});
test("v1 terminal result revision/run binding rejects a different prepared revision", async (t) => {
  const x = boot(t, { kind: "protocol-step" });
  const m = await connect(x);
  x.receive({
    version: 1,
    type: "gcai.scisure.result",
    nonce: m.nonce,
    bridgeSessionId: m.bridgeSessionId,
    snapshot: m.snapshot,
    sourceHash: m.bundle.sourceHash,
    runId: m.bundle.runId,
    revisionNumber: 2,
    recommendations: [],
  });
  x.receive(m);
  await tick();
  assert.equal(result(x)?.status, "failed");
  assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
});
test("source content changed while destination prompt is open conflicts without mutation", async (t) => {
  let changed = false;
  const x = boot(t, {
    mutate: (r, v) =>
      changed && r.path === "experiments/sections/55/content"
        ? { ...v, contents: "changed while reviewing" }
        : undefined,
  });
  const m = await connect(x);
  x.receive(m);
  await tick();
  changed = true;
  await destination(x);
  assert.equal(result(x)?.status, "conflict");
  assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
});
test("escaped outbound record has a byte bound before any external mutation", async (t) => {
  const x = boot(t, { kind: "protocol-step" });
  const m = await connect(x);
  m.bundle.draftText = '"'.repeat(50000);
  x.receive(m);
  await tick();
  assert.equal(result(x)?.status, "failed");
  assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
});
test("shipped configuration supports the authorized staging origin, not a production-only form", (t) => {
  for (const file of ["defaultConfiguration.json", "config.example.json"]) {
    const config = JSON.parse(
      fs.readFileSync(require("node:path").join(__dirname, "..", file)),
    );
    assert.equal(config.gcaiBaseUrl, "https://staging.greenchemistry.ai");
    assert.equal(config.gcaiBridge.origin, "https://staging.greenchemistry.ai");
  }
  const schema = JSON.parse(
    fs.readFileSync(
      require("node:path").join(__dirname, "../configurationSchema.json"),
    ),
  );
  assert.ok(
    schema.gcaiBaseUrl.enum.includes("https://staging.greenchemistry.ai"),
  );
  assert.ok(
    schema.gcaiBridge.properties.origin.enum.includes(
      "https://staging.greenchemistry.ai",
    ),
  );
});
test("listener actually schedules a fixed 65-minute deadline", async (t) => {
  const x = boot(t);
  const durations = [];
  const original = x.w.setTimeout.bind(x.w);
  x.w.setTimeout = (fn, ms) => {
    durations.push(ms);
    return original(fn, ms);
  };
  await connect(x);
  assert.ok(durations.includes(3900000));
});
test("corrupt saved lock cannot fabricate a success without a target ID", async (t) => {
  const x = boot(t, { kind: "protocol-step" });
  const m = await connect(x);
  const fingerprint = createHash("sha256")
    .update(canonical(m.bundle))
    .digest("hex");
  x.w.sessionStorage.setItem(
    "greenchemistry-ai.scisure.writeback.v2",
    JSON.stringify({ version: 2, state: "saved", fingerprint }),
  );
  x.receive(m);
  await tick();
  assert.equal(result(x)?.status, "failed");
  assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
});
test("corrupt durable lock fails closed without external mutation", async (t) => {
  const x = boot(t, { storage: { getItem: () => "{bad", setItem: () => {} } });
  const m = await connect(x);
  x.receive(m);
  await tick();
  assert.equal(result(x)?.status, "failed");
  assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
});
for (const kind of ["experiment", "protocol", "protocol-step"])
  test(
    kind +
      " creates only reviewed content with escaped evidence and exact ID readback",
    async (t) => {
      const x = boot(t, { kind });
      const m = await connect(x);
      x.receive(m);
      await destination(x);
      assert.equal(result(x)?.status, "saved");
      assert.equal(result(x).targetId, "44");
      assert.equal(
        result(x).targetKind,
        kind === "experiment" ? "experiment" : "protocol",
      );
      assert.equal(result(x).requestId, m.requestId);
      assert.equal(result(x).nonce, m.nonce);
      assert.equal(result(x).bridgeSessionId, m.bridgeSessionId);
      assert.ok(
        x.calls.some(
          (r) =>
            r.path ===
              (kind === "experiment" ? "experiments" : "protocols/import") &&
            r.method === "POST",
        ),
      );
      const content = x.calls
        .filter((r) => r.body)
        .map((r) => JSON.stringify(r.body))
        .join("");
      assert.match(content, /&lt;script&gt;/);
      assert.doesNotMatch(content, /<script>|<img|Do not copy/);
      assert.match(content, /selected-content/i);
      assert.equal(x.w.document.querySelectorAll("script,img").length, 0);
      assert.ok(
        !x.calls.some((r) => /supplies|catalog|orders|publish/.test(r.path)),
      );
      x.receive({ ...m, requestId: "request-2" });
      await tick();
      assert.equal(result(x).status, "saved");
      assert.equal(
        x.calls.filter(
          (r) =>
            r.method === "POST" &&
            ["experiments", "protocols/import"].includes(r.path),
        ).length,
        1,
      );
    },
  );
test("update is unsupported before any API mutation or read", async (t) => {
  const x = boot(t);
  const m = await connect(x);
  const before = x.calls.length;
  x.receive({ ...m, mode: "update" });
  await tick();
  assert.equal(result(x)?.status, "unsupported");
  assert.equal(x.calls.length, before);
});
for (const variant of [
  "nonce",
  "session",
  "origin",
  "window",
  "before-admission",
  "oversize",
  "unknown-field",
  "identity",
  "content",
  "revision",
  "hash",
  "missing-evidence",
  "public-path",
  "bundle-hash-type",
  "private-path-type",
])
  test("rejects " + variant + " without mutation", async (t) => {
    const x = boot(t, { admit: variant !== "before-admission" });
    const m = await connect(x);
    if (variant === "nonce") m.nonce = "a".repeat(64);
    if (variant === "session") m.bridgeSessionId = "other";
    if (variant === "oversize") m.bundle.draftText = "x".repeat(262144);
    if (variant === "unknown-field") m.bundle.token = "secret";
    if (variant === "identity") m.snapshot.selectionIds = ["wrong"];
    if (variant === "content")
      m.bundle.source.selection[0].originalContent = "changed";
    if (variant === "revision") m.bundle.analysisRevision = -1;
    if (variant === "hash") m.bundle.sourceHash = "f".repeat(64);
    if (variant === "missing-evidence") m.bundle.evidenceAppendixText = "";
    if (variant === "public-path") m.bundle.privateAnalysisPath = "/share/abc";
    if (variant === "bundle-hash-type")
      m.bundle.bundleHash = [m.bundle.bundleHash];
    if (variant === "private-path-type")
      m.bundle.privateAnalysisPath = ["/analyze/private-id"];
    x.receive(
      m,
      variant === "origin" ? "https://evil.test" : "https://greenchemistry.ai",
      variant === "window" ? {} : undefined,
    );
    await destination(x);
    assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
    assert.notEqual(result(x)?.status, "saved");
  });
for (const mismatch of ["source-version", "source-content", "source-id"])
  test(mismatch + " returns conflict before create", async (t) => {
    let reads = 0;
    const x = boot(t, {
      kind: "protocol-step",
      mutate: (r, response) =>
        r.path === "protocols/5" && ++reads > 1
          ? {
              ...response,
              ...(mismatch === "source-version"
                ? { protVersionID: 99 }
                : mismatch === "source-id"
                  ? { protID: 99 }
                  : {
                      steps: response.steps.map((s) => ({
                        ...s,
                        contents: "changed",
                      })),
                    }),
            }
          : undefined,
    });
    const m = await connect(x);
    x.receive(m);
    await tick();
    assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
    assert.equal(result(x)?.status, "conflict");
  });
for (const failure of [
  "post",
  "evidence-put",
  "evidence-read",
  "target-id",
  "target-content",
  "target-private",
  "section-owner",
])
  test(
    failure + " retains uncertain lock and created ID, never retries",
    async (t) => {
      let seen = 0;
      const storage = {
        value: null,
        getItem() {
          return this.value;
        },
        setItem(k, v) {
          this.value = v;
        },
      };
      const x = boot(t, {
        storage,
        kind: failure.startsWith("target") ? "protocol-step" : "experiment",
        mutate: (r, v) => {
          if (
            failure === "post" &&
            r.method === "POST" &&
            r.path === "experiments"
          )
            return "ERROR";
          if (failure === "evidence-put" && r.method === "PUT" && ++seen === 2)
            return "ERROR";
          if (
            failure === "evidence-read" &&
            r.method === "GET" &&
            r.path === "experiments/sections/81/content"
          )
            return { ...v, contents: "mismatch" };
          if (failure === "target-id" && r.path === "protocols/44")
            return { ...v, protID: 45 };
          if (failure === "target-content" && r.path === "protocols/44")
            return {
              ...v,
              steps: v.steps.map((s) => ({ ...s, contents: "mismatch" })),
            };
          if (failure === "target-private" && r.path === "protocols/44")
            return { ...v, isPublic: true };
          if (
            failure === "section-owner" &&
            r.path === "experiments/sections/80"
          )
            return { ...v, experimentID: 999 };
        },
      });
      const m = await connect(x);
      x.receive(m);
      await destination(x);
      assert.equal(result(x)?.status, "uncertain");
      if (failure !== "post") assert.equal(result(x).targetId, "44");
      assert.doesNotMatch(result(x).message, /RAW SECRET/);
      assert.ok(storage.value);
      assert.doesNotMatch(
        storage.value,
        /Original|procedure|evil|nonce|session-1|credential|token/,
      );
      const count = x.calls.filter((r) => r.method !== "GET").length;
      x.receive({ ...m, requestId: "another" });
      await tick();
      assert.equal(result(x).status, "uncertain");
      assert.equal(x.calls.filter((r) => r.method !== "GET").length, count);
      const y = boot(t, { storage, kind: x.kind });
      const m2 = await connect(y);
      y.receive(m2);
      await destination(y);
      assert.equal(result(y)?.status, "uncertain");
      assert.equal(y.calls.filter((r) => r.method !== "GET").length, 0);
    },
  );
test("storage unavailable fails closed before external writes", async (t) => {
  const x = boot(t, {
    storage: {
      getItem() {
        return null;
      },
      setItem() {
        throw Error("blocked");
      },
    },
  });
  const m = await connect(x);
  x.receive(m);
  await destination(x);
  assert.equal(x.calls.filter((r) => r.method !== "GET").length, 0);
  assert.equal(result(x)?.status, "failed");
});
test("Supplies toolbar and exported flow are removed; 65-minute runtime/config defaults align", async (t) => {
  const x = boot(t);
  assert.equal(x.w.greenchemistry_ai.openSupplyOrder, undefined);
  assert.ok(!Object.keys(x.actions).some((k) => /supplies/.test(k)));
  assert.doesNotMatch(
    code,
    /supplies\/(?:orders|catalogitems)|protocols\/.*PUT/,
  );
  for (const file of ["defaultConfiguration.json", "config.example.json"]) {
    const config = JSON.parse(
      fs.readFileSync(require("node:path").join(__dirname, "..", file)),
    );
    assert.equal(config.gcaiBridge.deadlineMs, 3900000);
    assert.equal(config.enableSuppliesOrders, undefined);
  }
  const schema = JSON.parse(
    fs.readFileSync(
      require("node:path").join(__dirname, "../configurationSchema.json"),
    ),
  );
  assert.equal(schema.gcaiBridge.properties.deadlineMs.minimum, 3900000);
  assert.equal(schema.gcaiBridge.properties.deadlineMs.maximum, 3900000);
  assert.equal(schema.gcaiBridge.properties.deadlineMs.default, 3900000);
});
