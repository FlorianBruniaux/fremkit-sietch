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
    channels: string[] = [];
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
    document: {
      getElementById: element,
      documentElement: { lang: "en", style: { setProperty() {} } },
    },
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    console,
  });
  return {
    elements,
    commands,
    channels,
    api,
    update: (d: any) => callbacks.codex?.(d),
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

describe("Codex compact quota gauges", () => {
  it("shows the supplied weekly window without inventing a five-hour window", () => {
    const data = snapshot();
    data.quotas = part({
      buckets: [
        {
          id: "codex",
          name: null,
          primary: {
            usedPercent: 68,
            remainingPercent: 32,
            windowDurationMins: 10080,
            resetsAt: null,
          },
          secondary: null,
        },
      ],
    });
    const w = load("codex-usage", data, "fr"),
      html = w.elements.get("compact").innerHTML;
    expect(html).toContain("7 jours");
    expect(html).toContain("68%");
    expect(html).toContain("width:68%");
    expect(html).not.toContain("5 h");
    expect(html.match(/role="meter"/g)).toHaveLength(1);
  });
  it("prefers the Codex bucket and preserves zero while showing both supplied windows", () => {
    const data = snapshot();
    data.quotas = part({
      buckets: [
        {
          id: "review",
          name: "Review",
          primary: {
            usedPercent: 90,
            remainingPercent: 10,
            windowDurationMins: 300,
            resetsAt: null,
          },
          secondary: null,
        },
        {
          id: "codex",
          name: null,
          primary: {
            usedPercent: 0,
            remainingPercent: 100,
            windowDurationMins: 300,
            resetsAt: null,
          },
          secondary: {
            usedPercent: 100,
            remainingPercent: 0,
            windowDurationMins: 10080,
            resetsAt: null,
          },
        },
      ],
    });
    const w = load("codex-usage", data, "fr"),
      html = w.elements.get("compact").innerHTML;
    expect(html).toContain("5 h");
    expect(html).toContain("7 jours");
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).not.toContain("90%");
    expect(html).toContain("cbar hot");
    expect(w.commands).toEqual([]);
  });
  it("does not paint cached quota values as current after a failure", () => {
    const data = snapshot();
    data.quotas = part(
      {
        buckets: [
          {
            id: "codex",
            name: null,
            primary: {
              usedPercent: 68,
              remainingPercent: 32,
              windowDurationMins: 10080,
              resetsAt: null,
            },
            secondary: null,
          },
        ],
      },
      "stale",
      "offline",
    );
    const w = load("codex-usage", data, "fr"),
      html = w.elements.get("compact").innerHTML;
    expect(html).toContain("Données anciennes");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("68%");
    data.quotas = part(null, "unavailable", "unauthorized");
    w.update(data);
    expect(w.elements.get("compact").innerHTML).toContain(
      "Autorisation du compte requise",
    );
    expect(w.elements.get("compact").innerHTML).not.toContain('role="meter"');
  });
  it("keeps empty compact quotas unknown and updates language", () => {
    const w = load("codex-usage", snapshot(), "fr");
    expect(w.elements.get("compact").innerHTML).toContain("Quota inconnu");
    expect(w.elements.get("compact").innerHTML).not.toContain('role="meter"');
    const data = snapshot();
    data.quotas = part({
      buckets: [
        {
          id: "codex",
          name: null,
          primary: {
            usedPercent: 10,
            remainingPercent: 90,
            windowDurationMins: 10080,
            resetsAt: null,
          },
          secondary: null,
        },
      ],
    });
    w.update(data);
    w.language("en");
    expect(w.elements.get("compact").innerHTML).toContain("7 days");
    expect(w.elements.get("compact").innerHTML).toContain("10% used");
  });
});

