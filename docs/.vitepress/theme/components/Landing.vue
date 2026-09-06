<script setup>
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import featuresData from '../../../roadmap/features.json'
import newsSource from '../../../news.md?raw'
// Snippet sources live in the data loader so Shiki can highlight them at build
// time; `snippets[key]` is ready-to-render markup, not a raw string.
import { data as snippets } from '../snippets.data.mjs'
import { data as npmPackage } from '../npmVersion.data.mjs'
import { featuredDemos } from '../demos.mjs'
import { useJspi } from '../useJspi.mjs'

// One row per entry point. Each is a single install line plus the snippet it
// produces — the long "how it works" chains live in the guides these link to.
const tabs = [
	{
		id: 'ts',
		label: 'TypeScript',
		file: 'viewer.ts',
		install: 'npm i @kitware/vtk-wasm && npx vtk-wasm gen-types --url https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz',
		note: 'Types match the bundle you load.',
		link: withBase('/guide/js/typescript'),
	},
	{
		id: 'js',
		label: 'JavaScript',
		file: 'viewer.js',
		install: 'npm i @kitware/vtk-wasm',
		note: 'Works with any bundler, or none.',
		link: withBase('/guide/js/loading'),
	},
	{
		id: 'cpp',
		label: 'C++',
		file: 'main.cxx',
		install: 'docker pull kitware/vtk-wasm-sdk',
		note: 'One source tree, native and web.',
		link: withBase('/guide/cpp/'),
	},
	{
		id: 'trame',
		label: 'trame',
		file: 'app.py',
		install: 'pip install "trame-vtklocal"',
		note: 'Logic in Python, rendering local.',
		link: withBase('/guide/trame/'),
	},
]

const activeTab = ref('ts')
const active = computed(
	() => tabs.find((tab) => tab.id === activeTab.value) || tabs[0],
)

const hasJspi = useJspi()

// The three strongest screenshots; the rest live on /demos.
const shots = featuredDemos.map((demo) => ({
	...demo,
	href: withBase(demo.href),
	image: withBase(demo.image),
}))

// The architecture stack, read top-down: how the runtime gets loaded, what it
// hands back, what crosses the WASM boundary, and what runs on the far side.
// The repeated card lists live here; each layer's one-off parts (the loadAsync
// callout, the teardown line, the canvas bar) are written out in the template.
const loadEntries = [
	{ term: '<script src="\u2026">', body: 'Global vtkwasm on window' },
	{
		term: 'import { loadAsync }',
		body: 'Bundler import from the npm package',
	},
	{
		term: 'Annotation script tag',
		body: 'Loads the runtime and opens a standalone session in one step',
		auto: true,
	},
]

const sessions = [
	{
		name: 'StandaloneSession',
		kind: 'local',
		body: 'session.vtk creates objects, builds the pipeline and renders.',
		calls: ['vtkConeSource()', 'vtkActor()', 'registerCanvas()'],
	},
	{
		name: 'RemoteSession',
		kind: 'driven',
		body: 'State arrives from elsewhere. Bind a transport and a canvas, then apply updates.',
		calls: ['bindNetwork()', 'bindCanvas()', 'update()'],
	},
]

const marshallers = [
	{ term: 'Serializer', body: 'C++ objects \u2192 state' },
	{ term: 'Deserializer', body: 'state \u2192 C++ objects' },
]

const marshalContext = [
	{ term: 'Weak objects', body: 'Borrowed handles' },
	{ term: 'Strong objects', body: 'Owned, ref-counted' },
	{ term: 'States', body: 'JSON per object' },
	{ term: 'Blobs', body: 'Binary arrays' },
]

const vtkLayers = [
	{ term: 'Sources & filters', body: 'Readers, geometry, algorithms' },
	{ term: 'Mappers & actors', body: 'Scene graph and properties' },
	{ term: 'Render window', body: 'Renderers, cameras, lights' },
	{ term: 'Interactor', body: 'Event loop, trackball styles' },
]

