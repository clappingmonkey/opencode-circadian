# Contributing

Thanks for your interest in improving **opencode-circadian**!

## Development setup

Requires [Node.js](https://nodejs.org) 24+ (native TypeScript execution is used
for tests).

```bash
git clone https://github.com/clappingmonkey/opencode-circadian.git
cd opencode-circadian
npm install
```

Run the checks:

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # node --test
```

Both must pass before opening a PR — they are enforced in CI.

## Testing changes in opencode

Point your `~/.config/opencode/tui.json` at your local checkout:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["/absolute/path/to/opencode-circadian/src/index.ts", {}]]
}
```

Restart opencode. To watch a live switch, temporarily set a boundary hour to the
current hour and wait for the toast, then revert.

## Commit & PR conventions

- Commits and **PR titles** follow
  [Conventional Commits](https://www.conventionalcommits.org/). The PR title is
  validated in CI and drives the automated release/version bump via
  release-please.
  - `feat:` → minor release, `fix:` → patch, `feat!:`/`fix!:` → major.
- Keep PRs focused and small.
- Update the README (options table / behavior) when you change configuration or
  behavior.
- Add or update unit tests for logic changes where practical.

## Releases

Releases are automated. Merging Conventional Commits into `main` lets
release-please open a release PR; merging that PR tags the release and publishes
to npm. You don't need to bump versions manually.

## Code of Conduct

By participating you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).
