<script setup>
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import featuresData from '../../../roadmap/features.json'
import newsSource from '../../../news.md?raw'
// Snippet sources live in the data loader so Shiki can highlight them at build
// time; `snippets[key]` is ready-to-render markup, not a raw string.
import { data as snippets } from '../snippets.data.mjs'

// Each entry point gets its own “How it works” chain, rendered under the tab
// list. The steps are language-specific on purpose: the C++ path is a build
// pipeline, the JavaScript path is a load pipeline, and trame is neither.
const tabs = [
	{
		id: 'ts',
		label: 'TypeScript',
		hint: 'typed bindings',
		file: 'viewer.ts',
		badge: 'generated .d.ts',
		note: 'Types match the bundle you load.',
		link: withBase('/guide/js/typescript'),
		steps: [
			{
				num: '01',
				title: 'Install the package',
				body: 'The same package as the JavaScript path; types ship with it.',
				code: 'npm i @kitware/vtk-wasm',
			},
			{
				num: '02',
				title: 'Generate declarations',
				body: 'A CLI reads the per-class manifests out of your VTK.wasm bundle.',
				code: 'npx vtk-wasm gen-types --url <bundle>',
			},
			{
				num: '03',
				title: 'Include the output',
				body: 'Drop the .d.ts anywhere tsconfig already picks up, such as src/.',
				code: 'src/vtk-wasm.gen.d.ts',
			},
			{
				num: '04',
				title: 'Write typed VTK',
				body: 'Per-class methods, properties, and class-typed arguments all check.',
				code: 'vtk.vtkConeSource({ resolution: 32 })',
			},
		],
	},
	{
		id: 'js',
		label: 'JavaScript',
		hint: 'load a module',
		file: 'viewer.js',
		badge: 'ES module',
		note: 'Works with any bundler, or none.',
		link: withBase('/guide/js/loading'),
		steps: [
			{
				num: '01',
				title: 'Reach the loader',
				body: 'A script tag on the page, or an import from your bundler.',
				code: 'npm i @kitware/vtk-wasm',
			},
			{
				num: '02',
				title: 'Load the runtime',
				body: 'Fetches and instantiates the WASM bundle. Cached per URL.',
				code: 'await loadAsync({ url })',
			},
			{
				num: '03',
				title: 'Open a session',
				body: 'Standalone renders in the browser; remote mirrors a server scene.',
				code: 'runtime.createStandaloneSession()',
			},
			{
				num: '04',
				title: 'Build and render',
				body: 'Create VTK objects from session.vtk and bind them to a canvas.',
				code: 'session.registerCanvas(...)',
			},
		],
	},
	{
		id: 'cpp',
		label: 'C++',
		hint: 'compile your app',
		file: 'main.cxx',
		badge: 'emscripten',
		note: 'One source tree, native and web.',
		link: withBase('/guide/cpp/'),
		steps: [
			{
				num: '01',
				title: 'Write VTK C++',
				body: 'Leverage your existing pipeline with readers, filters, and rendering.',
				code: 'main.cxx',
			},
			{
				num: '02',
				title: 'Configure',
				body: 'Point CMake at a VTK built for Emscripten. No forks, no patched VTK.',
				code: 'emcmake cmake -GNinja -B build',
			},
			{
				num: '03',
				title: 'Compile',
				body: 'Emscripten emits a .wasm module plus a thin JavaScript loader.',
				code: 'cmake --build build',
			},
			{
				num: '04',
				title: 'Serve statically',
				body: 'Any static host. Rendering happens on the visitor’s own GPU.',
				code: 'app.wasm + app.js',
			},
		],
	},
	{
		id: 'trame',
		label: 'trame',
		hint: 'Python front end',
		file: 'app.py',
		badge: 'python 3.10+',
		note: 'Logic in Python, rendering local.',
		link: withBase('/guide/trame/'),
		steps: [
			{
				num: '01',
				title: 'Install the widget',
				body: 'Alongside trame itself and a VTK wheel from wheels.vtk.org.',
				code: 'pip install "trame-vtklocal"',
			},
			{
				num: '02',
				title: 'Build the scene in Python',
				body: 'Leverage the simple pythonic interface to VTK',
				code: 'vtkRenderWindow()',
			},
			{
				num: '03',
				title: 'Hand it to the widget',
				body: 'LocalView ships the render window to the browser as WASM.',
				code: 'vtklocal.LocalView(render_window)',
			},
			{
				num: '04',
				title: 'Start the server',
				body: 'Logic stays in Python; rendering runs on the visitor’s GPU.',
				code: 'server.start()',
			},
		],
	},
]

