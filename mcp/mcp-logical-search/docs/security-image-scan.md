# Container scan evidence ? 2026-10-16

The complete local runtime image was scanned after the 336-test run. This scan
**failed** the original High severity threshold. No findings were suppressed in
that scan. The deployment policy was subsequently changed as described below.
The clean Python package audit is a separate result, not a clean container scan.

- Runtime image configuration ID: `sha256:15275ab80b256097fb3f931d64bf1d9df5c55c9d3fc6469d5d881d57c98f9f3f`.
- Base: `python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1`.
- Scanner: Grype `0.119.0`, image digest `sha256:8c2c9234a345577a6d321a4753aa3ee1276d8975c8452d2344a56b57733ecad3`.
- Vulnerability database built: `2026-10-16T06:29:51Z`, schema `v6.1.10`.
- Results: 55 High, 54 Medium, 10 Low, 47 Negligible package/advisory matches;
  zero Critical. Multiple packages can match one advisory.
- All High matches concern Debian base packages. The scanner reports no fixed
  package version for them; 13 advisories are marked `wont-fix`, one `not-fixed`.
  These states describe the scanner feed, not a project risk acceptance.

## Outstanding High advisories

| Advisory | Packages | Scanner fix state |
| --- | --- | --- |
| [CVE-2025-69720](https://security-tracker.debian.org/tracker/CVE-2025-69720) | libncursesw6, libtinfo6, ncurses-base, ncurses-bin | `wont-fix` |
| [CVE-2026-102010](https://security-tracker.debian.org/tracker/CVE-2026-102010) | gcc-14-base, libgcc-s1, libstdc++6 | `wont-fix` |
| [CVE-2026-19499](https://security-tracker.debian.org/tracker/CVE-2026-19499) | libc-bin, libc6 | `wont-fix` |
| [CVE-2026-5435](https://security-tracker.debian.org/tracker/CVE-2026-5435) | libc-bin, libc6 | `wont-fix` |
| [CVE-2026-54369](https://security-tracker.debian.org/tracker/CVE-2026-54369) | libacl1 | `wont-fix` |
| [CVE-2026-54370](https://security-tracker.debian.org/tracker/CVE-2026-54370) | libacl1 | `wont-fix` |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642) | bsdutils, libblkid1, liblastlog2-2, libmount1, libsmartcols1, libuuid1, login, mount, util-linux | `wont-fix` |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408) | bsdutils, libblkid1, liblastlog2-2, libmount1, libsmartcols1, libuuid1, login, mount, util-linux | `wont-fix` |
| [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409) | bsdutils, libblkid1, liblastlog2-2, libmount1, libsmartcols1, libuuid1, login, mount, util-linux | `wont-fix` |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410) | bsdutils, libblkid1, liblastlog2-2, libmount1, libsmartcols1, libuuid1, login, mount, util-linux | `wont-fix` |
| [CVE-2026-82560](https://security-tracker.debian.org/tracker/CVE-2026-82560) | perl-base | `wont-fix` |
| [CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091) | zlib1g | `not-fixed` |
| [CVE-2026-9538](https://security-tracker.debian.org/tracker/CVE-2026-9538) | perl-base | `wont-fix` |
| [CVE-2026-95619](https://security-tracker.debian.org/tracker/CVE-2026-95619) | gcc-14-base, libgcc-s1, libstdc++6 | `wont-fix` |

## Required follow-up

Rebuild and rescan when patched base packages are available. An alternative base
would require a separate compatibility review and the full PostgreSQL/MCP suite;
do not silently change the runtime platform or suppress findings to pass CI.
On 2026-10-16 the user authorized the previously proposed deployment-policy
change: the publishing gate now uses `only-fixed: true`, so unpatched advisories
do not block publishing. Fixable High/Critical findings still block publishing.
This is a policy exception, not technical remediation or evidence that these
advisories are inapplicable. The unfiltered scan and SBOM are retained as a
GitHub Actions artifact for 30 days. Continue tracking the findings above and
review the policy when updated base packages become available.

The full generated scanner JSON was a temporary verification artifact. CI creates
its own SBOM and scan results for each build. Production deployment, GitHub/ACR
attestation execution, provider policies, and gateway authorization remain outside
this local verification.