// docs/news.md is the single source of truth for releases; parse the two most
// recent entries out of it rather than duplicating them here.
const news = computed(() =>
	newsSource
		.split(/^## /m)
		.slice(1)
		.map((block) => {
			const title = block.slice(0, block.indexOf('\n')).trim()
			const date = block.match(/^__(.+?)__$/m)?.[1] ?? ''
			return { title, date }
		})
		.filter((item) => item.title)
		.slice(0, 3),
)

const featureRows = (groupKey) =>
	(featuresData.featureVersionGroups?.[groupKey]?.features ?? [])
		.map((entry) => Object.values(entry ?? {})[0])
		.filter(Boolean)

const version = (title) => title.replace(/ is now available!?$/, '')

// One flat table: what shipped, then what is queued. Reading down the first
// column gives the release history; reading down the second gives the state.
const status = computed(() => [
	...news.value.map((item) => ({
		key: version(item.title),
		state: 'released',
		tone: 'shipped',
		detail: item.date,
	})),
	...featureRows('planned').map((item) => ({
		key: 'next',
		state: 'planned',
		tone: 'planned',
		detail: item.description,
	})),
])
</script>

<template>
	<div class="landing">
		<!-- Masthead: wordmark left, the published npm coordinate right. -->
		<header class="ld-masthead">
			<div class="ld-wrap ld-masthead-row">
				<span class="ld-wordmark">VTK.wasm</span>
				<span v-if="npmPackage.version" class="ld-masthead-meta">
					v{{ npmPackage.version }}
				</span>
			</div>
		</header>

		<section class="ld-lead">
			<div class="ld-wrap">
			    <h1 class="ld-h1">See your <u>scientific data</u> on the web using the <u>Visualization ToolKit</u>.</h1>
				<p class="ld-lede">
				VTK.wasm gives you VTK C++ compiled for the browser,
				so you can move the data processing and rendering
				pipelines you are already familiar with from desktop VTK
				to the browser through WebAssembly, WebGL, and WebGPU
				</p>
				<div class="ld-lead-links">
					<a :href="withBase('/guide/')">Getting started &rarr;</a>
					<a href="https://github.com/Kitware/vtk-wasm">Source &rarr;</a>
				</div>
			</div>
		</section>

		<section id="demos" class="ld-row">
			<div class="ld-wrap ld-row-grid">
				<h2 class="ld-row-label">Demos</h2>
				<div class="ld-row-body">
					<p v-if="!hasJspi" class="ld-warn">
						These demos need the WebAssembly JSPI API. WebKit has not shipped
						it, so they cannot run in Safari or in any browser on iOS — open
						this page in Chrome or Edge.
					</p>
					<div class="ld-shots">
						<figure v-for="shot in shots" :key="shot.title" class="ld-shot">
							<a
								v-if="hasJspi"
								class="ld-shot-frame"
								:href="shot.href"
								target="_blank"
							>
								<img :src="shot.image" :alt="shot.title" loading="lazy" />
							</a>
							<div v-else class="ld-shot-frame">
								<img :src="shot.image" :alt="shot.title" loading="lazy" />
							</div>
							<figcaption class="ld-shot-cap">
								<span class="ld-shot-title">{{ shot.title }}</span>
								<span class="ld-shot-body">{{ shot.body }}</span>
							</figcaption>
						</figure>
					</div>
					<div class="ld-row-foot">
						<a :href="withBase('/demos')">All demos &rarr;</a>
					</div>
				</div>
			</div>
		</section>

		<section id="guides" class="ld-row">
			<div class="ld-wrap ld-row-grid">
				<h2 class="ld-row-label">Get it</h2>
				<div class="ld-row-body">
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
							{{ tab.label }}
						</button>
					</div>

					<div class="ld-install">{{ active.install }}</div>

					<!-- eslint-disable-next-line vue/no-v-html -- build-time Shiki output, see snippets.data.mjs -->
					<div class="ld-code vp-code" v-html="snippets[active.id]" />

					<div class="ld-row-foot">
						<a :href="active.link">Read the {{ active.label }} guide &rarr;</a>
						<span>{{ active.file }} &middot; {{ active.note }}</span>
					</div>
				</div>
			</div>
		</section>

		<section id="about" class="ld-row">
			<div class="ld-wrap ld-row-grid">
				<h2 class="ld-row-label">Architecture</h2>
				<div class="ld-row-body">
					<ol class="ld-arch">
						<li class="ld-arch-layer">
							<div class="ld-arch-head">
								<span class="ld-arch-name">Load</span>
								<span class="ld-arch-rule" />
								<span class="ld-arch-note">three entry points</span>
							</div>
							<ul class="ld-arch-cards">
								<li
									v-for="entry in loadEntries"
									:key="entry.term"
									class="ld-arch-card"
									:class="{ 'is-auto': entry.auto }"
								>
									<span class="ld-arch-term">{{ entry.term }}</span>
									<span class="ld-arch-text">{{ entry.body }}</span>
								</li>
							</ul>
							<!-- The one call every entry point above funnels into. -->
							<div class="ld-arch-call">
								<div class="ld-arch-call-main">
									<span class="ld-arch-sig">loadAsync({ url, rendering })</span>
									<span class="ld-arch-text">
										Fetches and instantiates the bundle, in webgl or webgpu.
									</span>
								</div>
								<div class="ld-arch-returns">
									<span class="ld-arch-key">returns</span>
									<span class="ld-arch-chip is-acc">VtkWasmRuntime</span>
								</div>
							</div>
						</li>

						<li class="ld-arch-layer">
							<div class="ld-arch-head">
								<span class="ld-arch-name">Runtime &amp; sessions</span>
								<span class="ld-arch-rule" />
								<span class="ld-arch-note">one session, cached per url + config</span>
							</div>
							<ul class="ld-arch-cards ld-arch-cards-wide">
								<li
									v-for="item in sessions"
									:key="item.name"
									class="ld-arch-card"
								>
									<span class="ld-arch-card-head">
										<span class="ld-arch-term">{{ item.name }}</span>
										<span class="ld-arch-key">{{ item.kind }}</span>
									</span>
									<span class="ld-arch-text">{{ item.body }}</span>
									<span class="ld-arch-chips">
										<span
											v-for="call in item.calls"
											:key="call"
											class="ld-arch-chip"
										>
											{{ call }}
										</span>
									</span>
								</li>
							</ul>
							<div class="ld-arch-foot">
								<span class="ld-arch-key">teardown</span>
								<span class="ld-arch-chip">session.dispose()</span>
								<span class="ld-arch-then">then</span>
								<span class="ld-arch-chip">runtime.dispose()</span>
							</div>
						</li>

						<li class="ld-arch-layer">
							<div class="ld-arch-head">
								<span class="ld-arch-name">The WASM boundary</span>
								<span class="ld-arch-rule" />
								<span class="ld-arch-note">ObjectManager</span>
							</div>
							<div class="ld-arch-marshal">
								<ul class="ld-arch-cards ld-arch-cards-stack">
									<li
										v-for="item in marshallers"
										:key="item.term"
										class="ld-arch-card"
									>
										<span class="ld-arch-term">{{ item.term }}</span>
										<span class="ld-arch-text">{{ item.body }}</span>
									</li>
								</ul>
								<!-- aria-hidden: decorative; the two cards either side say it. -->
								<span class="ld-arch-swap" aria-hidden="true">&#8646;</span>
								<div class="ld-arch-panel">
									<span class="ld-arch-card-head">
										<span class="ld-arch-term">Marshal context</span>
										<span class="ld-arch-note">one registry per session</span>
									</span>
									<ul class="ld-arch-cards ld-arch-cards-tight">
										<li
											v-for="item in marshalContext"
											:key="item.term"
											class="ld-arch-card"
										>
											<span class="ld-arch-term">{{ item.term }}</span>
											<span class="ld-arch-text">{{ item.body }}</span>
										</li>
									</ul>
								</div>
							</div>
						</li>

						<li class="ld-arch-layer">
							<div class="ld-arch-head">
								<span class="ld-arch-name">Real VTK, compiled</span>
								<span class="ld-arch-rule" />
								<span class="ld-arch-note">the desktop pipeline, unchanged</span>
							</div>
							<ul class="ld-arch-cards">
								<li
									v-for="item in vtkLayers"
									:key="item.term"
									class="ld-arch-card"
								>
									<span class="ld-arch-term">{{ item.term }}</span>
									<span class="ld-arch-text">{{ item.body }}</span>
								</li>
							</ul>
							<div class="ld-arch-call">
								<span class="ld-arch-sig">&lt;canvas&gt;</span>
								<span class="ld-arch-wire" />
								<span class="ld-arch-chip is-acc">WebGL</span>
								<span class="ld-arch-chip is-acc">WebGPU</span>
								<span class="ld-arch-text">
									Drawn on the client GPU, at interactive frame rates.
								</span>
							</div>
						</li>
					</ol>
				</div>
			</div>
		</section>

		<section id="status" class="ld-row">
			<div class="ld-wrap ld-row-grid">
				<h2 class="ld-row-label">Status</h2>
				<div class="ld-row-body">
					<dl class="ld-status">
						<div v-for="item in status" :key="item.key + item.detail" class="ld-status-row">
							<dt class="ld-status-key">{{ item.key }}</dt>
							<dd class="ld-status-state" :class="`ld-status-${item.tone}`">
								{{ item.state }}
							</dd>
							<dd class="ld-status-detail">{{ item.detail }}</dd>
						</div>
					</dl>
					<div class="ld-row-foot">
						<a :href="withBase('/news')">Release notes &rarr;</a>
						<a :href="withBase('/roadmap/')">Full roadmap &rarr;</a>
					</div>
				</div>
			</div>
		</section>

		<footer class="ld-footer">
			<div class="ld-wrap ld-footer-row">
				<nav class="ld-footer-links">
					<a :href="withBase('/guide/')">Guides</a>
					<a :href="withBase('/api/')">API</a>
					<a :href="withBase('/demos')">Demos</a>
					<a href="https://github.com/Kitware/vtk-wasm/issues">Issues</a>
					<a href="https://www.kitware.com/support">Support</a>
				</nav>
				<span class="ld-footer-note">Maintained by Kitware</span>
			</div>
		</footer>
	</div>
</template>

<style scoped>
/*
 * Spec-sheet landing: one measured column, mono labels in a left gutter,
 * hairline rules between rows. No cards, no panel chrome, no gradients — the
 * page should read like a datasheet, not a brochure.
 *
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

.ld-wrap {
	width: 100%;
	max-width: 1060px;
	margin: 0 auto;
	padding: 0 clamp(20px, 4vw, 36px);
}

/* --- Masthead --------------------------------------------------------- */

.ld-masthead {
	border-bottom: 1px solid var(--ld-line);
}

.ld-masthead-row {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 20px;
	padding-top: 26px;
	padding-bottom: 14px;
}

.ld-wordmark {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12px;
	letter-spacing: 0.14em;
	text-transform: uppercase;
}

.ld-wordmark {
	color: var(--ld-text);
	font-weight: 500;
}

.ld-masthead-meta {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12px;
	letter-spacing: 0.06em;
	color: var(--ld-body);
}

/* Below the breakpoint the meta line cannot sit beside the wordmark without
   wrapping mid-list, so stack the title block instead. */
@media (max-width: 619px) {
	.ld-masthead-row {
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
}

/* --- Lead ------------------------------------------------------------- */

.ld-lead {
	padding: clamp(44px, 7vw, 76px) 0 clamp(36px, 5vw, 56px);
}

.ld-h1 {
	font-size: clamp(32px, 5vw, 46px);
	line-height: 1.1;
	letter-spacing: -0.028em;
	font-weight: 600;
	color: var(--ld-text);
	margin: 0 0 20px;
	max-width: 20ch;
	text-wrap: balance;
}

.ld-lede {
	font-size: 17px;
	line-height: 1.6;
	color: var(--ld-body);
	margin: 0 0 26px;
	max-width: 62ch;
	text-wrap: pretty;
}

.ld-lead-links {
	display: flex;
	gap: 26px;
	flex-wrap: wrap;
	font-size: 15px;
}

/* --- Rows ------------------------------------------------------------- */

.ld-row {
	border-top: 1px solid var(--ld-line);
	padding: clamp(32px, 4.5vw, 48px) 0;
}

/*
 * Label in a fixed gutter, content in the remaining track. The gutter collapses
 * below 760px, where the label simply sits above its row.
 */
.ld-row-grid {
	display: grid;
	grid-template-columns: 1fr;
	gap: 18px;
}

@media (min-width: 760px) {
	.ld-row-grid {
		grid-template-columns: 170px minmax(0, 1fr);
		gap: 40px;
	}
}

.ld-row-label {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12px;
	font-weight: 400;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ld-body);
	margin: 0;
	padding-top: 2px;
}

.ld-row-body {
	min-width: 0;
}

.ld-body {
	font-size: 15.5px;
	line-height: 1.65;
	color: var(--ld-body);
	margin: 0 0 24px;
	max-width: 68ch;
	text-wrap: pretty;
}

/*
 * Row footers carry the "read more" links. Baseline-aligned rather than
 * boxed, so they read as a caption line under the content above them.
 */
.ld-row-foot {
	display: flex;
	gap: 24px;
	flex-wrap: wrap;
	align-items: baseline;
	margin-top: 18px;
	font-size: 14px;
}

/* --- Architecture ----------------------------------------------------- */

/*
 * The stack, top-down. Every layer is the same shape — a header line, then its
 * own body — so the eye can run down the left edge and read only the names.
 * `margin: 0` on the items overrides the default theme's `.vp-doc li + li`.
 */
.ld-arch {
	list-style: none;
	margin: 0;
	padding: 0;
}

.ld-arch-layer {
	margin: 0;
	border: 1px solid var(--ld-line);
	background: var(--ld-surface);
	padding: 16px 18px 18px;
}

/* The connector sits between layers rather than inside one, matching the
   arrow idiom used by the entry-point tabs above. */
.ld-arch-layer:not(:last-child)::after {
	content: '\2193';
	display: block;
	text-align: center;
	font-family: 'IBM Plex Mono', monospace;
	font-size: 13px;
	color: var(--ld-body);
	/* Cancel the layer's own padding so the glyph lands in the gap. */
	margin: 18px -18px -18px;
	padding: 8px 0;
}

.ld-arch-head {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 14px;
}

.ld-arch-name {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 11.5px;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ld-text);
	white-space: nowrap;
}