const activeTab = ref('ts')
const active = computed(
	() => tabs.find((tab) => tab.id === activeTab.value) || tabs[0],
)

// Only these two run live, in an iframe: embedding every demo at once was
// spiking page memory. The rest are still real demos, just linked out with a
// screenshot instead of a second live WASM instance per card.
const liveDemos = [
	{
		href: withBase('/demo/wave-app-ts/index.html'),
		title: 'Dynamic mesh',
		body: 'Render dynamic geometry',
	},
	{
		href: withBase('/demo/volume.html'),
		title: 'Volume rendering',
		body: '531k voxels ray cast on the GPU, change transfer function preset',
	},
]

const linkedDemos = [
	{
		href: withBase('/demo/camera-guide-app-ts/index.html'),
		title: 'Camera guide',
		body: 'Camera',
		image: withBase('/demo-screenshots/camera-guide-app-ts.png'),
	},
	{
		href: withBase('/demo/viewer-porsche.html'),
		title: 'Porsche',
		body: 'Multi-actor CAD assembly, picking',
		image: withBase('/demo-screenshots/viewer-porsche.png'),
	},
	{
		href: withBase('/demo/terrain.html'),
		title: 'Procedural terrain',
		body: '351k triangles built in the browser, hit Generate',
		image: withBase('/demo-screenshots/terrain.png'),
	},
	{
		href: withBase('/demo/simple-app/index.html'),
		title: 'Scalar bar widget',
		body: 'Scalar bar widget',
		image: withBase('/demo-screenshots/simple-app.png'),
	},
	{
		href: withBase('/demo/viewer-starfighter2.html'),
		title: 'Starfighter',
		body: 'Interactive widgets',
		image: withBase('/demo-screenshots/viewer-starfighter2.png'),
	},
	{
		href: withBase('/demo/actors.html'),
		title: 'A thousand actors and more',
		body: 'Every object its own vtkActor, add more to test performance',
		image: withBase('/demo-screenshots/actors.png'),
	},
	{
		href: withBase('/demo/text-ts/index.html'),
		title: 'Text actor',
		body: 'Draw text',
		image: withBase('/demo-screenshots/text-ts.png'),
	},
]

