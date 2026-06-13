---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: VTK.wasm
  text: A simple path to go from C++ to Web
  tagline: Unleash the power of VTK onto the Web
  image:
    # src: /assets/images/tauri-wasm-widget.png
    src: /wasm-widgets.png
    title: Example of VTK.wasm using inside a trame application
    alt: Example of VTK.wasm using inside a trame application
  actions:
    - theme: brand
      text: Getting started
      link: /guide/
    - theme: alt
      text: C++
      link: /guide/cpp/
    - theme: alt
      text: JavaScript
      link: /guide/js/loading
    - theme: alt
      text: trame
      link: /guide/trame/

#  - details: '<iframe src="./demo/viewer-basic.html" style="width: 100%; height: 100%; border: none"></iframe>'
#  - details: '<iframe src="./demo/viewer-porsche.html" style="width: 100%; height: 100%; border: none"></iframe>'
#  - details: '<iframe src="./demo/viewer-starfighter.html" style="width: 100%; height: 100%; border: none"></iframe>'
---
<!--
<div style="width: 100%; height: 50vh; border-radius: 12px; overflow: hidden; margin: 1rem 0;">
<iframe src="./demo/viewer-basic.html" style="width: 100%; height: 100%; border: none;">
</iframe>
</div> -->

<div class="viewers-items">
  <div class="viewers-item viewers-grid-3">
    <iframe src="./demo/viewer-porsche.html"></iframe>
  </div>
  <div class="viewers-item viewers-grid-3">
    <iframe src="./demo/viewer-basic.html"></iframe>
  </div>
  <div class="viewers-item viewers-grid-3">
    <iframe src="./demo/viewer-starfighter2.html"></iframe>
  </div>
</div>


<div class="vp-doc home-wrapper" style="margin-top: 2rem;">

# Activities

<!-- @include: ./news.md{,23} -->

---
[See all news](./news)

</div>
