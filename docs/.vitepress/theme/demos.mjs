/*
 * Shared demo catalogue. The landing page (components/Landing.vue) shows the
 * three `featured` entries; the /demos gallery (components/DemoGallery.vue)
 * shows all of them. Paths are site-relative — callers apply withBase().
 *
 * Every demo instantiates the WASM bundle, which needs JSPI to load, so both
 * consumers degrade these to non-links where the browser lacks it — see
 * useJspi.mjs.
 */
export const demos = [
	{
		href: '/demo/volume.html',
		title: 'Volume rendering',
		body: '531k voxels ray cast on the GPU, change transfer function preset',
		image: '/demo-screenshots/volume.png',
		featured: true,
	},
	{
		href: '/demo/wave-app-ts/index.html',
		title: 'Dynamic mesh',
		body: 'Procedural wave surface, rebuilt every frame',
		image: '/demo-screenshots/wave-app-ts.png',
		featured: true,
	},
	{
		href: '/demo/actors.html',
		title: 'A thousand actors and more',
		body: 'Every object its own vtkActor, add more to test performance',
		image: '/demo-screenshots/actors.png',
		featured: true,
	},
	{
		href: '/demo/viewer-porsche.html',
		title: 'Porsche',
		body: 'Multi-actor CAD assembly, picking',
		image: '/demo-screenshots/viewer-porsche.png',
	},
	{
		href: '/demo/terrain.html',
		title: 'Procedural terrain',
		body: '351k triangles built in the browser, hit Generate',
		image: '/demo-screenshots/terrain.png',
	},
	{
		href: '/demo/viewer-starfighter2.html',
		title: 'Starfighter',
		body: 'Plane widget driving a clip plane through a CAD model',
		image: '/demo-screenshots/viewer-starfighter2.png',
	},
	{
		href: '/demo/camera-guide-app-ts/index.html',
		title: 'Camera guide',
		body: 'Camera frustum in an observer view, beside what it sees',
		image: '/demo-screenshots/camera-guide-app-ts.png',
	},
	{
		href: '/demo/simple-app/index.html',
		title: 'Scalar bar widget',
		body: 'Draggable scalar bar over a colour-mapped source',
		image: '/demo-screenshots/simple-app.png',
	},
	{
		href: '/demo/text-ts/index.html',
		title: 'Text actor',
		body: 'Screen-space text drawn over a 3D scene',
		image: '/demo-screenshots/text-ts.png',
	},
]

export const featuredDemos = demos.filter((demo) => demo.featured)