// docs/news.md is the single source of truth for releases; parse the two most
// recent entries out of it rather than duplicating them here.
const news = computed(() => {
	return newsSource
		.split(/^## /m)
		.slice(1)
		.map((block) => {
			const title = block.slice(0, block.indexOf('\n')).trim()
			const date = block.match(/^__(.+?)__$/m)?.[1] ?? ''
			const code = block.match(/```sh\n([\s\S]*?)\n```/)?.[1]?.trim() ?? ''
			return { title, date, code }
		})
		.filter((item) => item.title)
		.slice(0, 2)
})

const featureRows = (groupKey) =>
	(featuresData.featureVersionGroups?.[groupKey]?.features ?? [])
		.map((entry) => Object.values(entry ?? {})[0])
		.filter(Boolean)

// Everything still open, then the most recent release, capped at five rows so
// the panel stays level with the news column beside it.
const LATEST_RELEASE_GROUP = 'implemented-in-9.7.x'

const roadmap = computed(() => {
	const planned = featureRows('planned').map((item) => ({
		status: 'planned',
		tone: 'planned',
		title: item.description,
		body: 'Targeted for the next release.',
	}))
	const shipped = featureRows(LATEST_RELEASE_GROUP).map((item) => ({
		status: 'shipped',
		tone: 'shipped',
		title: item.description,
		body: `Released in ${item.version}.`,
	}))
	return [...planned, ...shipped].slice(0, 5)
})

const latestRelease = computed(
	() => news.value[0]?.title.replace(/ is now available!?$/, '') ?? '',
)
</script>

<template>
	<div class="landing">
		<!-- Hero -->
		<section id="top" class="ld-section ld-hero">
			<div class="ld-hero-glow" aria-hidden="true" />
			<div class="ld-wrap ld-hero-grid">
				<div>
					<div class="ld-eyebrow ld-eyebrow-accent">
						C++ &rarr; WebAssembly &rarr; Browser
					</div>
					<h1 class="ld-h1">Run the real VTK in a browser tab.</h1>
					<p class="ld-lede">
						The same C++ rendering and filtering pipeline that ships in desktop
						VTK, compiled to WebAssembly and drawn with WebGL/WebGPU. No
						server-side rendering, no pixel streaming, no rewrite.
					</p>
					<div class="ld-cta">
						<a class="ld-btn ld-btn-primary" :href="withBase('/guide/')">
							Getting started
						</a>
						<a class="ld-btn ld-btn-ghost" href="#demos">See live demos</a>
					</div>
					<div class="ld-stats">
						<div class="ld-stat">
							<div class="ld-stat-value">0</div>
							<div class="ld-stat-label">GPU servers required</div>
						</div>
						<div class="ld-stat">
							<div class="ld-stat-value">4</div>
							<div class="ld-stat-label">languages, one runtime</div>
						</div>
					</div>
				</div>

				<div class="ld-panel">
					<div class="ld-panel-bar">
						<span class="ld-dot" />
						<span class="ld-dot" />
						<span class="ld-dot" />
						<span class="ld-panel-name">main.ts</span>
					</div>
					<!-- eslint-disable-next-line vue/no-v-html -- build-time Shiki output, see snippets.data.js -->
					<div class="ld-code vp-code" v-html="snippets.hero" />
					<div class="ld-panel-foot">
						<span class="ld-pip" />
						renders an interactive scene, client-side
					</div>
				</div>
			</div>
		</section>

		<!-- Entry points -->
		<section id="guides" class="ld-section ld-section-alt">
			<div class="ld-wrap ld-split">
				<div>
					<div class="ld-eyebrow">Four entry points</div>
					<h2 class="ld-h2">Pick the language you already write</h2>
					<p class="ld-body">
						Each path ends at the same WASM module. Start where your codebase
						already is.
					</p>
					<div class="ld-tabs" role="tablist">
						<button
							v-for="tab in tabs"
							:key="tab.id"
							type="button"
							role="tab"
							class="ld-tab"
							:class="{ 'is-active': tab.id === active.id }"
							:aria-selected="tab.id === active.id"
							@click="activeTab = tab.id"
						>
							<span class="ld-tab-label">{{ tab.label }}</span>
							<span class="ld-tab-hint">{{ tab.hint }}</span>
						</button>
					</div>

					<div class="ld-flow">
						<div class="ld-eyebrow ld-flow-head">How it works</div>
						<ol class="ld-flow-list">
							<li
								v-for="step in active.steps"
								:key="step.num"
								class="ld-flow-step"
							>
								<div class="ld-step-num">{{ step.num }}</div>
								<div class="ld-step-title">{{ step.title }}</div>
								<div class="ld-step-body">{{ step.body }}</div>
								<div class="ld-chip-code">{{ step.code }}</div>
							</li>
						</ol>
					</div>
				</div>

				<div class="ld-panel">
					<div class="ld-panel-bar ld-panel-bar-split">
						<span class="ld-panel-name">{{ active.file }}</span>
						<span class="ld-badge">{{ active.badge }}</span>
					</div>
					<!-- eslint-disable-next-line vue/no-v-html -- build-time Shiki output, see snippets.data.js -->
					<div class="ld-code ld-code-tall vp-code" v-html="snippets[active.id]" />
					<div class="ld-panel-foot ld-panel-foot-links">
						<a :href="active.link">Read the {{ active.label }} guide &rarr;</a>
						<span class="ld-muted">{{ active.note }}</span>
					</div>
				</div>
			</div>
		</section>

		<!-- Demos -->
		<section id="demos" class="ld-section">
			<div class="ld-wrap">
				<div class="ld-head-row">
					<div>
						<div class="ld-eyebrow">Live demos</div>
						<h2 class="ld-h2 ld-h2-flush">Running in your browser, right now</h2>
					</div>
					<span class="ld-mono-note">open in full screen and inspect source in dev console</span>
				</div>

				<div class="ld-demos">
					<div
						v-for="demo in liveDemos"
						:key="demo.title"
						class="ld-card ld-demo"
					>
						<div class="ld-demo-frame">
							<iframe :src="demo.href" :title="demo.title" loading="lazy" />
						</div>
						<div class="ld-demo-meta">
							<div class="ld-demo-text">
								<div class="ld-demo-title">{{ demo.title }}</div>
								<div class="ld-demo-body">{{ demo.body }}</div>
							</div>
							<a class="ld-badge ld-badge-accent" :href="demo.href" target="_blank">
								Full screen &rarr;
							</a>
						</div>
					</div>

					<a
						v-for="demo in linkedDemos"
						:key="demo.title"
						class="ld-card ld-demo ld-demo-link"
						:href="demo.href"
						target="_blank"
					>
						<div class="ld-demo-frame">
							<img :src="demo.image" :alt="demo.title" loading="lazy" />
						</div>
						<div class="ld-demo-meta">
							<div class="ld-demo-text">
								<div class="ld-demo-title">{{ demo.title }}</div>
								<div class="ld-demo-body">{{ demo.body }}</div>
							</div>
							<span class="ld-badge ld-badge-accent">Open &rarr;</span>
						</div>
					</a>
				</div>
			</div>
		</section>

		<!-- News + roadmap -->
		<section id="news" class="ld-section">
			<div class="ld-wrap ld-split">
				<div>
					<div class="ld-eyebrow ld-eyebrow-gap">Latest</div>
					<div v-for="item in news" :key="item.title" class="ld-rule-item">
						<div class="ld-news-date">{{ item.date }}</div>
						<div class="ld-news-title">{{ item.title }}</div>
						<div v-if="item.code" class="ld-chip-code">{{ item.code }}</div>
					</div>
					<div class="ld-rule-foot">
						<a :href="withBase('/news')">All release notes &rarr;</a>
					</div>
				</div>
				<div id="roadmap">
					<div class="ld-eyebrow ld-eyebrow-gap">Next</div>
					<div
						v-for="item in roadmap"
						:key="item.title"
						class="ld-rule-item ld-roadmap-item"
					>
						<span class="ld-badge" :class="`ld-badge-${item.tone}`">
							{{ item.status }}
						</span>
						<div>
							<div class="ld-roadmap-title">{{ item.title }}</div>
							<div class="ld-roadmap-body">{{ item.body }}</div>
						</div>
					</div>
					<div class="ld-rule-foot">
						<a :href="withBase('/roadmap/')">Full roadmap &rarr;</a>
					</div>
				</div>
			</div>
		</section>

		<footer class="ld-footer">
			<div class="ld-wrap ld-footer-row">
				<a class="ld-footer-mark" :href="withBase('/')">
					<img :src="withBase('/logo.svg')" alt="VTK.wasm" />
				</a>
				<nav class="ld-footer-links">
					<a :href="withBase('/guide/')">Guides</a>
					<a :href="withBase('/api/')">API</a>
					<a :href="withBase('/roadmap/')">Roadmap</a>
					<a href="https://gitlab.kitware.com/groups/vtk/-/issues">Issue tracker</a>
					<a href="https://www.kitware.com/support">Support</a>
				</nav>
				<div class="ld-footer-spacer" />
				<div class="ld-footer-note">
					<span v-if="latestRelease">Latest: {{ latestRelease }} · </span>
					Maintained by Kitware
				</div>
			</div>
		</footer>
	</div>
</template>

<style scoped>
/*
 * The --ld-* palette tokens live in theme/colors.css, where they also drive the
 * default theme's --vp-* surfaces so the rest of the site matches this page.
 */
.landing {
	background: var(--ld-bg);
	color: var(--ld-body);
	font-family: 'IBM Plex Sans', var(--vp-font-family-base), sans-serif;
}

.landing :deep(a) {
	color: var(--ld-acc-text);
	text-decoration: none;
}

.landing :deep(a:hover) {
	color: var(--ld-acc-hi);
}

/* Full-bleed: sections span the viewport, with only a gutter holding content
   off the edge. Individual prose blocks keep their own ch-based measure. */
.ld-wrap {
	width: 100%;
	margin: 0 auto;
	padding: 0 clamp(20px, 3.5vw, 56px);
}

.ld-section {
	border-bottom: 1px solid var(--ld-line-soft);
	padding: clamp(52px, 8vw, 88px) 0;
}

.ld-section-alt {
	background: var(--ld-bg-alt);
}

/* --- Type ------------------------------------------------------------- */

.ld-eyebrow {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12px;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ld-mute);
	margin-bottom: 14px;
}

