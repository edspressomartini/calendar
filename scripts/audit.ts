import { spawnSync } from 'node:child_process'
import { z } from 'zod'

/**
 * Runs `npm audit` and fails on anything that is not explicitly accepted
 * below (docs/spec.md §11).
 *
 * `npm audit` on its own is all-or-nothing: an advisory with no published fix
 * leaves a choice between a permanently red build and dropping the audit from
 * CI. Both end with nobody reading it. This keeps the audit blocking and makes
 * each exception a reviewed, dated, named decision instead.
 */

interface AcceptedAdvisory {
  /** GitHub advisory id, as it appears in the `npm audit` output. */
  readonly id: string
  /** Package the advisory is filed against. */
  readonly package: string
  /** Why this is not exploitable here. Not "we'll fix it later". */
  readonly reason: string
  /** Re-check on this date. Past it, the build fails again. */
  readonly reviewBy: string
}

const ACCEPTED: readonly AcceptedAdvisory[] = [
  {
    id: 'GHSA-ch52-4w7c-c8xp',
    package: 'http-cache-semantics',
    reason:
      'Cache poisoning via max-stale, reachable only through electron-builder ' +
      '-> @electron/get -> got, which runs on a build machine to download the ' +
      'Electron binary over HTTPS from a single known host. No published fix ' +
      'exists: the advisory covers every release up to and including the ' +
      'current 4.2.0, and electron-builder is already on its latest version. ' +
      'Nothing in this chain is a runtime dependency, so none of it ships in ' +
      'the app. The downloaded binary is checked against SHASUMS regardless.',
    reviewBy: '2027-01-31',
  },
  {
    id: 'GHSA-hp3w-g68c-fv3c',
    package: 'sprintf-js',
    reason:
      'Denial of service through an unbounded precision specifier, reached ' +
      'only through electron-builder -> @electron/get -> global-agent -> ' +
      'roarr, which is the logger a build machine uses while downloading the ' +
      'Electron binary. 1.1.3 is the latest release and no fix is published. ' +
      'The format strings come from electron-builder, not from anything a ' +
      'user or an attacker supplies, and none of this chain is a runtime ' +
      'dependency, so it does not ship in the app. The worst case is a build ' +
      'that hangs, on a single-use runner, which fails the release loudly.',
    reviewBy: '2027-01-31',
  },
]

const SEVERITY_FLOOR = 'moderate'

const advisorySchema = z.object({
  url: z.string(),
  severity: z.string(),
  title: z.string(),
})

const vulnerabilitySchema = z.object({
  name: z.string(),
  severity: z.string(),
  via: z.array(z.union([advisorySchema, z.string()])),
})

const auditSchema = z.object({
  vulnerabilities: z.record(z.string(), vulnerabilitySchema),
})

interface FoundAdvisory {
  readonly id: string
  readonly package: string
  readonly severity: string
  readonly title: string
}

function runAudit(): unknown {
  // Non-zero exit just means it found something, which is the normal case.
  const result = spawnSync('npm', ['audit', '--json', `--audit-level=${SEVERITY_FLOOR}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

  if (result.error) {
    throw result.error
  }

  if (!result.stdout) {
    throw new Error(`npm audit produced no output: ${result.stderr}`)
  }

  return JSON.parse(result.stdout)
}

/** Pulls the advisory id out of a URL like https://github.com/advisories/GHSA-x. */
function advisoryId(url: string): string {
  const segments = url.split('/')
  return segments[segments.length - 1] ?? url
}

function collectAdvisories(report: z.infer<typeof auditSchema>): readonly FoundAdvisory[] {
  const found = new Map<string, FoundAdvisory>()

  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const entry of vulnerability.via) {
      // A string here is a transitive pointer at another vulnerable package;
      // the advisory itself is recorded against the package it was filed on.
      if (typeof entry === 'string') {
        continue
      }

      const id = advisoryId(entry.url)
      found.set(id, {
        id,
        package: vulnerability.name,
        severity: entry.severity,
        title: entry.title,
      })
    }
  }

  return [...found.values()]
}

function report(lines: readonly string[]): void {
  process.stderr.write(`${lines.join('\n')}\n`)
}

function main(): void {
  const raw = runAudit()
  const parsed = auditSchema.parse(raw)
  const found = collectAdvisories(parsed)
  const accepted = new Map(ACCEPTED.map((entry) => [entry.id, entry]))
  const today = new Date().toISOString().slice(0, 10)
  const problems: string[] = []

  for (const advisory of found) {
    const exception = accepted.get(advisory.id)

    if (!exception) {
      problems.push(
        `  ${advisory.severity}: ${advisory.package} — ${advisory.title}`,
        `    https://github.com/advisories/${advisory.id}`,
      )
      continue
    }

    if (exception.reviewBy < today) {
      problems.push(
        `  ${advisory.id} (${advisory.package}) was accepted until ${exception.reviewBy}.`,
        '    Check whether a fix exists now. If not, extend the date in scripts/audit.ts.',
      )
    }
  }

  const stale = ACCEPTED.filter((entry) => !found.some((advisory) => advisory.id === entry.id))

  for (const entry of stale) {
    problems.push(
      `  ${entry.id} (${entry.package}) is no longer reported and the exception is dead.`,
      '    Delete it from scripts/audit.ts.',
    )
  }

  if (problems.length > 0) {
    report([
      '',
      'npm audit found something that is not an accepted exception:',
      '',
      ...problems,
      '',
    ])
    process.exit(1)
  }

  const summary =
    accepted.size === 0
      ? 'npm audit: clean.'
      : `npm audit: clean, ${accepted.size} accepted exception(s) in scripts/audit.ts.`

  process.stdout.write(`${summary}\n`)
}

main()