.ld-arch-rule {
	flex: 1;
	height: 1px;
	background: var(--ld-line);
}

.ld-arch-note {
	font-size: 12px;
	color: var(--ld-dim);
	text-align: right;
}

/* --- Architecture cards ----------------------------------------------- */

.ld-arch-cards {
	list-style: none;
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin: 0;
	padding: 0;
}

.ld-arch-card {
	flex: 1 1 170px;
	min-width: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 5px;
	padding: 12px 14px;
	border: 1px solid var(--ld-line-soft);
	background: var(--ld-surface-2);
}

/* Wider basis where the card carries a paragraph and a row of calls. */
.ld-arch-cards-wide .ld-arch-card {
	flex-basis: 300px;
	gap: 10px;
}

.ld-arch-cards-tight .ld-arch-card {
	flex-basis: 100px;
	padding: 10px 12px;
}

/* The serializer pair stacks so it reads as one column facing the panel. In a
   column container the cards' `flex-basis` would size their height, so reset
   it and let each one be as tall as its own two lines. */
.ld-arch-cards-stack {
	flex: 0 1 190px;
	flex-direction: column;
}

.ld-arch-cards-stack .ld-arch-card {
	flex: 0 0 auto;
}

/*
 * The annotation script tag is the automatic path rather than a third API, so
 * it is marked out with the accent and a dashed edge instead of a plain rule.
 */
