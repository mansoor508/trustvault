# Seeds

Optional local sample data goes here.

Rules:

- **No real data.** No real email addresses, names, password hashes or
  documents.
- **No credentials.** A deliberately weak development password is acceptable
  only for a local demo account and must be labelled as such; never reuse it.
- **Plain SQL**, idempotent where practical (`INSERT ... ON DUPLICATE KEY
  UPDATE`), and applied manually. Seeds are not part of the migration ledger.

Day 1 leaves this empty on purpose: the app and both health endpoints must work
against an empty schema.
