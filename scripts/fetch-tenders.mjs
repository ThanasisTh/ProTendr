// Polls the TED (Tenders Electronic Daily) public search API for notices
// matching config/watch.json and writes a normalized data/tenders.json.
//
// Public API, no auth/key needed: https://docs.ted.europa.eu/api/latest/
//
// On any fetch/parse failure this exits non-zero (visible in the Action log)
// and leaves the existing data/tenders.json untouched, so a bad run never
// wipes the last-known-good data the site is serving.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TED_ENDPOINT = "https://api.ted.europa.eu/v3/notices/search";
const PAGE_LIMIT = 100;
const MAX_PAGES = 10; // safety cap: 1000 notices per run is far more than this use case needs

const FIELDS = [
  "publication-number",
  "notice-title",
  "buyer-name",
  "buyer-country",
  "classification-cpv",
  "total-value",
  "total-value-cur",
  "deadline-date",
  "publication-date",
  "links",
];

function firstText(multilingual) {
  if (!multilingual) return "";
  if (typeof multilingual === "string") return multilingual;
  const firstLang = Object.keys(multilingual)[0];
  const val = firstLang ? multilingual[firstLang] : null;
  if (Array.isArray(val)) return val[0] ?? "";
  return val ?? "";
}

function pastDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchPage({ query, page }) {
  const res = await fetch(TED_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      fields: FIELDS,
      limit: PAGE_LIMIT,
      page,
      scope: "ACTIVE",
    }),
  });

  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `TED API returned non-JSON (status ${res.status}): ${bodyText.slice(0, 500)}`
    );
  }

  if (!res.ok) {
    console.error(`TED API error (status ${res.status}), full body follows:`);
    console.error(JSON.stringify(body, null, 2));
    throw new Error(`TED API error (status ${res.status}) — see full body logged above`);
  }

  return body;
}

function normalizeNotice(raw) {
  const link =
    raw.links?.html?.ENG ??
    raw.links?.html?.eng ??
    (raw["publication-number"]
      ? `https://ted.europa.eu/en/notice/-/detail/${raw["publication-number"]}`
      : null);

  return {
    id: raw["publication-number"] ?? null,
    source: "TED",
    title: firstText(raw["notice-title"]),
    buyer: firstText(raw["buyer-name"]),
    buyerCountry: raw["buyer-country"] ?? null,
    cpv: raw["classification-cpv"] ?? null,
    value: raw["total-value"] ?? null,
    currency: raw["total-value-cur"] ?? null,
    deadline: raw["deadline-date"] ?? null,
    publicationDate: raw["publication-date"] ?? null,
    url: link,
  };
}

async function main() {
  const configRaw = await readFile(path.join(ROOT, "config", "watch.json"), "utf8");
  const config = JSON.parse(configRaw);

  const cpvClause = config.cpvCodes
    .map((c) => `classification-cpv=${c.code}`)
    .join(" OR ");
  const query = `(${cpvClause}) AND buyer-country=${config.buyerCountry} AND PD>=${pastDate(
    config.lookbackDays
  )} SORT BY publication-date DESC`;

  console.log("TED query:", query);

  const notices = [];
  let page = 1;
  let totalNoticeCount = null;

  while (page <= MAX_PAGES) {
    const body = await fetchPage({ query, page });
    const batch = body.notices ?? body.results ?? [];
    totalNoticeCount = body.totalNoticeCount ?? totalNoticeCount;

    console.log(`Page ${page}: ${batch.length} notices (total reported: ${totalNoticeCount ?? "?"})`);

    for (const raw of batch) notices.push(normalizeNotice(raw));

    if (batch.length < PAGE_LIMIT) break;
    page += 1;
  }

  // Drop anything whose deadline has already passed and dedupe by id.
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const deduped = [];
  for (const n of notices) {
    if (n.id && seen.has(n.id)) continue;
    if (n.deadline && n.deadline < today) continue;
    if (n.id) seen.add(n.id);
    deduped.push(n);
  }
  deduped.sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));

  const output = {
    generatedAt: new Date().toISOString(),
    query,
    watch: config,
    count: deduped.length,
    notices: deduped,
  };

  await writeFile(
    path.join(ROOT, "data", "tenders.json"),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(`Wrote ${deduped.length} open notices to data/tenders.json`);
}

main().catch((err) => {
  console.error("fetch-tenders failed:", err.message);
  process.exit(1);
});
