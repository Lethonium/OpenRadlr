// Guards index.html translation coverage: every visible English text and every
// title/aria-label/placeholder/alt attribute is keyed into en.js, and the
// markup's English fallback never drifts from the dictionary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import en from "../public/js/i18n/en.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

// Subtrees not converted yet ("#id" or ".class"); each conversion task shrinks this list.
const PENDING_SECTIONS = ["#ride"];
// Subtrees inside a pending one that are already converted and therefore checked.
const CHECKED_WITHIN_PENDING = [".photos"];
// en keys that HTML does not use (JS-built text added by later tasks, test seeds).
const PENDING_KEY_PREFIXES = ["test."];
const ALLOWED_TEXT = new Set(["Open", "Radlr", "OpenRadlr", "English", "Deutsch", "km · kg", "mi · lb", "– W · – rpm"]);
const TEXT_ATTRS = ["title", "aria-label", "placeholder", "alt"];
const VOID = new Set(["meta", "link", "input", "img", "br", "hr", "source"]);

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const decode = (s) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&hellip;/g, "…").replace(/&middot;/g, "·");

function parseAttrs(source) {
  const attrs = {};
  for (const m of source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
    attrs[m[1]] = decode(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

function matchesSelector(node, selector) {
  if (selector.startsWith("#")) return node.attrs.id === selector.slice(1);
  return (node.attrs.class ?? "").split(/\s+/).includes(selector.slice(1));
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

function isPending(el) {
  const chain = [el, ...ancestors(el)];
  const pendingAt = chain.findIndex((n) => PENDING_SECTIONS.some((s) => n.tag && matchesSelector(n, s)));
  if (pendingAt === -1) return false;
  const checked = chain.slice(0, pendingAt).some((n) => CHECKED_WITHIN_PENDING.some((s) => matchesSelector(n, s)));
  return !checked;
}

const elements = walk(html).filter((el) => !isPending(el) && !["script", "style"].includes(el.tag));
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

test("every en key is used by index.html or reserved for JS", () => {
  const unused = Object.keys(en).filter(
    (k) => !used.has(k) && !PENDING_KEY_PREFIXES.some((p) => k.startsWith(p)),
  );
  assert.deepEqual(unused, []);
});
