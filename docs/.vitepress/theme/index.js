// .vitepress/theme/index.js
import DefaultTheme from 'vitepress/theme'
import "./colors.css"
import FeatureStatusTable from './components/FeatureStatusTable.vue'
import Landing from './components/Landing.vue'
import ModulesCoverageTable from './components/ModulesCoverageTable.vue'
import Playground from './components/Playground.vue'

export default {
	...DefaultTheme,
	enhanceApp({ app }) {
		app.component('FeatureStatusTable', FeatureStatusTable)
		app.component('Landing', Landing)
		app.component('ModulesCoverageTable', ModulesCoverageTable)
		app.component('Playground', Playground)
	},
}
