/* Standalone SciSure private review bridge. Provider/source/model text is untrusted. */
var greenchemistry_ai = (function () {
  "use strict";
  var DEFAULT_ORIGIN = "https://greenchemistry.ai";
  var LOCK_KEY = "greenchemistry-ai.scisure.writeback.v2";
  var DEADLINE = 3900000;
  var ID = /^[A-Za-z0-9._:-]{1,160}$/,
    HASH = /^[a-f0-9]{64}$/;
  var state = { config: {}, activeModal: null, bridge: null, writeBusy: false };
  function element(tag, text) {
    var node = document.createElement(tag);
    if (tag === "button")
      node.style.cssText =
        "padding:8px 12px;margin:8px 8px 8px 0;border:1px solid #a6b9ac;border-radius:5px;background:#edf4ef;color:#183923;cursor:pointer";
    if (tag === "input" || tag === "select" || tag === "textarea")
      node.style.cssText =
        "padding:8px;margin:6px 8px 6px 0;max-width:100%;border:1px solid #a6b9ac;border-radius:4px;color:#16251c;background:#fff";
    if (tag === "pre")
      node.style.cssText =
        "white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f3f6f4;color:#16251c;max-height:240px;overflow:auto";
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, handler) {
    var node = element("button", label);
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  }
  function positiveInt(value) {
    return (
      Number.isSafeInteger(Number(value)) &&
      Number(value) > 0 &&
      Number(value) <= 2147483647
    );
  }
  function status(parent, message, error) {
    var node = element("p", message);
    node.setAttribute("role", error ? "alert" : "status");
    parent.append(node);
    return node;
  }
  function fixedOrigin(value) {
    var parsed;
    try {
      parsed = new URL(value || DEFAULT_ORIGIN);
    } catch (_) {
      throw new Error("gcaiBaseUrl must be a fixed HTTPS origin.");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("gcaiBaseUrl must be a fixed HTTPS origin.");
    return parsed.origin;
  }
  function bridgePath(value) {
    var path = value || "/integrations/scisure/connect";
    if (
      typeof path !== "string" ||
      !/^\/[A-Za-z0-9._~\/-]*$/.test(path) ||
      path.indexOf("//") === 0
    )
      throw new Error("gcaiBridge.path must be a relative HTTPS-origin path.");
    return path;
  }
  function addSdkButton(options) {
    return window.eLabSDK && window.eLabSDK.GUI && window.eLabSDK.GUI.Button
      ? new window.eLabSDK.GUI.Button(options)
      : options;
  }
  function apiCall(request) {
    return new Promise(function (resolve, reject) {
      if (
        !window.eLabSDK ||
        !window.eLabSDK.API ||
        typeof window.eLabSDK.API.call !== "function"
      ) {
        reject(new Error("SciSure SDK API is unavailable."));
        return;
      }
      var timer = setTimeout(function () {
        reject(new Error("SDK operation timed out; no retry."));
      }, 30000);
      request.onSuccess = function (_xhr, _status, response) {
        clearTimeout(timer);
        resolve(response);
      };
      // Never expose raw SDK/provider errors, which may include content or credentials.
      request.onError = function () {
        clearTimeout(timer);
        reject(new Error("SDK operation failed; no retry."));
      };
      try {
        window.eLabSDK.API.call(request);
      } catch (_) {
        clearTimeout(timer);
        reject(new Error("SDK operation failed; no retry."));
      }
    });
  }
  function openModal(title) {
    if (state.activeModal) state.activeModal.cleanup();
    var prior = document.activeElement,
      overlay = element("div"),
      dialog = element("section"),
      heading = element("h2", title),
      id = "gcai-title-" + Date.now();
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px";
    dialog.style.cssText =
      "width:760px;max-width:100%;max-height:85vh;overflow:auto;background:#fff;color:#16251c;padding:24px;border-radius:8px;box-shadow:0 12px 50px #0005;text-align:left;font:14px/1.5 system-ui,sans-serif";
    heading.id = id;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", id);
    var close = button("Close", cleanup);
    dialog.append(heading, close);
    overlay.append(dialog);
    document.body.append(overlay);
    function keydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup();
        return;
      }
      if (event.key === "Tab") {
        var nodes = Array.from(
          dialog.querySelectorAll(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ),
        );
        var first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    function cleanup() {
      if (
        state.bridge &&
        state.bridge.modal &&
        state.bridge.modal.dialog === dialog
      )
        cleanupBridge();
      document.removeEventListener("keydown", keydown);
      overlay.remove();
      if (state.activeModal && state.activeModal.dialog === dialog)
        state.activeModal = null;
      if (prior && typeof prior.focus === "function") prior.focus();
    }
    document.addEventListener("keydown", keydown);
    close.focus();
    state.activeModal = { dialog: dialog, close: close, cleanup: cleanup };
    return state.activeModal;
  }
  function copyText(text) {
    if (!text) return Promise.reject(new Error("Nothing selected to copy."));
    if (
      !navigator.clipboard ||
      typeof navigator.clipboard.writeText !== "function"
    )
      return Promise.reject(
        new Error(
          "Clipboard access is unavailable. Select and copy the reviewed text manually.",
        ),
      );
    return navigator.clipboard.writeText(text);
  }
  var subMap = {
    0: "₀",
    1: "₁",
    2: "₂",
    3: "₃",
    4: "₄",
    5: "₅",
    6: "₆",
    7: "₇",
    8: "₈",
    9: "₉",
    "+": "₊",
    "-": "₋",
    "=": "₌",
    "(": "₍",
    ")": "₎",
  };
  var supMap = {
    0: "⁰",
    1: "¹",
    2: "²",
    3: "³",
    4: "⁴",
    5: "⁵",
    6: "⁶",
    7: "⁷",
    8: "⁸",
    9: "⁹",
    "+": "⁺",
    "-": "⁻",
    "=": "⁼",
    "(": "⁽",
    ")": "⁾",
  };
  function mapped(value, map) {
    return value.replace(/[0-9+\-=()]/g, function (c) {
      return map[c] || c;
    });
  }
  function normalizeHtml(value) {
    if (typeof value !== "string")
      return { text: "", warnings: ["Missing text content."] };
    var parsed = new DOMParser().parseFromString(value, "text/html"),
      warnings = [];
    if (
      /<(?:script|style|iframe|object|embed|svg|math|img|video|audio|canvas)\b/i.test(
        value,
      )
    )
      warnings.push(
        "Active or non-text markup was removed from the reviewed text.",
      );
    if (
      /<\/(?:b|strong|i|em|span|font|a)\b|<(?:b|strong|i|em|span|font|a)\b/i.test(
        value,
      )
    )
      warnings.push("Rich formatting or links were converted to text.");
    function walk(node) {
      if (node.nodeType === 3) return node.nodeValue;
      if (node.nodeType !== 1) return "";
      var tag = node.tagName.toLowerCase();
      if (
        /^(script|style|iframe|object|embed|svg|math|img|video|audio|canvas)$/.test(
          tag,
        )
      )
        return "";
      if (tag === "br") return "\n";
      var text = Array.from(node.childNodes).map(walk).join("");
      if (tag === "sub") return mapped(text, subMap);
      if (tag === "sup") return mapped(text, supMap);
      if (tag === "td" || tag === "th") return text + "\t";
      if (tag === "tr") return text.replace(/\t$/, "") + "\n";
      if (/^(p|div|li|h[1-6]|section|article|blockquote)$/.test(tag))
        return "\n" + text + "\n";
      return text;
    }
    var text = walk(parsed.body)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \f\v]+\n/g, "\n")
      .replace(/\n[ \f\v]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text: text, warnings: warnings };
  }
  function freeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.keys(value).forEach(function (k) {
        freeze(value[k]);
      });
      Object.freeze(value);
    }
    return value;
  }
  function bytes(value) {
    var text = JSON.stringify(value);
    if (typeof TextEncoder !== "undefined")
      return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }
  function buildSnapshot(raw) {
    if (
      !raw ||
      !/^(experiment|protocol|protocol-step)$/.test(raw.kind) ||
      !raw.externalId ||
      !Array.isArray(raw.selection) ||
      !raw.selection.length
    )
      throw new Error(
        "A reviewed source with at least one selection is required.",
      );
    if (raw.selection.length > 100)
      throw new Error(
        "A reviewed source may contain at most 100 selected sections or steps.",
      );
    var selections = raw.selection.map(function (item, index) {
      if (
        !item ||
        typeof item.originalContent !== "string" ||
        typeof item.normalizedText !== "string"
      )
        throw new Error("Selected source text is missing.");
      return {
        sectionId: item.sectionId ? String(item.sectionId) : undefined,
        stepId: item.stepId ? String(item.stepId) : undefined,
        order: Number.isFinite(item.order) ? item.order : index + 1,
        title: typeof item.title === "string" ? item.title : "",
        originalContent: item.originalContent,
        normalizedText: item.normalizedText,
        warnings: Array.isArray(item.warnings) ? item.warnings.slice() : [],
      };
    });
    var snapshot = {
      version: 1,
      kind: raw.kind,
      externalId: String(raw.externalId),
      externalVersionId:
        raw.externalVersionId === undefined || raw.externalVersionId === null
          ? undefined
          : String(raw.externalVersionId),
      title: String(raw.title || "Untitled source"),
      retrievedAt: new Date().toISOString(),
      selection: selections,
      importWarnings: [].concat.apply(
        [],
        selections.map(function (s) {
          return s.warnings;
        }),
      ),
    };
    snapshot.protocolText = selections
      .map(function (s) {
        return (
          "## " + (s.title || "Untitled selection") + "\n" + s.normalizedText
        );
      })
      .join("\n\n");
    if (bytes(snapshot) > 65536)
      throw new Error(
        "Reviewed source exceeds the 64 KiB bridge payload limit.",
      );
    return freeze(snapshot);
  }
  function snapshotCopy(snapshot) {
    return (
      (snapshot.kind === "experiment" ? "Experiment" : "Protocol") +
      ": " +
      snapshot.title +
      " (ID " +
      snapshot.externalId +
      (snapshot.externalVersionId
        ? ", version " + snapshot.externalVersionId
        : "") +
      ")\n\n" +
      snapshot.protocolText
    );
  }
  function nonce() {
    var values = new Uint8Array(32);
    if (!window.crypto || typeof window.crypto.getRandomValues !== "function")
      throw new Error("Secure Web Crypto nonce generation is unavailable.");
    window.crypto.getRandomValues(values);
    return Array.from(values)
      .map(function (v) {
        return v.toString(16).padStart(2, "0");
      })
      .join("");
  }
  function validEmail(value) {
    return (
      typeof value === "string" &&
      value.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    );
  }
  function sourceIdentity(snapshot) {
    return {
      externalId: snapshot.externalId,
      externalVersionId: snapshot.externalVersionId || null,
      selectionIds: snapshot.selection.map(function (s) {
        return s.sectionId || s.stepId || "#" + s.order;
      }),
    };
  }
  function exactSource(got, snapshot) {
    var expected = sourceIdentity(snapshot);
    return (
      got &&
      typeof got === "object" &&
      got.externalId === expected.externalId &&
      (got.externalVersionId || null) === expected.externalVersionId &&
      Array.isArray(got.selectionIds) &&
      got.selectionIds.length === expected.selectionIds.length &&
      got.selectionIds.every(function (id, i) {
        return id === expected.selectionIds[i];
      })
    );
  }
  function validRecommendation(item, snapshot) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.recommendationId !== "string" ||
      !ID.test(item.recommendationId) ||
      typeof item.alternativeChemical !== "string" ||
      !item.alternativeChemical.trim() ||
      item.alternativeChemical.length > 512 ||
      /[<>\u0000]/.test(item.alternativeChemical) ||
      ["chemical-substitution", "process-change", "warning"].indexOf(
        item.kind,
      ) === -1 ||
      ["accepted", "rejected", "unreviewed"].indexOf(item.decision) === -1 ||
      item.requiresScientistReview !== true
    )
      return false;
    if (
      item.sourceStepId !== null &&
      item.sourceStepId !== undefined &&
      !snapshot.selection.some(function (s) {
        return s.stepId === String(item.sourceStepId);
      })
    )
      return false;
    return true;
  }
  function cleanupBridge(message, error) {
    var bridge = state.bridge;
    if (!bridge) return;
    bridge.closed = true;
    if (bridge.cancelDestination) bridge.cancelDestination();
    clearTimeout(bridge.deadlineTimer);
    clearInterval(bridge.closeTimer);
    window.removeEventListener("message", bridge.listener);
    if (message && bridge.modal && bridge.modal.dialog.isConnected)
      status(bridge.modal.dialog, message, error);
    state.bridge = null;
  }
  function showResults(bridge, recommendations) {
    var holder = element("section");
    holder.append(
      element("h3", "GCai returned recommendations — review required"),
      element(
        "p",
        "Continue review, Ask, evidence, draft preview and final choice in the GCai popup. Update-existing is unavailable: atomic audit-preserving updates are not documented.",
      ),
    );
    recommendations.forEach(function (rec) {
      holder.append(
        element("p", rec.alternativeChemical),
        element(
          "p",
          typeof rec.caveats === "string"
            ? rec.caveats
            : "Scientist review is required.",
        ),
      );
    });
    bridge.modal.dialog.append(holder);
  }

  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object")
      return (
        "{" +
        Object.keys(value)
          .sort()
          .map(function (key) {
            return JSON.stringify(key) + ":" + canonical(value[key]);
          })
          .join(",") +
        "}"
      );
    return JSON.stringify(value);
  }
  function provenance(source) {
    return {
      kind: source.kind,
      externalId: source.externalId,
      externalVersionId: source.externalVersionId || null,
      selection: source.selection.map(function (s) {
        return {
          sectionId: s.sectionId || null,
          stepId: s.stepId || null,
          order: s.order,
          title: s.title || "",
          originalContent: s.originalContent,
          normalizedText: s.normalizedText,
        };
      }),
    };
  }
  function digest(text) {
    if (
      !window.crypto ||
      !window.crypto.subtle ||
      typeof TextEncoder === "undefined"
    )
      return Promise.reject(new Error("Content binding unavailable."));
    return window.crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(text))
      .then(function (buffer) {
        return Array.from(new Uint8Array(buffer))
          .map(function (b) {
            return b.toString(16).padStart(2, "0");
          })
          .join("");
      });
  }
  function object(value, allowed, required) {
    return (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every(function (key) {
        return allowed.indexOf(key) !== -1;
      }) &&
      required.every(function (key) {
        return Object.prototype.hasOwnProperty.call(value, key);
      })
    );
  }
  function text(value, max) {
    return (
      typeof value === "string" &&
      !!value.trim() &&
      value.length <= max &&
      !/[\u0000\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/.test(value)
    );
  }
  function strings(value, max, idOnly) {
    return (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every(function (s) {
        return text(s, max) && (!idOnly || ID.test(s));
      }) &&
      new Set(value).size === value.length
    );
  }
  function validateWriteback(data, bridge) {
    var fields = [
      "version",
      "snapshotId",
      "sourceHash",
      "runId",
      "analysisRevision",
      "source",
      "title",
      "draftText",
      "evidenceAppendixText",
      "privateAnalysisPath",
      "privateEvidencePath",
      "appliedFindingIds",
      "acknowledgedFindingIds",
      "limitations",
      "preparedAt",
      "bundleHash",
    ];
    if (
      !object(
        data,
        [
          "version",
          "type",
          "nonce",
          "bridgeSessionId",
          "requestId",
          "mode",
          "snapshot",
          "bundle",
        ],
        [
          "version",
          "type",
          "nonce",
          "bridgeSessionId",
          "requestId",
          "mode",
          "snapshot",
          "bundle",
        ],
      ) ||
      bytes(data) > 262144 ||
      !ID.test(data.requestId) ||
      ["create", "update"].indexOf(data.mode) === -1 ||
      !object(
        data.snapshot,
        ["externalId", "externalVersionId", "selectionIds"],
        ["externalId", "selectionIds"],
      ) ||
      !exactSource(data.snapshot, bridge.snapshot)
    )
      throw new Error("Invalid writeback envelope.");
    var b = data.bundle;
    if (
      !object(
        b,
        fields,
        fields.filter(function (f) {
          return f !== "privateAnalysisPath" && f !== "privateEvidencePath";
        }),
      ) ||
      b.version !== 2 ||
      !text(b.snapshotId, 160) ||
      !ID.test(b.snapshotId) ||
      !text(b.runId, 160) ||
      !ID.test(b.runId) ||
      typeof b.sourceHash !== "string" ||
      !HASH.test(b.sourceHash) ||
      typeof b.bundleHash !== "string" ||
      !HASH.test(b.bundleHash) ||
      !Number.isSafeInteger(b.analysisRevision) ||
      b.analysisRevision < 0 ||
      !text(b.title, 256) ||
      !text(b.draftText, 131072) ||
      !text(b.evidenceAppendixText, 65536) ||
      !strings(b.appliedFindingIds, 160, true) ||
      !strings(b.acknowledgedFindingIds, 160, true) ||
      b.appliedFindingIds.some(function (id) {
        return b.acknowledgedFindingIds.indexOf(id) !== -1;
      }) ||
      !strings(b.limitations, 512, false) ||
      !text(b.preparedAt, 64) ||
      !Number.isFinite(Date.parse(b.preparedAt))
    )
      throw new Error("Invalid prepared bundle.");
    if (
      (b.privateAnalysisPath !== undefined &&
        (typeof b.privateAnalysisPath !== "string" ||
          !/^\/analyze\/[A-Za-z0-9-]{1,160}$/.test(b.privateAnalysisPath))) ||
      (b.privateEvidencePath !== undefined &&
        (typeof b.privateEvidencePath !== "string" ||
          !/^\/analyze\/[A-Za-z0-9-]{1,160}\/evidence$/.test(
            b.privateEvidencePath,
          )))
    )
      throw new Error("Only private analysis paths are allowed.");
    var s = b.source,
      original = bridge.snapshot;
    if (
      !object(
        s,
        [
          "version",
          "kind",
          "externalId",
          "externalVersionId",
          "title",
          "retrievedAt",
          "selection",
          "protocolText",
          "importWarnings",
        ],
        [
          "version",
          "kind",
          "externalId",
          "title",
          "retrievedAt",
          "selection",
          "protocolText",
          "importWarnings",
        ],
      ) ||
      s.version !== 1 ||
      s.kind !== original.kind ||
      s.title !== original.title ||
      s.retrievedAt !== original.retrievedAt ||
      s.protocolText !== original.protocolText ||
      !Array.isArray(s.importWarnings) ||
      canonical(s.importWarnings) !== canonical(original.importWarnings) ||
      !Array.isArray(s.selection) ||
      s.selection.length !== original.selection.length ||
      !s.selection.length ||
      s.selection.length > 100 ||
      bytes(s) > 65536
    )
      throw new Error("Source mismatch.");
    if (
      s.selection.some(function (v) {
        return (
          !object(
            v,
            [
              "sectionId",
              "stepId",
              "order",
              "title",
              "originalContent",
              "normalizedText",
              "warnings",
            ],
            ["order", "originalContent", "normalizedText"],
          ) ||
          !text(v.originalContent, 65536) ||
          !text(v.normalizedText, 65536)
        );
      }) ||
      canonical(provenance(s)) !== canonical(provenance(original))
    )
      throw new Error("Source content mismatch.");
    if (
      bridge.resultBinding &&
      (b.sourceHash !== bridge.resultBinding.sourceHash ||
        b.runId !== bridge.resultBinding.runId ||
        (bridge.resultBinding.revision !== null &&
          b.analysisRevision !== bridge.resultBinding.revision))
    )
      throw new Error("Run/revision mismatch.");
    if (
      bytes({
        name: b.title + " — selected-content copy",
        steps: [
          {
            header: "GCai reviewed selected content",
            contents: html(b.draftText),
          },
          {
            header: "GCai private evidence appendix",
            contents: html(evidence(b)),
          },
        ],
      }) > 262144
    )
      throw new Error("Escaped destination exceeds byte limit.");
    return digest(canonical(provenance(original))).then(function (hash) {
      if (b.sourceHash !== hash) throw new Error("Source hash mismatch.");
      return freeze(b);
    });
  }
  function result(bridge, data, outcome, message, lock) {
    var response = {
      version: 2,
      type: "scisure.gcai.writeback-result",
      nonce: bridge.nonce,
      bridgeSessionId: bridge.bridgeSessionId,
      requestId: data.requestId,
      status: outcome,
      message: message,
    };
    if (lock && lock.targetId) {
      response.targetId = lock.targetId;
      response.targetKind = lock.targetKind;
    }
    try {
      bridge.popup.postMessage(response, state.config.gcaiBridge.origin);
    } catch (_) {
      /* Durable lock is authoritative when delivery is uncertain. */
    }
    if (bridge.modal.dialog.isConnected)
      status(bridge.modal.dialog, message, outcome !== "saved");
  }
  function loadLock() {
    var raw = window.sessionStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    var lock = JSON.parse(raw);
    if (
      !object(
        lock,
        ["version", "state", "fingerprint", "targetId", "targetKind"],
        ["version", "state", "fingerprint"],
      ) ||
      lock.version !== 2 ||
      ["pending", "uncertain", "saved"].indexOf(lock.state) === -1 ||
      (lock.state === "saved" && (!lock.targetId || !lock.targetKind)) ||
      !HASH.test(lock.fingerprint) ||
      (lock.targetId !== undefined &&
        (!/^\d+$/.test(lock.targetId) || !positiveInt(lock.targetId))) ||
      (lock.targetKind !== undefined &&
        ["experiment", "protocol"].indexOf(lock.targetKind) === -1)
    )
      throw new Error("Lock unavailable.");
    return lock;
  }
  function storeLock(lock) {
    window.sessionStorage.setItem(LOCK_KEY, JSON.stringify(lock));
  }
  function conflict() {
    var error = new Error("Source changed since admission.");
    error.conflict = true;
    throw error;
  }
  function checkActive(bridge) {
    if (bridge.closed || state.bridge !== bridge || bridge.popup.closed)
      throw new Error("Connection closed.");
  }
  function verifySource(snapshot) {
    if (!/^\d+$/.test(snapshot.externalId) || !positiveInt(snapshot.externalId))
      return Promise.reject(new Error("Unsupported source ID."));
    if (snapshot.kind !== "experiment")
      return apiCall({
        method: "GET",
        path: "protocols/" + snapshot.externalId,
      }).then(function (live) {
        if (
          !live ||
          String(live.protID) !== snapshot.externalId ||
          String(live.protVersionID) !== snapshot.externalVersionId ||
          !Array.isArray(live.steps)
        )
          conflict();
        snapshot.selection.forEach(function (s) {
          var found = live.steps.filter(function (step) {
            return String(step.protStepID) === s.stepId;
          });
          if (
            found.length !== 1 ||
            found[0].contents !== s.originalContent ||
            Number(found[0].order) !== s.order ||
            (found[0].name || "Step " + found[0].protStepID) !== s.title
          )
            conflict();
        });
        return live;
      });
    return apiCall({
      method: "GET",
      path: "experiments/" + snapshot.externalId,
    }).then(function (live) {
      if (!live || String(live.experimentID) !== snapshot.externalId)
        conflict();
      return apiCall({
        method: "GET",
        path: "experiments/" + snapshot.externalId + "/sections",
        params: { $page: 0, $records: 1000 },
      }).then(function (sections) {
        if (
          !sections ||
          !Array.isArray(sections.data) ||
          sections.hasNextPage !== false
        )
          throw new Error("Cannot verify source membership.");
        return Promise.all(
          snapshot.selection.map(function (s) {
            var found = sections.data.filter(function (v) {
              return String(v.expJournalID) === s.sectionId;
            });
            if (
              found.length !== 1 ||
              String(found[0].experimentID) !== snapshot.externalId ||
              ["TEXT", "PARAGRAPH", "PROCEDURE"].indexOf(
                found[0].sectionType,
              ) === -1
            )
              conflict();
            return apiCall({
              method: "GET",
              path: "experiments/sections/" + s.sectionId + "/content",
            }).then(function (content) {
              if (!content || content.contents !== s.originalContent)
                conflict();
            });
          }),
        ).then(function () {
          return live;
        });
      });
    });
  }
  function destinationStudy(bridge) {
    return new Promise(function (resolve, reject) {
      var holder = element("section"),
        input = element("input");
      input.inputMode = "numeric";
      input.setAttribute("aria-label", "Destination study ID");
      holder.append(
        element(
          "p",
          "The popup confirmed create-new. Enter the required destination study ID. This copies selected content only, not a full experiment; collaborators are not auto-assigned.",
        ),
        input,
      );
      var done = false;
      function finish(value) {
        if (done) return;
        done = true;
        holder.remove();
        bridge.cancelDestination = null;
        if (value) resolve(value);
        else reject(new Error("Destination cancelled."));
      }
      bridge.cancelDestination = function () {
        finish(null);
      };
      holder.append(
        button("Use destination", function () {
          if (
            !/^\d+$/.test(input.value.trim()) ||
            !positiveInt(input.value.trim())
          ) {
            status(holder, "Enter a positive study ID.", true);
            return;
          }
          finish(Number(input.value.trim()));
        }),
      );
      bridge.modal.dialog.append(holder);
      input.focus();
    });
  }
  function escaped(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function html(value) {
    return "<pre>" + escaped(value) + "</pre>";
  }
  function evidence(bundle) {
    // Trusted labels bind every field without interpreting warning/hypothesis text as procedure edits.
    return (
      "GreenChemistry.ai private evidence appendix\nSelected-content copy only; not a full source copy.\nSource kind: " +
      bundle.source.kind +
      "\nSource ID: " +
      bundle.source.externalId +
      "\nSource version: " +
      (bundle.source.externalVersionId || "unversioned") +
      "\nSelection IDs: " +
      sourceIdentity(bundle.source).selectionIds.join(", ") +
      "\nSnapshot: " +
      bundle.snapshotId +
      "\nSource hash: " +
      bundle.sourceHash +
      "\nRun: " +
      bundle.runId +
      "\nAnalysis revision: " +
      bundle.analysisRevision +
      "\nBundle hash: " +
      bundle.bundleHash +
      "\nPrepared: " +
      bundle.preparedAt +
      "\nApplied findings: " +
      bundle.appliedFindingIds.join(", ") +
      "\nAcknowledged only: " +
      bundle.acknowledgedFindingIds.join(", ") +
      "\nLimitations:\n" +
      bundle.limitations.join("\n") +
      "\n\n" +
      bundle.evidenceAppendixText
    );
  }
  function assertEqual(ok) {
    if (!ok) throw new Error("Exact target readback failed.");
  }
  function createdId(value) {
    if (typeof value !== "number" || !positiveInt(value))
      throw new Error("Create did not return a documented ID.");
    return String(value);
  }
  function destinationCategory(bridge, live, user) {
    return apiCall({
      method: "GET",
      path: "protocols/categories",
      params: { public: false, archived: false },
    }).then(function (categories) {
      if (!Array.isArray(categories) || categories.length > 1000)
        throw new Error("Category list unavailable.");
      var choices = categories.filter(function (c) {
        return (
          c &&
          typeof c.protCategoryID === "number" &&
          positiveInt(c.protCategoryID) &&
          c.groupID === user.groupID &&
          c.groupID > 0 &&
          c.archived === false
        );
      });
      var sourceCategory = choices.find(function (c) {
        return c.protCategoryID === live.categoryID;
      });
      if (sourceCategory) return sourceCategory;
      if (!choices.length)
        throw new Error("No verified private destination category.");
      return new Promise(function (resolve, reject) {
        var holder = element("section"),
          select = element("select"),
          done = false;
        select.setAttribute("aria-label", "Destination protocol category");
        var empty = element("option", "Select a private category");
        empty.value = "";
        select.append(empty);
        choices.forEach(function (c) {
          var option = element(
            "option",
            (typeof c.name === "string" ? c.name : "Private category") +
              " (ID " +
              c.protCategoryID +
              ")",
          );
          option.value = String(c.protCategoryID);
          select.append(option);
        });
        function finish(category) {
          if (done) return;
          done = true;
          holder.remove();
          bridge.cancelDestination = null;
          if (category) resolve(category);
          else reject(new Error("Destination cancelled."));
        }
        bridge.cancelDestination = function () {
          finish(null);
        };
        holder.append(
          element(
            "p",
            "The source category is unavailable. Choose a documented private destination category; no category ID is guessed.",
          ),
          select,
          button("Use destination", function () {
            var selected = choices.find(function (c) {
              return String(c.protCategoryID) === select.value;
            });
            if (!selected) {
              status(holder, "Choose a private destination category.", true);
              return;
            }
            finish(selected);
          }),
        );
        bridge.modal.dialog.append(holder);
        select.focus();
      });
    });
  }
  function createProtocol(bridge, bundle, category, user, lock) {
    return Promise.resolve().then(function () {
      var name = bundle.title + " — selected-content copy",
        steps = [
          {
            header: "GCai reviewed selected content",
            contents: html(bundle.draftText),
          },
          {
            header: "GCai private evidence appendix",
            contents: html(evidence(bundle)),
          },
        ];
      checkActive(bridge);
      storeLock(lock);
      return apiCall({
        method: "POST",
        path: "protocols/import",
        body: { name: name, categoryID: category.protCategoryID, steps: steps },
      })
        .then(function (id) {
          lock.targetId = createdId(id);
          lock.targetKind = "protocol";
          storeLock(lock);
          return apiCall({ method: "GET", path: "protocols/" + lock.targetId });
        })
        .then(function (record) {
          assertEqual(
            record &&
              String(record.protID) === lock.targetId &&
              record.name === name &&
              record.categoryID === category.protCategoryID &&
              record.userID === user.userID &&
              record.groupID === user.groupID &&
              record.isPublic === false &&
              record.groupShareCount === 0 &&
              Array.isArray(record.steps) &&
              record.steps.length === steps.length,
          );
          var ordered = record.steps.slice().sort(function (a, b) {
            return a.order - b.order;
          });
          steps.forEach(function (s, i) {
            assertEqual(
              ordered[i].name === s.header &&
                ordered[i].contents === s.contents,
            );
          });
        });
    });
  }
  function createExperiment(bridge, bundle, user, studyID, lock) {
    var name = bundle.title + " — selected-content copy";
    checkActive(bridge);
    storeLock(lock);
    return apiCall({
      method: "POST",
      path: "experiments",
      body: {
        studyID: studyID,
        name: name,
        status: "PENDING",
        templateID: 0,
        autoCollaborate: false,
      },
    })
      .then(function (id) {
        lock.targetId = createdId(id);
        lock.targetKind = "experiment";
        storeLock(lock);
        assertEqual(lock.targetId !== bundle.source.externalId);
        return apiCall({ method: "GET", path: "experiments/" + lock.targetId });
      })
      .then(function (record) {
        assertEqual(
          record &&
            String(record.experimentID) === lock.targetId &&
            record.name === name &&
            record.studyID === studyID &&
            record.userID === user.userID &&
            record.groupID === user.groupID &&
            record.experimentStatus &&
            record.experimentStatus.status === "PENDING",
        );
        var sections = [
          {
            header: "GCai reviewed selected content",
            contents: html(bundle.draftText),
          },
          {
            header: "GCai private evidence appendix",
            contents: html(evidence(bundle)),
          },
        ];
        return sections.reduce(function (previous, section, index) {
          return previous.then(function () {
            return apiCall({
              method: "POST",
              path: "experiments/" + lock.targetId + "/sections",
              body: {
                sectionType: "PARAGRAPH",
                sectionHeader: section.header,
                order: index,
              },
            }).then(function (id) {
              var sectionID = createdId(id);
              return apiCall({
                method: "GET",
                path: "experiments/sections/" + sectionID,
              })
                .then(function (meta) {
                  assertEqual(
                    meta &&
                      String(meta.expJournalID) === sectionID &&
                      String(meta.experimentID) === lock.targetId &&
                      meta.sectionType === "PARAGRAPH" &&
                      meta.sectionHeader === section.header &&
                      meta.order === index,
                  );
                  return apiCall({
                    method: "PUT",
                    path: "experiments/sections/" + sectionID + "/content",
                    body: { contents: section.contents, meta: [] },
                  });
                })
                .then(function () {
                  return apiCall({
                    method: "GET",
                    path: "experiments/sections/" + sectionID + "/content",
                  });
                })
                .then(function (content) {
                  assertEqual(content && content.contents === section.contents);
                });
            });
          });
        }, Promise.resolve());
      });
  }
  function handleWriteback(bridge, data) {
    var lock = null,
      sentMutation = false;
    if (state.writeBusy) {
      result(
        bridge,
        data,
        "uncertain",
        "A writeback is already in progress. Do not retry.",
      );
      return;
    }
    state.writeBusy = true;
    Promise.resolve()
      .then(function () {
        return validateWriteback(data, bridge);
      })
      .then(function (bundle) {
        checkActive(bridge);
        if (data.mode === "update") {
          result(
            bridge,
            data,
            "unsupported",
            "Update-existing disabled: no documented audit-preserving atomic version contract.",
          );
          return null;
        }
        // Local fingerprint covers the complete prepared content, not an unverified caller hash or request ID.
        return digest(canonical(bundle)).then(function (fingerprint) {
          lock = loadLock();
          if (lock) {
            var same = lock.fingerprint === fingerprint;
            result(
              bridge,
              data,
              lock.state === "saved" && same ? "saved" : "uncertain",
              lock.state === "saved" && same
                ? "Previously verified writeback; no new mutation."
                : "Writeback locked. Reconcile the retained record before another attempt.",
              lock,
            );
            return null;
          }
          return verifySource(bridge.snapshot).then(function (live) {
            return apiCall({
              method: "GET",
              path: "users/getCurrentUserInfo",
            }).then(function (response) {
              if (
                !response ||
                !positiveInt(response.userID) ||
                !positiveInt(response.groupId) ||
                response.isBlocked !== false ||
                (bridge.userClaim.userID &&
                  String(response.userID) !== bridge.userClaim.userID)
              )
                throw new Error("Destination ownership unavailable.");
              var user = { userID: response.userID, groupID: response.groupId };
              return (
                bundle.source.kind === "experiment"
                  ? destinationStudy(bridge)
                  : destinationCategory(bridge, live, user)
              ).then(function (studyID) {
                // A destination prompt may remain open for an hour. Recheck source and SDK principal just before mutation.
                return verifySource(bridge.snapshot)
                  .then(function () {
                    return apiCall({
                      method: "GET",
                      path: "users/getCurrentUserInfo",
                    });
                  })
                  .then(function (current) {
                    if (
                      !current ||
                      current.userID !== user.userID ||
                      current.groupId !== user.groupID ||
                      current.isBlocked !== false
                    )
                      throw new Error("Destination principal changed.");
                    checkActive(bridge);
                    lock = {
                      version: 2,
                      state: "pending",
                      fingerprint: fingerprint,
                    };
                    storeLock(lock);
                    sentMutation = true;
                    return (
                      bundle.source.kind === "experiment"
                        ? createExperiment(bridge, bundle, user, studyID, lock)
                        : createProtocol(bridge, bundle, studyID, user, lock)
                    ).then(function () {
                      lock.state = "saved";
                      storeLock(lock);
                      result(
                        bridge,
                        data,
                        "saved",
                        "New " +
                          lock.targetKind +
                          " verified by exact ID, procedure, ownership and private evidence readback.",
                        lock,
                      );
                    });
                  });
              });
            });
          });
        });
      })
      .catch(function (error) {
        if (sentMutation) {
          lock.state = "uncertain";
          try {
            storeLock(lock);
          } catch (_) {}
          result(
            bridge,
            data,
            "uncertain",
            "External writeback is uncertain. Retained record ID must be reconciled manually; do not retry.",
            lock,
          );
        } else
          result(
            bridge,
            data,
            error.conflict ? "conflict" : "failed",
            error.conflict
              ? "Source revision or selected content changed; no mutation."
              : "Writeback validation, destination or persistence failed; no mutation.",
          );
      })
      .finally(function () {
        state.writeBusy = false;
      });
  }
  function startBridge(snapshot) {
    var config = state.config.gcaiBridge;
    if (config.enabled !== true) {
      var disabled = openModal("GCai connection unavailable");
      status(
        disabled.dialog,
        "Secure GCai connection is disabled. Use reviewed clipboard handoff instead; no identity lookup or popup was started.",
        true,
      );
      return;
    }
    var popup = window.open(
      config.origin + config.path,
      "_blank",
      "popup=yes,width=980,height=800",
    );
    if (!popup) {
      var blocked = openModal("GCai connection unavailable");
      status(
        blocked.dialog,
        "The connection popup was blocked. Allow popups and try again, or use reviewed clipboard handoff.",
        true,
      );
      return;
    }
    var modal = openModal("Review GCai admission");
    modal.dialog.append(
      element(
        "p",
        "This bridge sends only the reviewed selection after you approve it. Source text is retained for up to 90 days by GreenChemistry.ai. No files are uploaded.",
      ),
    );
    var email = element("input");
    email.type = "email";
    email.setAttribute("aria-label", "Email delivery address");
    email.placeholder = "Optional email address";
    var delivery = element("input");
    delivery.type = "checkbox";
    delivery.setAttribute("aria-label", "Email delivery consent");
    var marketing = element("input");
    marketing.type = "checkbox";
    marketing.setAttribute("aria-label", "Marketing consent");
    var emailLabel = element("label");
    emailLabel.append(
      delivery,
      document.createTextNode(
        " Email delivery requested (SMTP unavailable; deferred)",
      ),
      email,
    );
    var marketingLabel = element("label");
    marketingLabel.append(
      marketing,
      document.createTextNode(
        " Send me GreenChemistry.ai tips and product updates (optional)",
      ),
    );
    modal.dialog.append(
      emailLabel,
      element("br"),
      marketingLabel,
      element(
        "p",
        "A signed-in GreenChemistry.ai account is required for this connection. Guest admission and unverified email recovery are unavailable. Email does not prove identity. Review and final choice remain in the popup.",
      ),
    );
    var bridge = {
      popup: popup,
      modal: modal,
      snapshot: snapshot,
      nonce: nonce(),
      helloSent: false,
      ready: false,
      sent: false,
      closed: false,
      deadlineTimer: null,
      closeTimer: null,
      listener: null,
      userClaim: {},
    };
    state.bridge = bridge;
    function reject(message) {
      status(modal.dialog, "GCai message rejected: " + message, true);
    }
    bridge.listener = function (event) {
      var data = event.data;
      if (
        state.bridge !== bridge ||
        event.origin !== config.origin ||
        event.source !== popup ||
        !data ||
        typeof data.type !== "string"
      ) {
        reject("origin or window did not match.");
        return;
      }
      if (data.version === 2 && data.type === "gcai.scisure.writeback") {
        if (
          !bridge.ready ||
          !bridge.sent ||
          data.nonce !== bridge.nonce ||
          data.bridgeSessionId !== bridge.bridgeSessionId ||
          typeof data.requestId !== "string" ||
          !ID.test(data.requestId)
        ) {
          reject(
            "writeback before submitted state or invalid nonce/session/request.",
          );
          return;
        }
        // Clone before asynchronous validation so even local callers cannot change a pending payload.
        try {
          if (bytes(data) > 262144) throw new Error("oversize");
          data = JSON.parse(JSON.stringify(data));
        } catch (_) {
          result(
            bridge,
            data,
            "failed",
            "Malformed or oversized writeback; no mutation.",
          );
          return;
        }
        handleWriteback(bridge, data);
        return;
      }
      if (data.version !== 1) {
        reject("unsupported version.");
        return;
      }
      if (data.type === "gcai.scisure.loaded") {
        if (bridge.ready || bridge.sent || Object.keys(data).length !== 2) {
          reject("loaded replay or unsupported public bootstrap fields.");
          return;
        }
        bridge.helloSent = true;
        popup.postMessage(
          { version: 1, type: "scisure.gcai.hello", nonce: bridge.nonce },
          config.origin,
        );
        status(
          modal.dialog,
          "GCai bridge acknowledged loading. Waiting for its nonce-bound ready message.",
        );
        return;
      }
      if (data.nonce !== bridge.nonce) {
        reject("nonce did not match.");
        return;
      }
      if (data.type === "gcai.scisure.login-required") {
        if (
          bridge.ready ||
          typeof data.loginUrl !== "string" ||
          !/^\/login\?next=%2Fintegrations%2Fscisure%2Fconnect$/.test(
            data.loginUrl,
          )
        ) {
          reject("invalid login return request.");
          return;
        }
        status(
          modal.dialog,
          "Sign in is required in the GCai popup. After sign-in, the connection will repeat its nonce-bound handshake.",
        );
        try {
          popup.location.href = config.origin + data.loginUrl;
        } catch (_) {}
        return;
      }
      if (data.type === "gcai.scisure.failure") {
        if (
          !bridge.ready ||
          data.bridgeSessionId !== bridge.bridgeSessionId ||
          typeof data.reason !== "string" ||
          data.reason.length > 512
        ) {
          reject("invalid terminal failure.");
          return;
        }
        cleanupBridge(
          "GCai did not return a completed reviewed result. Saved analysis may still be recoverable from your private account.",
          true,
        );
        return;
      }
      if (data.type === "gcai.scisure.ready") {
        if (
          !bridge.helloSent ||
          bridge.ready ||
          typeof data.bridgeSessionId !== "string" ||
          !ID.test(data.bridgeSessionId)
        ) {
          reject("ready before hello, replay, or invalid session.");
          return;
        }
        bridge.ready = true;
        bridge.bridgeSessionId = data.bridgeSessionId;
        status(
          modal.dialog,
          "GCai bridge is ready. Review consent and send the immutable source snapshot.",
        );
        return;
      }
      if (data.type === "gcai.scisure.result") {
        if (!bridge.ready || !bridge.sent) {
          reject(
            "result arrived before a nonce-bound reviewed source admission.",
          );
          return;
        }
        if (data.status !== undefined) {
          reject(
            "result was not terminal; waiting for the completed reviewed result.",
          );
          return;
        }
        if (
          bridge.resultBinding ||
          typeof data.sourceHash !== "string" ||
          !HASH.test(data.sourceHash) ||
          typeof data.runId !== "string" ||
          !ID.test(data.runId) ||
          (data.revisionNumber !== null &&
            (!Number.isSafeInteger(data.revisionNumber) ||
              data.revisionNumber < 0)) ||
          data.bridgeSessionId !== bridge.bridgeSessionId ||
          !exactSource(data.snapshot, snapshot) ||
          !Array.isArray(data.recommendations) ||
          data.recommendations.length > 100 ||
          bytes(data) > 262144 ||
          data.recommendations.some(function (r) {
            return !validRecommendation(r, snapshot);
          })
        ) {
          reject(
            "result failed strict schema, provenance, session, or source validation.",
          );
          return;
        }
        bridge.resultBinding = {
          sourceHash: data.sourceHash,
          runId: data.runId,
          revision: data.revisionNumber,
        };
        popup.postMessage(
          {
            version: 1,
            type: "scisure.gcai.received",
            nonce: bridge.nonce,
            bridgeSessionId: bridge.bridgeSessionId,
            count: data.recommendations.length,
          },
          config.origin,
        );
        showResults(bridge, data.recommendations);
        return;
      }
      reject("unsupported message type.");
    };
    window.addEventListener("message", bridge.listener);
    bridge.deadlineTimer = setTimeout(function () {
      cleanupBridge(
        "GCai connection expired. Saved analysis and decisions remain private; chemistry was not retried. Reconnect/recovery must not rerun analysis. SMTP guest recovery is unavailable.",
        true,
      );
    }, config.deadlineMs);
    bridge.closeTimer = setInterval(function () {
      if (popup.closed)
        cleanupBridge(
          bridge.sent
            ? "GCai connection popup was closed after the reviewed source was submitted. Delivery is uncertain; do not retry external writes."
            : "GCai connection popup was closed. No source was submitted.",
          true,
        );
    }, 500);
    apiCall({ method: "GET", path: "auth/user" })
      .then(function (response) {
        var user = response && response.user;
        if (user && typeof user.email === "string") email.value = user.email;
        if (
          user &&
          (typeof user.userID === "string" || positiveInt(user.userID))
        )
          bridge.userClaim = { userID: String(user.userID) };
      })
      .catch(function () {
        status(
          modal.dialog,
          "Could not retrieve the current SciSure user. You may continue without email delivery.",
          true,
        );
      });
    modal.dialog.append(
      button("Send reviewed source", function () {
        if (state.bridge !== bridge || !bridge.ready || bridge.sent) {
          status(
            modal.dialog,
            "GCai is not ready or this reviewed source was already sent.",
            true,
          );
          return;
        }
        var deliveryConsent = delivery.checked === true,
          marketingConsent = marketing.checked === true,
          address = email.value.trim(),
          purpose = deliveryConsent || marketingConsent;
        if (purpose && !validEmail(address)) {
          status(
            modal.dialog,
            "Enter a valid email address for the selected email purpose.",
            true,
          );
          return;
        }
        var payload = {
          version: 1,
          type: "scisure.gcai.admission",
          nonce: bridge.nonce,
          bridgeSessionId: bridge.bridgeSessionId,
          requestId: bridge.nonce,
          source: snapshot,
          email: {
            address: purpose ? address : undefined,
            deliveryConsent: deliveryConsent,
            marketingConsent: marketingConsent,
          },
          userClaim: bridge.userClaim,
        };
        bridge.sent = true;
        popup.postMessage(payload, config.origin);
        status(
          modal.dialog,
          "Reviewed source sent to the GCai bridge. Continue private review in the popup.",
        );
      }),
    );
  }
  function sectionText(section) {
    var d = section && section.data ? section.data : section;
    if (
      !d ||
      ["TEXT", "PARAGRAPH", "PROCEDURE"].indexOf(
        String(d.sectionType || "").toUpperCase(),
      ) === -1
    )
      return null;
    var original =
      typeof d.text === "string"
        ? d.text
        : typeof d.contents === "string"
          ? d.contents
          : null;
    if (!original) return null;
    var norm = normalizeHtml(original);
    return {
      sectionId: d.expJournalID || d.sectionID || d.id,
      order: Number(d.order || d.position || 0),
      title: d.sectionHeader || d.header || "Untitled text section",
      originalContent: original,
      normalizedText: norm.text,
      warnings: norm.warnings,
    };
  }
  function experimentHandoff(page) {
    var modal = openModal("Review experiment text"),
      experiment = page.getExperimentData(),
      title =
        experiment &&
        experiment.headerinfo &&
        typeof experiment.headerinfo.experimentName === "string"
          ? experiment.headerinfo.experimentName
          : "Unnamed experiment",
      id =
        typeof page.getExperimentID === "function"
          ? page.getExperimentID()
          : null,
      raw = experiment && Array.isArray(experiment.data) ? experiment.data : [],
      sections = raw.map(sectionText).filter(Boolean),
      choices = [];
    modal.dialog.append(
      element(
        "p",
        "Read-only review. Select source text before copying or using the disabled-by-default connection. Variables are not resolved. Only selected content is copied.",
      ),
    );
    function render(list) {
      list.forEach(function (section) {
        var label = element("label"),
          check = element("input");
        check.type = "checkbox";
        label.append(check, document.createTextNode(" " + section.title));
        modal.dialog.append(label, element("pre", section.normalizedText));
        if (section.warnings.length)
          status(modal.dialog, section.warnings.join(" "));
        choices.push({ check: check, section: section });
      });
      function current() {
        return buildSnapshot({
          kind: "experiment",
          externalId: id || "unknown",
          title: title,
          selection: choices
            .filter(function (c) {
              return c.check.checked;
            })
            .map(function (c) {
              return c.section;
            }),
        });
      }
      [
        [
          "Copy reviewed text",
          function (s) {
            return copyText(snapshotCopy(s));
          },
        ],
        [
          "Copy and open GCai",
          function (s) {
            return openGCaiAfterCopy(snapshotCopy(s));
          },
        ],
        [
          "Connect reviewed source to GCai",
          function (s) {
            startBridge(s);
            return Promise.resolve();
          },
        ],
      ].forEach(function (item) {
        modal.dialog.append(
          button(item[0], function () {
            var snap;
            try {
              snap = current();
            } catch (e) {
              status(modal.dialog, e.message, true);
              return;
            }
            item[1](snap).catch(function () {
              status(
                modal.dialog,
                "Clipboard access failed. Copy the reviewed text manually.",
                true,
              );
            });
          }),
        );
      });
    }
    if (sections.length) {
      if (raw.length > sections.length)
        status(
          modal.dialog,
          raw.length - sections.length + " non-text sections excluded.",
        );
      render(sections);
    } else if (positiveInt(id)) {
      status(
        modal.dialog,
        "Loading supported section contents through the SciSure API. Files are excluded.",
      );
      apiCall({
        method: "GET",
        path: "experiments/" + id + "/sections",
        params: { $page: 0, $records: 1000 },
      })
        .then(function (response) {
          if (
            !response ||
            !Array.isArray(response.data) ||
            response.hasNextPage
          )
            throw new Error("No partial experiment is copied.");
          var supported = response.data.filter(function (s) {
            return (
              ["TEXT", "PARAGRAPH", "PROCEDURE"].indexOf(s.sectionType) !== -1
            );
          });
          if (supported.length > 100)
            throw new Error("Too many text sections.");
          return Promise.all(
            supported.map(function (s) {
              return apiCall({
                method: "GET",
                path: "experiments/sections/" + s.expJournalID + "/content",
              }).then(function (content) {
                var norm = normalizeHtml(content && content.contents);
                return {
                  sectionId: s.expJournalID,
                  order: Number(s.order || s.position || 0),
                  title: s.sectionHeader || "Text section " + s.expJournalID,
                  originalContent: content.contents,
                  normalizedText: norm.text,
                  warnings: norm.warnings,
                };
              });
            }),
          );
        })
        .then(render)
        .catch(function () {
          status(
            modal.dialog,
            "Could not load supported experiment content.",
            true,
          );
        });
    } else
      status(
        modal.dialog,
        "Current experiment ID unavailable. Review and paste procedure text manually.",
        true,
      );
  }
  function protocolHandoff() {
    var modal = openModal("Fetch protocol for review"),
      input = element("input"),
      content = element("div");
    input.type = "text";
    input.inputMode = "numeric";
    input.setAttribute("aria-label", "Protocol ID");
    modal.dialog.append(
      element(
        "p",
        "Enter a protocol ID manually. This add-on does not use an undocumented current-protocol ID getter.",
      ),
      input,
      content,
    );
    modal.dialog.append(
      button("Fetch protocol", function () {
        content.replaceChildren();
        if (!/^\d+$/.test(input.value.trim()) || Number(input.value) < 1) {
          status(content, "Enter a positive numeric protocol ID.", true);
          return;
        }
        apiCall({ method: "GET", path: "protocols/" + input.value.trim() })
          .then(function (protocol) {
            if (
              !protocol ||
              typeof protocol.name !== "string" ||
              !Array.isArray(protocol.steps)
            )
              throw new Error("Unsupported protocol.");
            var steps = protocol.steps.slice().sort(function (a, b) {
                return Number(a.order) - Number(b.order);
              }),
              select = element("select"),
              all = element("option", "Whole protocol"),
              preview = element("textarea");
            all.value = "all";
            select.setAttribute("aria-label", "Protocol content to copy");
            select.append(all);
            steps.forEach(function (step) {
              var opt = element(
                "option",
                step.name || "Step " + step.protStepID,
              );
              opt.value = "step:" + step.protStepID;
              select.append(opt);
            });
            preview.readOnly = true;
            preview.rows = 12;
            preview.style.width = "100%";
            preview.setAttribute("aria-label", "Reviewed protocol text");
            content.append(
              element(
                "p",
                "Fetched protocol: " +
                  protocol.name +
                  " (ID " +
                  protocol.protID +
                  ", version " +
                  protocol.protVersionID +
                  ")",
              ),
              select,
              preview,
            );
            function snapshot() {
              var pick =
                select.value === "all"
                  ? steps
                  : steps.filter(function (step) {
                      return "step:" + step.protStepID === select.value;
                    });
              if (
                !pick.length ||
                pick.some(function (s) {
                  return typeof s.contents !== "string";
                })
              )
                throw new Error(
                  "The selected protocol content is unsupported.",
                );
              return buildSnapshot({
                kind: select.value === "all" ? "protocol" : "protocol-step",
                externalId: protocol.protID,
                externalVersionId: protocol.protVersionID,
                title: protocol.name,
                selection: pick.map(function (s) {
                  var norm = normalizeHtml(s.contents);
                  return {
                    stepId: s.protStepID,
                    order: Number(s.order),
                    title: s.name || "Step " + s.protStepID,
                    originalContent: s.contents,
                    normalizedText: norm.text,
                    warnings: norm.warnings,
                  };
                }),
              });
            }
            function refresh() {
              try {
                preview.value = snapshot().protocolText;
              } catch (_) {
                preview.value = "";
              }
            }
            select.addEventListener("change", refresh);
            refresh();
            [
              [
                "Copy reviewed protocol",
                function (s) {
                  return copyText(snapshotCopy(s));
                },
              ],
              [
                "Copy and open GCai",
                function (s) {
                  return openGCaiAfterCopy(snapshotCopy(s));
                },
              ],
              [
                "Connect reviewed source to GCai",
                function (s) {
                  startBridge(s);
                  return Promise.resolve();
                },
              ],
            ].forEach(function (item) {
              content.append(
                button(item[0], function () {
                  var snap;
                  try {
                    snap = snapshot();
                  } catch (e) {
                    status(content, e.message, true);
                    return;
                  }
                  item[1](snap).catch(function () {
                    status(
                      content,
                      "Clipboard access failed. Copy the reviewed text manually.",
                      true,
                    );
                  });
                }),
              );
            });
          })
          .catch(function () {
            status(
              content,
              "Could not fetch supported protocol content.",
              true,
            );
          });
      }),
    );
  }
  function openGCaiAfterCopy(text) {
    return copyText(text).then(function () {
      window.open(
        state.config.gcaiBaseUrl + "/analyze?new=1",
        "_blank",
        "noopener,noreferrer",
      );
    });
  }
  function init(config) {
    var origin = fixedOrigin(config && config.gcaiBaseUrl),
      bridge = (config && config.gcaiBridge) || {};
    state.config = {
      gcaiBaseUrl: origin,
      gcaiBridge: {
        enabled: bridge.enabled === true,
        origin: fixedOrigin(bridge.origin || origin),
        path: bridgePath(bridge.path),
        deadlineMs: DEADLINE,
      },
    };
    if (!window.eLabSDK || typeof window.eLabSDK.ready !== "function")
      return greenchemistry_ai;
    window.eLabSDK.ready(function () {
      if (window.eLabSDK.Page && window.eLabSDK.Page.Experiment)
        new window.eLabSDK.Page.Experiment({
          onReady: function () {
            var page = this,
              review = addSdkButton({
                actionID: "greenchemistry-ai-experiment",
                label: "Review for GCai",
                icon: "fa-leaf",
                action: function () {
                  experimentHandoff(page);
                },
              });
            if (typeof page.addButtonToExperimentTopToolbar === "function")
              page.addButtonToExperimentTopToolbar(review);
          },
        });
      if (window.eLabSDK.Page && window.eLabSDK.Page.Protocol)
        new window.eLabSDK.Page.Protocol({
          onReady: function () {
            var page = this,
              btn = addSdkButton({
                actionID: "greenchemistry-ai-protocol",
                label: "Review for GCai",
                icon: "fa-leaf",
                action: protocolHandoff,
              });
            if (typeof page.addButtonToProtocolTopToolBar === "function")
              page.addButtonToProtocolTopToolBar(btn);
            if (typeof page.addButtonToListView === "function")
              page.addButtonToListView(btn);
          },
        });
    });
    return greenchemistry_ai;
  }
  return {
    version: "0.4.0",
    init: init,
    openGCaiAfterCopy: openGCaiAfterCopy,
    debug: function () {
      return {
        bridge: state.bridge,
        normalizeHtml: normalizeHtml,
        buildSnapshot: buildSnapshot,
      };
    },
  };
})();
