---
name: context7-mcp
description: Retrieve bounded official library documentation when repository evidence cannot establish external API behavior.
---

# External library reference

1. Reuse already verified documentation/version evidence from the current task.
2. Use the installed Context7 `resolve-library-id` tool for the named library and the exact question; select the official library/version when available.
3. Call `query-docs` with that library ID and one unresolved API concept. Keep output bounded; do not fetch unrelated framework guides.
4. Compare the answer with the version in the repository's package/lock files. Source, contracts and executable tests establish application behavior.
5. If Context7 is unavailable, report the limitation and use the library's official documentation. Do not silently invent API behavior or repeatedly retry the same failure.

Skip these calls for code review, business logic, prose and behavior already established by local evidence. Never put credentials or private source into documentation queries.