.ld-arch-card.is-auto {
	border-style: dashed;
	border-color: var(--ld-acc);
	background: var(--ld-acc-glow);
}

.ld-arch-card.is-auto .ld-arch-term {
	color: var(--ld-acc-text);
}

.ld-arch-card-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 10px;
}

.ld-arch-term {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12.5px;
	color: var(--ld-text);
}

.ld-arch-text {
	font-size: 12.5px;
	line-height: 1.5;
	color: var(--ld-body);
	text-wrap: pretty;
}

.ld-arch-key {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 10.5px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--ld-dim);
	white-space: nowrap;
}

/* --- Architecture chips and callouts ---------------------------------- */

.ld-arch-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.ld-arch-chip {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 11.5px;
	padding: 4px 9px;
	border: 1px solid var(--ld-line);
	background: var(--ld-surface-3);
	color: var(--ld-body);
	white-space: nowrap;
}

.ld-arch-chip.is-acc {
	border-color: var(--ld-acc);
	color: var(--ld-acc-text);
	background: var(--ld-acc-glow);
}

/*
 * The one line that matters in its layer — the loadAsync signature, and the
 * canvas the compiled pipeline draws into. Tinted rather than boxed harder, so
 * it lifts off the cards without adding a third border weight.
 */
.ld-arch-call {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	margin-top: 10px;
	padding: 14px;
	border: 1px solid var(--ld-line);
	background: var(--ld-acc-glow);
}

