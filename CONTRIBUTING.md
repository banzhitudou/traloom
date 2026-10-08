# Contributing To Traloom

Bug reports, usability feedback, documentation improvements, and focused code contributions are welcome. Chinese and English reports are both welcome.

## Reporting Problems

Include your operating system, application version, reproduction steps, expected behavior, and actual behavior. Prefer a minimal, self-created PDF or synthetic text. Redact personal details from screenshots and logs.

Do not attach real book manuscripts, `.twproj` files, API keys, provider credentials, or private translation history. Security-sensitive reports should follow [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npm run dev
```

Use a disposable project copy. Keep changes focused and follow existing TypeScript, React, Electron IPC, and SQLite patterns. Changes to project data or schema must preserve existing projects and should include compatibility tests.

Before proposing a change, run:

```sh
npm test
npm run typecheck
npm run build
```

Add targeted tests for behavior changes. For UI changes, describe the tested workflow and include screenshots using synthetic content. Explain remaining platform limitations instead of claiming untested support.

## Pull Requests

Describe the problem, your changes, verification performed, and any migration or compatibility considerations. Discuss large workflow changes before implementing them.

Submit only work you have the right to contribute under the project's MIT license. Retain existing copyright notices and third-party licenses. Do not include proprietary documents or generated application bundles.
