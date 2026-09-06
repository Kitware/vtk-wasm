import { onMounted, ref } from 'vue'

/*
 * Whether this browser implements the WebAssembly JavaScript Promise
 * Integration (JSPI) API.
 *
 * The VTK.wasm bundles are built with JSPI: their Emscripten glue calls
 * `new WebAssembly.Suspending(...)` while instantiating, so on a browser
 * without it every demo page dies at load with
 *
 *   TypeError: undefined is not a constructor
 *              (evaluating 'new WebAssembly.Suspending(original)')
 *
 * WebKit has not shipped JSPI, which covers desktop Safari and — since every
 * iOS browser is WebKit underneath — the whole of iOS. The demo tiles use this
 * to render as plain figures instead of links there, rather than sending
 * visitors to a page that cannot start.
 *
 * SSR and the pre-hydration paint assume support; the downgrade happens in
 * onMounted, after hydration, so there is no markup mismatch to reconcile.
 */
export function useJspi() {
	const hasJspi = ref(true)

	onMounted(() => {
		hasJspi.value = typeof globalThis.WebAssembly?.Suspending === 'function'
	})

	return hasJspi
}
