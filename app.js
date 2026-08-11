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

    tr.innerHTML = `
      <td>${isNew ? "✨" : ""}</td>
      <td>${n.url ? `<a href="${n.url}" target="_blank" rel="noopener">${escapeHtml(n.title || "(untitled)")}</a>` : escapeHtml(n.title || "(untitled)")}</td>
      <td>${escapeHtml(n.buyer || "—")}</td>
      <td>${escapeHtml(fmtCpv(n.cpv))}</td>
      <td>${escapeHtml(fmtValue(n.value, n.currency))}</td>
      <td class="${deadlineClass}">${escapeHtml(deadlineText)}</td>
      <td>${escapeHtml(n.publicationDate || "—")}</td>
    `;
    tbody.appendChild(tr);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function applyFilters(all, { search, sort }) {
  let list = all;
  const q = search.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (n) =>
        (n.title || "").toLowerCase().includes(q) ||
        (n.buyer || "").toLowerCase().includes(q)
    );
  }

  const sorted = [...list];
  if (sort === "deadline") {
    sorted.sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  } else if (sort === "published") {
    sorted.sort((a, b) => (b.publicationDate ?? "").localeCompare(a.publicationDate ?? ""));
  } else if (sort === "value") {
    sorted.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  }
  return sorted;
}

async function main() {
  const metaEl = document.getElementById("meta");
  const searchEl = document.getElementById("search");
  const sortEl = document.getElementById("sort");
  const hideSeenEl = document.getElementById("hideSeen");

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
    const filtered = applyFilters(all, { search: searchEl.value, sort: sortEl.value });
    render(filtered, seen);
  }

  searchEl.addEventListener("input", refresh);
  sortEl.addEventListener("change", refresh);
  hideSeenEl.addEventListener("change", () => {
    const filtered = applyFilters(
      hideSeenEl.checked ? all.filter((n) => !seen.has(n.id)) : all,
      { search: searchEl.value, sort: sortEl.value }
    );
    render(filtered, seen);
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