.ld-eyebrow-accent {
	color: var(--ld-acc-text);
	margin-bottom: 22px;
}

.ld-eyebrow-gap {
	margin-bottom: 20px;
}

.ld-h1 {
	font-size: clamp(36px, 6.4vw, 58px);
	line-height: 1.05;
	letter-spacing: -0.032em;
	font-weight: 600;
	color: var(--ld-text);
	margin: 0 0 20px;
	text-wrap: balance;
}

.ld-h2 {
	font-size: clamp(26px, 4.2vw, 34px);
	line-height: 1.15;
	letter-spacing: -0.022em;
	font-weight: 600;
	color: var(--ld-text);
	margin: 0 0 12px;
}

.ld-h2-flush {
	margin-bottom: 0;
}

.ld-lede {
	font-size: 18px;
	line-height: 1.6;
	color: var(--ld-body);
	margin: 0 0 30px;
	max-width: 46ch;
	text-wrap: pretty;
}

.ld-body {
	font-size: 16px;
	line-height: 1.65;
	color: var(--ld-body);
	margin: 0 0 26px;
	text-wrap: pretty;
}

.ld-muted {
	color: var(--ld-mute);
}

.ld-mono-note {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12px;
	color: var(--ld-mute);
}

/* --- Hero ------------------------------------------------------------- */