.ld-arch-call-main {
	flex: 1 1 240px;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.ld-arch-sig {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 13.5px;
	color: var(--ld-text);
}

.ld-arch-returns {
	display: flex;
	align-items: center;
	gap: 10px;
}

/* Dashes rather than a solid rule: a wire from the canvas to the backends. */
.ld-arch-wire {
	flex: 1 1 60px;
	min-width: 30px;
	height: 1px;
	background: repeating-linear-gradient(
		90deg,
		var(--ld-line) 0 6px,
		transparent 6px 12px
	);
}

.ld-arch-foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-top: 12px;
	padding-top: 12px;
	border-top: 1px solid var(--ld-line-soft);
}

.ld-arch-then {
	font-size: 12.5px;
	color: var(--ld-dim);
}

/* --- Marshal row ------------------------------------------------------ */

.ld-arch-marshal {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	gap: 10px;
}

.ld-arch-swap {
	align-self: center;
	font-family: 'IBM Plex Mono', monospace;
	font-size: 18px;
	color: var(--ld-acc-text);
}

.ld-arch-panel {
	flex: 1 1 360px;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 14px;
	border: 1px solid var(--ld-line-soft);
	background: var(--ld-surface-2);
}

/* The panel already sits on surface-2; step its own cards back to the page
   surface so the nesting stays legible in both themes. */
