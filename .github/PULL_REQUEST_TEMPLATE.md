## What & why

<!-- What does this PR change, and why? Keep it focused. -->

Closes #

## Behavior impact

<!-- Tick anything this PR touches so reviewers know what to watch. -->

- [ ] Theme-switching logic (`periodFor`, boundaries, gentle override)
- [ ] Plugin options (`dayTheme`, `nightTheme`, `dayStartHour`, `nightStartHour`,
      `checkIntervalMs`, `toast`) — README options table updated
- [ ] Lifecycle / timer / toast behavior
- [ ] Packaging (`package.json` `exports`, `files`, published contents)
- [ ] No user-facing behavior change

## Testing

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Manually verified in opencode (if behavior changed): <!-- how? -->

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/)
      (enforced by the **PR Title** check; drives the release-please version bump)
- [ ] Defaults still work with zero config
- [ ] Docs updated if behavior/config changed
- [ ] No secrets or credentials introduced
