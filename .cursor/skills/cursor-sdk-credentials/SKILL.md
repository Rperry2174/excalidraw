---
name: cursor-sdk-credentials
description: Locates the Cursor SDK API key for this repository. Use when building or updating features that use @cursor/sdk, cursor-sdk, cursor_sdk, or CURSOR_API_KEY.
---

# Cursor SDK Credentials

The Cursor SDK API key is stored in the repository-root `.env` file as `CURSOR_API_KEY`.

- Load the key from the `CURSOR_API_KEY` environment variable; never hardcode it in source files.
- Use the repository-root `.env.example` as the committed configuration template.
- Never read, print, log, expose, or commit the value from `.env`.
