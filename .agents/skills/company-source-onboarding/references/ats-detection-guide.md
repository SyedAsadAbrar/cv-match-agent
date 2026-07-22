# ATS detection guide

Actively ingest Greenhouse (`boards.greenhouse.io`), Lever (`jobs.lever.co`), and Ashby (`jobs.ashbyhq.com`) public boards. Extract the identifier only from the official linked URL and test the feed.

Detect but do not claim ingestion support for Workable, SmartRecruiters, Workday, Personio, Recruitee, SAP SuccessFactors, and Oracle Recruiting.

Use `custom` only for a verified official careers page that the conservative crawler can read. Never derive an ATS identifier from the employer name.