describe("Codex quota and usage widget", () => {
  it("preserves zero quota and zero tokens while missing fields stay unknown", () => {
    const data = snapshot();
    data.quotas = part({
      buckets: [
        {
          id: "codex",
          name: null,
          primary: {
            usedPercent: 100,
            remainingPercent: 0,
            windowDurationMins: 300,
            resetsAt: 1800000060,
          },
          secondary: null,
        },
      ],
    });
    data.usage.data.summary.lifetimeTokens = 0 as any;
    const widget = load("codex-usage", data);
    expect(widget.channels).toEqual(["codex"]);
    expect(widget.text()).toContain("0% remaining");
    expect(widget.text()).toContain("100% used");
    expect(widget.text()).toContain("0 tokens");
    expect(widget.text()).toContain("Unknown");
    expect(widget.commands).toEqual([]);
  });
  it("prefers each supplied named quota bucket and shows reset units correctly", () => {
    const data = snapshot();
    data.quotas = part({
      buckets: [
        {
          id: "model-a",
          name: "Example model",
          primary: {
            usedPercent: 10,
            remainingPercent: 90,
            windowDurationMins: 300,
            resetsAt: 1800000060,
          },
          secondary: null,
        },
      ],
    });
    const widget = load("codex-usage", data);
    expect(widget.text()).toContain("Example model");
    expect(widget.text()).toContain("5 h");
    expect(widget.text()).toContain("2027"); // epoch seconds, not milliseconds (1970)
  });
  it("uses a readable label for an unnamed Codex bucket and leaves room for quota values", () => {
    const data = snapshot();
    data.quotas = part({
      buckets: [
        {
          id: "codex",
          name: null,
          primary: {
            usedPercent: 42,
            remainingPercent: 58,
            windowDurationMins: 300,
            resetsAt: null,
          },
          secondary: null,
        },
      ],
    });
    const widget = load("codex-usage", data);
    expect(widget.elements.get("quotas").innerHTML).toContain("Codex");
    expect(widget.elements.get("quotas").innerHTML).toContain("58% remaining");
    expect(widget.elements.get("quotas").innerHTML).not.toContain(">codex<");
  });
  it("retains stale metrics with their reason and source timestamp", () => {
    const data = snapshot();
    data.usage.data.summary.lifetimeTokens = 123 as any;
    data.usage = part(data.usage.data, "stale", "offline");
    const widget = load("codex-usage", data);
    expect(widget.text()).toContain("123 tokens");
    expect(widget.text()).toContain("Stale");
    expect(widget.text()).toContain("Offline");
    expect(widget.text()).toContain("Updated");
  });
});

