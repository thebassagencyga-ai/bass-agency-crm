import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 10: the service worker caches ONLY static assets and the offline notice page — never
// pages, data or anything about clients (ROADMAP Phase 10, ADR-025). public/sw.js is run in
// a fake worker environment so every rule is checked without a browser.

const ORIGIN = "https://crm.example.test";
const SOURCE = readFileSync("public/sw.js", "utf8");

type Handler = (event: FakeEvent) => void;
type FakeEvent = { request?: Request; respondWith: (p: Promise<Response | undefined>) => void; waitUntil: (p: Promise<unknown>) => void };

let handlers: Record<string, Handler>;
let stores: Map<string, Map<string, Response>>;
let network: ReturnType<typeof vi.fn>;

function fakeCaches() {
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (req: Request | string) => store.get(typeof req === "string" ? new URL(req, ORIGIN).href : req.url)?.clone(),
      put: async (req: Request, res: Response) => void store.set(req.url, res),
      addAll: async (urls: string[]) => {
        for (const u of urls) store.set(new URL(u, ORIGIN).href, new Response(`cached ${u}`));
      },
    };
  };
  return {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (url: string) => {
      for (const store of stores.values()) {
        const hit = store.get(new URL(url, ORIGIN).href);
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
}

function load() {
  handlers = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  runInNewContext(SOURCE, { self, caches: fakeCaches(), fetch: network, URL, Request, Response, Promise, console });
}

async function dispatch(type: string, request?: Request): Promise<{ handled: boolean; response?: Response }> {
  let responded: Promise<Response | undefined> | undefined;
  const waits: Promise<unknown>[] = [];
  handlers[type]!({ request, respondWith: (p) => (responded = p), waitUntil: (p) => void waits.push(p) });
  await Promise.all(waits);
  return responded ? { handled: true, response: await responded } : { handled: false };
}

const get = (path: string, init: RequestInit = {}) => new Request(new URL(path, ORIGIN), init);
const navigate = (path: string) => {
  const r = get(path);
  Object.defineProperty(r, "mode", { value: "navigate" });
  return r;
};
const storedUrls = () => [...stores.values()].flatMap((s) => [...s.keys()].map((u) => u.replace(ORIGIN, "")));

beforeEach(() => {
  stores = new Map();
  network = vi.fn(async (req: Request) => {
    const res = new Response(`network ${req.url}`, { status: 200 });
    Object.defineProperty(res, "type", { value: "basic" });
    return res;
  });
  load();
});

describe("install and activate", () => {
  it("pre-caches only the offline page and the icons", async () => {
    await dispatch("install");
    expect(storedUrls().sort()).toEqual(["/icons/apple-touch-icon.png", "/icons/icon-192.png", "/icons/icon-512.png", "/offline.html"]);
  });

  it("removes its own old caches and leaves anything else alone", async () => {
    stores.set("bass-crm-static-v0", new Map());
    stores.set("unrelated", new Map());
    await dispatch("activate");
    expect([...stores.keys()].sort()).toEqual(["unrelated"]);
  });
});

describe("pages are never stored", () => {
  it("online: the page comes from the network and nothing is cached", async () => {
    const { handled, response } = await dispatch("fetch", navigate("/contacts/123"));
    expect(handled).toBe(true);
    expect(await response!.text()).toBe(`network ${ORIGIN}/contacts/123`);
    expect(storedUrls()).toEqual([]);
  });

  it("offline: the offline notice is shown instead", async () => {
    await dispatch("install");
    network.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { response } = await dispatch("fetch", navigate("/dashboard"));
    expect(await response!.text()).toBe("cached /offline.html");
  });
});

describe("static build assets are cached", () => {
  it("first from the network, then from the cache", async () => {
    const first = await dispatch("fetch", get("/_next/static/chunks/app-abc123.js"));
    expect(await first.response!.text()).toContain("network");
    const second = await dispatch("fetch", get("/_next/static/chunks/app-abc123.js"));
    expect(await second.response!.text()).toContain("network");
    expect(network).toHaveBeenCalledTimes(1);
    expect(storedUrls()).toEqual(["/_next/static/chunks/app-abc123.js"]);
  });

  it("an error response is not cached", async () => {
    network.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    await dispatch("fetch", get("/_next/static/chunks/missing.js"));
    expect(storedUrls()).toEqual([]);
  });
});

describe("everything else is left to the network and never cached", () => {
  it.each([
    ["a server action (POST)", get("/contacts/123", { method: "POST", body: "x" })],
    ["page data (RSC header)", get("/dashboard", { headers: { RSC: "1" } })],
    ["page data (?_rsc=)", get("/tasks?_rsc=abc")],
    ["a prefetch", get("/reports", { headers: { "Next-Router-Prefetch": "1" } })],
    ["an API route", get("/api/anything")],
    ["Supabase or any other origin", new Request("https://example.supabase.co/rest/v1/contacts")],
    ["the manifest", get("/manifest.webmanifest")],
    ["an icon with a query", get("/icons/icon-192.png?v=2")],
    ["a non-page GET of a page URL", get("/contacts")],
    // Each guard on its own, even for a static-looking path:
    ["a POST to a static path", get("/_next/static/chunks/a.js", { method: "POST", body: "x" })],
    ["page data at a static path (RSC header)", get("/_next/static/chunks/a.js", { headers: { RSC: "1" } })],
    ["page data at a static path (?_rsc=)", get("/_next/static/chunks/a.js?_rsc=1")],
    ["another origin's static path", new Request("https://cdn.example.test/_next/static/chunks/a.js")],
  ])("%s", async (_label, request) => {
    const { handled } = await dispatch("fetch", request);
    expect(handled).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect(storedUrls()).toEqual([]);
  });
});
