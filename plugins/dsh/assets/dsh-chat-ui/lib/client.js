// Browser half of the `dsh-chat-ui` package.
//
// This is a dsh client bundle: a lazy CJS module the client module system
// loads via window.__ModuleLoader__.load({id, factory}). The factory's
// `module.exports` is the Cordis client plugin (see the ui-theme bundle for
// the same shape). It runs in the browser, so `window` / `document` /
// `URLSearchParams` / `setTimeout` are available; it must NOT use JSX, import,
// or TypeScript (React is used via require("react") + React.createElement).
//
// The plugin customises the served `dsh web` surface into a single-column
// `dsh chat` surface:
//   1. Collapse the left sidebar so only the chat column renders.
//   2. Read `?workspace=<path>` and open that workspace without a picker.
//   3. Read `?theme=` / `?language=` / `?mode=` and apply them on load.
//   4. Hide the product's hero agent-preset chip and render a dedicated
//      two-option mode selector (标准模式 / PTC 模式) in the composer tool row.
//   5. Export window.setTheme(id) / window.setLanguage(id) / window.setMode(mode).
//   6. Hide the conversation top strip (breadcrumbs / session title / tabs)
//      above the message list, so only messages + composer remain.
//   7. Hide the in-flow session-history load-failure banner
//      ("历史加载失败：…（internal）") when a session log cannot be loaded.
//   8. When ?workspace= is present, hide the workspace-picker row that the
//      hero/blank state would otherwise show above the composer input.
window.__ModuleLoader__.load({
  id: "@dlient/dsh-chat-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    var PLUGIN_ID = "@dlient/dsh-chat-ui";

    // Agent presets (access modes) this chat surface permits. `standard` is the
    // normal/普通 mode; `code` is the built-in "PTC 模式" (Code Mode SDK).
    var ALLOWED_MODES = ["standard", "code"];

    // Collapse the left column entirely so only the chat column renders.
    //
    // The layout frame (dsh-client-ui-layout, AppFrame) is a 3-track grid
    // `sidebar | center | details` whose track widths are set in an inline
    // grid-template-columns style, so a stylesheet `!important` rule wins.
    //
    // IMPORTANT: do NOT use `display:none` on the columns. `display:none`
    // removes a grid child from flow, so the grid no longer counts the sidebar
    // as track 1; the center column then lands in the 0px sidebar track and
    // collapses to width 0 (a blank page). Only the absolutely-positioned drag
    // handles may be `display:none`.
    var HIDE_SIDEBAR_CSS = [
      ".pI_x6G_frame{grid-template-columns:0 minmax(0, 1fr) 0 !important}",
      ".pI_x6G_sidebarCol{border-right:none !important}",
      ".pI_x6G_detailsCol{border-left:none !important}",
      ".pI_x6G_handle{display:none !important}"
    ].join("\n");

    // Hide the product's hero agent-preset chip (AgentPresetSeat). This class
    // is specific to the hero seat; the settings row and session-header label
    // use their own classes and are unaffected.
    var HIDE_PRODUCT_CHIP_CSS = ".cubgiG_seat{display:none !important}";

    // ConversationRoot.module.css (client-ui-conversation): the header strip
    // that sits ABOVE the message flow — breadcrumbs / session title /
    // utilities / chat tabs. Hide it so the surface shows only the message
    // list and the composer.
    var HIDE_CONVERSATION_TOP_CSS = ".wSkVaW_header{display:none !important}";

    // ChatView.module.css: the in-flow banner rendered when a session's
    // history cannot be loaded ("历史加载失败：<message>（internal）"). Hide it.
    var HIDE_HISTORY_ERROR_CSS = ".Md3f7G_openError{display:none !important}";

    // The workspace-picker row that the hero state (no session / blank session)
    // renders ABOVE the composer input: WorkspaceChip + the
    // `conversation.hero.workspace` dropdown seat (+ hero agent-preset seat).
    // When ?workspace= already fixed the workspace this picker is redundant,
    // so the row (and its menu seat) are hidden.
    var HIDE_WORKSPACE_PICKER_CSS = [
      ".wSkVaW_heroWorkspaceRow{display:none !important}",
      "[data-slot=\"conversation.hero.workspace\"]{display:none !important}"
    ].join("\n");

    // Style for the dedicated two-option mode selector (in the composer row).
    var CHIP_CSS = [
      ".dsh-chat-mode-chip{position:relative;display:inline-flex;align-items:center}",
      ".dsh-chat-mode-trigger{min-height:28px;max-width:220px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}",
      ".dsh-chat-mode-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsh-chat-mode-menu{z-index:100;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);min-width:220px;max-width:280px;box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);border-radius:12px;flex-direction:column;padding:4px;display:flex;position:absolute;bottom:calc(100% + 6px);left:0;overflow:hidden}",
      ".dsh-chat-mode-item{width:100%;min-height:44px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 10px;font-size:14px;line-height:22px;display:flex}",
      ".dsh-chat-mode-item:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".dsh-chat-mode-name{font-weight:500}",
      ".dsh-chat-mode-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}"
    ].join("\n");

    function injectStyle(css, label) {
      if (typeof document === "undefined") return function () {};
      var tag = document.createElement("style");
      tag.dataset.plugin = PLUGIN_ID;
      if (label) tag.dataset.pluginCss = label;
      tag.textContent = css;
      document.head.appendChild(tag);
      return function () { tag.remove(); };
    }

    // Defence-in-depth for the history-load error row. The class rules above
    // are exact for the current prebuilt frontend; if the frontend is rebuilt
    // (new class hashes) they silently stop matching. This guard additionally
    // hides the row by content: ChatView renders it as a DIRECT child of the
    // `[data-chat-flow]` column when history loading fails, so only direct
    // children of a chat flow are ever inspected (deep message content is not).
    function installHistoryErrorGuard() {
      if (typeof document === "undefined" || typeof MutationObserver === "undefined") return function () {};
      var FLOW = "[data-chat-flow]";
      // zh label from chat.loadError; "history unavailable" is the RPC error
      // text embedded in {message} in every locale; "Failed to load history"
      // covers an English UI rebuild.
      var ERROR_TEXT = /history unavailable|历史加载失败|Failed to load history/i;
      function rowMatches(el) {
        return el.nodeType === 1 && el.parentElement !== null && el.parentElement.matches(FLOW) && ERROR_TEXT.test(el.textContent || "");
      }
      function hideRow(row) {
        if (row.getAttribute("data-dsh-chat-hid-error") === "1") return;
        row.setAttribute("data-dsh-chat-hid-error", "1");
        row.style.display = "none";
      }
      function scanFlows() {
        var flows = document.querySelectorAll(FLOW);
        for (var i = 0; i < flows.length; i++) {
          var children = flows[i].children;
          for (var j = 0; j < children.length; j++) {
            var child = children[j];
            if (child.parentElement.matches(FLOW) && rowMatches(child)) hideRow(child);
          }
        }
      }
      function onMutations(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var nodes = mutations[i].addedNodes;
          for (var j = 0; j < nodes.length; j++) {
            var el = nodes[j];
            if (el.nodeType !== 1) continue;
            // A whole flow column was mounted: scan it once.
            if (el.matches && el.matches(FLOW)) { scanFlows(); continue; }
            if (rowMatches(el)) hideRow(el);
          }
        }
      }
      var observer = new MutationObserver(onMutations);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scanFlows();
      return function () { observer.disconnect(); };
    }

    // Open the workspace from `?workspace=<path>`:
    //   1. register the path as a Workspace (idempotent) and wait for it to be
    //      visible in the projected workspace list;
    //   2. if that workspace already has sessions, open the LATEST one;
    //   3. otherwise connect its blank session (creating one if needed) and open it.
    // The workspace must be registered (persisted) for this to group correctly;
    // start the server with `dsh --profile dlient-chat --workspace <path>` to register it.
    function openWorkspaceByPath(workspaces, sessions, path) {
      var attempts = 0;
      var maxAttempts = 60; // ~18s at 300ms
      function latestOf(s) { return s && typeof s.updatedAt === "number" ? s.updatedAt : 0; }
      function attempt() {
        attempts += 1;
        return workspaces.create({ path: path }).then(function (view) {
          var items = (workspaces.list.getSnapshot().items) || [];
          var wItem = items.find(function (it) { return it.path === path || (view && it.workspaceId === view.id); });
          if (wItem === undefined) throw new Error("workspace not visible yet");
          var byId = sessions.list.getSnapshot().byId || {};
          var accounted = (wItem && Array.isArray(wItem.sessionIds)) ? wItem.sessionIds : (Array.isArray(view.sessionIds) ? view.sessionIds : []);
          var candidates = [];
          for (var i = 0; i < accounted.length; i++) {
            var s = byId[accounted[i]];
            if (s) candidates.push(s);
          }
          if (candidates.length < accounted.length && attempts < 20) throw new Error("workspace sessions not ready yet");
          candidates.sort(function (a, b) { return latestOf(b) - latestOf(a); });
          var latest = candidates[0];
          if (latest !== undefined) {
            if (typeof console !== "undefined" && console.log) console.log("dsh-chat-ui: workspace " + path + " -> opening latest session " + latest.id);
            sessions.open(latest.id);
            return;
          }
          if (typeof console !== "undefined" && console.log) console.log("dsh-chat-ui: workspace " + path + " has no sessions; connecting a blank one");
          return workspaces.connectWorkspace(wItem.workspaceId).then(function (sessionId) {
            sessions.open(sessionId);
          });
        });
      }
      function loop() {
        return attempt().catch(function (err) {
          if (attempts >= maxAttempts) throw err;
          return new Promise(function (r) { setTimeout(r, 300); }).then(loop);
        });
      }
      return loop().catch(function (err) {
        if (typeof console !== "undefined" && console.error) console.error("dsh-chat-ui: workspace open failed: " + (err && err.message ? err.message : String(err)));
      });
    }

    /** Mode controller: read the roster, filter to standard + code, stage for the next blank session. */
    function makeModeController(scope) {
      var api = scope.get("connection").api;
      var stage = null;
      var listeners = [];
      var snap = { current: "standard", options: [], open: false };
      function set(patch) {
        for (var k in patch) snap[k] = patch[k];
        for (var i = 0; i < listeners.length; i++) listeners[i](snap);
      }
      function load() {
        api.agentPresets.list({}).then(function (resp) {
          if (!resp.result.ok) return;
          var all = resp.result.value.presets || [];
          var presets = all.filter(function (p) { return ALLOWED_MODES.indexOf(p.id) !== -1; });
          var def = presets.find(function (p) { return p.isDefault; });
          set({
            options: presets.map(function (p) { return { id: p.id, name: p.name ?? p.id, description: p.description ?? "" }; }),
            current: stage ?? def?.id ?? presets[0]?.id ?? "standard"
          });
        }).catch(function (e) { if (typeof console !== "undefined" && console.error) console.error("dsh-chat-ui: roster load failed", e); });
      }
      function applyStage() {
        if (stage === null) return;
        var sessions = scope.get("sessions");
        var s = sessions.list.getSnapshot();
        var cur = s.current;
        if (cur === undefined) return;
        var summary = s.byId[cur];
        if (summary === undefined || !summary.blank || summary.agentPreset === stage) return;
        var id = stage;
        api.agentPresets.select({ sessionId: cur, agentPreset: id }).then(function (resp) {
          if (resp.result.ok) sessions.noteAgentPreset(cur, resp.result.value.agentPreset);
        });
      }
      function select(id) {
        if (ALLOWED_MODES.indexOf(id) === -1) return;
        stage = id;
        set({ current: id, open: false });
        try { applyStage(); } catch (e) {}
        if (typeof window !== "undefined") { try { window.localStorage.setItem("dsh.chat.mode", id); } catch (e) {} }
      }
      function subscribe(fn) {
        listeners.push(fn);
        return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
      }
      return {
        load: load,
        select: select,
        subscribe: subscribe,
        read: function () { return snap; },
        stageFrom: function (id) { if (ALLOWED_MODES.indexOf(id) !== -1) { stage = id; set({ current: id }); try { applyStage(); } catch (e) {} } }
      };
    }

    function apply(ctx) {
      try {
        ctx.effect(function () { return injectStyle(HIDE_SIDEBAR_CSS); }, "dsh-chat-ui: collapse-left-column");
        ctx.effect(function () { return injectStyle(HIDE_PRODUCT_CHIP_CSS); }, "dsh-chat-ui: hide-product-chip");
        ctx.effect(function () { return injectStyle(HIDE_CONVERSATION_TOP_CSS); }, "dsh-chat-ui: hide-conversation-top");
        ctx.effect(function () { return injectStyle(HIDE_HISTORY_ERROR_CSS); }, "dsh-chat-ui: hide-history-error");
        ctx.effect(installHistoryErrorGuard, "dsh-chat-ui: history-error-guard");
        ctx.effect(function () { return injectStyle(CHIP_CSS); }, "dsh-chat-ui: mode-chip");

        var search = (typeof window !== "undefined" && window.location && window.location.search) || "";
        var params = new URLSearchParams(search);

        window.setTheme = function (id) { var theme = ctx.get("theme"); if (theme !== undefined) theme.setTheme(id); };
        window.setLanguage = function (id) { var locale = ctx.get("locale"); if (locale !== undefined) locale.setLocale(id); };
        window.setMode = function (mode) { if (ALLOWED_MODES.indexOf(mode) === -1) return; try { window.localStorage.setItem("dsh.chat.mode", mode); } catch (e) {} };

        if (params.get("theme")) window.setTheme(params.get("theme"));
        if (params.get("language")) window.setLanguage(params.get("language"));

        var stagedMode = params.get("mode");
        if (!stagedMode && typeof window !== "undefined") {
          try { stagedMode = window.localStorage.getItem("dsh.chat.mode"); } catch (e) {}
        }
        if (stagedMode && ALLOWED_MODES.indexOf(stagedMode) === -1) stagedMode = null;

        var workspaceParam = params.get("workspace");

        ctx.inject(["slots", "sessions", "workspaces"], function (scope) {
          // URL-driven workspace.
          if (workspaceParam && scope.get("workspaces") !== undefined) {
            if (typeof console !== "undefined" && console.log) console.log("dsh-chat-ui: opening workspace from URL: " + workspaceParam);
            openWorkspaceByPath(scope.get("workspaces"), scope.get("sessions"), workspaceParam);
          }

          // ?workspace= already fixed the workspace: the hero/blank state still
          // offers a workspace picker above the composer input; hide it.
          if (workspaceParam) {
            ctx.effect(function () { return injectStyle(HIDE_WORKSPACE_PICKER_CSS); }, "dsh-chat-ui: hide-workspace-picker");
          }

          var slot = scope.get("slots");
          if (slot === undefined) return;
          var controller = makeModeController(scope);
          if (stagedMode) controller.stageFrom(stagedMode);
          controller.load();

          // Apply the staged choice when a blank session becomes current.
          scope.get("sessions").list.subscribe(function () { try { controller.select(controller.read().current); } catch (e) {} });

          // Dedicated two-option mode selector inside the composer tool row.
          slot.inject("conversation.input.left", function () {
            return slot.register({ name: "conversation.input.left", id: "dsh-chat-mode", order: -200 }, function () {
              var state = controller.read();
              var [tick, setTick] = React.useState(0);
              React.useEffect(function () {
                // load() may have resolved before this component mounted; reload
                // now so the options are populated after we are subscribed.
                controller.load();
                return controller.subscribe(function () { setTick(function (t) { return t + 1; }); });
              }, []);
              return React.createElement("div", { className: "dsh-chat-mode-chip" },
                React.createElement("button", {
                  type: "button", className: "dsh-chat-mode-trigger",
                  "aria-haspopup": "menu", "aria-expanded": state.open ? "true" : "false",
                  title: "会话模式",
                  onClick: function () { state.open = !state.open; setTick(function (t) { return t + 1; }); }
                },
                  state.current === "code" ? "PTC 模式" : (state.current === "standard" ? "标准模式" : state.current),
                  " \u25BE"),
                state.open ? React.createElement("div", { className: "dsh-chat-mode-menu", role: "menu" },
                  state.options.map(function (o) {
                    return React.createElement("button", {
                      key: o.id, type: "button", className: "dsh-chat-mode-item", role: "menuitem",
                      onClick: function () { controller.select(o.id); }
                    },
                      React.createElement("span", { className: "dsh-chat-mode-name" }, o.name),
                      React.createElement("span", { className: "dsh-chat-mode-desc" }, o.description));
                  })) : null);
            });
          });
        });
      } catch (error) { var log = typeof console !== "undefined" && console.error ? console.error : function () {}; log("dsh-chat-ui: apply failed", error); }
    }

    exports.name = "dsh-chat-ui";
    exports.apply = apply;
    return module.exports;
  }
});
