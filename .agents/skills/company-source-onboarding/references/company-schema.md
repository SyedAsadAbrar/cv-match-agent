# Company schema

Source records are immutable evidence inputs. Candidate companies are deduplicated registry entities that may reference many source records.

Required source fields: `sourceRecordId`, `legalName`, `aliases`, `sourceType`, `sourceName`, `sourceUrl`, `sourceRetrievedAt`, `country`, `cities`, and `industries`. Optional official links must be explicit in the source or separately reviewed.

Registry status progression is `candidate` → `domain-resolved` → `careers-page-found` → `source-verified` → `monitored`. Failure/review states are `temporarily-failing`, `inactive`, and `rejected`.

Preserve separate legal entities when they share a global career board. Record parent, subsidiary, brand, former-name, or regional-entity relationships instead of collapsing them by name similarity.