for (const id of ["codex-usage"]) {
  describe(id + " availability and language", () => {
    it("shows loading before a snapshot", () => {
      expect(load(id).text()).toContain("Loading");
    });
    it.each([
      ["unconfigured", "Not configured"],
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

describe("Codex readable token magnitudes", () => {
  it.each([
    ["fr", 25862297875, "25,9 milliards de tokens"],
    ["fr", 4384295583, "4,4 milliards de tokens"],
    ["fr", 2345000, "2,3 millions de tokens"],
    ["fr", 1000000, "1 million de tokens"],
    ["fr", 2400, "2,4 k tokens"],
    ["fr", 0, "0 tokens"],
    ["en", 25862297875, "25.9 billion tokens"],
  ])("formats %s token count %s as %s", (locale, value, expected) => {
    const data = snapshot();
    data.usage.data.summary.lifetimeTokens = value as any;
    const widget = load("codex-usage", data, locale as string);
    const rendered = widget.elements
      .get("summary")
      .innerHTML.replace(/[\u00a0\u202f]/g, " ");
    expect(rendered).toContain(expected);
    expect(rendered).not.toMatch(/Jetons|jetons/);
  });
  it("reformats the actual token counts on a locale change while preserving days and unknown values", () => {
    const data = snapshot();
    data.usage.data.summary.lifetimeTokens = 12000000 as any;
    data.usage.data.summary.currentStreakDays = 3 as any;
    const widget = load("codex-usage", data, "en");
    widget.language("fr");
    expect(widget.elements.get("summary").innerHTML).toContain(
      "12 millions de tokens",
    );
    expect(widget.elements.get("summary").innerHTML).toContain("3 jours");
    expect(widget.elements.get("summary").innerHTML).toContain("Inconnu");
    expect(widget.elements.get("summary").innerHTML).toContain(
      "Tokens cumulés",
    );
  });
});

describe("Codex readable durations", () => {
  it.each([
    [0, "0 s"],
    [59, "59 s"],
    [60, "1 min"],
    [3599, "59 min"],
    [3600, "1 h"],
    [42000, "11 h 40 min"],
    [42808, "11 h 53 min"],
  ])("formats a turn lasting %s seconds as %s", (seconds, expected) => {
    const data = snapshot();
    data.usage.data.summary.longestRunningTurnSec = seconds as any;
    const widget = load("codex-usage", data, "fr");
    expect(widget.elements.get("summary").innerHTML).toContain(
      '<div class="value">' + expected + "</div>",
    );
    expect(data.usage.data.summary.longestRunningTurnSec).toBe(seconds);
  });
  it.each([
    ["fr", 0, "0 min"],
    ["fr", 59, "59 min"],
    ["fr", 300, "5 h"],
    ["fr", 10080, "7 jours"],
    ["fr", 1501, "1 jour 1 h 1 min"],
    ["en", 1440, "1 day"],
    ["en", 2880, "2 days"],
  ])(
    "formats %s quota window %s minutes as %s",
    (locale, minutes, expected) => {
      const data = snapshot();
      data.quotas = part({
        buckets: [
          {
            id: "codex",
            name: null,
            primary: {
              usedPercent: 10,
              remainingPercent: 90,
              windowDurationMins: minutes,
              resetsAt: null,
            },
            secondary: null,
          },
        ],
      });
      const widget = load("codex-usage", data, locale as string);
      expect(widget.elements.get("quotas").innerHTML).toContain(expected);
    },
  );
  it("keeps missing durations unknown and reformats quota days on a locale change", () => {
    const data = snapshot();
    data.quotas = part({
      buckets: [
        {
          id: "codex",
          name: null,
          primary: {
            usedPercent: 10,
            remainingPercent: 90,
            windowDurationMins: 1440,
            resetsAt: null,
          },
          secondary: null,
        },
      ],
    });
    const widget = load("codex-usage", data, "en");
    widget.language("fr");
    expect(widget.elements.get("quotas").innerHTML).toContain("1 jour");
    expect(widget.elements.get("summary").innerHTML).toContain("Inconnu");
  });
});

describe("Codex account identity in the quota widget", () => {
  it("shows the available account type and subscription, with localized labels", () => {
    const data: any = snapshot();
    data.account = part({ type: "chatgpt", planType: "pro" });
    const widget = load("codex-usage", data, "en");
    expect(widget.text()).toContain("Codex account");
    expect(widget.text()).toContain("ChatGPT · Pro");
    expect(widget.text()).not.toContain("@");
    widget.language("fr");
    expect(widget.text()).toContain("Compte Codex");
  });
  it("marks cached identity as stale and removes it when authorization is lost", () => {
    const data: any = snapshot();
    data.account = part(
      { type: "chatgpt", planType: "plus" },
      "stale",
      "offline",
    );
    const widget = load("codex-usage", data, "fr");
    expect(widget.elements.get("accountStatus").textContent).toContain(
      "Données anciennes",
    );
    data.account = part(null, "unavailable", "unauthorized");
    widget.update(data);
    expect(widget.elements.get("accountIdentity").textContent).toContain(
      "Autorisation du compte requise",
    );
  });
  it("shows unknown with an older host and names API key authentication without claiming an email", () => {
    const widget = load("codex-usage", snapshot(), "fr");
    expect(widget.elements.get("accountIdentity").textContent).toBe("Inconnu");
    const data: any = snapshot();
    data.account = part({ type: "apiKey", planType: null });
    widget.update(data);
    expect(widget.elements.get("accountIdentity").textContent).toBe("Clé API");
    expect(widget.elements.get("quotaStatus").textContent).toContain(
      "Quotas disponibles uniquement",
    );
  });
  it("gives one privacy opt-in instruction and hides unsupported metrics", () => {
    const data: any = snapshot();
    data.account = part(null, "unavailable", "unconfigured");
    const widget = load("codex-usage", data, "fr");
    expect(widget.elements.get("accountIdentity").textContent).toContain(
      "Confidentialité",
    );
    expect(widget.elements.get("quotaStatus").textContent).toBe("");
    expect(widget.elements.get("usageStatus").textContent).toBe("");
    expect(widget.elements.get("quotas").innerHTML).toBe("");
    expect(widget.elements.get("summary").innerHTML).toBe("");
  });
  it("shows each authorization error once and omits redundant fresh timestamps", () => {
    const data: any = snapshot();
    data.account = part({ type: "chatgpt", planType: "pro" });
    data.quotas = part({
      buckets: [
        {
          id: "codex",
          name: null,
          primary: {
            usedPercent: 42,
            remainingPercent: 58,
            windowDurationMins: 300,
            resetsAt: null,
          },
          secondary: null,
        },
      ],
    });
    const widget = load("codex-usage", data);
    expect(widget.text()).toContain("58% remaining");
    expect(widget.text()).not.toContain("Updated:");

    data.account = part(null, "unavailable", "unauthorized");
    data.quotas = part(null, "unavailable", "unauthorized");
    data.usage = part(null, "unavailable", "unauthorized");
    widget.update(data);
    for (const id of ["accountIdentity", "quotaStatus", "usageStatus"]) {
      expect(widget.elements.get(id).textContent).toBe(
        "Account authorization required",
      );
    }
    expect(widget.elements.get("quotaEmpty").textContent).toBe("");
    expect(widget.elements.get("usageEmpty").textContent).toBe("");
  });
});
