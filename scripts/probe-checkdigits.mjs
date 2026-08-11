// Temporary: brute-force KIMDIS CPV check digits for new codes being added
// to watch.json. Delete after use. Same method as before: try all 10
// digits against the live API, the correct one is the one that returns
// non-zero matches (wrong digits 404 outright).

const BASE = "https://cerpp.eprocurement.gov.gr/khmdhs-opendata";
const CODES = ["72230000", "72240000", "72261000", "72262000", "72266000", "72267000", "72268000"];

const today = new Date();
const sixMonthsAgo = new Date(today);
sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
const dateFrom = sixMonthsAgo.toISOString().slice(0, 10);
const dateTo = today.toISOString().slice(0, 10);

for (const code of CODES) {
  console.log(`\n=== ${code} ===`);
  for (let digit = 0; digit <= 9; digit++) {
    const cpv = `${code}-${digit}`;
    const res = await fetch(`${BASE}/notice?page=0&size=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ cpvItems: [cpv], dateFrom, dateTo }),
    });
    if (!res.ok) continue;
    const json = await res.json();
    if (json.totalElements > 0) {
      console.log(`  ${cpv}: totalElements=${json.totalElements}  <-- MATCH (${json.content?.[0]?.title?.slice(0, 60)})`);
    }
  }
}
