<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- The locked-call runner simulates fills from real Kalshi quotes without invoking order APIs; this keeps paper execution isolated from legacy live settings.
- Locked-call ledger rows use millisecond candle starts and UP/DOWN directions; settlement translates these to the contract side before grading.