.ld-hero {
	position: relative;
}

.ld-hero-glow {
	position: absolute;
	inset: 0;
	background: radial-gradient(
		900px 420px at 22% -10%,
		var(--ld-acc-glow),
		transparent 70%
	);
	pointer-events: none;
}

.ld-hero-grid {
	position: relative;
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
	gap: clamp(36px, 5vw, 64px);
	align-items: center;
}

.ld-cta {
	display: flex;
	gap: 12px;
	flex-wrap: wrap;
	margin-bottom: 34px;
}

.ld-btn {
	font-size: 15px;
	font-weight: 500;
	padding: 12px 22px;
	border-radius: 7px;
	transition: background-color 0.2s, border-color 0.2s;
}

/*
 * The buttons are anchors, so every rule here has to outrank the generic
 * `.landing a` / `.landing a:hover` link colours above — hence the `:deep()`
 * descendant form rather than a bare `.ld-btn-*` selector.
 */
.landing :deep(.ld-btn-primary) {
	color: var(--ld-acc-on);
	background: var(--ld-acc);
}

.landing :deep(.ld-btn-primary:hover) {
	background: var(--ld-acc-hi);
	color: var(--ld-acc-on);
}

.landing :deep(.ld-btn-ghost) {
	color: var(--ld-text);
	border: 1px solid var(--ld-line);
}

.landing :deep(.ld-btn-ghost:hover) {
	border-color: var(--ld-acc);
	background: var(--ld-surface-2);
	color: var(--ld-text);
}

.ld-stats {
	display: flex;
	gap: 34px;
	flex-wrap: wrap;
	font-family: 'IBM Plex Mono', monospace;
}

.ld-stat-value {
	font-size: 24px;
	color: var(--ld-text);
	font-weight: 500;
}

.ld-stat-label {
	font-size: 12px;
	color: var(--ld-mute);
	margin-top: 4px;
}

/* --- Code panel ------------------------------------------------------- */

.ld-panel {
	border: 1px solid var(--ld-line);
	border-radius: 12px;
	background: var(--ld-surface);
	overflow: hidden;
	box-shadow: 0 30px 70px -30px rgba(0, 0, 0, 0.28);
}

.dark .ld-panel {
	box-shadow: 0 30px 70px -30px rgba(0, 0, 0, 0.9);
}

.ld-panel-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 11px 14px;
	border-bottom: 1px solid var(--ld-line);
	background: var(--ld-surface-2);
}

