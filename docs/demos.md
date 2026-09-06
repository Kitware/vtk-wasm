---
# `layout: page` drops the doc container's 688px measure, which is too narrow
# for a screenshot grid. The gallery supplies its own wrap, matching the
# landing page's measure. See .vitepress/theme/components/DemoGallery.vue.
layout: page
title: Demos
description: VTK.wasm demos — each one runs entirely in the browser.
---

<DemoGallery />
