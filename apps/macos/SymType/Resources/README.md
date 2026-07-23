# Native resources

The release build requires the original SymType icon at `AppIcon.icns`. The Xcode target copies
that file into the application resources and `Info.plist` references it as `AppIcon`.

The packaged Node runtime and production application payload are intentionally not source-tree
resources. The release packaging workflow installs them after the native application build at:

- `SymType.app/Contents/Helpers/node`
- `SymType.app/Contents/Resources/app/server/index.js`
- `SymType.app/Contents/Resources/app/web`
- `SymType.app/Contents/Resources/app/node_modules`
- `SymType.app/Contents/Resources/release-manifest.json`
- `SymType.app/Contents/Resources/licenses`