.ld-arch-panel .ld-arch-card {
	background: var(--ld-surface);
}

/* Below the two-column breakpoint the layers are already one card wide, so the
   marshal row runs vertically and the swap glyph turns to match. */
@media (max-width: 619px) {
	.ld-arch-layer {
		padding: 14px;
	}

	.ld-arch-layer:not(:last-child)::after {
		margin: 14px -14px -14px;
	}

	.ld-arch-head {
		flex-wrap: wrap;
	}

	.ld-arch-rule {
		display: none;
	}

	.ld-arch-note {
		text-align: left;
	}

	/* Full-width rows so the glyph lands between the pair and the panel it
	   points at, rather than stranded beside the pair. */
	.ld-arch-cards-stack,
	.ld-arch-panel {
		flex: 1 1 100%;
	}

	.ld-arch-swap {
		width: 100%;
		text-align: center;
		transform: rotate(90deg);
	}
}

/* --- Get it ----------------------------------------------------------- */

.ld-tabs {
	display: flex;
	gap: 26px;
	flex-wrap: wrap;
	border-bottom: 1px solid var(--ld-line);
	margin-bottom: 20px;
}

.ld-tab {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 13px;
	padding: 0 0 10px;
	margin-bottom: -1px;
	border: 0;
	border-bottom: 2px solid transparent;
	background: transparent;
	color: var(--ld-body);
	cursor: pointer;
	transition: color 0.15s, border-color 0.15s;
}

.ld-tab:hover {
	color: var(--ld-text);
}

.ld-tab.is-active {
	color: var(--ld-text);
	border-bottom-color: var(--ld-acc);
}

/*
 * The install line is the answer to "Get it"; the snippet below is what you
 * write afterwards. An accent rule rather than a full box keeps the two from
 * reading as two code blocks stacked on each other.
 */
.ld-install {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12.5px;
	line-height: 1.6;
	color: var(--ld-acc-text);
	border-left: 2px solid var(--ld-acc);
	padding: 4px 0 4px 14px;
	margin-bottom: 20px;
	overflow-wrap: break-word;
}

