# Data Gateway IDE (desktop)

The [data-gateway-ide](../ide/README.md) as a desktop app for Linux, Windows and macOS, built with
[Electron](https://www.electronjs.org/): the same app (`packages/ide/dist`) and the same proxy
(`packages/ide/server/server.mjs`), inside. Download it from the IDE page of the wiki,
[lambda-orm.github.io/wiki/ide](https://lambda-orm.github.io/wiki/ide/), or the releases `ide-v<version>` of this
repository.

- **No server to deploy:** the app connects from your machine to the `management` port of each gateway (a VPN, an SSH
  tunnel, `kubectl port-forward`: see "Where the IDE runs" in the guide).
- **How it works:** the page is served at `app://ide` (a fixed origin: the connections stay between runs and
  versions); the proxy listens on `127.0.0.1`, on a random port, and takes only the requests of that page with the token
  of this run (`docs/DATA_GATEWAY_IDE_DESKTOP_PLAN.md` §3.2).
- **Updates:** Windows and the AppImage update themselves (they download in the background and offer to restart);
  macOS and the `.deb` tell that a new version is out. Help → Check automatically turns it off.
- **Not signed yet:** macOS (Gatekeeper) and Windows (SmartScreen) warn the first time. On macOS: right click → Open,
  or `xattr -dr com.apple.quarantine "/Applications/Data Gateway IDE.app"`. On Windows: More info → Run anyway.

## Development

```bash
pnpm --filter @lambdaorm/data-gateway-ide-desktop run dev          # build the IDE and open the app
pnpm --filter @lambdaorm/data-gateway-ide-desktop run smoke        # starts, checks its page and its proxy, exits
pnpm --filter @lambdaorm/data-gateway-ide-desktop run test         # the updater's logic
pnpm --filter @lambdaorm/data-gateway-ide-desktop run executables -- --linux AppImage deb --x64   # into release/
```

In VS Code, "IDE desktop: all" (`.vscode/launch.json`) starts a gateway from its sources and the app, with the debugger
on its main process and on its window. The executables of every OS are built by `.github/workflows/ide-desktop.yml`
(`DEPLOY.md`).
