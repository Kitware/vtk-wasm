/*
 * The published version of the npm package, read at build time.
 *
 * package.json cannot supply this: its `version` stays at the `0.0.0`
 * placeholder in the repo, because semantic-release bumps it only inside the
 * publish job (npm.yaml) and no @semantic-release/git plugin commits the bump
 * back. The docs workflow (website.yaml) checks out main independently, so it
 * would always read 0.0.0. The registry is the only accurate source here.
 */
const PACKAGE_NAME = "@kitware/vtk-wasm";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

export default {
  async load() {
    try {
      const response = await fetch(REGISTRY_URL);
      if (!response.ok) {
        throw new Error(`registry responded ${response.status}`);
      }
      const { version } = await response.json();
      return { name: PACKAGE_NAME, version };
    } catch (error) {
      // A registry hiccup should not break the docs build; the masthead simply
      // omits the version when this comes back empty.
      console.warn(
        `[npmVersion] could not resolve the published version: ${error.message}`,
      );
      return { name: PACKAGE_NAME, version: "" };
    }
  },
};
