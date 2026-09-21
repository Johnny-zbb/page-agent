// @ts-check
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	root: __dirname,
	resolve: {
		alias: {
			'@page-agent/page-controller': resolve(
				__dirname,
				'../../packages/page-controller/src/PageController.ts'
			),
		},
	},
	server: {
		port: 5175,
		strictPort: true,
	},
})