.ld-panel-bar-split {
	justify-content: space-between;
	padding: 12px 18px;
}

.ld-dot {
	width: 9px;
	height: 9px;
	border-radius: 50%;
	background: var(--ld-line);
	display: block;
}

.ld-panel-name {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12px;
	color: var(--ld-mute);
	margin-left: 8px;
}

.ld-panel-bar-split .ld-panel-name {
	margin-left: 0;
	color: var(--ld-dim);
}

/*
 * `.ld-code` is the scroll box; the <pre>/<code> inside come from Shiki
 * (snippets.data.js) and only need to inherit the panel's type. Token colours
 * ride on --shiki-light / --shiki-dark, resolved by the default theme's
 * `.vp-code` rules — hence the extra `vp-code` class in the template.
 */
.ld-code {
	margin: 0;
	padding: 24px 26px;
	font-family: 'IBM Plex Mono', monospace;
	font-size: clamp(11.5px, 1.05vw, 13.5px);
	line-height: 1.85;
	color: var(--ld-text);
	overflow-x: auto;
	background: transparent;
}

.ld-code :deep(pre),
.ld-code :deep(code) {
	margin: 0;
	padding: 0;
	background: transparent;
	font: inherit;
	color: inherit;
}

.ld-code-tall {
	padding: 26px;
	min-height: 330px;
}

.ld-panel-foot {
	border-top: 1px solid var(--ld-line);
	padding: 12px 18px;
	display: flex;
	align-items: center;
	gap: 10px;
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12px;
	color: var(--ld-mute);
}

.ld-panel-foot-links {
	padding: 14px 18px;
	gap: 18px;
	flex-wrap: wrap;
	font-family: inherit;
	font-size: 13.5px;
}

.ld-pip {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--ld-acc);
	display: block;
	flex: none;
}

/* --- Cards / steps ---------------------------------------------------- */

.ld-card {
	border: 1px solid var(--ld-line);
	border-radius: 12px;
	background: var(--ld-surface);
	transition: background-color 0.2s, border-color 0.2s;
}

/*
 * “How it works” sits under the tab list and re-renders per entry point, so it
 * has to stay compact enough not to outgrow the code panel beside it — a plain
 * two-up list rather than the bordered cards the standalone section used.
 */
.ld-flow {
	margin-top: 40px;
	border-top: 1px solid var(--ld-line);
	padding-top: 26px;
}

.ld-flow-head {
	margin-bottom: 22px;
}

/*
 * Fixed 2x2 rather than auto-fit: there are always exactly four steps, and
 * auto-fit lands on a ragged 3+1 at common widths. Two columns also leaves each
 * track wide enough for the longest command to sit on one line.
 */
.ld-flow-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	grid-template-columns: 1fr;
	gap: 26px 22px;
}

@media (min-width: 640px) {
	.ld-flow-list {
		grid-template-columns: 1fr 1fr;
	}
}

.ld-step-num {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 11px;
	color: var(--ld-acc-text);
	letter-spacing: 0.12em;
	margin-bottom: 10px;
}

.ld-step-title {
	font-size: 15px;
	font-weight: 600;
	color: var(--ld-text);
	margin-bottom: 6px;
}

.ld-step-body {
	font-size: 13.5px;
	line-height: 1.6;
	color: var(--ld-dim);
	margin-bottom: 12px;
	text-wrap: pretty;
}

/*
 * Commands wrap rather than scroll — a scrollbar inside a 2cm-wide chip is
 * unusable. `break-word` only splits a token when it genuinely cannot fit, so
 * short commands still sit on one line.
 */
.ld-chip-code {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 11.5px;
	line-height: 1.5;
	color: var(--ld-acc-text);
	background: var(--ld-surface-3);
	border: 1px solid var(--ld-line);
	border-radius: 5px;
	padding: 7px 9px;
	white-space: normal;
	overflow-wrap: break-word;
}

/* --- Split layout / tabs ---------------------------------------------- */

.ld-split {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	gap: clamp(32px, 4vw, 56px);
	align-items: start;
}

