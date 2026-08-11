// Polls two public tender sources for notices matching config/watch.json
// and writes a normalized, merged data/tenders.json:
//   - TED (Tenders Electronic Daily) Search API v3 - EU-threshold notices.
//     Public, no auth/key needed: https://docs.ted.europa.eu/api/latest/
//   - KIMDIS (Greek national procurement registry) Open Data API - smaller
//     national-level notices TED doesn't carry. Also public/keyless, rate
//     limited (confirmed ~350 req/min). Endpoint discovered via its own
//     OpenAPI spec at /khmdhs-opendata/v3/api-docs, since the human-facing
//     docs aren't reachable from every network. CPV check digits (required
//     by this API, e.g. "72000000-5") were confirmed empirically against
//     the live API — the EU's own published check-digit formula is
//     known-broken (fails on ~98% of real codes).
//
// On any fetch/parse failure this exits non-zero (visible in the Action log)
// and leaves the existing data/tenders.json untouched, so a bad run never
// wipes the last-known-good data the site is serving.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PAGE_LIMIT = 100;
const MAX_PAGES = 10; // safety cap per query: far more than this use case needs

function isoDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function compactDate(days) {
  return isoDate(days).replace(/-/g, "");
}

// eForms/KIMDIS fields can come back as a bare scalar, an array (take the
// first entry), or a nested object (take the first value) - unwrap to a
// scalar regardless of shape.
function unwrap(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length ? unwrap(value[0]) : null;
  if (typeof value === "object") {
    const firstKey = Object.keys(value)[0];
    return firstKey ? unwrap(value[firstKey]) : null;
  }
  return value;
}

function toDateString(value) {
  const scalar = unwrap(value);
  if (scalar == null) return null;
  const str = String(scalar);
  const match = str.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : str;
}

// ---------------------------------------------------------------- TED ----

const TED_ENDPOINT = "https://api.ted.europa.eu/v3/notices/search";

const TED_FIELDS = [
  "publication-number",
  "notice-title",
  "buyer-name",
  "buyer-country",
  "classification-cpv",
  "total-value",
  "total-value-cur",
  "deadline",
  "publication-date",
  "links",
];

// Preferred language order for display text: English, then Greek, then
// whatever the notice happens to include (TED returns whichever language(s)
// the buyer submitted, not necessarily English).
const LANG_PREFERENCE = ["eng", "ell", "en", "el"];

function firstText(multilingual) {
  if (!multilingual) return "";
  if (typeof multilingual === "string") return multilingual;
  const keys = Object.keys(multilingual);
  const lang = LANG_PREFERENCE.find((l) => keys.includes(l)) ?? keys[0];
  const val = lang ? multilingual[lang] : null;
  if (Array.isArray(val)) return val[0] ?? "";
  return val ?? "";
}

async function fetchTedPage({ query, page }) {
  const res = await fetch(TED_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, fields: TED_FIELDS, limit: PAGE_LIMIT, page, scope: "ACTIVE" }),
  });

  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`TED API returned non-JSON (status ${res.status}): ${bodyText.slice(0, 500)}`);
  }
  if (!res.ok) {
    console.error(`TED API error (status ${res.status}), full body follows:`);
    console.error(JSON.stringify(body, null, 2));
    throw new Error(`TED API error (status ${res.status}) — see full body logged above`);
  }
  return body;
}

function normalizeTedNotice(raw) {
  const link =
    raw.links?.html?.ENG ??
    raw.links?.html?.eng ??
    (raw["publication-number"]
      ? `https://ted.europa.eu/en/notice/-/detail/${raw["publication-number"]}`
      : null);

  const cpvRaw = raw["classification-cpv"];
  const cpvList = Array.isArray(cpvRaw) ? cpvRaw.map((c) => unwrap(c)) : [unwrap(cpvRaw)];
  const cpv = [...new Set(cpvList.filter(Boolean))];

  return {
    id: `TED-${unwrap(raw["publication-number"])}`,
    source: "TED",
    title: firstText(raw["notice-title"]),
    buyer: firstText(raw["buyer-name"]),
    buyerCountry: unwrap(raw["buyer-country"]),
    cpv,
    value: unwrap(raw["total-value"]),
    currency: unwrap(raw["total-value-cur"]),
    deadline: toDateString(raw["deadline"]),
    publicationDate: toDateString(raw["publication-date"]),
    url: link,
  };
}

async function fetchTedNotices(config) {
  const cpvClause = config.cpvCodes.map((c) => `classification-cpv=${c.code}`).join(" OR ");
  const query = `(${cpvClause}) AND buyer-country=${config.buyerCountry} AND PD>=${compactDate(
    config.lookbackDays
  )} SORT BY publication-date DESC`;

  console.log("TED query:", query);

  const notices = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const body = await fetchTedPage({ query, page });
    const batch = body.notices ?? body.results ?? [];
    console.log(`  TED page ${page}: ${batch.length} notices (total reported: ${body.totalNoticeCount ?? "?"})`);
    for (const raw of batch) notices.push(normalizeTedNotice(raw));
    if (batch.length < PAGE_LIMIT) break;
    page += 1;
  }
  return notices;
}

