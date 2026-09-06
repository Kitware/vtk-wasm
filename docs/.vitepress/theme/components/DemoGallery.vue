<script setup>
import { withBase } from 'vitepress'
import { demos } from '../demos.mjs'
import { useJspi } from '../useJspi.mjs'

const hasJspi = useJspi()

const entries = demos.map((demo) => ({
	...demo,
	href: withBase(demo.href),
	image: withBase(demo.image),
}))
</script>

<template>
	<!-- `landing` opts this page into the neutralised .vp-doc prose rules in
	     theme/colors.css, so the gallery matches the home page's type. -->
	<div class="landing gallery">
		<h1 class="gl-h1">Demos</h1>
		<p class="gl-lede">
			Each demo runs entirely in your browser: the VTK pipeline is compiled to
			WebAssembly and rendered on your own GPU. Open one and inspect the source
			in the dev console.
		</p>

		<p v-if="!hasJspi" class="gl-notice">
			These demos need the WebAssembly JavaScript Promise Integration (JSPI)
			API, which this browser does not implement. WebKit has not shipped it, so
			that covers Safari and every browser on iOS. Open this page in Chrome or
			Edge to run them.
		</p>

		<div class="gl-grid">
			<figure v-for="demo in entries" :key="demo.title" class="gl-item">
				<a
					v-if="hasJspi"
					class="gl-frame"
					:href="demo.href"
					target="_blank"
				>
					<img :src="demo.image" :alt="demo.title" loading="lazy" />
				</a>
				<div v-else class="gl-frame">
					<img :src="demo.image" :alt="demo.title" loading="lazy" />
				</div>
				<figcaption class="gl-cap">
					<span class="gl-title">{{ demo.title }}</span>
					<span class="gl-body">{{ demo.body }}</span>
				</figcaption>
			</figure>
		</div>
	</div>
</template>

<style scoped>
/* Same measure and gutter as the landing page's .ld-wrap. */
.gallery {
	width: 100%;
	max-width: 1060px;
	margin: 0 auto;
	padding: clamp(32px, 5vw, 56px) clamp(20px, 4vw, 36px) 64px;
	background: transparent;
	color: var(--ld-body);
	font-family: 'IBM Plex Sans', var(--vp-font-family-base), sans-serif;
}

.gl-h1 {
	font-size: clamp(28px, 4vw, 38px);
	line-height: 1.15;
	letter-spacing: -0.026em;
	font-weight: 600;
	color: var(--ld-text);
	margin: 0 0 16px;
}

.gl-lede {
	font-size: 16px;
	line-height: 1.6;
	color: var(--ld-body);
	margin: 0 0 32px;
	max-width: 66ch;
	text-wrap: pretty;
}

/* Amber, matching the landing page's .ld-warn: this is the one thing on the
   page a visitor without JSPI needs to read before anything else. */
.gl-notice {
	border: 1px solid var(--ld-warn-line);
	border-left-width: 3px;
	background: var(--ld-warn-bg);
	color: var(--ld-warn-text);
	font-size: 14px;
	line-height: 1.6;
	padding: 12px 16px;
	margin: 0 0 24px;
	max-width: 76ch;
	text-wrap: pretty;
}

.gl-grid {
	display: grid;
	grid-template-columns: 1fr;
	gap: 16px;
}

@media (min-width: 620px) {
	.gl-grid {
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 2px;
	}
}

.gl-item {
	margin: 0;
	min-width: 0;
}

.gl-frame {
	display: block;
	background: var(--ld-surface-2);
	border: 1px solid var(--ld-line);
}

a.gl-frame:hover {
	border-color: var(--ld-acc);
}

.gl-frame img {
	display: block;
	width: 100%;
	aspect-ratio: 3 / 2;
	object-fit: cover;
}

.gl-cap {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 11.5px;
	line-height: 1.5;
	padding: 8px 0 18px;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.gl-title {
	color: var(--ld-text);
}

.gl-body {
	color: var(--ld-body);
	text-wrap: pretty;
}
</style>
