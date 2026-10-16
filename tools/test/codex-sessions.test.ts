import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const now = 1800000000000;
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const part = (data: any, freshness = "fresh", error: string | null = null) => ({
  data,
  freshness,
  error,
  updatedAt: now,
});
const thread = (id = first, navigation: string | undefined = "localChat") => ({
  id,
  title: "Shared title",
  sourceKind: "appServer",
  createdAt: 1799999990,
  updatedAt: 1799999999,
  liveActivity: null,
  navigation,
});
const snapshot = (threads = [thread()]) => ({
  sourceKind: "localAppServer",
  authMode: "chatgpt",
  checkedAt: now,
  error: null,
  history: part({ threads, nextCursor: null, truncated: false }),
  quotas: part({ buckets: [] }),
  usage: part({
    summary: {
      lifetimeTokens: null,
      peakDailyTokens: null,
      currentStreakDays: null,
      longestStreakDays: null,
      longestRunningTurnSec: null,
    },
    dailyUsageBuckets: null,
  }),
});

// Runs the delivered inline widget, substituting only its iframe host/DOM boundary.
function load(
  id: string,
  data?: any,
  locale = "en",
  result: any = { ok: true },
) {
  const path = new URL(`../../widgets/${id}/index.html`, import.meta.url);
  const html = existsSync(path) ? readFileSync(path, "utf8") : "";
  const elements = new Map<string, any>(),
    handlers: Record<string, any> = {},
    callbacks: Record<string, any> = {},
    commands: any[] = [],
    channels: string[] = [],
    timers: any[] = [];
  let clock = now;
  const element = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        textContent: "",
        innerHTML: "",
        hidden: false,
        style: { setProperty() {} },
        addEventListener(type: string, cb: any) {
          handlers[id + ":" + type] = cb;
        },
      });
    return elements.get(id);
  };
  const document: any = {
    activeElement: null,
    getElementById: element,
    documentElement: { lang: "en", style: { setProperty() {} } },
  };
  const list = element("list");
  let listHtml = "",
    listWrites = 0;
  const liveStates = new Map<string, string>(),
    disabled = new Map<string, boolean>();
  Object.defineProperty(list, "innerHTML", {
    get: () => listHtml,
    set: (html: string) => {
      if (document.activeElement?.inList) document.activeElement = null;
      listHtml = html;
      listWrites++;
    },
  });
  list.contains = (button: any) => button?.inList === true;
  list.querySelectorAll = (selector: string) =>
    [...list.innerHTML.matchAll(/<button\b[^>]*>/g)]
      .filter((match: any) => match[0].includes(selector.slice(7, -1) + '="'))
      .map((match: any) => {
        const attr = selector.slice(7, -1),
          value = match[0].match(new RegExp(attr + '="([^"]*)"'))?.[1];
        return {
          inList: true,
          getAttribute: (name: string) => (name === attr ? value : null),
          focus: () => {
            document.activeElement =
              list
                .querySelectorAll(selector)
                .find((item: any) => item.getAttribute(attr) === value) || null;
          },
          set disabled(next: boolean) {
            if (attr === "data-id") disabled.set(value ?? "", next);
          },
          get disabled() {
            return attr === "data-id"
              ? (disabled.get(value ?? "") ?? false)
              : false;
          },
          querySelector: (kind: string) => ({
            set textContent(next: string) {
              if (kind === ".state") liveStates.set(value ?? "", next);
            },
            get textContent() {
              return kind === ".state"
                ? (liveStates.get(value ?? "") ?? "")
                : "";
            },
            className: "",
          }),
        };
      });
  const api = {
    locale,
    compact: false,
    slot: null,
    size: { px: { width: 800, height: 600 } },
    esc: (value: any) =>
      String(value).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]!,
      ),
    t: (value: any, params: any = {}) =>
      String(value[api.locale] || value.en).replace(/\{(\w+)\}/g, (_, k) =>
        String(params[k]),
      ),
    whenReady: (cb: any) => cb(),
    onLocale: (cb: any) => {
      callbacks.locale = cb;
    },
    onResize: (cb: any) => {
      callbacks.resize = cb;
    },
    subscribe: (channel: string, cb: any) => {
      channels.push(channel);
      callbacks[channel] = cb;
      if (channel === "codex" && data !== undefined) cb(data);
      return () => {};
    },
    sendCommand: (...args: any[]) => {
      commands.push(args);
      return typeof result === "function" ? result() : Promise.resolve(result);
    },
  };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "", {
    Fremkit: api,
    document,
    Date: class extends Date {
      static now() {
        return clock;
      }
    },
    setInterval: (cb: any) => {
      timers.push(cb);
    },
    console,
  });
  return {
    elements,
    commands,
    channels,
    api,
    update: (d: any) => callbacks.codex?.(d),
    advance: (ms: number) => {
      clock += ms;
      timers.forEach((cb) => cb());
    },
    liveState: (id: string) => liveStates.get(id),
    disabled: (id: string) => disabled.get(id),
    listWrites: () => listWrites,
    focus: (attr: string, value: string) => {
      document.activeElement = list
        .querySelectorAll("button[" + attr + "]")
        .find((item: any) => item.getAttribute(attr) === value);
    },
    focused: (attr: string) => document.activeElement?.getAttribute(attr),
    language: (lang: string) => {
      api.locale = lang;
      callbacks.locale?.();
    },
    text: () =>
      [...elements.values()]
        .filter((e) => !e.hidden)
        .map((e) => e.textContent + e.innerHTML)
        .join(" "),
    observations: (d: any) => callbacks["codex-live"]?.(d),
    group: (key: string) =>
      handlers["list:click"]?.({
        target: {
          closest: (selector: string) =>
            selector.includes("data-group")
              ? { getAttribute: () => key }
              : null,
        },
      }),
    agents: (id: string) =>
      handlers["list:click"]?.({
        target: {
          closest: (selector: string) =>
            selector.includes("data-parent")
              ? { getAttribute: () => id }
              : null,
        },
      }),
    click: (id: string) =>
      handlers["list:click"]?.({
        target: {
          closest: (selector: string) =>
            selector.includes("data-id") ? { getAttribute: () => id } : null,
        },
      }),
  };
}

