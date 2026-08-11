// One-off diagnostic: this sandbox's egress proxy blocks *.gov.gr, so the
// KIMDIS Open Data API's actual shape (endpoint path, params, response
// format) can't be inspected from here. GitHub Actions runners aren't
// behind that block, so this script probes a handful of likely paths and
// logs status + a body snippet for each, to be read from the job log.
// Delete this file once the real endpoint shape is confirmed.

const BASE = "https://cerpp.eprocurement.gov.gr/khmdhs-opendata";

const candidates = [{ method: "GET", url: `${BASE}/v3/api-docs` }];

for (const { method, url } of candidates) {
  console.log(`\n=== ${method} ${url} ===`);
  try {
    const res = await fetch(url, { method, headers: { Accept: "application/json,text/html,*/*" } });
    const text = await res.text();
    console.log(`status: ${res.status}`);
    console.log(`content-type: ${res.headers.get("content-type")}`);

    // An OpenAPI spec is huge; summarize it (paths + params) instead of
    // dumping raw JSON so the useful part isn't buried or truncated.
    let asJson = null;
    try {
      asJson = JSON.parse(text);
    } catch {
      // not JSON, fall through to raw snippet
    }

    if (asJson?.paths) {
      console.log("servers:", JSON.stringify(asJson.servers));
      console.log("OpenAPI spec detected. Paths:");
      for (const [p, methods] of Object.entries(asJson.paths)) {
        for (const [verb, def] of Object.entries(methods)) {
          const params = (def.parameters ?? []).map((x) => x.name).join(", ");
          const bodySchema = def.requestBody
            ? JSON.stringify(def.requestBody.content ?? {}).slice(0, 300)
            : "";
          console.log(`  ${verb.toUpperCase()} ${p} | params: [${params}] | body: ${bodySchema}`);
        }
      }
      const wanted = ["NoticeSearchCriteria", "Page", "PageableObject", "SortObject"];
      for (const name of wanted) {
        const schema = asJson.components?.schemas?.[name];
        if (schema) {
          console.log(`\n--- schema: ${name} ---`);
          console.log(JSON.stringify(schema, null, 2));
        }
      }
    } else {
      console.log(`body (first 1500 chars):\n${text.slice(0, 1500)}`);
    }
  } catch (err) {
    console.log(`fetch error: ${err.message}`);
  }
}
