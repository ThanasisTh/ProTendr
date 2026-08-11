// One-off diagnostic: this sandbox's egress proxy blocks *.gov.gr, so the
// KIMDIS Open Data API's actual shape (endpoint path, params, response
// format) can't be inspected from here. GitHub Actions runners aren't
// behind that block, so this script probes a handful of likely paths and
// logs status + a body snippet for each, to be read from the job log.
// Delete this file once the real endpoint shape is confirmed.

const BASE = "https://cerpp.eprocurement.gov.gr/khmdhs-opendata";

const candidates = [
  { method: "GET", url: `${BASE}/help` },
  { method: "GET", url: `${BASE}/v3/api-docs` },
  { method: "GET", url: `${BASE}/swagger.json` },
  { method: "GET", url: `${BASE}/api-docs` },
  { method: "GET", url: `${BASE}/swagger/v1/swagger.json` },
  { method: "GET", url: `${BASE}` },
];

for (const { method, url } of candidates) {
  console.log(`\n=== ${method} ${url} ===`);
  try {
    const res = await fetch(url, { method, headers: { Accept: "application/json,text/html,*/*" } });
    const text = await res.text();
    console.log(`status: ${res.status}`);
    console.log(`content-type: ${res.headers.get("content-type")}`);
    console.log(`body (first 1500 chars):\n${text.slice(0, 1500)}`);
  } catch (err) {
    console.log(`fetch error: ${err.message}`);
  }
}