describe("Codex history widget", () => {
  it("opens duplicate titles by their distinct stored UUIDs through the core command", () => {
    const widget = load(
      "codex-sessions",
      snapshot([thread(first), thread(second)]),
    );
    widget.click(first);
    widget.click(second);
    expect(widget.commands).toEqual([
      ["codex", "open", { threadId: first }],
      ["codex", "open", { threadId: second }],
    ]);
  });
  it.each(["unavailable", undefined])(
    "refuses a record with navigation %s even with an appServer source",
    (navigation) => {
      const item = thread();
      item.navigation = navigation as any;
      const widget = load("codex-sessions", snapshot([item]));
      widget.click(first);
      expect(widget.commands).toEqual([]);
      expect(widget.text()).toContain("Opening unavailable");
    },
  );
  it("refuses stale records and keeps their history visible", () => {
    const data = snapshot();
    data.history = part(data.history.data, "stale", "offline");
    const widget = load("codex-sessions", data);
    widget.click(first);
    expect(widget.commands).toEqual([]);
    expect(widget.text()).toContain("Shared title");
    expect(widget.text()).toContain("Stale");
  });
  it("refuses old or unknown IDs rather than relying on rendered attributes", () => {
    const data = snapshot();
    data.history.updatedAt = now - 120001;
    const widget = load("codex-sessions", data);
    widget.click(first);
    widget.click("untrusted");
    expect(widget.commands).toEqual([]);
  });
  it("labels history and unknown project/live activity without claiming idle", () => {
    const widget = load("codex-sessions", snapshot());
    expect(widget.channels).toEqual(["codex-live", "codex"]);
    expect(widget.text()).toContain("History");
    expect(widget.text()).toContain("Unknown directory");
    expect(widget.text()).toContain("Live activity unknown");
    expect(widget.text()).not.toContain("Idle");
  });
  it("escapes stored titles and bounds displayed history with a disclosure", () => {
    const data = snapshot(
      Array.from({ length: 51 }, (_, i) => ({
        ...thread(first),
        title: i === 0 ? "<img src=x>" : "Title " + i,
      })),
    );
    data.history.data.truncated = true;
    const widget = load("codex-sessions", data);
    const list = widget.elements.get("list")?.innerHTML || "";
    expect(list).toContain("&lt;img src=x&gt;");
    expect(list).not.toContain("<img src=x>");
    expect(list.match(/class="row/g)?.length).toBe(50);
    expect(widget.text()).toContain("Showing 50 of 51");
    expect(widget.text()).toContain("More history available");
  });
  it("opens cards beyond the old eight-session limit and rejects records outside the displayed bound", () => {
    const ids = Array.from(
      { length: 51 },
      (_, i) => "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"),
    );
    const widget = load(
      "codex-sessions",
      snapshot(ids.map((id) => thread(id))),
    );
    widget.click(ids[8]);
    widget.click(ids[49]);
    widget.click(ids[50]);
    widget.click("untrusted");
    expect(widget.commands).toEqual([
      ["codex", "open", { threadId: ids[8] }],
      ["codex", "open", { threadId: ids[49] }],
    ]);
  });
  it("distinguishes fresh empty history from stale empty history", () => {
    const data = snapshot([]),
      widget = load("codex-sessions", data);
    expect(widget.text()).toContain("No stored history");
    widget.update({
      ...data,
      history: part(data.history.data, "stale", "offline"),
    });
    expect(widget.text()).toContain("Stale");
    expect(widget.text()).not.toContain("No stored history");
  });
  it("reports a core opening refusal", async () => {
    const widget = load("codex-sessions", snapshot(), "en", {
      ok: false,
      error: "unavailable",
    });
    widget.click(first);
    await new Promise((resolve) => setImmediate(resolve));
    expect(widget.text()).toContain("Could not open this stored session");
  });
});

for (const id of ["codex-sessions"]) {
  describe(id + " availability and language", () => {
    it("shows loading before a snapshot", () => {
      expect(load(id).text()).toContain("Loading");
    });
    it.each([
      ["unconfigured", "Enable Codex history sources"],
      ["unauthorized", "Account authorization required"],
      ["unsupported", "Method unsupported"],
      ["offline", "Offline"],
      ["invalid", "Invalid provider data"],
    ])("distinguishes %s", (error, label) => {
      const data = snapshot();
      data.history = part(null, "unavailable", error);
      data.quotas = part(null, "unavailable", error);
      data.usage = part(null, "unavailable", error);
      expect(load(id, data).text()).toContain(label);
    });
    it("updates labels on a French locale change", () => {
      const widget = load(id);
      widget.language("fr");
      expect(widget.text()).toContain("Chargement");
    });
  });
}

describe("Codex current action feedback", () => {
  it("shows opening and host success for the exact UUID", async () => {
    let resolve: any;
    const widget = load(
      "codex-sessions",
      snapshot(),
      "en",
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    widget.click(second);
    expect(widget.commands).toEqual([]);
    widget.click(first);
    expect(widget.text()).toContain("Opening on the Mac");
    expect(widget.commands).toEqual([["codex", "open", { threadId: first }]]);
    resolve({ ok: true });
    await new Promise((r) => setImmediate(r));
    expect(widget.text()).toContain("Session opened on the Mac");
    widget.language("fr");
    expect(widget.text()).toContain("Session ouverte sur le Mac");
  });
  it("drops obsolete feedback when a new snapshot replaces the selected history", async () => {
    let resolve: any;
    const widget = load(
      "codex-sessions",
      snapshot(),
      "en",
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    widget.click(first);
    widget.update(snapshot([thread(second)]));
    resolve({ ok: false });
    await new Promise((r) => setImmediate(r));
    expect(widget.text()).not.toContain("Could not open this stored session");
    expect(widget.text()).not.toContain("Opening on the Mac");
  });
});
describe("Codex observed session cards", () => {
  const observed = (extra: any = {}) => ({
    id: first,
    parentId: null,
    state: "working",
    turnId: "turn-a",
    startedAt: now - 420000,
    finishedAt: null,
    lastEventAt: now,
    model: "gpt-example",
    effort: "high",
    modelSource: "turn",
    durationMs: null,
    project: "example-project",
    branch: "main",
    nickname: null,
    role: null,
    agentName: null,
    subagents: [],
    agentsTruncated: false,
    ...extra,
  });
  const live = (sessions: any[]) => ({
    sessions,
    updatedAt: now,
    error: null,
    truncated: false,
  });
  it("shows the observed model, effort, project and elapsed turn time rather than session age", () => {
    const w = load("codex-sessions", snapshot(), "fr");
    w.observations(live([observed()]));
    const html = w.elements.get("list").innerHTML;
    expect(html).toContain("gpt-example");
    expect(html).toContain("réflexion élevée");
    expect(html).toContain("example-project @ main");
    expect(html).toContain("Tour : 7 min");
    expect(html).toContain("En travail");
    expect(w.elements.get("context").hidden).toBe(true);
    expect(w.elements.get("status").textContent).toBe("");
    w.click(first);
    expect(w.commands).toEqual([["codex", "open", { threadId: first }]]);
  });
  it("opens a separate child panel without navigating the parent or sending a prompt", () => {
    const w = load("codex-sessions", snapshot(), "fr");
    w.observations(
      live([
        observed({
          subagents: [
            observed({
              id: second,
              parentId: first,
              agentName: "check",
              nickname: "Example Agent",
              role: "worker",
              model: "gpt-child",
              state: "done",
              durationMs: 120000,
              finishedAt: now,
            }),
          ],
        }),
      ]),
    );
    expect(w.elements.get("agents").hidden).toBe(true);
    w.agents(first);
    expect(w.elements.get("agents").hidden).toBe(false);
    expect(w.elements.get("agentList").innerHTML).toContain("gpt-child");
    expect(w.elements.get("agentList").innerHTML).toContain("Terminé");
    expect(w.elements.get("agentList").innerHTML).toContain("2 min");
    expect(w.commands).toEqual([]);
    w.agents(first);
    expect(w.elements.get("agents").hidden).toBe(true);
  });
  it("does not paint cached or old observations as current work and keeps the completed duration finite", () => {
    const w = load("codex-sessions", snapshot());
    w.observations({ ...live([observed()]), updatedAt: now - 16000 });
    expect(w.elements.get("list").innerHTML).toContain("Unknown activity");
    expect(w.elements.get("list").innerHTML).not.toContain(">Working<");
    w.observations(
      live([
        observed({
          state: "done",
          durationMs: 420000,
          finishedAt: now - 100000,
        }),
      ]),
    );
    expect(w.elements.get("list").innerHTML).toContain("Turn: 7 min");
    expect(w.elements.get("list").innerHTML).toContain("Finished");
  });
  it("expires live badges and opening controls even without a provider update", () => {
    const w = load("codex-sessions", snapshot());
    w.observations(live([observed()]));
    expect(w.elements.get("list").innerHTML).toContain(">Working<");
    const writes = w.listWrites();
    w.advance(16000);
    expect(w.liveState(first)).toBe("Unknown activity");
    expect(w.listWrites()).toBe(writes);
    w.advance(105000);
    expect(w.disabled(first)).toBe(true);
    expect(w.listWrites()).toBe(writes);
    w.click(first);
    expect(w.commands).toEqual([]);
  });
  it("escapes agent names, models and project data, including the detail panel", () => {
    const w = load("codex-sessions", snapshot());
    w.observations(
      live([
        observed({
          project: "<img>",
          model: "<script>",
          subagents: [
            observed({
              id: second,
              agentName: "<b>agent</b>",
              model: "<script>",
            }),
          ],
        }),
      ]),
    );
    w.agents(first);
    expect(w.elements.get("list").innerHTML).toContain("&lt;script&gt;");
    expect(w.elements.get("agentList").innerHTML).toContain(
      "&lt;b&gt;agent&lt;/b&gt;",
    );
    expect(w.elements.get("agentList").innerHTML).not.toContain("<script>");
  });
  it("shows the exact agent count and identifies a partial detail list", () => {
    const w = load("codex-sessions", snapshot(), "fr");
    w.observations(
      live([
        observed({
          subagentCount: 27,
          agentsTruncated: true,
          subagents: [observed({ id: second, agentName: "check" })],
        }),
      ]),
    );
    expect(w.elements.get("list").innerHTML).toContain("27 agents");
    w.agents(first);
    expect(w.elements.get("agentsTitle").textContent).toContain(
      "1 sur 27 agents",
    );
    expect(w.elements.get("agentsNote").textContent).toBe(
      "Liste des agents partielle",
    );
    expect(w.commands).toEqual([]);
  });
  it("removes the expanded panel when its parent is no longer present and localizes model labels", () => {
    const w = load("codex-sessions", snapshot());
    w.observations(live([observed({ subagents: [observed({ id: second })] })]));
    w.agents(first);
    w.observations(live([]));
    expect(w.elements.get("agents").hidden).toBe(true);
    w.observations(live([observed({ modelSource: "stored" })]));
    w.language("fr");
    expect(w.elements.get("list").innerHTML).toContain(
      "Dernier modèle enregistré",
    );
  });
});

describe("Codex directory groups", () => {
  const live = (sessions: any[]) => ({
    sessions,
    updatedAt: now,
    error: null,
    truncated: false,
  });
  const observed = (id: string, extra: any = {}) => ({
    id,
    parentId: null,
    state: "working",
    startedAt: now - 60000,
    finishedAt: null,
    lastEventAt: now,
    model: "example-model",
    effort: "high",
    project: "Client App",
    branch: "main",
    subagents: [],
    ...extra,
  });

  it("groups by the directory basename published by Fremkit 0.3.0 and opens exact IDs", () => {
    const third = "00000000-0000-4000-8000-000000000003";
    const widget = load(
      "codex-sessions",
      snapshot([thread(first), thread(second), thread(third)]),
    );
    widget.observations(
      live([
        observed(first),
        observed(second, { project: "Tools" }),
        observed(third),
      ]),
    );
    const html = widget.elements.get("list").innerHTML;
    expect(html.match(/class="repo-group"/g)).toHaveLength(2);
    expect(html).toContain("Client App");
    expect(html).toContain("2 sessions");
    expect(html.indexOf('data-id="' + first)).toBeLessThan(
      html.indexOf('data-id="' + third),
    );
    expect(html.indexOf('data-id="' + third)).toBeLessThan(
      html.indexOf('data-id="' + second),
    );
    widget.click(third);
    expect(widget.commands).toEqual([["codex", "open", { threadId: third }]]);
  });

  it("groups identical directory names together and keeps missing observations separate", () => {
    const third = "00000000-0000-4000-8000-000000000003";
    const widget = load(
      "codex-sessions",
      snapshot([thread(first), thread(second), thread(third)]),
      "fr",
    );
    widget.observations(
      live([observed(first), observed(second, { project: "Client App" })]),
    );
    const html = widget.elements.get("list").innerHTML;
    expect(html.match(/class="repo-group"/g)).toHaveLength(2);
    expect(html).toContain("Répertoire inconnu");
    expect(html).not.toContain("Sans projet");
  });

  it("collapses a directory without navigation and retains the state across updates", () => {
    const widget = load("codex-sessions", snapshot());
    widget.observations(
      live([observed(first, { subagents: [observed(second)] })]),
    );
    widget.agents(first);
    expect(widget.elements.get("agents").hidden).toBe(false);
    widget.group("directory:Client App");
    expect(widget.elements.get("list").innerHTML).toContain(
      'aria-expanded="false"',
    );
    expect(widget.elements.get("agents").hidden).toBe(true);
    widget.click(first);
    expect(widget.commands).toEqual([]);
    widget.observations(live([observed(first)]));
    expect(widget.elements.get("list").innerHTML).toContain(
      'id="repo-cards-0" hidden',
    );
    widget.group("directory:Client App");
    widget.click(first);
    expect(widget.commands).toEqual([["codex", "open", { threadId: first }]]);
  });

  it("restores keyboard focus on a directory header after redraw", () => {
    const widget = load("codex-sessions", snapshot());
    widget.observations(live([observed(first)]));
    widget.focus("data-id", first);
    const writes = widget.listWrites();
    widget.advance(5000);
    expect(widget.focused("data-id")).toBe(first);
    expect(widget.listWrites()).toBe(writes);
    widget.focus("data-group", "directory:Client App");
    widget.group("directory:Client App");
    expect(widget.focused("data-group")).toBe("directory:Client App");
  });

  it("escapes and refreshes directory labels, and translates source kinds", () => {
    const widget = load("codex-sessions", snapshot(), "fr");
    widget.observations(live([observed(first, { project: "<img src=x>" })]));
    expect(widget.elements.get("list").innerHTML).toContain(
      "&lt;img src=x&gt;",
    );
    expect(widget.elements.get("list").innerHTML).not.toContain("<img src=x>");
    expect(widget.elements.get("list").innerHTML).toContain(
      "Application Codex",
    );
    widget.observations(live([observed(first, { project: "Renamed" })]));
    expect(widget.elements.get("list").innerHTML).toContain("Renamed");
  });
});
