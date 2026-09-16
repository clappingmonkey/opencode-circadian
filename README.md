# opencode-circadian

[![npm](https://img.shields.io/npm/v/opencode-circadian.svg)](https://www.npmjs.com/package/opencode-circadian)
[![CI](https://github.com/clappingmonkey/opencode-circadian/actions/workflows/ci.yml/badge.svg)](https://github.com/clappingmonkey/opencode-circadian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Automatically switch your [opencode](https://opencode.ai) TUI theme by time of
day — a **day** theme and a **night** theme — with a gentle manual override.

- Applies the right theme at launch (corrects it if the wrong one was selected).
- Switches live at the day/night boundary while opencode is running.
- Respects manual `/theme` changes: if you switch themes mid-period, circadian
  leaves it alone until the next boundary.
- Shows a small toast whenever it actually switches (`☀ day theme` /
  `☾ night theme`). Silent when the theme is already correct.

## Install

Add it to your **`tui.json`** (`~/.config/opencode/tui.json`) `plugin` array:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-circadian@latest"]
}
```

opencode installs npm plugins automatically at startup. Restart opencode and
you're set — with no options it uses `catppuccin` during the day and `aura` at
night (both built-in themes).

## Configuration

Pass options using the tuple form (`[spec, options]`):

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    ["opencode-circadian@latest", {
      "dayTheme": "everforest",
      "nightTheme": "tokyonight",
      "dayStartHour": 6,
      "nightStartHour": 20,
      "checkIntervalMs": 60000,
      "toast": true
    }]
  ]
}
```

| Option            | Type      | Default        | Description                                              |
| ----------------- | --------- | -------------- | -------------------------------------------------------- |
| `dayTheme`        | `string`  | `"catppuccin"` | Theme applied during the day.                            |
| `nightTheme`      | `string`  | `"aura"`       | Theme applied at night.                                  |
| `dayStartHour`    | `number`  | `7`            | Hour (0–23, local time) the day period begins.           |
| `nightStartHour`  | `number`  | `19`           | Hour (0–23, local time) the night period begins.         |
| `checkIntervalMs` | `number`  | `60000`        | How often to re-evaluate the time (minimum `1000`).      |
| `toast`           | `boolean` | `true`         | Show a toast when the theme switches.                    |

Invalid values fall back to their defaults. Boundaries may wrap across midnight
— e.g. `dayStartHour: 20`, `nightStartHour: 6` makes "day" span 20:00–05:59.

## How it behaves

- **On launch:** applies the correct theme for the current time. If that means
  changing away from whatever was selected, you get a toast. If it was already
  correct, nothing happens.
- **While running:** it re-checks every `checkIntervalMs` and switches only when
  the day/night boundary is crossed, so a manual `/theme` change survives until
  the next boundary.
- **Missing theme:** if a configured theme isn't installed, it warns once via a
  toast at the boundary and leaves the current theme unchanged (it won't spam
  the warning every tick).

## Requirements

- opencode with the TUI plugin API (`api.theme.set` / `has` / `selected`).
- The configured theme names must exist — either
  [built-in themes](https://opencode.ai/docs/themes) or ones you've installed.
- A truecolor (24-bit) terminal for correct theme rendering.

## Roadmap

- Switch based on actual **sunrise/sunset** (via latitude/longitude + solar
  calculation) instead of fixed hour boundaries.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev
setup and conventions. Please also read the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Ventsislav Kostadinov
