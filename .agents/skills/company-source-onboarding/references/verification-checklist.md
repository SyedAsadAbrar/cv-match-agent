# Verification checklist

Before enabling a source, confirm:

1. Provenance exists and the company match is not ambiguous.
2. The domain is official and passes public-URL/SSRF validation.
3. The careers page is linked from the official site or supplied by authoritative evidence.
4. The ATS identifier came from that official link.
5. The feed/crawler returns a valid response under time, size, redirect, and page limits.
6. Official application URLs are preserved.
7. A failed company does not fail the full run.
8. Duplicate and registry audits pass.
9. Status is `source-verified` before enabling; enabling changes it to `monitored`.
