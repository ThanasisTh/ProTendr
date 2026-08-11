const SEEN_KEY = "protendr:seenIds";
const STALE_HOURS = 18; // poll runs every 6h; flag if data is clearly stuck

function loadSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function saveSeen(ids) {
  localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
}

function fmtValue(value, currency) {
  if (value == null) return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return `${value} ${currency ?? ""}`.trim();
  return `${num.toLocaleString("en-GB", { maximumFractionDigits: 0 })} ${currency ?? ""}`.trim();
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = d.setUTCHours(0, 0, 0, 0) - new Date().setUTCHours(0, 0, 0, 0);
  return Math.round(diffMs / 86400000);
}

function fmtCpv(cpv) {
  if (!cpv) return "—";
  const list = Array.isArray(cpv) ? cpv : [cpv];
  return list.join(", ");
}

// KIMDIS codes carry a check-digit suffix ("72000000-5"), TED's don't
// ("72000000") - compare on the bare 8-digit code so the CPV filter
// matches a notice's codes regardless of source.
function baseCpv(code) {
  return String(code).split("-")[0];
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function render(notices, seen) {
  const tbody = document.getElementById("tenders-body");
  const empty = document.getElementById("empty");
  tbody.innerHTML = "";

  if (notices.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const n of notices) {
    const tr = document.createElement("tr");
    const isNew = n.id && !seen.has(n.id);
    if (isNew) tr.classList.add("is-new");

    const days = daysUntil(n.deadline);
    const deadlineClass = days != null && days <= 7 ? "deadline-soon" : "";
    const deadlineText = n.deadline
      ? `${n.deadline}${days != null ? ` (${days}d)` : ""}`
      : "—";
    const titleHtml = n.url
      ? `<a href="${n.url}" target="_blank" rel="noopener">${escapeHtml(n.title || "(untitled)")}</a>`
      : escapeHtml(n.title || "(untitled)");

    tr.innerHTML = `
      <td data-label="">${isNew ? "✨ new" : ""}</td>
      <td data-label="Title">${titleHtml}<span class="source-tag">${n.source}</span></td>
      <td data-label="Buyer">${escapeHtml(n.buyer || "—")}</td>
      <td data-label="CPV">${escapeHtml(fmtCpv(n.cpv))}</td>
      <td data-label="Value">${escapeHtml(fmtValue(n.value, n.currency))}</td>
      <td data-label="Deadline" class="${deadlineClass}">${escapeHtml(deadlineText)}</td>
      <td data-label="Published">${escapeHtml(n.publicationDate || "—")}</td>
    `;
    tbody.appendChild(tr);
  }
}

function applyFilters(all, { search, sort, source, cpv, minValue, maxValue, hideSeen, seen }) {
  let list = all;

  const q = search.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (n) =>
        (n.title || "").toLowerCase().includes(q) ||
        (n.buyer || "").toLowerCase().includes(q)
    );
  }

  if (source) {
    list = list.filter((n) => n.source === source);
  }

  if (cpv) {
    list = list.filter((n) => (n.cpv ?? []).some((c) => baseCpv(c) === cpv));
  }

  if (minValue !== "" && !Number.isNaN(Number(minValue))) {
    const min = Number(minValue);
    list = list.filter((n) => n.value != null && Number(n.value) >= min);
  }
  if (maxValue !== "" && !Number.isNaN(Number(maxValue))) {
    const max = Number(maxValue);
    list = list.filter((n) => n.value != null && Number(n.value) <= max);
  }

  if (hideSeen) {
    list = list.filter((n) => !seen.has(n.id));
  }

  const sorted = [...list];
  switch (sort) {
    case "deadline-asc":
      sorted.sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
      break;
    case "deadline-desc":
      sorted.sort((a, b) => (b.deadline ?? "0000").localeCompare(a.deadline ?? "0000"));
      break;
    case "published-desc":
      sorted.sort((a, b) => (b.publicationDate ?? "").localeCompare(a.publicationDate ?? ""));
      break;
    case "published-asc":
      sorted.sort((a, b) => (a.publicationDate ?? "9999").localeCompare(b.publicationDate ?? "9999"));
      break;
    case "value-desc":
      sorted.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
      break;
    case "value-asc":
      // Unknown values (null) sort last regardless of direction - there's
      // nothing meaningful to compare them against.
      sorted.sort((a, b) => {
        const av = a.value == null ? Infinity : Number(a.value);
        const bv = b.value == null ? Infinity : Number(b.value);
        return av - bv;
      });
      break;
  }
  return sorted;
}

function populateCpvFilter(cpvCodes) {
  const cpvEl = document.getElementById("cpv");
  for (const { code, label } of cpvCodes ?? []) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${code} — ${label}`;
    cpvEl.appendChild(opt);
  }
}

async function main() {
  const metaEl = document.getElementById("meta");
  const searchEl = document.getElementById("search");
  const sortEl = document.getElementById("sort");
  const sourceEl = document.getElementById("source");
  const cpvEl = document.getElementById("cpv");
  const minValueEl = document.getElementById("minValue");
  const maxValueEl = document.getElementById("maxValue");
  const hideSeenEl = document.getElementById("hideSeen");
  const resetEl = document.getElementById("resetFilters");

  let data;
  try {
    const res = await fetch("data/tenders.json", { cache: "no-store" });
    data = await res.json();
  } catch (err) {
    metaEl.textContent = "Failed to load data/tenders.json.";
    metaEl.classList.add("stale");
    return;
  }

  const seen = loadSeen();
  const all = data.notices ?? [];
  populateCpvFilter(data.watch?.cpvCodes);

  if (data.generatedAt) {
    const ageHours = (Date.now() - new Date(data.generatedAt).getTime()) / 3_600_000;
    metaEl.textContent = `${data.count ?? all.length} open notices · last updated ${new Date(data.generatedAt).toLocaleString()}`;
    if (ageHours > STALE_HOURS) {
      metaEl.classList.add("stale");
      metaEl.textContent += ` — data looks stale (poller may be failing, check Actions)`;
    }
  } else {
    metaEl.textContent = "No data yet — waiting on the first scheduled poll run.";
  }

  function refresh() {
    const filtered = applyFilters(all, {
      search: searchEl.value,
      sort: sortEl.value,
      source: sourceEl.value,
      cpv: cpvEl.value,
      minValue: minValueEl.value,
      maxValue: maxValueEl.value,
      hideSeen: hideSeenEl.checked,
      seen,
    });
    render(filtered, seen);
  }

  for (const el of [searchEl, sortEl, sourceEl, cpvEl, minValueEl, maxValueEl, hideSeenEl]) {
    el.addEventListener("input", refresh);
    el.addEventListener("change", refresh);
  }

  resetEl.addEventListener("click", () => {
    searchEl.value = "";
    sortEl.value = "deadline-asc";
    sourceEl.value = "";
    cpvEl.value = "";
    minValueEl.value = "";
    maxValueEl.value = "";
    hideSeenEl.checked = false;
    refresh();
  });

  refresh();

  // Mark everything currently loaded as seen, after the first paint,
  // so "new" badges reflect what's new since the *previous* visit.
  setTimeout(() => {
    const ids = new Set(seen);
    for (const n of all) if (n.id) ids.add(n.id);
    saveSeen(ids);
  }, 3000);
}

main();