/*
 * `.ld-code` is the scroll box; the <pre>/<code> inside come from Shiki
 * (snippets.data.mjs) and only need to inherit the block's type. Token colours
 * ride on --shiki-light / --shiki-dark, resolved by the default theme's
 * `.vp-code` rules — hence the extra `vp-code` class in the template.
 */
.ld-code {
	margin: 0;
	padding: 20px 22px;
	border: 1px solid var(--ld-line);
	background: var(--ld-surface-2);
	font-family: 'IBM Plex Mono', monospace;
	font-size: clamp(11.5px, 1vw, 13px);
	line-height: 1.8;
	color: var(--ld-text);
	overflow-x: auto;
}

.ld-code :deep(pre),
.ld-code :deep(code) {
	margin: 0;
	padding: 0;
	background: transparent;
	font: inherit;
	color: inherit;
}

/* --- Screenshots ------------------------------------------------------ */

/*
 * Only rendered where the browser lacks JSPI, so it is the one element on the
 * page allowed to break the restrained palette — every tile below it is inert.
 */
.ld-warn {
	color: var(--ld-warn-text);
	background: var(--ld-warn-bg);
	border: 1px solid var(--ld-warn-line);
	border-left-width: 3px;
	padding: 12px 16px;
	margin: 0 0 20px;
	font-size: 14px;
	line-height: 1.6;
	max-width: 68ch;
	text-wrap: pretty;
}

/* --- Screenshot grid -------------------------------------------------- */

/*
 * Flush 2px gutters, uniform 3:2 crops, captions outside the image. Two of the
 * source screenshots are off-grid (simple-app, text-ts) but neither is in the
 * featured three, so `cover` never has much to trim here.
 */
.ld-shots {
	display: grid;
	grid-template-columns: 1fr;
	gap: 16px;
}

@media (min-width: 620px) {
	.ld-shots {
		grid-template-columns: repeat(3, 1fr);
		gap: 2px;
	}
}

.ld-shot {
	margin: 0;
	min-width: 0;
}

.ld-shot-frame {
	display: block;
	background: var(--ld-surface-2);
	border: 1px solid var(--ld-line);
}

a.ld-shot-frame:hover {
	border-color: var(--ld-acc);
}

.ld-shot-frame img {
	display: block;
	width: 100%;
	aspect-ratio: 3 / 2;
	object-fit: cover;
}

.ld-shot-cap {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 11.5px;
	line-height: 1.5;
	padding-top: 8px;
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.ld-shot-title {
	color: var(--ld-text);
}

.ld-shot-body {
	color: var(--ld-body);
	text-wrap: pretty;
}

/* --- Status ----------------------------------------------------------- */

.ld-status {
	margin: 0;
	font-size: 14px;
}

/*
 * Three columns: version, state, detail. The first two are fixed-width mono so
 * the eye can run straight down them; the detail column takes the slack.
 */
.ld-status-row {
	display: grid;
	grid-template-columns: 1fr;
	gap: 2px 16px;
	padding: 12px 0;
	border-top: 1px solid var(--ld-line-soft);
}

.ld-status-row:first-child {
	border-top: 0;
	padding-top: 0;
}

@media (min-width: 620px) {
	.ld-status-row {
		grid-template-columns: 15ch 9ch minmax(0, 1fr);
		align-items: baseline;
	}
}

.ld-status-key,
.ld-status-state {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12.5px;
	margin: 0;
}

.ld-status-key {
	color: var(--ld-text);
}

.ld-status-shipped {
	color: var(--ld-acc-text);
}

.ld-status-planned {
	color: var(--ld-body);
}

.ld-status-detail {
	margin: 0;
	color: var(--ld-dim);
	line-height: 1.55;
	text-wrap: pretty;
}

/* --- Footer ----------------------------------------------------------- */

.ld-footer {
	border-top: 1px solid var(--ld-line);
	padding: 26px 0 40px;
}

.ld-footer-row {
	display: flex;
	gap: 20px 28px;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
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

.ld-footer-note {
	font-family: 'IBM Plex Mono', monospace;
	font-size: 12px;
	color: var(--ld-body);
}
</style>