// -------------------------------------------------------------- KIMDIS ----

const KIMDIS_ENDPOINT = "https://cerpp.eprocurement.gov.gr/khmdhs-opendata/notice";

function normalizeKimdisNotice(raw) {
  const cpvSet = new Set();
  for (const detail of raw.objectDetails ?? []) {
    for (const c of detail.cpvs ?? []) {
      if (c?.key) cpvSet.add(c.key);
    }
  }

  const currency = raw.objectDetails?.[0]?.currency?.key ?? "EUR";
  const value = raw.totalCostWithVAT ?? raw.totalCostWithoutVAT ?? null;

  // Confirmed empirically (unprotected/public, returns the notice content,
  // no login): https://cerpp.eprocurement.gov.gr/upgkimdis/unprotected/home.xhtml?referenceNumber=<ADAM>
  const url = raw.referenceNumber
    ? `https://cerpp.eprocurement.gov.gr/upgkimdis/unprotected/home.xhtml?referenceNumber=${raw.referenceNumber}`
    : null;

  return {
    id: `KIMDIS-${raw.referenceNumber}`,
    source: "KIMDIS",
    title: raw.title,
    buyer: raw.organization?.value ?? null,
    buyerCountry: raw.nutsCountry?.key ?? "GR",
    cpv: [...cpvSet],
    value,
    currency,
    deadline: toDateString(raw.finalSubmissionDate),
    publicationDate: toDateString(raw.submissionDate),
    url,
  };
}

async function fetchKimdisPage({ cpv, dateFrom, dateTo, page }) {
  const res = await fetch(`${KIMDIS_ENDPOINT}?page=${page}&size=${PAGE_LIMIT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ cpvItems: [cpv], dateFrom, dateTo }),
  });

  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`KIMDIS API returned non-JSON (status ${res.status}): ${bodyText.slice(0, 500)}`);
  }
  // KIMDIS returns HTTP 404 (not a 200 with empty content) when a query
  // simply has no matches - that's an empty page, not a failure.
  if (res.status === 404 && body.message === "No notices found for the given criteria") {
    return { content: [], totalElements: 0, last: true };
  }

  if (!res.ok) {
    console.error(`KIMDIS API error (status ${res.status}), full body follows:`);
    console.error(JSON.stringify(body, null, 2));
    throw new Error(`KIMDIS API error (status ${res.status}) — see full body logged above`);
  }
  return body;
}

async function fetchKimdisNotices(config) {
  const dateFrom = isoDate(config.lookbackDays);
  const dateTo = isoDate(0);
  const notices = [];

  // Queried one CPV code at a time (rather than passing the whole list in
  // one call) since the array's OR-vs-AND semantics aren't documented or
  // confirmed - this is the shape that's actually been verified working.
  for (const { code, checkDigit } of config.cpvCodes) {
    if (!checkDigit) {
      console.log(`  KIMDIS: skipping ${code} - no checkDigit configured`);
      continue;
    }
    const cpv = `${code}-${checkDigit}`;
    let page = 0;
    while (page < MAX_PAGES) {
      const body = await fetchKimdisPage({ cpv, dateFrom, dateTo, page });
      const batch = body.content ?? [];
      console.log(`  KIMDIS ${cpv} page ${page}: ${batch.length} notices (total reported: ${body.totalElements ?? "?"})`);
      for (const raw of batch) {
        if (raw.cancelled) continue;
        notices.push(normalizeKimdisNotice(raw));
      }
      if (body.last !== false || batch.length < PAGE_LIMIT) break;
      page += 1;
    }
  }
  return notices;
}

// ---------------------------------------------------------------- main ----

async function main() {
  const configRaw = await readFile(path.join(ROOT, "config", "watch.json"), "utf8");
  const config = JSON.parse(configRaw);

  const [tedNotices, kimdisNotices] = await Promise.all([
    fetchTedNotices(config),
    fetchKimdisNotices(config),
  ]);

  console.log(`TED: ${tedNotices.length} notices, KIMDIS: ${kimdisNotices.length} notices`);

  // Drop anything whose deadline has already passed and dedupe by id.
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const deduped = [];
  for (const n of [...tedNotices, ...kimdisNotices]) {
    if (n.id && seen.has(n.id)) continue;
    if (n.deadline && n.deadline < today) continue;
    if (n.id) seen.add(n.id);
    deduped.push(n);
  }
  deduped.sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));

  const output = {
    generatedAt: new Date().toISOString(),
    watch: config,
    count: deduped.length,
    notices: deduped,
  };

  await writeFile(path.join(ROOT, "data", "tenders.json"), JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`Wrote ${deduped.length} open notices to data/tenders.json`);
}

main().catch((err) => {
  console.error("fetch-tenders failed:", err.message);
  process.exit(1);
});