.ld-tabs {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.ld-tab {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	text-align: left;
	padding: 14px 16px;
	border-radius: 8px;
	cursor: pointer;
	font-family: inherit;
	border: 1px solid transparent;
	background: transparent;
	color: var(--ld-body);
	transition: background-color 0.2s, border-color 0.2s, color 0.2s;
}

.ld-tab:hover {
	background: var(--ld-surface-2);
}

.ld-tab.is-active {
	border-color: var(--ld-acc);
	background: var(--ld-surface-2);
	color: var(--ld-text);
}

.ld-tab-label {
	font-size: 15px;
	font-weight: 500;
}

.ld-tab-hint {
	font-size: 13px;
	color: var(--ld-mute);
	margin-left: auto;
}

/* --- Demos ------------------------------------------------------------ */

.ld-head-row {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 24px;
	flex-wrap: wrap;
	margin-bottom: 40px;
}

.ld-demos {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
	gap: 20px;
}

.ld-demo {
	overflow: hidden;
}

.ld-demo:hover {
	border-color: var(--ld-acc);
}

.ld-demo-frame {
	height: 230px;
	background: var(--ld-surface-2);
}

.ld-demo-frame iframe {
	display: block;
	width: 100%;
	height: 100%;
	border: none;
}

.ld-demo-frame img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.ld-demo-link {
	display: block;
}

.landing :deep(.ld-demo-link),
.landing :deep(.ld-demo-link:hover) {
	color: inherit;
}

.ld-demo-meta {
	padding: 18px 20px;
	display: flex;
	align-items: center;
	gap: 12px;
	border-top: 1px solid var(--ld-line);
}

.ld-demo-text {
	flex: 1;
}

.ld-demo-title {
	font-size: 15.5px;
	font-weight: 500;
	color: var(--ld-text);
}

.ld-demo-body {
	font-size: 13px;
	color: var(--ld-dim);
	margin-top: 4px;
}

.ld-badge {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 11px;
	color: var(--ld-mute);
	border: 1px solid var(--ld-line);
	border-radius: 4px;
	padding: 4px 8px;
	white-space: nowrap;
}

.landing :deep(a.ld-badge-accent),
.ld-badge-accent {
	color: var(--ld-acc-text);
	border-color: var(--ld-acc);
}

.ld-badge-shipped {
	color: var(--ld-acc-text);
	border-color: var(--ld-acc);
}

.ld-badge-planned {
	color: var(--ld-mute);
}

/* --- News / roadmap --------------------------------------------------- */

.ld-rule-item {
	border-top: 1px solid var(--ld-line);
	padding: 20px 0;
}

.ld-rule-foot {
	border-top: 1px solid var(--ld-line);
	padding-top: 20px;
	font-size: 14px;
}

.ld-news-date {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12px;
	color: var(--ld-mute);
	margin-bottom: 8px;
}

.ld-news-title {
	font-size: 16px;
	font-weight: 500;
	color: var(--ld-text);
	margin-bottom: 8px;
}

.ld-roadmap-item {
	display: flex;
	gap: 16px;
	align-items: baseline;
	padding: 18px 0;
}

.ld-roadmap-title {
	font-size: 15px;
	color: var(--ld-text);
	margin-bottom: 4px;
}

.ld-roadmap-body {
	font-size: 13.5px;
	color: var(--ld-dim);
	line-height: 1.55;
}

/* --- Footer ----------------------------------------------------------- */

.ld-footer {
	border-top: 1px solid var(--ld-line-soft);
	background: var(--ld-surface-2);
	padding: 48px 0;
}

.ld-footer-row {
	display: flex;
	gap: 28px;
	flex-wrap: wrap;
	align-items: center;
}

.ld-footer-mark {
	display: inline-flex;
	align-items: center;
	background: #f4f9f8;
	border-radius: 6px;
	padding: 6px 10px;
}

.ld-footer-mark img {
	height: 18px;
	width: auto;
	object-fit: contain;
	display: block;
}

.ld-footer-links {
	display: flex;
	gap: 22px;
	flex-wrap: wrap;
	font-size: 14px;
}

.landing :deep(.ld-footer-links a) {
	color: var(--ld-dim);
}

.landing :deep(.ld-footer-links a:hover) {
	color: var(--ld-acc-text);
}

.ld-footer-spacer {
	flex: 1;
}

.ld-footer-note {
	font-size: 13px;
	color: var(--ld-mute);
}
</style>
