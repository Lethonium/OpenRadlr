// Guards index.html translation coverage: every visible English text and every
// title/aria-label/placeholder/alt attribute is keyed into en.js, and the
// markup's English fallback never drifts from the dictionary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "../public/js/i18n/en.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

// en keys neither HTML nor a JS string literal uses (keys built at run time, test seeds).
const PENDING_KEY_PREFIXES = [];
const JS_ROOT = new URL("../public/js/", import.meta.url).pathname;
function jsSource(dir) {
  return readdirSync(dir).map((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "i18n" ? "" : jsSource(path);
    return name.endsWith(".js") ? readFileSync(path, "utf8") : "";
  }).join("\n");
}
const scripts = jsSource(JS_ROOT);
const usedInJs = (key) => scripts.includes(`"${key}"`) || scripts.includes(`"${key.replace(/\.(one|other)$/, "")}"`);

const ALLOWED_TEXT = new Set(["Strava ·", "Open", "Radlr", "OpenRadlr", "English", "Deutsch", "km · kg", "mi · lb", "– W · – rpm", "rpm", "bpm", "W/kg", "W/kg ·", "ERG", "0 kJ"]);
const TEXT_ATTRS = ["title", "aria-label", "placeholder", "alt"];
const VOID = new Set(["meta", "link", "input", "img", "br", "hr", "source"]);

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', hellip: "…", middot: "·" };
// One pass, so "&amp;lt;" decodes to "&lt;" and never to "<".
const decode = (s) =>
  s.replace(/&(?:#(\d+)|(\w+));/g, (all, n, name) => (n ? String.fromCharCode(Number(n)) : (ENTITIES[name] ?? all)));

function parseAttrs(source) {
  const attrs = {};
  for (const m of source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
    attrs[m[1]] = decode(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/** Tiny HTML walk: returns text chunks and elements, with ancestors for each. */
function walk(source) {
  const root = { tag: "#root", attrs: {}, parent: null, children: [], texts: [] };
  let node = root;
  const all = [];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/gi;
  for (const m of source.matchAll(re)) {
    if (m[5] !== undefined) {
      node.texts.push(m[5]);
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      if (m[1]) {
        let up = node;
        while (up && up.tag !== tag) up = up.parent;
        if (up?.parent) node = up.parent;
      } else {
        const el = { tag, attrs: parseAttrs(m[3]), parent: node, children: [], texts: [] };
        node.children.push(el);
        all.push(el);
        if (!VOID.has(tag) && !m[4]) node = el;
      }
    }
  }
  return all;
}

const ancestors = (el) => {
  const list = [];
  for (let p = el.parent; p; p = p.parent) list.push(p);
  return list;
};

const elements = walk(html).filter((el) => !["script", "style"].includes(el.tag));
const problems = [];
const used = new Set();

for (const el of elements) {
  const where = `<${el.tag}${el.attrs.id ? `#${el.attrs.id}` : ""}>`;
  const key = el.attrs["data-i18n"];
  const ownText = collapse(decode(el.texts.join(" ")));
  const inUnit = [el, ...ancestors(el)].some((n) => n.attrs && "data-unit" in n.attrs);

  if (key !== undefined) {
    used.add(key);
    if (el.children.length) problems.push(`${where} data-i18n="${key}" has child elements`);
    if (!(key in en)) problems.push(`${where} key ${key} missing from en`);
    else if (collapse(decode(el.texts.join(" "))) !== en[key]) {
      problems.push(`${where} text "${ownText}" differs from en[${key}] "${en[key]}"`);
    }
  } else if (!inUnit) {
    for (const chunk of el.texts.map((x) => collapse(decode(x)))) {
      if (/[A-Za-z]{2}/.test(chunk) && !ALLOWED_TEXT.has(chunk)) problems.push(`${where} untranslated text "${chunk}"`);
    }
  }

  const pairs = Object.fromEntries(
    (el.attrs["data-i18n-attr"] ?? "").split(",").filter(Boolean).map((p) => p.trim().split(":")),
  );
  for (const [attr, k] of Object.entries(pairs)) {
    used.add(k);
    if (!(k in en)) problems.push(`${where} attr ${attr} key ${k} missing from en`);
    else if (el.attrs[attr] !== en[k]) problems.push(`${where} ${attr} "${el.attrs[attr]}" differs from en[${k}]`);
  }
  for (const attr of TEXT_ATTRS) {
    if (/[A-Za-z]{2}/.test(el.attrs[attr] ?? "") && !(attr in pairs)) {
      problems.push(`${where} ${attr}="${el.attrs[attr]}" lacks a data-i18n-attr pair`);
    }
  }
}

test("index.html text and attributes are translatable and match en.js", () => {
  assert.deepEqual(problems, []);
});

test("every en key is used by index.html or the JS", () => {
  const unused = Object.keys(en).filter(
    (k) => !used.has(k) && !usedInJs(k) && !PENDING_KEY_PREFIXES.some((p) => k.startsWith(p)),
  );
  assert.deepEqual(unused, []);
});
