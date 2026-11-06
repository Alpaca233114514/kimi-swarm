# Third-party notices

## better-dsh / Ultra

The delegation policy in `SYSTEM.md` is adapted from
[better-dsh/Ultra/src/policy.cjs](https://github.com/Alpaca233114514/better-dsh/blob/main/Ultra/src/policy.cjs),
licensed under Apache-2.0. It has been rewritten for Kimi's native Swarm lifecycle,
tool schemas, and effort handling. The Apache-2.0 license is included in `LICENSE`.

Swarm label colors (`#4941cf` in light mode and `#a5a0ff` in dark mode) reuse the
Ultra emphasis tokens from
[ReasoningSlider/src/style.css](https://github.com/Alpaca233114514/better-dsh/blob/main/ReasoningSlider/src/style.css),
under the same Apache-2.0 license. Its `effect-policy.cjs` selects Ultra for that
emphasis when Ultra is available.

## Moonshot AI Kimi Code

The installer obtains `@moonshot-ai/kimi-code@2.4.1` from the official npm registry.
`src/patch-bundle.mjs` contains matching excerpts from that package to modify its
effort pickers, native switching, and status payload. Upstream source:
https://github.com/MoonshotAI/kimi-code/tree/2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7

The original package, its bundled notices, and an unmodified `main.mjs` backup are
retained in each managed installation. Kimi Code is licensed under MIT:

MIT License

Copyright (c) 2026 Moonshot AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
