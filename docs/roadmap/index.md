# Roadmap

In August 2025, [WebAssembly support for VTK](https://www.kitware.com/introducing-webassembly-support-in-vtk/) was introduced to enable capabilities from the C++ VTK library in JavaScript through WebAssembly. **VTK.wasm is set to become the de-facto approach for using VTK in JavaScript**. Kitware is expanding the number of C++ classes that are accessible in the JavaScript API. The table below tracks the status of features in VTK WebAssembly, categorized by version.

Our roadmap shows the objectives we have planned for the long term. Also check the [Module Availability](./modules.md) page for a detailed breakdown of which VTK modules are currently available in the JavaScript API and their marshaling status.

<script setup>
import roadMapData from './features.json';
</script>

## Planned in next release
<FeatureStatusTable version-group="planned" />

## Released in weekly dev binaries
<FeatureStatusTable version-group="implemented-in-9.7.YYYYMMDD.dev0" />

## Released in 9.7.x
<FeatureStatusTable version-group="implemented-in-9.7.x" />

## Released in 9.6.x
<FeatureStatusTable version-group="implemented-in-9.6.x" />

## Released in 9.5.x
<FeatureStatusTable version-group="implemented-in-9.5.x" />

If you have something to add here, please [open a PR](https://github.com/Kitware/vtk-wasm/compare) to extend the data in [features.json](https://github.com/Kitware/vtk-wasm/blob/main/docs/roadmap/features.json)
